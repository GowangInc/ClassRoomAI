/**
 * ClassRoomAI provider adapters.
 *
 * Owns every outbound model request. Rules enforced here:
 *  - HTTPS for remote endpoints; plain HTTP only for loopback, tailnet
 *    (100.64.0.0/10), private addresses, and LAN-only names (.local, .internal,
 *    .home.arpa, single-label), which is what self-hosted servers use.
 *  - No URL credentials, query strings, or fragments. No redirect following.
 *  - Teacher instructions and materials are either delivered in full or the call fails
 *    with an actionable error; context is never silently truncated.
 *  - API keys and raw provider response bodies never leave this module.
 */
import type { ChatMessage, ProviderConfig, ProviderConnection, ProviderKind, ProviderModel } from './types';

/* -------------------------------------------------------------------------- */
/* Bounds                                                                     */
/* -------------------------------------------------------------------------- */

const KINDS: readonly ProviderKind[] = ['openai', 'anthropic', 'gemini'];

/**
 * Budget defaults and hard bounds, exported so the settings screen and the API
 * payload show exactly the numbers this module enforces.
 */
export const PROVIDER_LIMITS = {
  defaultMaxOutputTokens: 16_384,
  defaultContextChars: 60_000,
  maxOutputTokens: 128_000,
  minContextChars: 1_000,
  maxContextChars: 2_000_000,
};

const CHAT_TIMEOUT_MS = 120_000;
const IMAGE_TIMEOUT_MS = 180_000;

/** Upper bound on a provider response we are willing to buffer. */
const MAX_RESPONSE_CHARS = 24 * 1024 * 1024;

const MAX_NAME_CHARS = 80;
const MAX_ID_CHARS = 120;
const MAX_MODEL_CHARS = 200;
const MAX_API_KEY_CHARS = 8_192;
const MAX_IMAGE_PROMPT_CHARS = 8_000;

const MAX_IMAGES_PER_MESSAGE = 6;
const MAX_IMAGES_PER_REQUEST = 10;
/** ~6 MB of decoded image data per attachment. */
const MAX_IMAGE_BASE64_CHARS = 8_000_000;

const ANTHROPIC_VERSION = '2023-06-01';
const ERROR_DETAIL_CHARS = 300;

/* -------------------------------------------------------------------------- */
/* Presets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Optional starting points for the settings screen. No key is ever pre-filled;
 * a preset's optional budgets apply only when a saved config points at exactly
 * that preset endpoint. Model ids stay editable because vendor catalogues move;
 * every value below is a plain OpenAI/Anthropic/Gemini protocol endpoint.
 */
export const PRESETS: {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  imageModel?: string;
  /** Starting budgets applied only when this exact endpoint is used. */
  maxOutputTokens?: number;
  contextChars?: number;
}[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    imageModel: 'gpt-image-1',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    kind: 'openai',
    baseUrl: 'https://opencode.ai/zen/v1',
    model: 'glm-5.3-flash',
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    kind: 'openai',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    model: 'glm-5.3-flash',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
  },
  {
    id: 'together',
    name: 'Together AI',
    kind: 'openai',
    baseUrl: 'https://api.together.ai/v1',
    model: 'MiniMaxAI/MiniMax-M3',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    maxOutputTokens: 32_000,
    contextChars: 240_000,
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  {
    id: 'kimi',
    name: 'Kimi API',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2-0905-preview',
  },
  {
    id: 'zai',
    name: 'Z.ai (GLM)',
    kind: 'openai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-5.3-flash',
  },
  {
    id: 'bigmodel',
    name: 'Zhipu BigModel',
    kind: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-flash',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    imageModel: 'gemini-2.5-flash-image',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.2',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: '',
  },
];


/* -------------------------------------------------------------------------- */
/* Configuration validation                                                   */
/* -------------------------------------------------------------------------- */

