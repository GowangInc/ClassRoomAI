import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load or create the 32-byte master key used for AES-GCM secret encryption.
 * Source priority: APP_SECRET env (hex or base64, >=32 bytes) else
 * `${dataDir}/master.key` (raw 32 bytes, mode 600). Never logged.
 */
export function ensureMasterKey(dataDir: string): Buffer {
  const env = process.env.APP_SECRET;
  if (env && env.trim()) {
    const s = env.trim();
    const raw = /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
    if (raw.length < 32) throw new Error('APP_SECRET must be hex or base64 encoding at least 32 bytes');
    return raw.subarray(0, 32);
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const keyPath = join(dataDir, 'master.key');
  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath);
    if (raw.length < 32) throw new Error('master.key is corrupt (too short); restore it from backup');
    return raw.subarray(0, 32);
  }
  const key = randomBytes(32);
  writeFileSync(keyPath, key, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return key;
}

/** AES-256-GCM encrypt; output `v1.` + base64(nonce | ciphertext | tag). */
export function encryptSecret(key: Buffer, plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1.' + Buffer.concat([nonce, ct, tag]).toString('base64');
}

/** Inverse of encryptSecret. Throws a generic error on any failure. */
export function decryptSecret(key: Buffer, blob: string): string {
  try {
    if (!blob.startsWith('v1.')) throw new Error('bad version');
    const raw = Buffer.from(blob.slice(3), 'base64');
    if (raw.length < 12 + 16) throw new Error('too short');
    const nonce = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const ct = raw.subarray(12, raw.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('invalid ciphertext');
  }
}

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

/** 32 random bytes, base64url — session token (only its hash is stored). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 hex of a session token; this is what the DB stores. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newId(): string {
  return crypto.randomUUID();
}

/** In-memory sliding-window rate limiter. Lazy sweep; no timers. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  allow(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    if (now - this.lastSweep > 60_000) this.sweep(now, windowMs);
    const cutoff = now - windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  private sweep(now: number, windowMs: number): void {
    this.lastSweep = now;
    const cutoff = now - windowMs;
    for (const [k, arr] of this.hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(k);
      else this.hits.set(k, kept);
    }
  }
}
