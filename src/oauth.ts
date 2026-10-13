import { createHash } from 'node:crypto';
import { PRESETS } from './providers';
import type { OAuthProvider, ProviderConnection } from './types';
import { isRecord } from './validate';

export interface GeminiOAuthSettings { clientId: string; clientSecret: string; projectId: string }
export type OAuthCredential =
  | { provider: 'openrouter'; apiKey: string }
  | { provider: 'gemini'; accessToken: string; refreshToken: string; expiresAt: number; clientId: string; projectId: string };
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/generative-language.retriever'];

export function geminiOAuthSettings(): GeminiOAuthSettings {
  return { clientId: process.env.GEMINI_OAUTH_CLIENT_ID?.trim() ?? '', clientSecret: process.env.GEMINI_OAUTH_CLIENT_SECRET?.trim() ?? '', projectId: process.env.GEMINI_OAUTH_PROJECT_ID?.trim() ?? '' };
}
function googleConfigured(settings: GeminiOAuthSettings): boolean {
  return settings.clientId.endsWith('.apps.googleusercontent.com') && Boolean(settings.clientSecret) && /^(?:[a-z][a-z0-9-]{4,61}[a-z0-9]|[0-9]{6,})$/.test(settings.projectId);
}
export function oauthProviders(settings: GeminiOAuthSettings) {
  return [
    { id: 'openrouter', name: 'OpenRouter', configured: true },
    { id: 'gemini', name: 'Google Gemini', configured: googleConfigured(settings), reason: googleConfigured(settings) ? '' : 'Configure GEMINI_OAUTH_CLIENT_ID, GEMINI_OAUTH_CLIENT_SECRET and GEMINI_OAUTH_PROJECT_ID on the server with your own Google Cloud OAuth client and enabled Generative Language API.' },
  ];
}
export function assertOAuthDestination(provider: unknown, connection: Pick<ProviderConnection, 'kind' | 'baseUrl'>): asserts provider is OAuthProvider {
  const preset = (provider === 'openrouter' || provider === 'gemini') && PRESETS.find(item => item.id === provider);
  if (!preset || connection.kind !== preset.kind || new URL(connection.baseUrl).href.replace(/\/+$/, '') !== preset.baseUrl) throw new Error('Provider login is supported only at the direct OpenRouter or Google Gemini API endpoint.');
}
export function oauthCallbackUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '') || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Provider login requires an HTTPS BASE_URL or an HTTP loopback address on this computer.');
  return new URL('/api/provider-oauth/callback', url).href;
}
export function oauthAuthorizationUrl(provider: OAuthProvider, callback: string, state: string, verifier: string, settings: GeminiOAuthSettings): string {
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL(provider === 'openrouter' ? 'https://openrouter.ai/auth' : 'https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (provider === 'openrouter') {
    url.searchParams.set('callback_url', callback);
    url.searchParams.set('key_label', 'ClassRoomAI');
  } else {
    if (!googleConfigured(settings)) throw new Error('Google Gemini OAuth is not configured on this server.');
    url.searchParams.set('client_id', settings.clientId);
    url.searchParams.set('redirect_uri', callback);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
  }
  return url.href;
}

// Token endpoint errors can echo codes, refresh tokens or client secrets. Never surface their bodies.
async function oauthRequest(url: string, body: string, contentType: string): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch(url, { method: 'POST', headers: { 'content-type': contentType }, body, redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('Provider authorization could not reach its token endpoint. Try signing in again.'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Provider authorization failed (HTTP ${response.status}). Try signing in again.`); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Provider authorization returned an empty response.');
  let bytes = 0, text = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32_768) { await reader.cancel(); throw new Error('oversized'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error('invalid');
    return parsed;
  } catch { throw new Error('Provider authorization returned an invalid response. Try signing in again.'); }
  finally { reader.releaseLock(); }
}
function secretString(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/\s/.test(value); }
function googleCredential(result: Record<string, unknown>, settings: GeminiOAuthSettings, previousRefreshToken?: string): OAuthCredential {
  const refreshToken = result.refresh_token ?? previousRefreshToken;
  if (!secretString(result.access_token) || !secretString(refreshToken) || typeof result.expires_in !== 'number' || !Number.isInteger(result.expires_in) || result.expires_in < 1 || result.expires_in > 604800 || typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer') throw new Error('Google did not return a usable offline grant. Sign in again and approve the requested API access.');
  if (typeof result.scope === 'string' && !GOOGLE_SCOPES.every(scope => result.scope!.toString().split(/\s+/).includes(scope))) throw new Error('Google did not grant the requested Gemini API scopes. Sign in again and approve both API scopes.');
  return { provider: 'gemini', accessToken: result.access_token, refreshToken, expiresAt: Date.now() + result.expires_in * 1000, clientId: settings.clientId, projectId: settings.projectId };
}
export async function exchangeOAuthCode(provider: OAuthProvider, code: string, verifier: string, callback: string, settings: GeminiOAuthSettings): Promise<OAuthCredential> {
  if (provider === 'openrouter') {
    const result = await oauthRequest('https://openrouter.ai/api/v1/auth/keys', JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }), 'application/json');
    if (!secretString(result.key)) throw new Error('OpenRouter did not return a usable API key. Sign in again.');
    return { provider, apiKey: result.key };
  }
  if (!googleConfigured(settings)) throw new Error('Google Gemini OAuth is not configured on this server.');
  return googleCredential(await oauthRequest('https://oauth2.googleapis.com/token', new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: callback, client_id: settings.clientId, client_secret: settings.clientSecret }).toString(), 'application/x-www-form-urlencoded'), settings);
}
export function parseOAuthCredential(text: string): OAuthCredential {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) throw new Error('invalid');
    if (value.provider === 'openrouter' && secretString(value.apiKey)) return { provider: 'openrouter', apiKey: value.apiKey };
    if (value.provider === 'gemini' && secretString(value.accessToken) && secretString(value.refreshToken) && typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) && typeof value.clientId === 'string' && typeof value.projectId === 'string') return { provider: 'gemini', accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt, clientId: value.clientId, projectId: value.projectId };
  } catch { /* Stored JSON parse details can contain credentials. */ }
  throw new Error('Stored provider login cannot be read. Sign in to the provider again.');
}
export function assertGoogleGrant(credential: Extract<OAuthCredential, { provider: 'gemini' }>, settings: GeminiOAuthSettings): void {
  if (!googleConfigured(settings) || credential.clientId !== settings.clientId || credential.projectId !== settings.projectId) throw new Error('Google OAuth client or project changed. Sign in to Gemini again.');
}
export async function refreshGoogleCredential(credential: Extract<OAuthCredential, { provider: 'gemini' }>, settings: GeminiOAuthSettings): Promise<OAuthCredential> {
  assertGoogleGrant(credential, settings);
  return googleCredential(await oauthRequest('https://oauth2.googleapis.com/token', new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credential.refreshToken, client_id: settings.clientId, client_secret: settings.clientSecret }).toString(), 'application/x-www-form-urlencoded'), settings, credential.refreshToken);
}