/** Connection validation also works before a model has been selected. */
export function validateConnection(input: unknown): ProviderConnection {
  const raw = asRecord(input);
  if (!raw) throw new Error('Provider connection must be an object.');
  const kind = raw.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as ProviderKind)) throw new Error(`Provider kind must be one of: ${KINDS.join(', ')}.`);
  const connection: ProviderConnection = {
    name: optionalText(raw.name, 'name', MAX_NAME_CHARS) ?? 'Provider',
    kind: kind as ProviderKind,
    baseUrl: validateBaseUrl(raw.baseUrl),
  };
  const key = optionalText(raw.apiKey, 'apiKey', MAX_API_KEY_CHARS);
  if (key) connection.apiKey = key;
  if (raw.authMode === 'bearer' && connection.kind === 'gemini') {
    connection.authMode = 'bearer';
    const project = optionalText(raw.quotaProject, 'quotaProject', 100);
    if (project) connection.quotaProject = project;
  }
  return connection;
}

/** Fetch the provider's actual catalogue, including native cursor/token pagination. */
export async function listModels(input: unknown, signal?: AbortSignal): Promise<ProviderModel[]> {
  const connection = validateConnection(input);
  if (!connection.apiKey && !isPrivateHost(new URL(connection.baseUrl).hostname)) throw new Error('Supply an API key or choose an existing Keychain entry before loading models.');
  const models = new Map<string, ProviderModel>();
  const cursors = new Set<string>();
  const deadline = Date.now() + 30_000;
  let cursor = '';
  for (let page = 0; page < 100; page++) {
    const url = new URL(`${connection.baseUrl}/models`);
    if (connection.kind === 'anthropic') {
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('after_id', cursor);
    } else if (connection.kind === 'gemini') {
      url.searchParams.set('pageSize', '100');
      if (cursor) url.searchParams.set('pageToken', cursor);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('The provider model catalogue did not finish loading within 30 seconds.');
    const headers = authHeaders(connection.kind === 'openai' ? 'bearer' : connection.kind, connection.apiKey, connection);
    if (connection.kind === 'anthropic') headers['anthropic-version'] = ANTHROPIC_VERSION;
    let payload: unknown;
    try {
      payload = await requestJson(connection, url.href, headers, undefined, signal, remaining, 'GET');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load models.';
      if (/HTTP (404|405|501)/.test(message)) throw new Error('This provider does not expose a compatible model catalogue. Enter its model identifier manually.');
      throw error;
    }
    const root = asRecord(payload);
    const rows = root?.[connection.kind === 'gemini' ? 'models' : 'data'];
    if (!Array.isArray(rows)) throw new Error('The provider returned an unsupported model catalogue. Enter a model identifier manually.');
    for (const value of rows) {
      const row = asRecord(value);
      if (!row) throw new Error('The provider returned an invalid model entry.');
      if (connection.kind === 'gemini' && Array.isArray(row.supportedGenerationMethods) && !row.supportedGenerationMethods.includes('generateContent')) continue;
      const rawId = connection.kind === 'gemini' ? row.name : row.id;
      if (typeof rawId !== 'string' || !rawId.trim() || rawId.length > MAX_MODEL_CHARS) throw new Error('The provider returned an invalid model identifier.');
      const id = connection.kind === 'gemini' ? rawId.replace(/^models\//, '') : rawId;
      const label = row.display_name ?? row.displayName ?? row.name;
      models.set(id, { id, name: typeof label === 'string' && label.length <= 200 ? label : id });
      if (models.size > 10_000) throw new Error('The provider catalogue exceeds 10,000 models; enter a model identifier manually.');
    }
    const next = connection.kind === 'anthropic' && root?.has_more === true ? root.last_id : connection.kind === 'gemini' ? root?.nextPageToken : '';
    if (connection.kind === 'anthropic' && root?.has_more === true && !next) throw new Error('The provider omitted the next model catalogue cursor.');
    if (!next) return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (typeof next !== 'string' || next.length > 2048 || cursors.has(next)) throw new Error('The provider returned an invalid or repeated model catalogue cursor.');
    cursors.add(next); cursor = next;
  }
  throw new Error('The provider catalogue exceeded the pagination limit; enter a model identifier manually.');
}

/**
 * Validates untrusted provider settings (settings screen / API body) and returns
 * a complete, bounded `ProviderConfig`. Throws `Error` with a teacher-readable
 * message on anything unusable. A blank/absent `apiKey` is allowed (local
 * servers); a remote endpoint is rejected at call time without one.
 */
export function validateProvider(input: unknown): ProviderConfig {
  const raw = asRecord(input);
  if (!raw) throw new Error('Provider configuration must be an object.');

  const connection = validateConnection(input);

  const id = optionalText(raw.id, 'id', MAX_ID_CHARS) ?? crypto.randomUUID();
  const name = requiredText(raw.name, 'name', MAX_NAME_CHARS);
  const model = requiredText(raw.model, 'model', MAX_MODEL_CHARS);
  const { kind, baseUrl, apiKey } = connection;
  const imageModel = optionalText(raw.imageModel, 'imageModel', MAX_MODEL_CHARS);
  const keychainId = optionalText(raw.keychainId, 'keychainId', MAX_ID_CHARS);

  // A saved config that names a real endpoint starts from that endpoint's
  // budgets; anything else starts from the generic defaults. Supplied values are
  // never rewritten, however small.
  const budgets = PRESETS.find(item=>item.kind===kind&&item.baseUrl.replace(/\/+$/,'')===baseUrl);
  const maxOutputTokens =
    raw.maxOutputTokens === undefined || raw.maxOutputTokens === null
      ? budgets?.maxOutputTokens ?? PROVIDER_LIMITS.defaultMaxOutputTokens
      : ensurePositiveInteger(raw.maxOutputTokens, 'maxOutputTokens', 1, PROVIDER_LIMITS.maxOutputTokens);
  const contextChars =
    raw.contextChars === undefined || raw.contextChars === null
      ? budgets?.contextChars ?? PROVIDER_LIMITS.defaultContextChars
      : ensurePositiveInteger(raw.contextChars, 'contextChars', PROVIDER_LIMITS.minContextChars, PROVIDER_LIMITS.maxContextChars);

  const config: ProviderConfig = {
    id,
    name,
    kind: kind as ProviderKind,
    baseUrl,
    model,
    maxOutputTokens,
    contextChars,
  };
  // Kept absent rather than `undefined` so stored/JSON-serialised configs stay clean.
  if (apiKey) config.apiKey = apiKey;
  if (imageModel) config.imageModel = imageModel;
  if (keychainId) config.keychainId = keychainId;
  return config;
}

/**
 * Re-checks a stored config at call time (the database is not trusted) and
 * returns the normalised base URL.
 */
function assertUsable(config: ProviderConfig, action: string): { baseUrl: string; apiKey?: string } {
  const raw = asRecord(config);
  if (!raw) throw new Error('Provider configuration is missing.');
  const kind = raw.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as ProviderKind)) {
    throw new Error(`Provider "${config.id ?? ''}" has an unknown kind and cannot ${action}.`);
  }
  if (typeof config.model !== 'string' || !config.model.trim()) {
    throw new Error(`Provider "${config.name ?? config.id ?? ''}" has no model configured.`);
  }
  const baseUrl = validateBaseUrl(config.baseUrl);
  const apiKey = typeof config.apiKey === 'string' && config.apiKey.trim() ? config.apiKey.trim() : undefined;
  if (!apiKey && !isPrivateHost(new URL(baseUrl).hostname)) {
    throw new Error(`An API key is required for remote provider "${config.name ?? config.id ?? ''}". Add one in provider settings.`);
  }
  return { baseUrl, apiKey };
}

