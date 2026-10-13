import { PRESETS } from './providers';
import type { ProviderConnection } from './types';

const ENTRIES = [
  { id: 'gemini-api', name: 'Google Gemini', presetId: 'gemini' },
  { id: 'aistudio-api', name: 'Google AI Studio', presetId: 'gemini' },
  { id: 'deepseek-api', name: 'DeepSeek', presetId: 'deepseek' },
  { id: 'openrouter-api', name: 'OpenRouter', presetId: 'openrouter' },
  { id: 'moonshot-api', name: 'Moonshot', presetId: 'moonshot' },
  { id: 'kimi-api', name: 'Kimi API', presetId: 'kimi' },
] as const;

/** A Keychain credential can only be sent to the corresponding provider's direct API. */
export function assertKeychainDestination(id: string, connection: Pick<ProviderConnection, 'kind' | 'baseUrl'>): void {
  const entry = ENTRIES.find(item => item.id === id);
  const preset = entry && PRESETS.find(item => item.id === entry.presetId);
  let destination: string;
  try { destination = new URL(connection.baseUrl.trim().replace(/\/+$/, '')).href; }
  catch { throw new Error('Enter a valid provider API base URL.'); }
  if (!preset || connection.kind !== preset.kind || destination !== new URL(preset.baseUrl).href) {
    throw new Error('This Keychain entry belongs to a different provider endpoint. Choose its matching preset, or enter a separate API key.');
  }
}

async function readEntry(id: string, secret: boolean): Promise<string | null> {
  if (process.platform !== 'darwin') throw new Error('Existing macOS Keychain keys are available only on macOS. Enter a provider key instead.');
  if (!ENTRIES.some(entry => entry.id === id)) throw new Error('Choose one of the supported provider Keychain entries.');
  const args = ['/usr/bin/security', 'find-generic-password', '-s', id];
  if (secret) args.push('-w');
  // The key is captured in memory only: no secret argv, output, files, or Keychain writes.
  const child = Bun.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10_000);
  try {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let value = '', bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > (secret ? 8192 : 64 * 1024)) {
        await reader.cancel(); child.kill();
        throw new Error('The Keychain entry is too large to use as a provider API key.');
      }
      if (secret) value += decoder.decode(chunk.value, { stream: true });
    }
    if (secret) value += decoder.decode();
    const status = await child.exited;
    if (timedOut) throw new Error('Keychain access timed out. Unlock the login Keychain and approve access on this computer, then try again.');
    if (status === 44) return null; // errSecItemNotFound (-25300)
    if (status !== 0) throw new Error('Keychain access was denied or the login Keychain is locked. Approve access on this computer, or enter a key manually.');
    return secret ? value.trim() || null : '';
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
}

export async function listKeychainEntries(): Promise<{ supported: boolean; entries: { id: string; name: string; presetId: string; available: boolean }[] }> {
  if (process.platform !== 'darwin') return { supported: false, entries: [] };
  const entries = [];
  for (const entry of ENTRIES) entries.push({ ...entry, available: (await readEntry(entry.id, false)) !== null });
  return { supported: true, entries };
}

export async function resolveKeychainKey(id: string, connection: Pick<ProviderConnection, 'kind' | 'baseUrl'>): Promise<string> {
  assertKeychainDestination(id, connection);
  const key = await readEntry(id, true);
  if (!key) throw new Error('That provider key was not found in this computer’s Keychain. Choose an available entry or enter a key manually.');
  return key;
}