/** Validates an endpoint URL and returns it without a trailing slash. */
function validateBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Provider base URL is required.');
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Provider base URL must be an absolute URL, for example https://api.openai.com/v1.');
  }
  if (url.username || url.password) {
    throw new Error('Provider base URL must not embed credentials.');
  }
  if (url.search) {
    throw new Error('Provider base URL must not include a query string.');
  }
  if (url.hash) {
    throw new Error('Provider base URL must not include a fragment.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Provider base URL must use https (http is accepted only for loopback, tailnet, or private addresses).');
  }
  if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) {
    throw new Error('Insecure http is allowed only for loopback, tailnet (100.64.0.0/10), or private addresses. Use https for public endpoints.');
  }
  return url.toString().replace(/\/+$/, '');
}

/* -------------------------------------------------------------------------- */
/* Completion                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Runs one non-streaming chat completion and returns the assistant text.
 * Throws a safe, actionable `Error` when the provider cannot be reached, rejects
 * the request, or returns no text — a failure is never turned into a fake reply.
 */
export async function complete(
  config: ProviderConfig,
  system: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
  requireComplete = false,
): Promise<string> {
  const { baseUrl, apiKey } = assertUsable(config, 'run completions');
  if (typeof system !== 'string') throw new Error('System instructions must be text.');
  const prepared = prepareMessages(config, system, messages);

  switch (config.kind) {
    case 'openai':
      return completeOpenAi(config, baseUrl, apiKey, system, prepared, signal, requireComplete);
    case 'anthropic':
      return completeAnthropic(config, baseUrl, apiKey, system, prepared, signal, requireComplete);
    case 'gemini':
      return completeGemini(config, baseUrl, apiKey, system, prepared, signal, requireComplete);
    default:
      throw new Error(`Provider kind "${String(config.kind)}" is not supported.`);
  }
}

type PreparedImage = { mime: string; data: string };
type PreparedMessage = { role: 'user' | 'assistant'; content: string; images: PreparedImage[] };

/**
 * Validates every message and the total context size before a request is made.
 * Oversized context fails instead of quietly dropping teacher instructions,
 * materials or attachments.
 */
function prepareMessages(config: ProviderConfig, system: string, messages: ChatMessage[]): PreparedMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('At least one message is required.');
  }
  const prepared: PreparedMessage[] = [];
  let totalChars = system.length;
  let imageCount = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const record = asRecord(messages[index]);
    if (!record) throw new Error(`Message ${index + 1} is not a valid message.`);
    const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null;
    if (role === null) throw new Error(`Message ${index + 1} has an unsupported role.`);
    if (typeof record.content !== 'string') {
      throw new Error(`Message ${index + 1} must have text content.`);
    }
    const content = record.content;
    const images = normalizeImages(record.images, index);
    if (images.length && role === 'assistant') {
      throw new Error('Image attachments are only supported on user messages.');
    }
    imageCount += images.length;
    if (imageCount > MAX_IMAGES_PER_REQUEST) {
      throw new Error(`Too many image attachments (limit ${MAX_IMAGES_PER_REQUEST} per request).`);
    }
    totalChars += content.length;
    prepared.push({ role, content, images });
  }

  const limit = ensurePositiveInteger(config.contextChars, 'contextChars');
  if (totalChars > limit) {
    throw new Error(
      `This conversation is ${totalChars} characters but provider "${config.name}" is limited to ${limit}. ` +
        'Remove materials or attachments, shorten the history, or raise the context limit in provider settings.',
    );
  }
  return prepared;
}

function normalizeImages(value: unknown, messageIndex: number): PreparedImage[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`Message ${messageIndex + 1} has malformed attachments.`);
  if (value.length > MAX_IMAGES_PER_MESSAGE) {
    throw new Error(`Message ${messageIndex + 1} has too many attachments (limit ${MAX_IMAGES_PER_MESSAGE}).`);
  }
  return value.map((image, imageIndex) => normalizeImage(image, messageIndex, imageIndex));
}

function normalizeImage(value: unknown, messageIndex: number, imageIndex: number): PreparedImage {
  const label = `Attachment ${imageIndex + 1} of message ${messageIndex + 1}`;
  const record = asRecord(value);
  if (!record) throw new Error(`${label} is not a valid image.`);
  const mimeRaw = record.mime;
  const dataRaw = record.data;
  let mime = typeof mimeRaw === 'string' ? mimeRaw.trim().toLowerCase() : '';
  let data = typeof dataRaw === 'string' ? dataRaw.trim() : '';

  if (data.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(data);
    if (!match) throw new Error(`${label} is not a valid data URL.`);
    if (match[1]) mime = match[1].trim().toLowerCase();
    data = match[3];
  }

  if (!/^image\/(png|jpe?g|gif|webp|bmp)$/.test(mime)) {
    throw new Error(`${label} has an unsupported image type (${mime || 'unknown'}).`);
  }
  data = data.replace(/\s+/g, '');
  if (!data) throw new Error(`${label} has no image data.`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new Error(`${label} is not valid base64 image data.`);
  }
  if (data.length > MAX_IMAGE_BASE64_CHARS) {
    throw new Error(`${label} is too large to send.`);
  }
  return { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, data };
}

async function completeOpenAi(
  config: ProviderConfig,
  baseUrl: string,
  apiKey: string | undefined,
  system: string,
  messages: PreparedMessage[],
  signal: AbortSignal | undefined,
  requireComplete: boolean,
): Promise<string> {
  const body = {
    model: config.model,
    max_tokens: ensurePositiveInteger(config.maxOutputTokens, 'maxOutputTokens'),
    stream: false,
    messages: [
      { role: 'system', content: system },
      ...messages.map((message) => {
        // Some OpenAI-compatible servers reject an empty content part.
        const caption = message.content || ' ';
        return {
          role: message.role,
          content: message.images.length
            ? [
                { type: 'text', text: caption },
                ...message.images.map((image) => ({
                  type: 'image_url',
                  image_url: { url: `data:${image.mime};base64,${image.data}` },
                })),
              ]
            : caption,
        };
      }),
    ],
  };

  const payload = await requestJson(config, `${baseUrl}/chat/completions`, authHeaders('bearer', apiKey), body, signal, CHAT_TIMEOUT_MS);
  const root = asRecord(payload);
  const choices = root?.['choices'];
  const choice = Array.isArray(choices) ? asRecord(choices[0]) : null;
  const message = choice ? asRecord(choice['message']) : null;
  const text = readTextBlocks(message?.['content']);
  if (requireComplete && choice?.finish_reason === 'length') throw new Error(`The model reached the ${config.maxOutputTokens}-token output limit before completing the design. Increase Maximum output tokens in Providers or request a shorter draft; no partial design was applied.`);
  if (text.trim()) return text;

  const refusal = message?.['refusal'];
  if (typeof refusal === 'string' && refusal.trim()) {
    throw new Error(`Provider "${config.name}" declined this request.`);
  }
  const finishRaw = choice?.['finish_reason'];
  const finish = typeof finishRaw === 'string' ? finishRaw : '';
  throw new Error(
    `Provider "${config.name}" returned no text${finish ? ` (finish reason: ${finish})` : ''}.`,
  );
}

async function completeAnthropic(
  config: ProviderConfig,
  baseUrl: string,
  apiKey: string | undefined,
  system: string,
  messages: PreparedMessage[],
  signal: AbortSignal | undefined,
  requireComplete: boolean,
): Promise<string> {
  const body = {
    model: config.model,
    max_tokens: ensurePositiveInteger(config.maxOutputTokens, 'maxOutputTokens'),
    system,
    messages: messages.map((message) => ({
      role: message.role,
      content: [
        ...message.images.map((image) => ({
          type: 'image',
          source: { type: 'base64', media_type: image.mime, data: image.data },
        })),
        { type: 'text', text: message.content || ' ' },
      ],
    })),
  };

  const headers = { ...authHeaders('anthropic', apiKey), 'anthropic-version': ANTHROPIC_VERSION };
  const payload = await requestJson(config, `${baseUrl}/messages`, headers, body, signal, CHAT_TIMEOUT_MS);
  const root = asRecord(payload);
  const text = readTextBlocks(root?.['content']);
  if (requireComplete && root?.stop_reason === 'max_tokens') throw new Error(`The model reached the ${config.maxOutputTokens}-token output limit before completing the design. Increase Maximum output tokens in Providers or request a shorter draft; no partial design was applied.`);
  if (text.trim()) return text;

  const stopRaw = root?.['stop_reason'];
  const stop = typeof stopRaw === 'string' ? stopRaw : '';
  throw new Error(`Provider "${config.name}" returned no text${stop ? ` (stop reason: ${stop})` : ''}.`);
}

async function completeGemini(
  config: ProviderConfig,
  baseUrl: string,
  apiKey: string | undefined,
  system: string,
  messages: PreparedMessage[],
  signal: AbortSignal | undefined,
  requireComplete: boolean,
): Promise<string> {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((message) => {
      const parts: Record<string, unknown>[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const image of message.images) {
        parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
      }
      if (!parts.length) parts.push({ text: ' ' });
      return { role: message.role === 'assistant' ? 'model' : 'user', parts };
    }),
    generationConfig: { maxOutputTokens: ensurePositiveInteger(config.maxOutputTokens, 'maxOutputTokens') },
  };

  // Model ids are sometimes pasted as "models/<id>"; keep only the id for the path segment.
  const url = `${baseUrl}/models/${encodeURIComponent(config.model.trim().replace(/^models\//, ''))}:generateContent`;
  const payload = await requestJson(config, url, authHeaders('gemini', apiKey, config), body, signal, CHAT_TIMEOUT_MS);
  const root = asRecord(payload);
  const candidate = firstRecord(root?.['candidates']);
  const text = candidate ? readTextBlocks(asRecord(candidate['content'])?.['parts']) : '';
  if (requireComplete && candidate?.finishReason === 'MAX_TOKENS') throw new Error(`The model reached the ${config.maxOutputTokens}-token output limit before completing the design. Increase Maximum output tokens in Providers or request a shorter draft; no partial design was applied.`);
  if (text.trim()) return text;

  const blockReason = asRecord(root?.['promptFeedback'])?.['blockReason'];
  if (typeof blockReason === 'string' && blockReason) {
    throw new Error(`Provider "${config.name}" blocked this request (${blockReason}).`);
  }
  const finishRaw = candidate?.['finishReason'];
  const finish = typeof finishRaw === 'string' ? finishRaw : '';
  throw new Error(`Provider "${config.name}" returned no text${finish ? ` (finish reason: ${finish})` : ''}.`);
}

/* -------------------------------------------------------------------------- */
/* Image generation                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Generates one image and returns it as base64. Anthropic has no image
 * generation endpoint, so that case fails explicitly instead of silently
 * falling back to text.
 */
export async function generateImage(
  config: ProviderConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ mime: string; data: string }> {
  const { baseUrl, apiKey } = assertUsable(config, 'generate images');
  const text = requiredText(prompt, 'prompt', MAX_IMAGE_PROMPT_CHARS);

  if (config.kind === 'anthropic') {
    throw new Error(
      'Image generation is not supported by Anthropic providers. Configure an OpenAI-compatible or Gemini image model instead.',
    );
  }
  const imageModel = typeof config.imageModel === 'string' ? config.imageModel.trim() : '';
  if (!imageModel) {
    throw new Error(`No image model is configured for provider "${config.name}". Add one in provider settings.`);
  }

  if (config.kind === 'gemini') {
    return geminiImage(config, baseUrl, apiKey, imageModel, text, signal);
  }
  return openAiImage(config, baseUrl, apiKey, imageModel, text, signal);
}

async function openAiImage(
  config: ProviderConfig,
  baseUrl: string,
  apiKey: string | undefined,
  imageModel: string,
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<{ mime: string; data: string }> {
  const body: Record<string, unknown> = { model: imageModel, prompt, n: 1, size: '1024x1024' };
  // `response_format` is a DALL·E-era parameter; GPT Image models reject it and
  // already answer with base64.
  if (/^dall-e/i.test(imageModel)) body['response_format'] = 'b64_json';

  const payload = await requestJson(
    config,
    `${baseUrl}/images/generations`,
    authHeaders('bearer', apiKey),
    body,
    signal,
    IMAGE_TIMEOUT_MS,
  );
  const root = asRecord(payload);
  const first = firstRecord(root?.['data']);
  const base64Raw = first?.['b64_json'];
  const base64 = typeof base64Raw === 'string' ? base64Raw.trim() : '';
  if (!base64) {
    const link = first?.['url'];
    if (typeof link === 'string' && link) {
      throw new Error(
        `Provider "${config.name}" returned an image link instead of image data. ` +
          'Use an image model that returns base64 (for example an OpenAI GPT Image model).',
      );
    }
    throw new Error(`Provider "${config.name}" returned no image data.`);
  }
  return { mime: 'image/png', data: base64 };
}

async function geminiImage(
  config: ProviderConfig,
  baseUrl: string,
  apiKey: string | undefined,
  imageModel: string,
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<{ mime: string; data: string }> {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const url = `${baseUrl}/models/${encodeURIComponent(imageModel.replace(/^models\//, ''))}:generateContent`;
  const payload = await requestJson(config, url, authHeaders('gemini', apiKey, config), body, signal, IMAGE_TIMEOUT_MS);

  const root = asRecord(payload);
  const candidate = firstRecord(root?.['candidates']);
  const parts = candidate ? asRecord(candidate['content'])?.['parts'] : null;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const record = asRecord(part);
      const inline = record ? asRecord(record['inlineData']) ?? asRecord(record['inline_data']) : null;
      if (!inline) continue;
      const dataRaw = inline['data'];
      const data = typeof dataRaw === 'string' ? dataRaw.trim() : '';
      if (!data) continue;
      const mimeRaw = inline['mimeType'] ?? inline['mime_type'];
      const mime = typeof mimeRaw === 'string' && mimeRaw ? mimeRaw : 'image/png';
      return { mime, data };
    }
  }

  const blockReason = asRecord(root?.['promptFeedback'])?.['blockReason'];
  if (typeof blockReason === 'string' && blockReason) {
    throw new Error(`Provider "${config.name}" blocked this image request (${blockReason}).`);
  }
  const finishRaw = candidate?.['finishReason'];
  const finish = typeof finishRaw === 'string' ? finishRaw : '';
  throw new Error(
    `Provider "${config.name}" returned no image data${finish ? ` (finish reason: ${finish})` : ''}.`,
  );
}

/* -------------------------------------------------------------------------- */
/* HTTP plumbing                                                              */
/* -------------------------------------------------------------------------- */

function authHeaders(kind: 'bearer' | 'anthropic' | 'gemini', apiKey: string | undefined, config?: ProviderConnection): Record<string, string> {
  if (!apiKey) return {};
  if (kind === 'bearer') return { authorization: `Bearer ${apiKey}` };
  if (kind === 'anthropic') return { 'x-api-key': apiKey };
  if (config?.authMode === 'bearer') return { authorization: `Bearer ${apiKey}`, ...(config.quotaProject ? { 'x-goog-user-project': config.quotaProject } : {}) };
  return { 'x-goog-api-key': apiKey };
}

/**
 * POSTs JSON, refuses redirects, bounds response size and time, and converts
 * every failure into a safe message (status + short explanation, key redacted).
 */
async function requestJson(
  config: ProviderConnection,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  method: 'GET' | 'POST' = 'POST',
): Promise<unknown> {
  const guard = createGuard(signal, timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { ...headers, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: guard.signal,
    });
  } catch (error) {
    guard.dispose();
    throw transportError(config, error, guard, timeoutMs);
  }

  let text = '';
  let oversized = false;
  try {
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_CHARS) {
      oversized = true;
      await response.body?.cancel();
      throw new Error('Response exceeds the byte limit.');
    }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_CHARS) {
          oversized = true;
          await reader.cancel();
          throw new Error('Response exceeds the byte limit.');
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    }
  } catch (error) {
    if (oversized) throw new Error(`Provider "${config.name}" returned an oversized response.`);
    throw transportError(config, error, guard, timeoutMs);
  } finally {
    guard.dispose();
  }

  if (!response.ok) {
    throw new Error(httpError(config, response.status, text));
  }
  if (text.length > MAX_RESPONSE_CHARS) {
    throw new Error(`Provider "${config.name}" returned an oversized response.`);
  }
  if (!text.trim()) {
    throw new Error(`Provider "${config.name}" returned an empty response (HTTP ${response.status}).`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Provider "${config.name}" returned a response that was not valid JSON (HTTP ${response.status}).`);
  }
}

type RequestGuard = {
  signal: AbortSignal;
  timedOut: boolean;
  aborted: boolean;
  dispose: () => void;
};

function createGuard(signal: AbortSignal | undefined, timeoutMs: number): RequestGuard {
  const controller = new AbortController();
  const guard: RequestGuard = {
    signal: controller.signal,
    timedOut: false,
    aborted: false,
    dispose: () => {},
  };
  const timer = setTimeout(() => {
    guard.timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => {
    guard.aborted = true;
    controller.abort();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  guard.dispose = () => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  };
  return guard;
}

function transportError(config: ProviderConnection, error: unknown, guard: RequestGuard, timeoutMs: number): Error {
  if (guard.timedOut) {
    return new Error(`Provider "${config.name}" did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
  }
  if (guard.aborted) return new Error('Request cancelled.');
  const cause = asRecord(error)?.['cause'] ?? (error instanceof Error ? error.cause : undefined);
  const detail = `${error instanceof Error ? error.message : ''} ${cause instanceof Error ? cause.message : ''}`;
  if (/redirect/i.test(detail)) {
    return new Error(`Provider "${config.name}" responded with a redirect, which is not allowed. Use the provider's direct API base URL.`);
  }
  return new Error(`Could not reach provider "${config.name}". Check the base URL and your network connection.`);
}

/** `Provider "X" rejected the request (HTTP 401): short safe reason.` */
function httpError(config: ProviderConnection, status: number, bodyText: string): string {
  const detail = safeProviderDetail(bodyText, config.apiKey);
  const hint = status === 401 || status === 403 ? ' Check the API key for this provider.' : '';
  return `Provider "${config.name}" rejected the request (HTTP ${status})${detail ? `: ${detail}` : ''}.${hint}`;
}

/** Extracts a short, key-free explanation from an error body; never the raw body. */
function safeProviderDetail(bodyText: string, apiKey: string | undefined): string {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    const root = asRecord(parsed);
    const error = root?.['error'];
    const nested = asRecord(error);
    const candidates = [
      nested?.['message'],
      typeof error === 'string' ? error : undefined,
      root?.['message'],
      root?.['detail'],
    ];
    const found = candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (found) detail = found;
  } catch {
    detail = '';
  }
  detail = detail.replace(/\s+/g, ' ').trim();
  if (apiKey) detail = detail.split(apiKey).join('[redacted]');
  detail = detail.replace(
    /\b(?:api[_-]?key|apikey|access[_-]?token|authorization|bearer|x-api-key|x-goog-api-key)\b\s*[:=]?\s*[A-Za-z0-9._\-]{8,}/gi,
    '[redacted]',
  );
  if (detail.length > ERROR_DETAIL_CHARS) detail = `${detail.slice(0, ERROR_DETAIL_CHARS)}…`;
  return detail;
}

/* -------------------------------------------------------------------------- */
/* Small shared helpers                                                       */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? asRecord(value[0]) : null;
}

/** Joins the text of an OpenAI `content` string/array or Anthropic/Gemini block list. */
function readTextBlocks(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  let text = '';
  for (const block of value) {
    const record = asRecord(block);
    const blockText = record?.['text'];
    if (typeof blockText === 'string') text += blockText;
  }
  return text;
}

function requiredText(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Provider ${field} is required.`);
  }
  return boundedText(value, field, maxChars);
}

function optionalText(value: unknown, field: string, maxChars: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`Provider ${field} must be text.`);
  if (!value.trim()) return undefined;
  return boundedText(value, field, maxChars);
}

function boundedText(value: string, field: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length > maxChars) {
    throw new Error(`Provider ${field} must be ${maxChars} characters or fewer.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) {
    throw new Error(`Provider ${field} contains unsupported control characters.`);
  }
  return trimmed;
}

function ensurePositiveInteger(value: unknown, field: string, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Provider ${field} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Host classification                                                        */
/* -------------------------------------------------------------------------- */

/**
 * True for loopback, tailnet (100.64.0.0/10), and private IPv4/IPv6 addresses,
 * plus local network names. Plain HTTP is allowed only for these hosts.
 */
function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  const lower = host.trim().toLowerCase().replace(/\.$/, '');
  if (!lower) return false;
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (/\.(local|internal|home\.arpa|lan)$/.test(lower)) return true;
  const ipv4 = parseIpv4(lower);
  if (ipv4) return isPrivateIpv4(ipv4);
  if (lower.includes(':')) return isPrivateIpv6(lower);
  // A single-label name cannot resolve on the public internet.
  return !lower.includes('.');
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map((part) => Number(part)) as [number, number, number, number];
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const address = host.split('%')[0];
  if (address === '::1' || address === '::') return true;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address);
  if (mapped) {
    const ipv4 = parseIpv4(mapped[1]);
    return ipv4 ? isPrivateIpv4(ipv4) : false;
  }
  const first = Number.parseInt(address.split(':')[0] ?? '', 16);
  if (!Number.isFinite(first)) return false;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  return false;
}
