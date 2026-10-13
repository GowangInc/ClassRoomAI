import { serve } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import QRCode from 'qrcode';
import { decryptSecret, encryptSecret, ensureMasterKey, hashPassword, hashToken, newId, randomToken, RateLimiter, verifyPassword } from './auth';
import {
  messageFromRow, openDb, participantFromRow, providerFromRow, runFromRow, runSummaryFromRow,
  spaceFromRow, teacherFromRow,
} from './db';
import type { MessageRow, ParticipantRow, ProviderRow, RunRow, SpaceRow, StoredProvider, TeacherRow } from './db';
import { extractMaterial, isImageMaterial, MAX_FILE_BYTES, validateMaterialInput } from './files';
import { buildSystemPrompt, generateRunCode, isRunExpired, studentSpace, toolEnabled, validateSpacePatch } from './spaces';
import type { SpacePatch } from './spaces';
import { complete, generateImage, listModels, PRESETS, validateConnection, validateProvider } from './providers';
import { assertKeychainDestination, listKeychainEntries, resolveKeychainKey } from './keychain';
import { assertGoogleGrant, assertOAuthDestination, exchangeOAuthCode, geminiOAuthSettings, oauthAuthorizationUrl, oauthCallbackUrl, oauthProviders, parseOAuthCredential, refreshGoogleCredential } from './oauth';
import type { GeminiOAuthSettings, OAuthCredential } from './oauth';
import { assessTask } from './assessment';
import { acknowledgeAlert, createAlertTables, listAlerts, recordAlerts } from './safeguarding';
import type { ChatMessage, Material, Message, MessageFeedback, OAuthProvider, OutcomeInsight, Participant, ProviderConfig, ProviderConnection, ProviderKind, Run, Space, SpaceType, StudentInsight, Teacher } from './types';
import { asMaterials, asSpaceType, asStudentInsight, isJsonValue, isRecord, parseJson, TOOL_TYPES } from './validate';

export interface ServerLike {
  requestIP?: (req: Request) => { address: string } | null;
}

export interface AppOptions {
  dataDir: string;
  /** Public origin used for QR/join links and CSRF allowlisting (e.g. http://192.168.1.10:9272). */
  baseUrl?: string;
  geminiOAuth?: GeminiOAuthSettings;
}

export interface AppHandle {
  fetch(req: Request, server?: ServerLike): Promise<Response> | Response;
  close(): void;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self'; frame-src https://www.youtube-nocookie.com https://www.youtube.com; base-uri 'self'; form-action 'self'",
};

export const MAX_JSON_BODY = 25 * 1024 * 1024;
/**
 * Seconds a request may sit idle before Bun closes it. Bun's 10-second default is far
 * too short for slow model and image replies; exported so smoke checks match the server.
 */
export const SERVER_IDLE_SECONDS = 210;
/** Multipart uploads: the 10 MB file bound plus room for part headers and the boundary. */
const MAX_MULTIPART_BODY = MAX_FILE_BYTES + 64 * 1024;
const MAX_ARTIFACT_CHARS = 15_000_000;
const MAX_PARTICIPANTS_PER_RUN = 200;
const TEACHER_SESSION_DAYS = 30;
const STUDENT_SESSION_DAYS = 7;
const TEACHER_COOKIE = 'cra_teacher';
const STUDENT_COOKIE = 'cra_student';

const RESPONSE_LANGUAGES: Record<string, true> = {
  English: true, Chinese: true, Spanish: true, French: true, Arabic: true,
  Hindi: true, Portuguese: true, German: true, Japanese: true, Korean: true,
};
const SUPPORT_LEVELS: Record<string, true> = {
  'more-support': true, standard: true, challenge: true,
};

type DesignTarget = 'draft' | 'outcomes' | 'descriptions';

function isDesignTarget(x: unknown): x is DesignTarget {
  return x === 'draft' || x === 'outcomes' || x === 'descriptions';
}

/**
 * Fields the teacher-facing design assistant may propose. Ownership, ids,
 * provider settings and visibility are never part of a draft: the model can only
 * suggest authoring content the teacher then reviews and saves.
 */
const DESIGN_FIELDS: Record<DesignTarget, readonly (keyof SpacePatch)[]> = {
  draft: [
    'title', 'subtitle', 'instructions', 'audienceDetails', 'interactionStyle', 'outcomes', 'agenda',
    'teacherDescription', 'studentDescription', 'gradeLevel', 'spaceType',
  ],
  outcomes: ['outcomes'],
  descriptions: ['title', 'subtitle', 'teacherDescription', 'studentDescription'],
};

/** JSON shape requested from the model per target, kept inside the canonical validator limits. */
const DESIGN_SHAPES: Record<DesignTarget, string> = {
  draft:
    '{"title":string,"subtitle":string,"instructions":string,' +
    '"audienceDetails":string,"interactionStyle":string,"outcomes":[string],' +
    '"agenda":[{"title":string,"instructions":string,"tool":string|null}],' +
    '"teacherDescription":string,"studentDescription":string,"gradeLevel":string,' +
    '"spaceType":"student-learning"|"teacher-productivity"|"staff-operations"}',
  outcomes: '{"outcomes":[string]}',
  descriptions: '{"title":string,"subtitle":string,"teacherDescription":string,"studentDescription":string}',
};

/** Image attachments per design request; matches the provider adapter's per-message bound. */
const MAX_DESIGN_IMAGES = 6;

const STATIC_FILES: Record<string, string> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/styles.css': 'styles.css',
  '/tools.js': 'tools.js',
  '/alerts.js': 'alerts.js',
  '/oauth-callback.js': 'oauth-callback.js',
};

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return new Response(JSON.stringify(data), { status, headers });
}

function err(message: string, status: number): Response {
  return json({ error: message }, status);
}

/**
 * Spreadsheet-safe CSV cell: a formula, or whitespace/control characters hiding one, is
 * neutralized first and quotes are doubled after, so an export can never auto-execute.
 */
function csvCell(value: string): string {
  const neutralized = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

/** Destination identity of a stored provider key; a trailing slash does not move it. */
function normalizeBaseUrl(baseUrl: string | undefined): string {
  const value = (baseUrl ?? '').trim().replace(/\/+$/, '');
  try {
    return new URL(value).href; // Hostnames are case-insensitive; paths are not.
  } catch {
    return value;
  }
}

/** Comparison key for an outcome label; ignores numbering, casing and spacing. */
function outcomeKey(label: string): string {
  return label.trim().replace(/^\d+[.)]\s*/, '').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * One insight row per canonical Space outcome, in canonical order. Rows the model invented,
 * renamed or duplicated are dropped, so stored mastery always maps to a real outcome.
 */
function alignOutcomeInsights(canonical: readonly string[], rows: readonly OutcomeInsight[]): OutcomeInsight[] {
  const byKey = new Map<string, OutcomeInsight>();
  for (const row of rows) {
    const key = outcomeKey(row.outcome);
    if (key && !byKey.has(key)) byKey.set(key, row);
  }
  return canonical.map((label) => {
    const row = byKey.get(outcomeKey(label));
    return { outcome: label, mastery: row?.mastery ?? null, evidence: row ? [...row.evidence] : [] };
  });
}

export function createApp(opts: AppOptions): AppHandle {
  const db = openDb(opts.dataDir);
  const masterKey = ensureMasterKey(opts.dataDir);
  const baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:9272').replace(/\/+$/, '');
  const secureCookies = baseUrl.startsWith('https://');
  const limiter = new RateLimiter();
  const inFlightChats = new Map<string, Promise<Response>>();
  const publicDir = join(import.meta.dir, '..', 'public');
  const mathBundle = join(import.meta.dir, '..', 'node_modules', 'mathjs', 'lib', 'browser', 'math.js');
  createAlertTables(db);
  const googleOAuth = opts.geminiOAuth ?? geminiOAuthSettings();
  const oauthRefreshes = new Map<string, Promise<OAuthCredential>>();
  type LoginFlow = { provider: OAuthProvider; config: ProviderConfig; teacherId: string; sessionHash: string; browserHash: string; verifier: string; callback: string; expiresAt: number; previous: string | null; code?: string };
  const oauthFlows = new Map<string, LoginFlow>();
  const oauthFinishes = new Map<string, LoginFlow>();
  const oauthCookie = 'classroomai_provider_oauth';
  let closed = false;

  // ---------- generic helpers ----------

  function clientIp(req: Request, server?: ServerLike): string {
    const info = server?.requestIP?.(req);
    if (!info) return '127.0.0.1'; // direct handler invocation (self-check): loopback
    return info.address.replace(/^::ffff:/, '');
  }

  function checkCsrf(req: Request): void {
    const origin = req.headers.get('origin');
    if (origin === null) return; // non-browser same-origin clients; SameSite=Strict cookies guard browsers
    const host = req.headers.get('host');
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Invalid Origin header');
    }
    let trustedHost = '';
    try {
      trustedHost = new URL(baseUrl).host;
    } catch {
      trustedHost = '';
    }
    if (originHost !== host && originHost !== trustedHost) throw new HttpError(403, 'Cross-origin request rejected');
  }

  /**
   * Reads a request body while counting bytes, cancelling as soon as the limit is passed so
   * an oversized body is never fully buffered. The one body reader for JSON and multipart.
   */
  async function readBodyBytes(req: Request, maxBytes: number, tooLarge: string): Promise<Uint8Array<ArrayBuffer>> {
    const declared = Number(req.headers.get('content-length') ?? Number.NaN);
    if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, tooLarge);
    const stream = req.body;
    if (!stream) return new Uint8Array(0);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new HttpError(413, tooLarge);
        }
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, 'Could not read request body');
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  }

  async function parseBody(req: Request): Promise<unknown> {
    const bytes = await readBodyBytes(req, MAX_JSON_BODY, 'Request body too large');
    if (bytes.byteLength === 0) return {};
    const text = new TextDecoder('utf-8').decode(bytes);
    try {
      return parseJson(text);
    } catch {
      throw new HttpError(400, 'Body must be valid JSON');
    }
  }

  function requireString(v: unknown, label: string, min: number, max: number): string {
    if (typeof v !== 'string') throw new HttpError(400, `${label} must be a string`);
    const t = v.trim();
    if (t.length < min) throw new HttpError(400, `${label} is required`);
    if (t.length > max) throw new HttpError(400, `${label} too long (max ${max} characters)`);
    return t;
  }

  function requirePassword(value: unknown): string {
    if (typeof value !== 'string') throw new HttpError(400, 'Enter a password.');
    if (value.length < 4) throw new HttpError(400, 'Password must contain at least 4 characters.');
    if (value.length > 200) throw new HttpError(400, 'Password is too long (maximum 200 characters).');
    return value;
  }

  function cookieValue(req: Request, name: string): string | null {
    const header = req.headers.get('cookie');
    if (!header) return null;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return null;
  }

  function sessionSetCookie(name: string, token: string, days: number): string {
    const secure = secureCookies ? '; Secure' : '';
    return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${days * 86400}${secure}`;
  }

  function sessionClearCookie(name: string): string {
    const secure = secureCookies ? '; Secure' : '';
    return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  }

  function flowCookie(value: string, sameSite: 'Lax' | 'Strict', clear = false): string {
    return `${oauthCookie}=${clear ? '' : value}; Path=/api/provider-oauth; HttpOnly; SameSite=${sameSite}; Max-Age=${clear ? 0 : 600}${secureCookies ? '; Secure' : ''}`;
  }

  function providerFingerprint(id: string): string | null {
    const row = db.query('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow | null;
    return row ? hashToken(JSON.stringify(row)) : null;
  }

  function loginSessionActive(req: Request, flow: LoginFlow): boolean {
    const token = cookieValue(req, TEACHER_COOKIE);
    if (!token || hashToken(token) !== flow.sessionHash) return false;
    const teacher = getTeacher(req);
    return Boolean(teacher?.admin && teacher.id === flow.teacherId);
  }

  // ---------- auth lookups ----------

  function nowIso(): string {
    return new Date().toISOString();
  }

  function createTeacherSession(teacherId: string): string {
    const token = randomToken();
    db.query('INSERT INTO teacher_sessions(token_hash, teacher_id, created_at, expires_at) VALUES (?,?,?,?)').run(
      hashToken(token), teacherId, nowIso(), new Date(Date.now() + TEACHER_SESSION_DAYS * 86400_000).toISOString(),
    );
    return token;
  }

  function getTeacher(req: Request): Teacher | null {
    const token = cookieValue(req, TEACHER_COOKIE);
    if (!token) return null;
    const row = db.query(
      `SELECT t.* FROM teacher_sessions s JOIN teachers t ON t.id = s.teacher_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    ).get(hashToken(token), nowIso()) as TeacherRow | null;
    return row ? teacherFromRow(row) : null;
  }

  function requireTeacher(req: Request): Teacher {
    const t = getTeacher(req);
    if (!t) throw new HttpError(401, 'Sign in required');
    return t;
  }

  /** Admin-only actions: fleet-wide provider settings and teacher accounts. */
  function requireAdmin(req: Request): Teacher {
    const teacher = requireTeacher(req);
    if (!teacher.admin) throw new HttpError(403, 'Admin access required');
    return teacher;
  }

  function createStudentSession(participantId: string): string {
    const token = randomToken();
    db.query('INSERT INTO student_sessions(token_hash, participant_id, created_at, expires_at) VALUES (?,?,?,?)').run(
      hashToken(token), participantId, nowIso(), new Date(Date.now() + STUDENT_SESSION_DAYS * 86400_000).toISOString(),
    );
    return token;
  }

  interface StudentCtx {
    participantRow: ParticipantRow;
    runRow: RunRow;
  }

  function getStudent(req: Request): StudentCtx | null {
    const token = cookieValue(req, STUDENT_COOKIE);
    if (!token) return null;
    const session = db
      .query('SELECT participant_id FROM student_sessions WHERE token_hash = ? AND expires_at > ?')
      .get(hashToken(token), nowIso()) as { participant_id: string } | null;
    if (!session) return null;
    const participantRow = db.query('SELECT * FROM participants WHERE id = ?').get(session.participant_id) as ParticipantRow | null;
    if (!participantRow) return null;
    const runRow = db.query('SELECT * FROM runs WHERE id = ?').get(participantRow.run_id) as RunRow | null;
    if (!runRow) return null;
    return { participantRow, runRow };
  }

  function requireStudent(req: Request): StudentCtx {
    const s = getStudent(req);
    if (!s) throw new HttpError(401, 'Join a session first');
    return s;
  }

  function fullParticipant(row: ParticipantRow): Participant {
    return participantFromRow(db, row);
  }

  const assessmentJobs = new Map<string, Promise<void>>();
  function assessmentSnapshot(participantId: string) {
    const row = db.query('SELECT * FROM participants WHERE id = ?').get(participantId) as ParticipantRow | null;
    if (!row) return null;
    const run = runFromRow(loadRunRow(row.run_id)), participant = fullParticipant(row);
    const fingerprint = hashToken(JSON.stringify({
      instructions: run.space.instructions, agenda: run.space.agenda, outcomes: run.space.outcomes,
      sessionPrompt: run.sessionPrompt, subject: run.space.subject, gradeLevel: run.space.gradeLevel,
      materials: run.space.materials.map(material => ({ id: material.id, text: material.text })),
      messages: participant.messages.map(message => ({ id: message.id, role: message.role, content: message.content, attachments: message.attachments })),
      artifacts: participant.artifacts,
    }));
    return { run, participant, fingerprint };
  }

  function queueAssessment(participantId: string, force = false): void {
    if (closed) return;
    const initial = assessmentSnapshot(participantId);
    if (!initial || (!initial.participant.messages.length && !initial.participant.artifacts.length)) return;
    const prior = db.query('SELECT fingerprint, status FROM participant_assessments WHERE participant_id = ?').get(participantId) as { fingerprint: string; status: string } | null;
    if (!force && prior?.fingerprint === initial.fingerprint && ['current', 'pending', 'unavailable'].includes(prior.status)) return;
    db.query(`INSERT INTO participant_assessments(participant_id,fingerprint,status,assessment_json,updated_at) VALUES (?,?,'pending',NULL,?)
      ON CONFLICT(participant_id) DO UPDATE SET fingerprint=excluded.fingerprint,status='pending',assessment_json=NULL,updated_at=excluded.updated_at`).run(participantId,initial.fingerprint,nowIso());
    if (assessmentJobs.has(participantId)) return;
    const task = (async () => {
      for (;;) {
        if (closed) return;
        const snapshot = assessmentSnapshot(participantId);
        if (!snapshot) return;
        try {
          const config = await providerConfig(snapshot.run.space.providerId);
          const assessment = await assessTask(config, snapshot.run, snapshot.participant);
          if (closed) return;
          const fresh = assessmentSnapshot(participantId);
          if (!fresh) return;
          if (fresh.fingerprint !== snapshot.fingerprint) continue;
          db.transaction(() => {
            recordAlerts(db, snapshot.run, snapshot.participant, assessment.alerts);
            db.query("UPDATE participant_assessments SET status='current', assessment_json=?,updated_at=? WHERE participant_id=? AND fingerprint=?").run(JSON.stringify(assessment),nowIso(),participantId,snapshot.fingerprint);
          })();
        } catch {
          if (closed) return;
          const fresh = assessmentSnapshot(participantId);
          if (!fresh) return;
          if (fresh.fingerprint !== snapshot.fingerprint) continue;
          db.query("UPDATE participant_assessments SET status='unavailable',updated_at=? WHERE participant_id=? AND fingerprint=?").run(nowIso(),participantId,snapshot.fingerprint);
        }
        return;
      }
    })().finally(() => {
      assessmentJobs.delete(participantId);
      if (!closed) {
        const pending = db.query('SELECT status FROM participant_assessments WHERE participant_id = ?').get(participantId) as { status: string } | null;
        if (pending?.status === 'pending') queueAssessment(participantId, true);
      }
    });
    assessmentJobs.set(participantId, task);
  }

  function monitoringStatus(runId: string) {
    const rows = db.query('SELECT a.status FROM participants p LEFT JOIN participant_assessments a ON a.participant_id=p.id WHERE p.run_id=?').all(runId) as { status: string | null }[];
    if (rows.some(row => row.status === 'unavailable')) return { status: 'unavailable', message: 'Task and safeguarding monitoring is unavailable for some work. Review transcripts directly and check the provider connection.' };
    if (rows.some(row => row.status === 'pending')) return { status: 'pending', message: 'Checking new student work. Teacher supervision remains necessary.' };
    if (rows.some(row => row.status === 'current')) return { status: 'current', message: 'AI-reviewed work. Alerts are advisory; no alerts does not certify safety.' };
    return { status: 'not-assessed', message: 'No work has been assessed yet. Teacher supervision remains necessary.' };
  }

  queueMicrotask(() => {
    if (!closed) for (const row of db.query("SELECT participant_id FROM participant_assessments WHERE status='pending'").all() as { participant_id: string }[]) queueAssessment(row.participant_id, true);
  });

  /** Student-facing view of a participant: teacher-only assessment fields are dropped here. */
  function publicParticipant(participant: Participant): Omit<Participant, 'insights'> {
    return {
      id: participant.id,
      runId: participant.runId,
      name: participant.name,
      createdAt: participant.createdAt,
      updatedAt: participant.updatedAt,
      paused: participant.paused,
      messages: participant.messages,
      progress: participant.progress,
      progressStatus: participant.progressStatus,
      progressEvidence: participant.progressEvidence,
      artifacts: participant.artifacts,
    };
  }

  // ---------- providers ----------

  function storedProvider(id: string): StoredProvider | null {
    const row = db.query('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow | null;
    return row ? providerFromRow(row) : null;
  }

  async function applyOAuthCredential(sp: StoredProvider, connection: ProviderConnection): Promise<void> {
    assertOAuthDestination(sp.oauthProvider, connection);
    if (!sp.oauthSecretEnc) throw new HttpError(400, 'Provider login is disconnected; sign in again.');
    let credential: OAuthCredential;
    try { credential = parseOAuthCredential(decryptSecret(masterKey, sp.oauthSecretEnc)); }
    catch { throw new HttpError(500, 'Stored provider login cannot be read; sign in again.'); }
    if (credential.provider !== sp.oauthProvider) throw new HttpError(400, 'Stored provider login does not match its provider.');
    if (credential.provider === 'gemini') {
      assertGoogleGrant(credential, googleOAuth);
      if (credential.expiresAt <= Date.now() + 60_000) {
        let task = oauthRefreshes.get(sp.id);
        if (!task) {
          const before = sp.oauthSecretEnc;
          task = refreshGoogleCredential(credential, googleOAuth).then(refreshed => {
            if (closed) throw new Error('Application closed during provider authorization.');
            const changed = db.query("UPDATE providers SET oauth_secret_enc = ?, updated_at = ? WHERE id = ? AND oauth_secret_enc = ? AND oauth_provider = 'gemini'").run(encryptSecret(masterKey, JSON.stringify(refreshed)), nowIso(), sp.id, before);
            if (!changed.changes) throw new Error('Provider credentials changed during renewal. Retry with the current connection.');
            return refreshed;
          });
          oauthRefreshes.set(sp.id, task);
        }
        try { credential = await task; }
        finally { if (oauthRefreshes.get(sp.id) === task) oauthRefreshes.delete(sp.id); }
      }
    }
    if (credential.provider === 'openrouter') connection.apiKey = credential.apiKey;
    else { connection.apiKey = credential.accessToken; connection.authMode = 'bearer'; connection.quotaProject = credential.projectId; }
  }

  /** Resolve a provider config with decrypted key. Never serialized outward. */
  async function providerConfig(id: string): Promise<ProviderConfig> {
    const sp = storedProvider(id);
    if (!sp) throw new HttpError(400, 'No provider configured for this Space; open Settings and choose one');
    if (sp.kind !== 'openai' && sp.kind !== 'anthropic' && sp.kind !== 'gemini')
      throw new HttpError(400, 'Configured provider has an invalid kind');
    const kind: ProviderKind = sp.kind;
    const config: ProviderConfig = {
      id: sp.id, name: sp.name, kind, baseUrl: sp.baseUrl, model: sp.model,
      maxOutputTokens: sp.maxOutputTokens, contextChars: sp.contextChars,
    };
    if (sp.imageModel) config.imageModel = sp.imageModel;
    if (sp.oauthProvider) {
      assertOAuthDestination(sp.oauthProvider, config);
      config.oauthProvider = sp.oauthProvider;
      await applyOAuthCredential(sp, config);
    } else if (sp.keychainId) {
      config.keychainId = sp.keychainId;
      config.apiKey = await resolveKeychainKey(sp.keychainId, config);
    } else if (sp.apiKeyEnc) {
      try {
        config.apiKey = decryptSecret(masterKey, sp.apiKeyEnc);
      } catch {
        throw new HttpError(500, 'Stored provider key cannot be decrypted; re-enter it in Settings');
      }
    }
    return config;
  }

  function publicProvider(sp: StoredProvider): unknown {
    return {
      id: sp.id, name: sp.name, kind: sp.kind, baseUrl: sp.baseUrl, model: sp.model,
      imageModel: sp.imageModel, maxOutputTokens: sp.maxOutputTokens, contextChars: sp.contextChars,
      keychainId: sp.keychainId, oauthProvider: sp.oauthProvider, hasKey: sp.apiKeyEnc !== null || Boolean(sp.keychainId) || Boolean(sp.oauthProvider && sp.oauthSecretEnc),
    };
  }

  /** One destination/credential policy for saving and unsaved model discovery. */
  function selectedConnection(body: Record<string, unknown>, existing: StoredProvider | null): ProviderConnection & { keychainId?: string; oauthProvider?: string } {
    let connection: ProviderConnection;
    try {
      connection = validateConnection({
        name: body.name ?? existing?.name, kind: body.kind ?? existing?.kind,
        baseUrl: body.baseUrl ?? existing?.baseUrl, apiKey: body.apiKey,
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Invalid provider connection');
    }
    if (body.credentialSource !== undefined && !['manual', 'keychain', 'oauth'].includes(String(body.credentialSource))) throw new HttpError(400, 'Choose a supported credential source.');
    const retainOAuth = body.credentialSource === 'oauth' || (body.credentialSource === undefined && body.keychainId === undefined && !connection.apiKey && Boolean(existing?.oauthProvider));
    if (retainOAuth) {
      if (!existing?.oauthProvider || !existing.oauthSecretEnc) throw new HttpError(400, 'Sign in to the provider before saving or loading its models.');
      if (connection.apiKey || body.keychainId) throw new HttpError(400, 'Choose one credential source.');
      try { assertOAuthDestination(existing.oauthProvider, connection); }
      catch { throw new HttpError(400, 'An OAuth credential cannot be sent to a different provider endpoint. Sign in to the new provider or enter its API key.'); }
      return { ...connection, oauthProvider: existing.oauthProvider };
    }
    const explicitReference = body.keychainId === undefined ? undefined : requireString(body.keychainId, 'keychainId', 0, 100);
    const reference = explicitReference ?? (connection.apiKey || body.credentialSource === 'manual' ? '' : existing?.keychainId ?? '');
    if (body.credentialSource === 'keychain' && !reference) throw new HttpError(400, 'Choose an existing Keychain entry.');
    if (connection.apiKey && reference) throw new HttpError(400, 'Choose either an entered API key or an existing Keychain entry, not both.');
    if (reference) {
      try { assertKeychainDestination(reference, connection); }
      catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid Keychain destination'); }
      return { ...connection, keychainId: reference };
    }
    if (!connection.apiKey && existing?.apiKeyEnc) {
      if (connection.kind !== existing.kind || normalizeBaseUrl(connection.baseUrl) !== normalizeBaseUrl(existing.baseUrl))
        throw new HttpError(400, 'Changing the provider kind or base URL requires re-entering the API key');
      try { connection.apiKey = decryptSecret(masterKey, existing.apiKeyEnc); }
      catch { throw new HttpError(500, 'Stored provider key cannot be decrypted; re-enter the API key'); }
    }
    return connection;
  }

  // ---------- spaces & runs ----------

  function loadSpaceRow(id: string): SpaceRow {
    const row = db.query('SELECT * FROM spaces WHERE id = ?').get(id) as SpaceRow | null;
    if (!row) throw new HttpError(404, 'Space not found');
    return row;
  }

  /** Read-level: owner, admin, or any teacher when the template is shared locally. */
  function requireSpaceRead(teacher: Teacher, row: SpaceRow): void {
    if (row.owner_id === teacher.id || teacher.admin || row.visibility === 'shared') return;
    throw new HttpError(403, 'This Space belongs to another teacher');
  }

  /** Write-level: owner or admin only, even for shared templates. */
  function requireSpaceWrite(teacher: Teacher, row: SpaceRow): void {
    if (row.owner_id !== teacher.id && !teacher.admin) throw new HttpError(403, 'Only the Space owner can change it');
  }

  function insertSpace(teacher: Teacher, patch: SpacePatch & { title: string; instructions: string }): Space {
    const id = newId();
    const now = nowIso();
    db.query(
      `INSERT INTO spaces(id, owner_id, title, subtitle, teacher_description, student_description, instructions,
        standard, grade_level, subject, outcomes, agenda, show_agenda, allow_language_choice, audience_details, interaction_style,
        space_type, visibility, materials, provider_id, tools, video_url,
        video_questions, cover, folder, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, teacher.id, patch.title, patch.subtitle ?? '', patch.teacherDescription ?? '',
      patch.studentDescription ?? '', patch.instructions, patch.standard ?? '', patch.gradeLevel ?? '',
      patch.subject ?? '', JSON.stringify(patch.outcomes ?? []), JSON.stringify(patch.agenda ?? []),
      patch.showAgenda === false ? 0 : 1, patch.allowLanguageChoice === true ? 1 : 0, patch.audienceDetails ?? '', patch.interactionStyle ?? '',
      patch.spaceType ?? 'student-learning', patch.visibility ?? 'private',
      JSON.stringify(patch.materials ?? []), patch.providerId ?? '', JSON.stringify(patch.tools ?? []),
      patch.videoUrl ?? '', JSON.stringify(patch.videoQuestions ?? []), patch.cover ?? '', patch.folder ?? '',
      now, now,
    );
    return spaceFromRow(loadSpaceRow(id));
  }

  function loadRunRow(id: string): RunRow {
    const row = db.query('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | null;
    if (!row) throw new HttpError(404, 'Session not found');
    return row;
  }

  function runOwnerId(runRow: RunRow): string {
    return spaceFromRow(loadSpaceRow(runRow.space_id)).ownerId;
  }

  function isCollaborator(runId: string, teacherId: string): boolean {
    return db.query('SELECT 1 AS x FROM collaborators WHERE run_id = ? AND teacher_id = ?').get(runId, teacherId) !== null;
  }

  /** Monitor/pause/resume/intervene/insights/export: owner, collaborator, or admin. */
  function requireRunAccess(teacher: Teacher, runRow: RunRow): void {
    if (teacher.admin) return;
    if (runOwnerId(runRow) === teacher.id) return;
    if (isCollaborator(runRow.id, teacher.id)) return;
    throw new HttpError(403, 'You do not have access to this session');
  }

  /** Ownership-level actions (end, collaborators, patch): owner or admin only. */
  function requireRunOwner(teacher: Teacher, runRow: RunRow): void {
    if (teacher.admin) return;
    if (runOwnerId(runRow) === teacher.id) return;
    throw new HttpError(403, 'Only the session owner can do that');
  }

  function teacherForRun(runRow: RunRow): Teacher {
    const row = db.query('SELECT * FROM teachers WHERE id = ?').get(runOwnerId(runRow)) as TeacherRow | null;
    if (row) return teacherFromRow(row);
    return { id: '', name: '', email: '', admin: false, customInstructions: '' };
  }

  function studentSafeRun(runRow: RunRow): unknown {
    const run = runFromRow(runRow);
    return {
      id: run.id, title: run.title, status: run.status, expiresAt: run.expiresAt,
      maxTurns: run.maxTurns, createdAt: run.createdAt, space: studentSpace(run.space),
    };
  }

  function requireActiveRun(runRow: RunRow): Run {
    const run = runFromRow(runRow);
    if (run.status === 'ended') throw new HttpError(400, 'This session has ended');
    if (isRunExpired(run)) throw new HttpError(400, 'This session has expired');
    if (run.status === 'paused') throw new HttpError(400, 'This session is paused by the teacher');
    return run;
  }

  function requireLiveRun(runRow: RunRow, participantRow: ParticipantRow): Run {
    const run = requireActiveRun(runRow);
    if (participantRow.paused === 1) throw new HttpError(400, 'Your participation is paused by the teacher');
    return run;
  }

  function chatHistory(messages: Message[]): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const m of messages) {
      if (m.role === 'assistant') {
        out.push({ role: 'assistant', content: m.content });
      } else if (m.role === 'teacher') {
        out.push({ role: 'user', content: `[Message from your teacher] ${m.content}` });
      } else {
        const msg: ChatMessage = { role: 'user', content: m.content };
        const images = (m.attachments ?? []).filter(isImageMaterial).map((a) => ({ mime: a.mime, data: a.data ?? '' }));
        if (images.length) msg.images = images;
        out.push(msg);
      }
    }
    return out;
  }

  /**
   * Teacher-uploaded reference images on a Space, sent as one leading user message so
   * configured vision models actually receive them. Empty when the Space has no images.
   */
  function teacherReferenceMessages(space: Space): ChatMessage[] {
    const images = space.materials.filter(isImageMaterial).map((m) => ({ mime: m.mime, data: m.data ?? '' }));
    if (images.length === 0) return [];
    return [
      {
        role: 'user',
        content: 'Reference images supplied by the teacher for this activity. Treat them as visual context.',
        images,
      },
    ];
  }

  function enforceContext(
    config: ProviderConfig,
    system: string,
    history: ChatMessage[],
    extra: string,
    message = 'This conversation is too long for the configured model context. Ask your teacher to launch a new session.',
  ): void {
    let chars = system.length + extra.length;
    for (const m of history) {
      chars += m.content.length;
      chars += (m.images?.length ?? 0) * 1000;
    }
    if (chars > config.contextChars) throw new HttpError(400, message);
  }

  function insertMessage(
    participantId: string,
    role: 'user' | 'assistant' | 'teacher',
    content: string,
    attachments: Material[] | null,
    requestId: string | null,
  ): Message {
    const id = newId();
    const now = nowIso();
    db.query('INSERT INTO messages(id, participant_id, role, content, attachments, request_id, created_at) VALUES (?,?,?,?,?,?,?)').run(
      id, participantId, role, content, attachments ? JSON.stringify(attachments) : null, requestId, now,
    );
    db.query('UPDATE participants SET updated_at = ? WHERE id = ?').run(now, participantId);
    const msg: Message = { id, role, content, createdAt: now };
    if (attachments && attachments.length) msg.attachments = attachments;
    return msg;
  }

  /** Parse a JSON object out of a model reply (tolerates code fences), then validate. */
  function parseModelJson(reply: string): unknown {
    let text = reply.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new HttpError(502, 'The model did not return usable JSON; try again');
    try {
      return parseJson(text.slice(start, end + 1));
    } catch {
      throw new HttpError(502, 'The model returned malformed JSON; try again');
    }
  }

  // ---------- AI endpoints ----------

  async function runPreview(req: Request, teacher: Teacher, spaceRow: SpaceRow): Promise<Response> {
    const body = await parseBody(req);
    if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
    const message = requireString(body.message, 'message', 1, 8000);
    const historyRaw = body.history ?? [];
    if (!Array.isArray(historyRaw) || historyRaw.length > 50) throw new HttpError(400, 'history must be an array of at most 50 messages');
    const clientHistory: ChatMessage[] = historyRaw.map((h) => {
      if (!isRecord(h) || (h.role !== 'user' && h.role !== 'assistant') || typeof h.content !== 'string' || h.content.length > 8000)
        throw new HttpError(400, 'history entries must be {role: user|assistant, content}');
      return { role: h.role, content: h.content };
    });
    const space = spaceFromRow(spaceRow);
    const config = await providerConfig(space.providerId);
    const system = buildSystemPrompt(space, teacher, '');
    const history = [...teacherReferenceMessages(space), ...clientHistory];
    enforceContext(config, system, history, message);
    const reply = await complete(config, system, [...history, { role: 'user', content: message }]);
    return json({ reply });
  }

  /**
   * Teacher-only Space authoring assistant. It proposes authoring content the
   * teacher reviews in the editor; nothing is persisted here.
   */
  async function runSpaceDesign(teacher: Teacher, body: unknown): Promise<Response> {
    if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
    const providerId = requireString(body.providerId, 'providerId', 1, 100);
    const brief = requireString(body.brief, 'brief', 1, 12000);
    const target: DesignTarget | null = isDesignTarget(body.target) ? body.target : null;
    if (target === null) throw new HttpError(400, 'target must be draft, outcomes, or descriptions');

    let requestedType: SpaceType | null = null;
    if (body.spaceType !== undefined) {
      try {
        requestedType = asSpaceType(body.spaceType);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : 'Invalid spaceType');
      }
    }
    const gradeLevel = body.gradeLevel === undefined ? '' : requireString(body.gradeLevel, 'gradeLevel', 0, 100);

    let materials: Material[] = [];
    if (body.materials !== undefined) {
      try {
        materials = asMaterials(body.materials);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : 'Invalid materials');
      }
    }

    // An existing template is context only, and only when this teacher may read it.
    let template: Space | null = null;
    if (body.spaceId !== undefined) {
      const templateId = requireString(body.spaceId, 'spaceId', 1, 100);
      const templateRow = loadSpaceRow(templateId);
      requireSpaceRead(teacher, templateRow);
      template = spaceFromRow(templateRow);
    }

    const images: { mime: string; data: string }[] = [];
    const references: string[] = [];
    for (const material of materials) {
      if (material.mime.startsWith('image/')) {
        if (!material.data) throw new HttpError(400, `Material "${material.name}" is an image without data; re-upload it`);
        images.push({ mime: material.mime, data: material.data });
      } else if (material.text.trim()) {
        references.push(`--- ${material.name} ---\n${material.text}`);
      }
    }
    if (images.length > MAX_DESIGN_IMAGES)
      throw new HttpError(400, `At most ${MAX_DESIGN_IMAGES} images can be used as design context`);

    const config = await providerConfig(providerId);
    const system = designSystemPrompt(teacher, target, requestedType, gradeLevel);
    const parts = [`Teacher brief:\n${brief}`];
    if (template) parts.push(`Existing activity to work from:\n${spaceDigest(template)}`);
    if (references.length) parts.push(`Reference materials supplied by the teacher:\n${references.join('\n\n')}`);
    const user: ChatMessage = { role: 'user', content: parts.join('\n\n') };
    if (images.length) user.images = images;

    enforceContext(
      config,
      system,
      [user],
      '',
      'This design request is too long for the configured model context. Shorten the brief or the attached materials, or raise the context limit in provider settings.',
    );
    const reply = await complete(config, system, [user], undefined, true);
    const draft = validatedDesignDraft(target, parseModelJson(reply));
    // Teacher-stated context wins over whatever the model guessed.
    if (target === 'draft') {
      if (requestedType) draft.spaceType = requestedType;
      if (gradeLevel) draft.gradeLevel = gradeLevel;
    }
    return json({ draft });
  }

  function designSystemPrompt(teacher: Teacher, target: DesignTarget, requestedType: SpaceType | null, gradeLevel: string): string {
    const parts: string[] = [];
    parts.push(
      'You are an instructional designer helping a teacher author a classroom activity in a self-hosted teaching app. ' +
        'You propose content only: the teacher reviews, edits and saves it. Never claim to have created, saved, published or launched anything. ' +
        'Write measurable, student-facing outcomes and an ordered agenda in which every step has explicit instructions. ' +
        'Use age-appropriate language, do not invent personal data about real students, and write in the same language as the teacher brief.',
    );
    const custom = teacher.customInstructions.trim();
    if (custom) parts.push(`Teacher preferences:\n${custom}`);
    parts.push(
      `Available classroom tools (use these exact ids for a step tool, or null when a step needs no tool): ${Object.keys(TOOL_TYPES).join(', ')}.`,
    );
    parts.push(`Requested activity type: ${requestedType ?? 'unspecified'}\nRequested grade level: ${gradeLevel || 'unspecified'}`);
    parts.push(`Return ONLY one JSON object in this exact shape, with no code fences and no commentary:\n${DESIGN_SHAPES[target]}`);
    return parts.join('\n\n');
  }

  /** Compact view of an existing template for the designer; material text is never copied in. */
  function spaceDigest(space: Space): string {
    const lines = [`Title: ${space.title}`];
    if (space.subtitle) lines.push(`Subtitle: ${space.subtitle}`);
    if (space.subject) lines.push(`Subject: ${space.subject}`);
    if (space.gradeLevel) lines.push(`Grade level: ${space.gradeLevel}`);
    lines.push(`Activity type: ${space.spaceType}`);
    if (space.instructions) lines.push(`Current instructions:\n${space.instructions}`);
    if (space.outcomes.length) lines.push(`Current outcomes:\n${space.outcomes.map((o, i) => `${i + 1}. ${o}`).join('\n')}`);
    if (space.agenda.length)
      lines.push(
        `Current agenda:\n${space.agenda
          .map((s, i) => `${i + 1}. ${s.title}${s.tool ? ` [tool: ${s.tool}]` : ''}${s.instructions ? ` — ${s.instructions}` : ''}`)
          .join('\n')}`,
      );
    if (space.teacherDescription) lines.push(`Current educator description: ${space.teacherDescription}`);
    if (space.studentDescription) lines.push(`Current participant description: ${space.studentDescription}`);
    if (space.audienceDetails) lines.push(`Current audience details: ${space.audienceDetails}`);
    if (space.interactionStyle) lines.push(`Current interaction style: ${space.interactionStyle}`);
    if (space.materials.length) lines.push(`Supporting materials on file: ${space.materials.map((m) => m.name).join(', ')}`);
    return lines.join('\n');
  }

  /**
   * Keeps only the fields the target may change, then runs them through the canonical
   * space validators, so a draft can never carry unsupported tools, oversized text,
   * ownership fields, provider settings or visibility changes.
   */
  function validatedDesignDraft(target: DesignTarget, raw: unknown): SpacePatch {
    if (!isRecord(raw)) throw new HttpError(502, 'The model did not return a usable draft; try again');
    const picked: Record<string, unknown> = {};
    for (const field of DESIGN_FIELDS[target]) if (raw[field] !== undefined) picked[field] = raw[field];
    if (Object.keys(picked).length === 0) throw new HttpError(502, 'The model returned no usable suggestions; try again');
    try {
      if (target === 'outcomes' && (!Array.isArray(picked.outcomes) || picked.outcomes.length === 0)) throw new Error('no learning outcomes were supplied');
      return validateSpacePatch(picked, { requireCore: target === 'draft' });
    } catch (e) {
      throw new HttpError(
        502,
        `The model returned suggestions this app cannot use (${e instanceof Error ? e.message : 'invalid'}). Try again.`,
      );
    }
  }

  async function runParticipantInsights(teacher: Teacher, runRow: RunRow, participantRow: ParticipantRow): Promise<Response> {
    if (!limiter.allow(`insights:${teacher.id}`, 10, 60_000)) throw new HttpError(429, 'Too many insight requests; slow down');
    const run = runFromRow(runRow);
    const participant = fullParticipant(participantRow);
    const config = await providerConfig(run.space.providerId);
    const recent = participant.messages.slice(-60);
    const transcriptIds = new Set<string>();
    const studentIds = new Set<string>();
    const transcript = recent
      .map((m) => {
        transcriptIds.add(m.id);
        if (m.role === 'user') studentIds.add(m.id);
        const attached = (m.attachments ?? [])
          .filter((a) => !isImageMaterial(a) && a.text.trim().length > 0)
          .map((a) => `[Attached file: ${a.name}]\n${a.text}`)
          .join('\n')
          .slice(0, 1000);
        const content = attached ? `${m.content.slice(0, 500)}\n${attached}` : m.content.slice(0, 500);
        return `[${m.id}] ${m.role}: ${content}`;
      })
      .join('\n');
    if (!transcript) throw new HttpError(400, 'No conversation to analyze yet');
    const outcomes = run.space.outcomes.map((o, i) => `${i + 1}. ${o}`).join('\n');
    const system =
      'You are an assessment analyst helping a teacher review one student\'s learning conversation. ' +
      'Output ONLY a JSON object with this exact shape: ' +
      '{"headline": string (max 12 words), "summary": string (2-4 sentences, evidence-based), ' +
      '"outcomes": [{"outcome": string (copied from the list), "mastery": 1|2|3|4|null, "evidence": [message ids]}], ' +
      '"flags": [{"severity": "info"|"attention", "reason": string, "evidence": [message ids]}]}. ' +
      'Rules: return exactly one entry per learning outcome listed below, copying each outcome text unchanged and in the same ' +
      'order; never invent, rename or repeat an outcome; cite only message ids from the transcript; mastery may be based only ' +
      'on messages the student wrote themselves, never on teacher or assistant messages; set mastery to null unless the ' +
      'student\'s own messages show clear evidence; never assign a mastery level without at least one cited student message; ' +
      'flags are advisory for teacher review only — never make disciplinary, safety, or crisis conclusions.';
    const user =
      `Learning outcomes:\n${outcomes || '(none listed)'}\n\nAgenda:\n${run.space.agenda.map((s) => s.title).join('\n') || '(none)'}\n\n` +
      `Transcript for student "${participant.name}":\n${transcript}`;
    enforceContext(config, system, [], user);
    const reply = await complete(config, system, [{ role: 'user', content: user }]);
    const insights = asStudentInsight(parseModelJson(reply));
    // One row per canonical outcome; uncited or teacher/model-only evidence can never score.
    const aligned = alignOutcomeInsights(run.space.outcomes, insights.outcomes);
    for (const o of aligned) {
      o.evidence = o.evidence.filter((id) => transcriptIds.has(id));
      if (o.mastery !== null && !o.evidence.some((id) => studentIds.has(id))) o.mastery = null;
    }
    for (const f of insights.flags) f.evidence = f.evidence.filter((id) => transcriptIds.has(id));
    const stored: StudentInsight = { ...insights, outcomes: aligned };
    db.query('UPDATE participants SET insights = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(stored), nowIso(), participant.id,
    );
    return json({ insights: stored });
  }

  async function runGroupInsights(teacher: Teacher, runRow: RunRow): Promise<Response> {
    if (!limiter.allow(`insights:${teacher.id}`, 10, 60_000)) throw new HttpError(429, 'Too many insight requests; slow down');
    const run = runFromRow(runRow);
    const rows = db.query('SELECT * FROM participants WHERE run_id = ? ORDER BY created_at').all(run.id) as ParticipantRow[];
    if (rows.length === 0) throw new HttpError(400, 'No students have joined yet');
    const participants = rows.map((r) => fullParticipant(r));
    const withMessages = participants.filter((p) => p.messages.length > 0);
    if (withMessages.length === 0) throw new HttpError(400, 'No conversations to summarize yet');
    const config = await providerConfig(run.space.providerId);
    const digest = withMessages
      .map((p) => {
        const insightNote = p.insights ? `Assessed headline: ${p.insights.headline}` : 'Not yet assessed';
        const excerpt = p.messages.slice(-8).map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join('\n');
        return `Student ${p.name} (task progress ${p.progressStatus === 'current' && p.progress !== null ? `${p.progress}%` : p.progressStatus})\n${insightNote}\n${excerpt}`;
      })
      .join('\n\n');
    const system =
      'You are an assessment analyst helping a teacher understand a whole class session. ' +
      'Output ONLY a JSON object: {"summary": string (3-6 sentences for the teacher), ' +
      '"misconceptions": [string] (recurring misconceptions seen across students, empty if none)}. ' +
      'Base everything strictly on the provided transcripts; do not invent performance claims.';
    const user = `Activity: ${run.title}\nLearning outcomes:\n${run.space.outcomes.join('\n') || '(none)'}\n\n${digest}`;
    enforceContext(config, system, [], user);
    const reply = await complete(config, system, [{ role: 'user', content: user }]);
    const parsed = parseModelJson(reply);
    if (!isRecord(parsed) || typeof parsed.summary !== 'string' || !Array.isArray(parsed.misconceptions))
      throw new HttpError(502, 'The model returned an unexpected summary shape; try again');
    // Support/ready groups are derived only from valid assessed mastery, never invented by the model.
    const canonicalOutcomes = new Set(
      run.space.outcomes.map((label) => outcomeKey(label)).filter((key) => key.length > 0),
    );
    const support: string[] = [];
    const ready: string[] = [];
    for (const p of participants) {
      const studentIds = new Set(p.messages.filter((m) => m.role === 'user').map((m) => m.id));
      const scored = new Map<string, number>();
      for (const o of p.insights?.outcomes ?? []) {
        const key = outcomeKey(o.outcome);
        if (o.mastery === null || !canonicalOutcomes.has(key) || scored.has(key)) continue;
        if (!o.evidence.some((id) => studentIds.has(id))) continue;
        scored.set(key, o.mastery);
      }
      if (scored.size === 0) continue;
      const avg = [...scored.values()].reduce((a, b) => a + b, 0) / scored.size;
      if (avg < 2) support.push(p.id);
      else if (avg >= 3) ready.push(p.id);
    }
    const summary = {
      summary: parsed.summary,
      misconceptions: parsed.misconceptions.filter((m): m is string => typeof m === 'string').slice(0, 20),
      support,
      ready,
    };
    db.query('UPDATE runs SET summary = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(summary), nowIso(), run.id);
    return json({ summary });
  }

  async function runToolGeneration(runRow: RunRow, participantRow: ParticipantRow, body: unknown): Promise<Response> {
    const run = requireLiveRun(runRow, participantRow);
    if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
    const type = requireString(body.type, 'type', 1, 20);
    if (type !== 'flashcards' && type !== 'mindmap' && type !== 'presentation')
      throw new HttpError(400, 'type must be flashcards, mindmap, or presentation');
    if (!toolEnabled(run.space, type)) throw new HttpError(400, `The teacher has not enabled the ${type} tool`);
    const prompt = requireString(body.prompt, 'prompt', 1, 1000);
    const config = await providerConfig(run.space.providerId);
    const teacher = teacherForRun(runRow);
    const baseSystem = buildSystemPrompt(run.space, teacher, run.sessionPrompt);
    const shapes: Record<string, string> = {
      flashcards: '{"cards":[{"front":string,"back":string}]} — 5 to 20 cards',
      mindmap: '{"nodes":[{"id":string,"label":string,"parentId":string|null}]} — one root with parentId null, 3 to 40 nodes',
      presentation: '{"slides":[{"title":string,"body":string}]} — 3 to 10 slides',
    };
    const system = `${baseSystem}\n\nYou are generating structured study material for the student. ` +
      `Output ONLY JSON with this exact shape: ${shapes[type]}. No commentary.`;
    const user = `Create a ${type} about: ${prompt}`;
    const history = teacherReferenceMessages(run.space);
    enforceContext(config, system, history, user);
    const reply = await complete(config, system, [...history, { role: 'user', content: user }]);
    const data = validateToolData(type, parseModelJson(reply));
    return json({ data });
  }

  function validateToolData(type: string, raw: unknown): unknown {
    if (!isRecord(raw)) throw new HttpError(502, 'The model returned an unexpected shape; try again');
    if (type === 'flashcards') {
      if (!Array.isArray(raw.cards) || raw.cards.length < 1 || raw.cards.length > 30) throw new HttpError(502, 'Model returned invalid cards; try again');
      const cards = raw.cards.map((c) => {
        if (!isRecord(c) || typeof c.front !== 'string' || typeof c.back !== 'string' || c.front.length > 500 || c.back.length > 500)
          throw new HttpError(502, 'Model returned invalid cards; try again');
        return { front: c.front, back: c.back };
      });
      return { cards };
    }
    if (type === 'mindmap') {
      if (!Array.isArray(raw.nodes) || raw.nodes.length < 1 || raw.nodes.length > 40) throw new HttpError(502, 'Model returned invalid nodes; try again');
      const ids: Record<string, true> = {};
      const nodes = raw.nodes.map((n, i) => {
        if (!isRecord(n) || typeof n.id !== 'string' || typeof n.label !== 'string' || n.label.length > 200)
          throw new HttpError(502, 'Model returned invalid nodes; try again');
        if (n.parentId !== null && typeof n.parentId !== 'string') throw new HttpError(502, 'Model returned invalid nodes; try again');
        const node = { id: n.id || `n${i}`, label: n.label, parentId: n.parentId };
        ids[node.id] = true;
        return node;
      });
      for (const n of nodes) if (n.parentId !== null && !ids[n.parentId]) n.parentId = null;
      if (!nodes.some((n) => n.parentId === null)) nodes[0].parentId = null;
      return { nodes };
    }
    if (!Array.isArray(raw.slides) || raw.slides.length < 1 || raw.slides.length > 15) throw new HttpError(502, 'Model returned invalid slides; try again');
    const slides = raw.slides.map((s) => {
      if (!isRecord(s) || typeof s.title !== 'string' || typeof s.body !== 'string' || s.title.length > 200 || s.body.length > 2000)
        throw new HttpError(502, 'Model returned invalid slides; try again');
      return { title: s.title, body: s.body };
    });
    return { slides };
  }

  async function runStudentChat(req: Request, ctx: StudentCtx): Promise<Response> {
    const pid = ctx.participantRow.id;
    if (!limiter.allow(`chat:${pid}`, 30, 60_000)) throw new HttpError(429, 'Sending too fast; please wait a moment');
    // Reserve the single-flight slot synchronously before any await so a concurrent
    // request cannot pass the same check.
    if (inFlightChats.has(pid)) throw new HttpError(409, 'A response is already being generated; please wait for it');

    const task = (async (): Promise<Response> => {
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const requestId = requireString(body.requestId, 'requestId', 8, 100);
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (message.length > 8000) throw new HttpError(400, 'message too long (max 8000 characters)');
      const attachmentsRaw = body.attachments ?? [];
      if (!Array.isArray(attachmentsRaw) || attachmentsRaw.length > 5) throw new HttpError(400, 'at most 5 attachments');
      const attachments = attachmentsRaw.map((a) => {
        try {
          return validateMaterialInput(a);
        } catch (e) {
          throw new HttpError(400, e instanceof Error ? e.message : 'invalid attachment');
        }
      });
      if (message.length === 0 && attachments.length === 0) throw new HttpError(400, 'message is required');
      const language = body.language === undefined ? '' : requireString(body.language, 'language', 0, 50);
      const difficulty = body.difficulty === undefined ? '' : requireString(body.difficulty, 'difficulty', 0, 50);
      if (language && !Object.hasOwn(RESPONSE_LANGUAGES, language) &&
          !/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/.test(language))
        throw new HttpError(400, 'Choose a supported response language or language code');
      // Teacher-only policy: a run's own snapshot decides. Never carried over from a
      // template toggle, so existing sessions stay unaffected.
      if (language && runFromRow(ctx.runRow).space.allowLanguageChoice !== true)
        throw new HttpError(400, 'This session does not offer a response-language choice');
      if (difficulty && !Object.hasOwn(SUPPORT_LEVELS, difficulty))
        throw new HttpError(400, 'Choose a supported support level');

      // Idempotent replay: a completed turn with this requestId returns history unchanged.
      const seen = db.query('SELECT 1 AS x FROM chat_dedup WHERE participant_id = ? AND request_id = ?').get(pid, requestId);
      if (seen) return json({ messages: fullParticipant(ctx.participantRow).messages });

      const run = requireLiveRun(ctx.runRow, ctx.participantRow);
      const participant = fullParticipant(ctx.participantRow);
      const userTurns = participant.messages.filter((m) => m.role === 'user').length;
      if (userTurns >= run.maxTurns)
        throw new HttpError(400, 'Turn limit reached for this session. Ask your teacher to launch a new session.');
      const config = await providerConfig(run.space.providerId);
      const teacher = teacherForRun(ctx.runRow);
      let system = buildSystemPrompt(run.space, teacher, run.sessionPrompt);
      const prefs: string[] = [];
      if (language) prefs.push(`Respond in ${language}`);
      if (difficulty) prefs.push(`Adjust difficulty: ${difficulty}`);
      if (prefs.length) system += `\n\nStudent preferences for this session: ${prefs.join('. ')}.`;
      const history = [...teacherReferenceMessages(run.space), ...chatHistory(participant.messages)];
      let content = message;
      const noteTexts = attachments.filter((a) => !isImageMaterial(a) && a.text.trim()).map((a) => `[Attached file: ${a.name}]\n${a.text}`);
      if (noteTexts.length) content = `${content}\n\n${noteTexts.join('\n\n')}`.trim();
      const userMsg: ChatMessage = { role: 'user', content };
      const images = attachments.filter(isImageMaterial).map((a) => ({ mime: a.mime, data: a.data ?? '' }));
      if (images.length) userMsg.images = images;
      enforceContext(config, system, history, content);
      const reply = await complete(config, system, [...history, userMsg]);
      // Re-check lifecycle after the provider call before persisting anything.
      const freshRun = runFromRow(loadRunRow(run.id));
      const freshParticipant = db.query('SELECT * FROM participants WHERE id = ?').get(pid) as ParticipantRow | null;
      if (!freshParticipant) throw new HttpError(400, 'This session is no longer available');
      if (freshRun.status !== 'active' || isRunExpired(freshRun) || freshParticipant.paused === 1)
        throw new HttpError(400, 'This session is no longer active; your message was not saved');
      db.transaction(() => {
        insertMessage(pid, 'user', message, attachments.length ? attachments : null, requestId);
        insertMessage(pid, 'assistant', reply, null, null);
        db.query('INSERT INTO chat_dedup(participant_id, request_id, created_at) VALUES (?,?,?)').run(pid, requestId, nowIso());
      })();
      const row = db.query('SELECT * FROM participants WHERE id = ?').get(pid) as ParticipantRow;
      queueAssessment(pid);
      return json({ messages: fullParticipant(row).messages });
    })();

    inFlightChats.set(pid, task);
    try {
      return await task;
    } finally {
      inFlightChats.delete(pid);
    }
  }

  /**
   * Model-produced opening turn for a brand-new conversation. Shares the chat single-flight
   * slot and rate bucket so a start can never race the learner's first message, and writes
   * one assistant message only while the transcript is still empty. No user turn is consumed.
   */
  async function runStudentStart(ctx: StudentCtx): Promise<Response> {
    const pid = ctx.participantRow.id;
    if (!limiter.allow(`chat:${pid}`, 30, 60_000)) throw new HttpError(429, 'Sending too fast; please wait a moment');
    if (inFlightChats.has(pid)) throw new HttpError(409, 'A response is already being generated; please wait for it');

    const task = (async (): Promise<Response> => {
      const run = requireLiveRun(ctx.runRow, ctx.participantRow);
      const started = fullParticipant(ctx.participantRow);
      if (started.messages.length > 0)
        return json({ participant: publicParticipant(started), run: studentSafeRun(ctx.runRow) });
      const config = await providerConfig(run.space.providerId);
      const teacher = teacherForRun(ctx.runRow);
      const system = buildSystemPrompt(run.space, teacher, run.sessionPrompt);
      const history = teacherReferenceMessages(run.space);
      const opening =
        'Open the session now: greet the learner, introduce the activity in one or two sentences, ' +
        'and invite their first reply. Follow your instructions exactly; do not answer for the learner.';
      enforceContext(config, system, history, opening);
      const reply = await complete(config, system, [...history, { role: 'user', content: opening }]);
      // Re-check lifecycle after the provider call, then write the opening only if the
      // transcript is still empty (a teacher message may have landed meanwhile).
      const freshRun = runFromRow(loadRunRow(run.id));
      const freshParticipant = db.query('SELECT * FROM participants WHERE id = ?').get(pid) as ParticipantRow | null;
      if (!freshParticipant) throw new HttpError(400, 'This session is no longer available');
      if (freshRun.status !== 'active' || isRunExpired(freshRun) || freshParticipant.paused === 1)
        throw new HttpError(400, 'This session is no longer active; no opening was saved');
      db.transaction(() => {
        const existing = db.query('SELECT 1 AS x FROM messages WHERE participant_id = ? LIMIT 1').get(pid);
        if (!existing) insertMessage(pid, 'assistant', reply, null, null);
      })();
      const row = db.query('SELECT * FROM participants WHERE id = ?').get(pid) as ParticipantRow;
      queueAssessment(pid);
      return json({ participant: publicParticipant(fullParticipant(row)), run: studentSafeRun(ctx.runRow) });
    })();

    inFlightChats.set(pid, task);
    try {
      return await task;
    } finally {
      inFlightChats.delete(pid);
    }
  }

  // ---------- routing ----------

  function matchPath(pathname: string, pattern: string[]): Record<string, string> | null {
    const segs = pathname.split('/').filter((s) => s.length > 0);
    if (segs.length !== pattern.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p !== segs[i]) return null;
    }
    return params;
  }

  async function route(req: Request, server?: ServerLike): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    // Static assets (exact allowlist only; DB/keys/data dir never served).
    if (method === 'GET') {
      const staticName = STATIC_FILES[path];
      if (staticName !== undefined) {
        const file = join(publicDir, staticName);
        if (!existsSync(file)) return err('Interface files not installed', 404);
        return new Response(readFileSync(file), {
          headers: { 'Content-Type': STATIC_TYPES[extname(staticName)] ?? 'application/octet-stream', ...SECURITY_HEADERS },
        });
      }
      if (path === '/vendor/math.js') {
        if (!existsSync(mathBundle)) return err('mathjs is not installed', 404);
        return new Response(readFileSync(mathBundle), {
          headers: { 'Content-Type': 'text/javascript; charset=utf-8', ...SECURITY_HEADERS },
        });
      }
    }

    if (path === '/api/provider-oauth/callback' && method === 'GET') {
      const browserToken = cookieValue(req, oauthCookie);
      const state = url.searchParams.get('state') ?? '';
      const flow = oauthFlows.get(state);
      if (flow) oauthFlows.delete(state);
      const code = url.searchParams.get('code') ?? '';
      if (!flow || !browserToken || hashToken(browserToken) !== flow.browserHash || flow.expiresAt <= Date.now() || url.searchParams.has('error') || !code || code.length > 4096) {
        return new Response(null, { status: 303, headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', Location: '/?provider_login=failed#/teacher/settings', 'Set-Cookie': flowCookie('', 'Lax', true) } });
      }
      flow.code = code;
      oauthFinishes.set(flow.browserHash, flow);
      // A same-site fetch from this page sees the Strict teacher cookie. Cross-site redirects cannot.
      return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><title>Provider sign-in</title><p>Completing provider sign-in…</p><script src="/oauth-callback.js"></script></html>', { headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': flowCookie(browserToken, 'Strict') } });
    }
    if (!path.startsWith('/api/')) return err('Not found', 404);
    if (method !== 'GET' && method !== 'HEAD') checkCsrf(req);
    const ip = clientIp(req, server);

    // ---- public status / setup / auth ----
    if (path === '/api/status' && method === 'GET') {
      const teacherCount = (db.query('SELECT COUNT(*) AS n FROM teachers').get() as { n: number }).n;
      const teacher = getTeacher(req);
      const student = getStudent(req);
      return json({
        setupRequired: teacherCount === 0,
        teacher,
        student: student
          ? { id: student.participantRow.id, name: student.participantRow.name, runId: student.participantRow.run_id }
          : null,
      });
    }

    if (path === '/api/setup' && method === 'POST') {
      if (ip !== '127.0.0.1' && ip !== '::1') throw new HttpError(403, 'Initial setup is only allowed from this computer');
      if (!limiter.allow(`setup:${ip}`, 5, 60_000)) throw new HttpError(429, 'Too many attempts; slow down');
      const teacherCount = (db.query('SELECT COUNT(*) AS n FROM teachers').get() as { n: number }).n;
      if (teacherCount > 0) throw new HttpError(400, 'Setup is already complete; sign in instead');
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const name = requireString(body.name, 'name', 1, 100);
      const email = requireString(body.email, 'email', 3, 200).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'email is not valid');
      const password = requirePassword(body.password);
      const id = newId();
      db.query('INSERT INTO teachers(id, name, email, pass_hash, admin, custom_instructions, created_at) VALUES (?,?,?,?,1,\'\',?)').run(
        id, name, email, await hashPassword(password), nowIso(),
      );
      const token = createTeacherSession(id);
      const teacher = teacherFromRow(db.query('SELECT * FROM teachers WHERE id = ?').get(id) as TeacherRow);
      return json({ teacher }, 200, { 'Set-Cookie': sessionSetCookie(TEACHER_COOKIE, token, TEACHER_SESSION_DAYS) });
    }

    if (path === '/api/login' && method === 'POST') {
      if (!limiter.allow(`login:${ip}`, 5, 60_000)) throw new HttpError(429, 'Too many sign-in attempts; wait a minute');
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const row = db.query('SELECT * FROM teachers WHERE email = ?').get(email) as TeacherRow | null;
      if (!row || !(await verifyPassword(password, row.pass_hash))) throw new HttpError(401, 'Email or password is incorrect');
      const token = createTeacherSession(row.id);
      return json({ teacher: teacherFromRow(row) }, 200, { 'Set-Cookie': sessionSetCookie(TEACHER_COOKIE, token, TEACHER_SESSION_DAYS) });
    }

    if (path === '/api/logout' && method === 'POST') {
      const token = cookieValue(req, TEACHER_COOKIE);
      if (token) db.query('DELETE FROM teacher_sessions WHERE token_hash = ?').run(hashToken(token));
      return json({}, 200, { 'Set-Cookie': sessionClearCookie(TEACHER_COOKIE) });
    }

    // ---- student public endpoints ----
    if (path === '/api/join/students' && method === 'POST') {
      if (!limiter.allow(`roster:${ip}`, 40, 60_000)) throw new HttpError(429, 'Too many classroom lookups; wait a moment.');
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!/^[A-Z2-9]{8}$/.test(code)) throw new HttpError(400, 'Enter the 8-character session code');
      const row = db.query('SELECT * FROM runs WHERE code = ?').get(code) as RunRow | null;
      if (!row) throw new HttpError(404, 'No session found with that code');
      const run = runFromRow(row);
      const students = db.query('SELECT id,name FROM participants WHERE run_id = ? ORDER BY name COLLATE NOCASE,created_at').all(run.id);
      return json({ students, title: run.title, status: isRunExpired(run) ? 'ended' : run.status }, 200, { 'Cache-Control': 'no-store' });
    }

    if (path === '/api/join' && method === 'POST') {
      if (!limiter.allow(`join:${ip}`, 10, 60_000)) throw new HttpError(429, 'Too many join attempts; wait a minute');
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      if (!/^[A-Z2-9]{8}$/.test(code)) throw new HttpError(400, 'Enter the 8-character session code');
      const name = requireString(body.name, 'name', 1, 60);
      const runRow = db.query('SELECT * FROM runs WHERE code = ?').get(code) as RunRow | null;
      if (!runRow) throw new HttpError(404, 'No session found with that code');
      const run = runFromRow(runRow);
      const username = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
      // ponytail: at most 200 students per run; a bounded scan handles Unicode names without a second identity store.
      const matches = (db.query('SELECT * FROM participants WHERE run_id = ? ORDER BY created_at').all(run.id) as ParticipantRow[]).filter(row => username(row.name) === username(name));
      let participant: ParticipantRow | null = null;
      if (body.participantId !== undefined) {
        const selectedId = requireString(body.participantId, 'participantId', 1, 100);
        participant = matches.find(row => row.id === selectedId) ?? null;
        if (!participant) throw new HttpError(404, 'That returning username does not belong to this classroom.');
      } else if (matches.length > 1) throw new HttpError(409, 'Choose your returning username from the list.');
      else participant = matches[0] ?? null;
      const resumed = Boolean(participant);
      if (!participant) {
        requireActiveRun(runRow);
        const count = db.query('SELECT COUNT(*) AS n FROM participants WHERE run_id = ?').get(run.id) as { n: number };
        if (count.n >= MAX_PARTICIPANTS_PER_RUN) throw new HttpError(400, 'This session is full');
        const pid = newId(), now = nowIso();
        db.query('INSERT INTO participants(id,run_id,name,paused,progress,insights,created_at,updated_at) VALUES (?,?,?,0,0,NULL,?,?)').run(pid,run.id,name,now,now);
        participant = db.query('SELECT * FROM participants WHERE id = ?').get(pid) as ParticipantRow;
      }
      const token = createStudentSession(participant.id);
      return json(
        { participant: publicParticipant(fullParticipant(participant)), run: studentSafeRun(runRow), resumed },
        200,
        { 'Set-Cookie': sessionSetCookie(STUDENT_COOKIE, token, STUDENT_SESSION_DAYS) },
      );
    }

    if (path === '/api/student' && method === 'GET') {
      const ctx = requireStudent(req);
      return json({ participant: publicParticipant(fullParticipant(ctx.participantRow)), run: studentSafeRun(ctx.runRow) });
    }

    if (path === '/api/student/leave' && method === 'POST') {
      const token = cookieValue(req, STUDENT_COOKIE);
      if (token) db.query('DELETE FROM student_sessions WHERE token_hash = ?').run(hashToken(token));
      return json({}, 200, { 'Set-Cookie': sessionClearCookie(STUDENT_COOKIE) });
    }

    if (path === '/api/student/chat' && method === 'POST') {
      const ctx = requireStudent(req);
      return await runStudentChat(req, ctx);
    }

    if (path === '/api/student/start' && method === 'POST') {
      const ctx = requireStudent(req);
      return await runStudentStart(ctx);
    }

    if (path === '/api/student/feedback' && method === 'POST') {
      const ctx = requireStudent(req);
      const pid = ctx.participantRow.id;
      if (!limiter.allow(`feedback:${pid}`, 60, 60_000)) throw new HttpError(429, 'Too many feedback updates; slow down');
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const messageId = requireString(body.messageId, 'messageId', 1, 100);
      const raw = body.feedback;
      if (raw !== undefined && raw !== null && raw !== 'positive' && raw !== 'negative')
        throw new HttpError(400, 'feedback must be "positive", "negative", or null');
      const feedback: MessageFeedback | null = raw === 'positive' || raw === 'negative' ? raw : null;
      const target = db
        .query("SELECT * FROM messages WHERE id = ? AND participant_id = ? AND role = 'assistant'")
        .get(messageId, pid) as MessageRow | null;
      if (!target) throw new HttpError(404, 'Message not found');
      db.transaction(() => {
        db.query('UPDATE messages SET feedback = ? WHERE id = ?').run(feedback, messageId);
        db.query('UPDATE participants SET updated_at = ? WHERE id = ?').run(nowIso(), pid);
      })();
      return json({ message: messageFromRow(db.query('SELECT * FROM messages WHERE id = ?').get(messageId) as MessageRow) });
    }


    if (path === '/api/student/artifacts' && method === 'PUT') {
      const ctx = requireStudent(req);
      const run = requireLiveRun(ctx.runRow, ctx.participantRow);
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const type = requireString(body.type, 'type', 1, 30);
      if (!TOOL_TYPES[type]) throw new HttpError(400, `unknown tool type: ${type}`);
      if (!toolEnabled(run.space, type)) throw new HttpError(400, `The teacher has not enabled the ${type} tool`);
      const title = requireString(body.title, 'title', 1, 200);
      if (!isJsonValue(body.data)) throw new HttpError(400, 'artifact data must be JSON');
      if (JSON.stringify(body.data).length > MAX_ARTIFACT_CHARS) throw new HttpError(400, 'artifact too large');
      const now = nowIso();
      if (body.id !== undefined) {
        if (typeof body.id !== 'string') throw new HttpError(400, 'artifact id must be a string');
        const existing = db.query('SELECT * FROM artifacts WHERE id = ? AND participant_id = ?').get(body.id, ctx.participantRow.id);
        if (!existing) throw new HttpError(404, 'Artifact not found');
        db.query('UPDATE artifacts SET type = ?, title = ?, data = ?, updated_at = ? WHERE id = ?').run(
          type, title, JSON.stringify(body.data), now, body.id,
        );
        queueAssessment(ctx.participantRow.id);
        return json({ artifact: { id: body.id, type, title, data: body.data, updatedAt: now } });
      }
      const id = newId();
      db.query('INSERT INTO artifacts(id, participant_id, type, title, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
        id, ctx.participantRow.id, type, title, JSON.stringify(body.data), now, now,
      );
      db.query('UPDATE participants SET updated_at = ? WHERE id = ?').run(now, ctx.participantRow.id);
      queueAssessment(ctx.participantRow.id);
      return json({ artifact: { id, type, title, data: body.data, updatedAt: now } });
    }

    if (path === '/api/student/tool' && method === 'POST') {
      const ctx = requireStudent(req);
      if (!limiter.allow(`tool:${ctx.participantRow.id}`, 20, 60_000)) throw new HttpError(429, 'Too many requests; slow down');
      return await runToolGeneration(ctx.runRow, ctx.participantRow, await parseBody(req));
    }

    if (path === '/api/student/image' && method === 'POST') {
      const ctx = requireStudent(req);
      const run = requireLiveRun(ctx.runRow, ctx.participantRow);
      if (!limiter.allow(`image:${ctx.participantRow.id}`, 10, 60_000)) throw new HttpError(429, 'Too many image requests; slow down');
      if (!toolEnabled(run.space, 'image')) throw new HttpError(400, 'The teacher has not enabled the image tool');
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const prompt = requireString(body.prompt, 'prompt', 1, 1000);
      const config = await providerConfig(run.space.providerId);
      if (!config.imageModel) throw new HttpError(400, 'The configured provider has no image model');
      const img = await generateImage(config, prompt);
      return json({ mime: img.mime, data: img.data });
    }

    if (path === '/api/files' && method === 'POST') {
      const teacher = getTeacher(req);
      const student = teacher ? null : getStudent(req);
      let who: string;
      if (teacher) who = teacher.id;
      else if (student) who = student.participantRow.id;
      else throw new HttpError(401, 'Sign in or join a session first');
      if (!limiter.allow(`files:${who}`, 30, 60_000)) throw new HttpError(429, 'Too many uploads; slow down');
      let form: FormData;
      try {
        const bytes = await readBodyBytes(req, MAX_MULTIPART_BODY, 'Upload is too large (max 10 MB)');
        form = await new Response(bytes, {
          headers: { 'content-type': req.headers.get('content-type') ?? '' },
        }).formData();
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, 'Expected multipart form data with a file field');
      }
      const file = form.get('file');
      if (!(file instanceof File)) throw new HttpError(400, 'file field is required');
      const buf = new Uint8Array(await file.arrayBuffer());
      let extracted;
      try {
        extracted = await extractMaterial(file.name || 'file', buf);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : 'Could not read that file');
      }
      const material: Material = { id: newId(), name: extracted.name, text: extracted.text, mime: extracted.mime };
      if (extracted.data !== undefined) material.data = extracted.data;
      return json({ material });
    }

    // ---- teacher account ----
    if (path === '/api/teacher' && method === 'GET') {
      return json({ teacher: requireTeacher(req) });
    }

    if (path === '/api/teacher' && method === 'PATCH') {
      const teacher = requireTeacher(req);
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const name = body.name !== undefined ? requireString(body.name, 'name', 1, 100) : teacher.name;
      const custom = body.customInstructions !== undefined
        ? requireString(body.customInstructions, 'customInstructions', 0, 5000)
        : teacher.customInstructions;
      db.query('UPDATE teachers SET name = ?, custom_instructions = ? WHERE id = ?').run(name, custom, teacher.id);
      return json({ teacher: { ...teacher, name, customInstructions: custom } });
    }

    if (path === '/api/teacher/password' && method === 'POST') {
      const teacher = requireTeacher(req);
      if (!limiter.allow(`password:${teacher.id}`, 5, 60_000)) throw new HttpError(429, 'Too many password-change attempts; wait a minute.');
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const row = db.query('SELECT * FROM teachers WHERE id = ?').get(teacher.id) as TeacherRow;
      if (typeof body.currentPassword !== 'string' || !(await verifyPassword(body.currentPassword, row.pass_hash))) throw new HttpError(401, 'Current password is incorrect.');
      const passwordHash = await hashPassword(requirePassword(body.newPassword));
      requireTeacher(req);
      const changed = db.transaction(() => {
        const result = db.query('UPDATE teachers SET pass_hash = ? WHERE id = ? AND pass_hash = ?').run(passwordHash, teacher.id, row.pass_hash);
        if (result.changes) db.query('DELETE FROM teacher_sessions WHERE teacher_id = ?').run(teacher.id);
        return result.changes;
      })();
      if (!changed) throw new HttpError(409, 'The password changed while this request was running. Sign in again.');
      return json({ ok: true }, 200, { 'Set-Cookie': sessionSetCookie(TEACHER_COOKIE, createTeacherSession(teacher.id), TEACHER_SESSION_DAYS) });
    }

    const resetTeacherPassword = matchPath(path, ['api', 'teachers', ':id', 'password']);
    if (resetTeacherPassword && method === 'POST') {
      const admin = requireAdmin(req);
      if (!limiter.allow(`password-reset:${admin.id}`, 20, 60_000)) throw new HttpError(429, 'Too many password resets; wait a minute.');
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const target = db.query('SELECT * FROM teachers WHERE id = ?').get(resetTeacherPassword.id) as TeacherRow | null;
      if (!target) throw new HttpError(404, 'Teacher account not found.');
      const passwordHash = await hashPassword(requirePassword(body.password));
      requireAdmin(req);
      db.transaction(() => {
        db.query('UPDATE teachers SET pass_hash = ? WHERE id = ?').run(passwordHash, target.id);
        db.query('DELETE FROM teacher_sessions WHERE teacher_id = ?').run(target.id);
      })();
      return json({ ok: true }, 200, target.id === admin.id ? { 'Set-Cookie': sessionSetCookie(TEACHER_COOKIE, createTeacherSession(admin.id), TEACHER_SESSION_DAYS) } : undefined);
    }

    if (path === '/api/teachers' && method === 'GET') {
      requireAdmin(req);
      const rows = db.query('SELECT * FROM teachers ORDER BY created_at').all() as TeacherRow[];
      return json({ teachers: rows.map(teacherFromRow) });
    }

    if (path === '/api/teachers' && method === 'POST') {
      requireAdmin(req);
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const name = requireString(body.name, 'name', 1, 100);
      const email = requireString(body.email, 'email', 3, 200).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'email is not valid');
      const password = requirePassword(body.password === undefined || body.password === '' ? email.split('@')[0]!.slice(0, 4) : body.password);
      if (db.query('SELECT 1 AS x FROM teachers WHERE email = ?').get(email)) throw new HttpError(409, 'A teacher with that email already exists');
      const id = newId();
      db.query('INSERT INTO teachers(id, name, email, pass_hash, admin, custom_instructions, created_at) VALUES (?,?,?,?,0,\'\',?)').run(
        id, name, email, await hashPassword(password), nowIso(),
      );
      return json({ teacher: teacherFromRow(db.query('SELECT * FROM teachers WHERE id = ?').get(id) as TeacherRow) });
    }

    // ---- providers ----
    // Provider metadata is readable by every teacher (they pick a model id); only
    // administrators may change or test a connection.
    if (path === '/api/providers' && method === 'GET') {
      requireTeacher(req);
      const rows = db.query('SELECT * FROM providers ORDER BY created_at').all() as ProviderRow[];
      return json({ providers: rows.map((r) => publicProvider(providerFromRow(r))), presets: PRESETS, oauthProviders: oauthProviders(googleOAuth) });
    }

    if (path === '/api/provider-oauth/start' && method === 'POST') {
      const admin = requireAdmin(req);
      if (!limiter.allow(`oauth:${admin.id}`, 10, 60_000)) throw new HttpError(429, 'Too many provider login attempts; wait a moment.');
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      if (body.apiKey || body.keychainId) throw new HttpError(400, 'Provider login cannot include an API key or Keychain source.');
      let config: ProviderConfig, callback: string;
      try {
        config = validateProvider({ ...body, id: typeof body.id === 'string' && body.id ? body.id : newId() });
        assertOAuthDestination(body.oauthProvider, config);
        callback = oauthCallbackUrl(baseUrl);
      } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid provider login configuration.'); }
      if (new URL(req.url).origin !== new URL(baseUrl).origin) throw new HttpError(400, 'Open Providers at the configured BASE_URL before signing in.');
      const provider = body.oauthProvider as OAuthProvider;
      const state = randomToken(), verifier = randomToken(), browserToken = randomToken();
      let authorizationUrl: string;
      try { authorizationUrl = oauthAuthorizationUrl(provider, callback, state, verifier, googleOAuth); }
      catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Provider login is not configured.'); }
      for (const [key, flow] of oauthFlows) if (flow.expiresAt <= Date.now() || flow.teacherId === admin.id) oauthFlows.delete(key);
      for (const [key, flow] of oauthFinishes) if (flow.expiresAt <= Date.now() || flow.teacherId === admin.id) oauthFinishes.delete(key);
      oauthFlows.set(state, { provider, config, callback, teacherId: admin.id, sessionHash: hashToken(cookieValue(req, TEACHER_COOKIE)!), browserHash: hashToken(browserToken), verifier, expiresAt: Date.now() + 600_000, previous: providerFingerprint(config.id) });
      return json({ authorizationUrl }, 200, { 'Cache-Control': 'no-store', 'Set-Cookie': flowCookie(browserToken, 'Lax') });
    }

    if (path === '/api/provider-oauth/finish' && method === 'POST') {
      requireAdmin(req);
      const browserToken = cookieValue(req, oauthCookie);
      const key = browserToken ? hashToken(browserToken) : '';
      const flow = oauthFinishes.get(key);
      if (flow) oauthFinishes.delete(key);
      if (!flow?.code || flow.expiresAt <= Date.now() || !loginSessionActive(req, flow)) throw new HttpError(400, 'Provider login expired or the signed-in administrator changed. Start again.');
      if (providerFingerprint(flow.config.id) !== flow.previous) throw new HttpError(409, 'The connection changed during login; sign in again.');
      const credential = await exchangeOAuthCode(flow.provider, flow.code, flow.verifier, flow.callback, googleOAuth);
      if (!loginSessionActive(req, flow) || providerFingerprint(flow.config.id) !== flow.previous) throw new HttpError(409, 'Account or connection changed during login; sign in again.');
      const config = flow.config, now = nowIso();
      db.query(`INSERT INTO providers(id,name,kind,base_url,model,api_key_enc,keychain_id,oauth_provider,oauth_secret_enc,image_model,max_output_tokens,context_chars,created_at,updated_at)
        VALUES (?,?,?,?,?,NULL,NULL,?,?,?,?,?,COALESCE((SELECT created_at FROM providers WHERE id = ?),?),?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,base_url=excluded.base_url,model=excluded.model,api_key_enc=NULL,keychain_id=NULL,oauth_provider=excluded.oauth_provider,oauth_secret_enc=excluded.oauth_secret_enc,image_model=excluded.image_model,max_output_tokens=excluded.max_output_tokens,context_chars=excluded.context_chars,updated_at=excluded.updated_at`)
        .run(config.id,config.name,config.kind,config.baseUrl,config.model,flow.provider,encryptSecret(masterKey,JSON.stringify(credential)),config.imageModel ?? null,config.maxOutputTokens,config.contextChars,config.id,now,now);
      return json({ provider: publicProvider(storedProvider(config.id)!) }, 200, { 'Cache-Control': 'no-store', 'Set-Cookie': flowCookie('', 'Strict', true) });
    }

    const disconnectOAuth = matchPath(path, ['api', 'providers', ':id', 'oauth', 'disconnect']);
    if (disconnectOAuth && method === 'POST') {
      requireAdmin(req);
      const existing = storedProvider(disconnectOAuth.id);
      if (!existing?.oauthProvider) throw new HttpError(404, 'OAuth connection not found.');
      db.query('UPDATE providers SET oauth_secret_enc = NULL, updated_at = ? WHERE id = ?').run(nowIso(), existing.id);
      return json({ provider: publicProvider(storedProvider(existing.id)!) });
    }

    if (path === '/api/providers' && method === 'PUT') {
      requireAdmin(req);
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const id = typeof body.id === 'string' && body.id ? body.id : newId();
      const existing = storedProvider(id);
      const connection = selectedConnection(body, existing);
      const rawKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      let config: ProviderConfig;
      try {
        const input: Record<string, unknown> = {
          ...connection, id,
          model: body.model ?? existing?.model,
          imageModel: body.imageModel ?? existing?.imageModel,
          maxOutputTokens: body.maxOutputTokens ?? existing?.maxOutputTokens,
          contextChars: body.contextChars ?? existing?.contextChars,
        };
        config = validateProvider(input);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : 'Invalid provider configuration');
      }
      const enc = connection.keychainId || connection.oauthProvider ? null : rawKey ? encryptSecret(masterKey, rawKey) : (existing?.apiKeyEnc ?? null);
      const now = nowIso();
      db.query(
        `INSERT INTO providers(id, name, kind, base_url, model, api_key_enc, keychain_id, oauth_provider, oauth_secret_enc, image_model, max_output_tokens, context_chars, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, COALESCE((SELECT created_at FROM providers WHERE id = ?), ?), ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, base_url=excluded.base_url,
           model=excluded.model, api_key_enc=excluded.api_key_enc, keychain_id=excluded.keychain_id, oauth_provider=excluded.oauth_provider, oauth_secret_enc=excluded.oauth_secret_enc, image_model=excluded.image_model,
           max_output_tokens=excluded.max_output_tokens, context_chars=excluded.context_chars, updated_at=excluded.updated_at`,
      ).run(
        config.id, config.name, config.kind, config.baseUrl, config.model, enc, connection.keychainId ?? null, connection.oauthProvider ?? null, connection.oauthProvider ? existing?.oauthSecretEnc ?? null : null,
        config.imageModel ?? null, config.maxOutputTokens, config.contextChars,
        config.id, now, now,
      );
      const saved = storedProvider(config.id);
      if (!saved) throw new HttpError(500, 'Could not save provider');
      return json({ provider: publicProvider(saved) });
    }

    if (path === '/api/keychain' && method === 'GET') {
      requireAdmin(req);
      return json(await listKeychainEntries());
    }

    if (path === '/api/providers/models' && method === 'POST') {
      const admin = requireAdmin(req);
      if (!limiter.allow(`models:${admin.id}`, 10, 60_000)) throw new HttpError(429, 'Too many model catalogue requests; wait a moment.');
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const existing = typeof body.id === 'string' ? storedProvider(body.id) : null;
      const connection = selectedConnection(body, existing);
      if (connection.keychainId) connection.apiKey = await resolveKeychainKey(connection.keychainId, connection);
      if (connection.oauthProvider && existing) await applyOAuthCredential(existing, connection);
      return json({ models: await listModels(connection) });
    }

    const providerTest = matchPath(path, ['api', 'providers', ':id', 'test']);
    if (providerTest && method === 'POST') {
      requireAdmin(req);
      const config = await providerConfig(providerTest.id);
      if (!limiter.allow(`ptest:${providerTest.id}`, 10, 60_000)) throw new HttpError(429, 'Too many test requests; slow down');
      const reply = await complete(config, 'You are a connectivity check. Reply briefly.', [
        { role: 'user', content: 'Reply with the single word: ready' },
      ]);
      return json({ reply });
    }

    // ---- spaces ----
    if (path === '/api/spaces' && method === 'GET') {
      const teacher = requireTeacher(req);
      const rows = (teacher.admin
        ? db.query('SELECT * FROM spaces ORDER BY updated_at DESC').all()
        : db.query("SELECT * FROM spaces WHERE owner_id = ? OR visibility = 'shared' ORDER BY updated_at DESC").all(teacher.id)) as SpaceRow[];
      return json({ spaces: rows.map(spaceFromRow) });
    }

    if (path === '/api/spaces' && method === 'POST') {
      const teacher = requireTeacher(req);
      let patch: SpacePatch;
      try {
        patch = validateSpacePatch(await parseBody(req), { requireCore: true });
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : 'Invalid space');
      }
      const space = insertSpace(teacher, patch as SpacePatch & { title: string; instructions: string });
      return json({ space });
    }

    if (path === '/api/spaces/import' && method === 'POST') {
      const teacher = requireTeacher(req);
      const body = await parseBody(req);
      if (!isRecord(body) || !isRecord(body.space)) throw new HttpError(400, 'body must be {space}');
      const src = body.space;
      // Pick only writable template fields; ids/owner/timestamps never imported.
      const picked: Record<string, unknown> = {};
      for (const k of ['title', 'subtitle', 'teacherDescription', 'studentDescription', 'instructions', 'standard',
        'gradeLevel', 'subject', 'outcomes', 'agenda', 'showAgenda', 'allowLanguageChoice', 'audienceDetails', 'interactionStyle',
        'spaceType', 'materials', 'tools', 'videoUrl', 'videoQuestions', 'cover', 'folder'])
        if (src[k] !== undefined) picked[k] = src[k];
      let patch: SpacePatch;
      try {
        patch = validateSpacePatch(picked, { requireCore: true });
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : 'Invalid space file');
      }
      // Remap provider: keep only if this teacher owns a provider with that id.
      const wantedProvider = typeof src.providerId === 'string' ? src.providerId : '';
      patch.providerId = wantedProvider && storedProvider(wantedProvider) ? wantedProvider : '';
      if (patch.materials) patch.materials = patch.materials.map((m) => ({ ...m, id: newId() }));
      const space = insertSpace(teacher, patch as SpacePatch & { title: string; instructions: string });
      return json({ space });
    }

    if (path === '/api/spaces/design' && method === 'POST') {
      const teacher = requireTeacher(req);
      if (!limiter.allow(`design:${teacher.id}`, 20, 60_000)) throw new HttpError(429, 'Too many design requests; slow down');
      return await runSpaceDesign(teacher, await parseBody(req));
    }

    const spaceId = matchPath(path, ['api', 'spaces', ':id']);
    if (spaceId && method === 'GET') {
      const teacher = requireTeacher(req);
      const row = loadSpaceRow(spaceId.id);
      requireSpaceRead(teacher, row);
      return json({ space: spaceFromRow(row) });
    }

    if (spaceId && method === 'PATCH') {
      const teacher = requireTeacher(req);
      const row = loadSpaceRow(spaceId.id);
      requireSpaceWrite(teacher, row);
      let patch: SpacePatch;
      try {
        patch = validateSpacePatch(await parseBody(req), { requireCore: false });
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : 'Invalid space');
      }
      const current = spaceFromRow(row);
      const merged: Omit<Space, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'> = {
        title: patch.title ?? current.title,
        subtitle: patch.subtitle ?? current.subtitle,
        teacherDescription: patch.teacherDescription ?? current.teacherDescription,
        studentDescription: patch.studentDescription ?? current.studentDescription,
        instructions: patch.instructions ?? current.instructions,
        standard: patch.standard ?? current.standard,
        gradeLevel: patch.gradeLevel ?? current.gradeLevel,
        subject: patch.subject ?? current.subject,
        outcomes: patch.outcomes ?? current.outcomes,
        agenda: patch.agenda ?? current.agenda,
        showAgenda: patch.showAgenda ?? current.showAgenda,
        allowLanguageChoice: patch.allowLanguageChoice ?? current.allowLanguageChoice,
        audienceDetails: patch.audienceDetails ?? current.audienceDetails,
        interactionStyle: patch.interactionStyle ?? current.interactionStyle,
        spaceType: patch.spaceType ?? current.spaceType,
        visibility: patch.visibility ?? current.visibility,
        materials: patch.materials ?? current.materials,
        providerId: patch.providerId ?? current.providerId,
        tools: patch.tools ?? current.tools,
        videoUrl: patch.videoUrl ?? current.videoUrl,
        videoQuestions: patch.videoQuestions ?? current.videoQuestions,
        cover: patch.cover ?? current.cover,
        folder: patch.folder ?? current.folder,
      };
      db.query(
        `UPDATE spaces SET title=?, subtitle=?, teacher_description=?, student_description=?, instructions=?,
          standard=?, grade_level=?, subject=?, outcomes=?, agenda=?, show_agenda=?, allow_language_choice=?, audience_details=?,
          interaction_style=?, space_type=?, visibility=?, materials=?, provider_id=?, tools=?,
          video_url=?, video_questions=?, cover=?, folder=?, updated_at=? WHERE id=?`,
      ).run(
        merged.title, merged.subtitle, merged.teacherDescription, merged.studentDescription, merged.instructions,
        merged.standard, merged.gradeLevel, merged.subject, JSON.stringify(merged.outcomes), JSON.stringify(merged.agenda),
        merged.showAgenda === false ? 0 : 1, merged.allowLanguageChoice === true ? 1 : 0, merged.audienceDetails, merged.interactionStyle, merged.spaceType,
        merged.visibility,
        JSON.stringify(merged.materials), merged.providerId, JSON.stringify(merged.tools), merged.videoUrl,
        JSON.stringify(merged.videoQuestions), merged.cover, merged.folder, nowIso(), row.id,
      );
      return json({ space: spaceFromRow(loadSpaceRow(row.id)) });
    }

    const spaceDup = matchPath(path, ['api', 'spaces', ':id', 'duplicate']);
    if (spaceDup && method === 'POST') {
      const teacher = requireTeacher(req);
      const row = loadSpaceRow(spaceDup.id);
      requireSpaceRead(teacher, row);
      const src = spaceFromRow(row);
      // Remixing a shared template always lands as a private copy owned by the caller.
      const space = insertSpace(teacher, {
        title: `${src.title} (copy)`.slice(0, 200),
        subtitle: src.subtitle,
        teacherDescription: src.teacherDescription,
        studentDescription: src.studentDescription,
        instructions: src.instructions,
        standard: src.standard,
        gradeLevel: src.gradeLevel,
        subject: src.subject,
        outcomes: src.outcomes,
        agenda: src.agenda,
        showAgenda: src.showAgenda,
        allowLanguageChoice: src.allowLanguageChoice,
        audienceDetails: src.audienceDetails,
        interactionStyle: src.interactionStyle,
        spaceType: src.spaceType,
        visibility: 'private',
        materials: src.materials.map((m) => ({ ...m, id: newId() })),
        providerId: src.providerId,
        tools: src.tools,
        videoUrl: src.videoUrl,
        videoQuestions: src.videoQuestions,
        cover: src.cover,
        folder: src.folder,
      });
      return json({ space });
    }

    const spacePreview = matchPath(path, ['api', 'spaces', ':id', 'preview']);
    if (spacePreview && method === 'POST') {
      const teacher = requireTeacher(req);
      const row = loadSpaceRow(spacePreview.id);
      requireSpaceRead(teacher, row);
      if (!limiter.allow(`preview:${teacher.id}`, 20, 60_000)) throw new HttpError(429, 'Too many preview requests; slow down');
      return await runPreview(req, teacher, row);
    }

    const spaceCover = matchPath(path, ['api', 'spaces', ':id', 'cover']);
    if (spaceCover && method === 'POST') {
      const teacher = requireTeacher(req);
      const row = loadSpaceRow(spaceCover.id);
      requireSpaceWrite(teacher, row);
      if (!limiter.allow(`cover:${teacher.id}`, 10, 60_000)) throw new HttpError(429, 'Too many image requests; slow down');
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const prompt = requireString(body.prompt, 'prompt', 1, 1000);
      const space = spaceFromRow(row);
      const config = await providerConfig(space.providerId);
      if (!config.imageModel) throw new HttpError(400, 'The configured provider has no image model');
      const img = await generateImage(config, prompt);
      const cover = `data:${img.mime};base64,${img.data}`;
      db.query('UPDATE spaces SET cover = ?, updated_at = ? WHERE id = ?').run(cover, nowIso(), row.id);
      return json({ cover });
    }

    const spaceExport = matchPath(path, ['api', 'spaces', ':id', 'export']);
    if (spaceExport && method === 'GET') {
      const teacher = requireTeacher(req);
      const row = loadSpaceRow(spaceExport.id);
      requireSpaceRead(teacher, row);
      const space = spaceFromRow(row);
      const stripped: Space = {
        ...space,
        ownerId: '',
        providerId: '',
        materials: space.materials.map((m) => {
          const s: Material = { id: '', name: m.name, text: m.text, mime: m.mime };
          if (m.data !== undefined) s.data = m.data;
          return s;
        }),
      };
      return json({ space: stripped });
    }

    const spaceLaunch = matchPath(path, ['api', 'spaces', ':id', 'launch']);
    if (spaceLaunch && method === 'POST') {
      const teacher = requireTeacher(req);
      const row = loadSpaceRow(spaceLaunch.id);
      requireSpaceWrite(teacher, row);
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const space = spaceFromRow(row);
      const title = body.title !== undefined ? requireString(body.title, 'title', 1, 200) : space.title;
      const sessionPrompt = body.sessionPrompt !== undefined ? requireString(body.sessionPrompt, 'sessionPrompt', 0, 5000) : '';
      let expiresAt: string | null = null;
      if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== '') {
        if (typeof body.expiresAt !== 'string' || Number.isNaN(Date.parse(body.expiresAt)))
          throw new HttpError(400, 'expiresAt must be an ISO date-time string');
        if (Date.parse(body.expiresAt) <= Date.now()) throw new HttpError(400, 'expiresAt must be in the future');
        expiresAt = new Date(body.expiresAt).toISOString();
      }
      let maxTurns = 40;
      if (body.maxTurns !== undefined) {
        if (typeof body.maxTurns !== 'number' || !Number.isInteger(body.maxTurns) || body.maxTurns < 1 || body.maxTurns > 500)
          throw new HttpError(400, 'maxTurns must be an integer 1-500');
        maxTurns = body.maxTurns;
      }
      let sessionOutcomes: string[] | null = null;
      if (body.outcomes !== undefined) {
        try {
          sessionOutcomes = validateSpacePatch({ outcomes: body.outcomes }, { requireCore: false }).outcomes ?? [];
        } catch (e) {
          throw new HttpError(400, e instanceof Error ? e.message : 'Invalid outcomes');
        }
      }
      // A launch may replace outcomes for this run only; the reusable template keeps its own copy.
      const snapshot: Space = sessionOutcomes === null ? space : { ...space, outcomes: sessionOutcomes };
      let code = generateRunCode();
      for (let i = 0; i < 10 && db.query('SELECT 1 AS x FROM runs WHERE code = ?').get(code); i++) code = generateRunCode();
      const id = newId();
      const now = nowIso();
      db.query(
        `INSERT INTO runs(id, space_id, title, code, status, session_prompt, expires_at, max_turns, space_snapshot, summary, created_at, updated_at)
         VALUES (?,?,?,?,'active',?,?,?,?,NULL,?,?)`,
      ).run(id, space.id, title, code, sessionPrompt, expiresAt, maxTurns, JSON.stringify(snapshot), now, now);
      return json({ run: runFromRow(loadRunRow(id)) });
    }

    // ---- runs ----
    if (path === '/api/runs' && method === 'GET') {
      const teacher = requireTeacher(req);
      const rows = (teacher.admin
        ? db.query('SELECT * FROM runs ORDER BY created_at DESC').all()
        : db.query(
            `SELECT DISTINCT r.* FROM runs r JOIN spaces s ON s.id = r.space_id
             LEFT JOIN collaborators c ON c.run_id = r.id
             WHERE s.owner_id = ? OR c.teacher_id = ? ORDER BY r.created_at DESC`,
          ).all(teacher.id, teacher.id)) as RunRow[];
      return json({ runs: rows.map(runFromRow) });
    }

    const runId = matchPath(path, ['api', 'runs', ':id']);
    if (runId && method === 'GET') {
      const teacher = requireTeacher(req);
      const row = loadRunRow(runId.id);
      requireRunAccess(teacher, row);
      return json({ run: runFromRow(row) });
    }

    if (runId && method === 'PATCH') {
      const teacher = requireTeacher(req);
      const row = loadRunRow(runId.id);
      requireRunOwner(teacher, row);
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const run = runFromRow(row);
      if (run.status === 'ended') throw new HttpError(400, 'Ended sessions cannot be edited');
      const title = body.title !== undefined ? requireString(body.title, 'title', 1, 200) : run.title;
      let sessionPrompt = run.sessionPrompt;
      if (body.sessionPrompt !== undefined) {
        if (run.status !== 'paused') throw new HttpError(400, 'Pause the session before editing its instructions');
        sessionPrompt = requireString(body.sessionPrompt, 'sessionPrompt', 0, 5000);
      }
      db.query('UPDATE runs SET title = ?, session_prompt = ?, updated_at = ? WHERE id = ?').run(title, sessionPrompt, nowIso(), run.id);
      if (sessionPrompt !== run.sessionPrompt) for (const participant of db.query('SELECT id FROM participants WHERE run_id = ?').all(run.id) as { id: string }[]) queueAssessment(participant.id);
      return json({ run: runFromRow(loadRunRow(run.id)) });
    }

    const runLifecycle = matchPath(path, ['api', 'runs', ':id', ':action']);
    if (runLifecycle && method === 'POST' && (runLifecycle.action === 'pause' || runLifecycle.action === 'resume' || runLifecycle.action === 'end')) {
      const teacher = requireTeacher(req);
      const row = loadRunRow(runLifecycle.id);
      if (runLifecycle.action === 'end') requireRunOwner(teacher, row);
      else requireRunAccess(teacher, row);
      const run = runFromRow(row);
      if (run.status === 'ended') throw new HttpError(400, 'This session has already ended');
      if (runLifecycle.action === 'end') {
        db.query("UPDATE runs SET status = 'ended', updated_at = ? WHERE id = ?").run(nowIso(), run.id);
      } else if (runLifecycle.action === 'pause') {
        if (run.status !== 'active') throw new HttpError(400, 'Only an active session can be paused');
        db.query("UPDATE runs SET status = 'paused', updated_at = ? WHERE id = ?").run(nowIso(), run.id);
      } else {
        if (run.status !== 'paused') throw new HttpError(400, 'Only a paused session can be resumed');
        if (isRunExpired(run)) throw new HttpError(400, 'This session has expired and cannot be resumed');
        db.query("UPDATE runs SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso(), run.id);
      }
      return json({ run: runFromRow(loadRunRow(run.id)) });
    }

    const runDashboard = matchPath(path, ['api', 'runs', ':id', 'dashboard']);
    if (runDashboard && method === 'GET') {
      const teacher = requireTeacher(req);
      const row = loadRunRow(runDashboard.id);
      requireRunAccess(teacher, row);
      const participantRows = db.query('SELECT * FROM participants WHERE run_id = ? ORDER BY created_at').all(row.id) as ParticipantRow[];
      const collabRows = db.query(
        'SELECT t.* FROM collaborators c JOIN teachers t ON t.id = c.teacher_id WHERE c.run_id = ?',
      ).all(row.id) as TeacherRow[];
      for (const participant of participantRows) {
        const stored = db.query('SELECT 1 FROM participant_assessments WHERE participant_id = ?').get(participant.id);
        if (!stored) queueAssessment(participant.id);
      }
      return json({
        run: runFromRow(row),
        participants: participantRows.map((r) => participantFromRow(db, r)),
        summary: runSummaryFromRow(row),
        collaborators: collabRows.map((t) => ({ id: t.id, name: t.name, email: t.email })),
        alerts: listAlerts(db, row.id),
        monitoring: monitoringStatus(row.id),
      });
    }

    const runAlerts = matchPath(path, ['api', 'runs', ':id', 'alerts']);
    if (runAlerts && method === 'GET') {
      const teacher = requireTeacher(req), row = loadRunRow(runAlerts.id);
      requireRunAccess(teacher, row);
      return json({ alerts: listAlerts(db, row.id), monitoring: monitoringStatus(row.id) });
    }
    const acknowledge = matchPath(path, ['api', 'runs', ':id', 'alerts', ':alertId', 'acknowledge']);
    if (acknowledge && method === 'POST') {
      const teacher = requireTeacher(req), row = loadRunRow(acknowledge.id);
      requireRunAccess(teacher, row);
      if (!acknowledgeAlert(db, row.id, acknowledge.alertId, teacher.id)) throw new HttpError(404, 'Alert not found in this classroom.');
      return json({ ok: true });
    }

    const runCollab = matchPath(path, ['api', 'runs', ':id', 'collaborators']);
    if (runCollab && method === 'POST') {
      const teacher = requireTeacher(req);
      const row = loadRunRow(runCollab.id);
      requireRunOwner(teacher, row);
      const body = await parseBody(req);
      if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
      const email = requireString(body.email, 'email', 3, 200).toLowerCase();
      const target = db.query('SELECT * FROM teachers WHERE email = ?').get(email) as TeacherRow | null;
      if (!target) throw new HttpError(404, 'No teacher account with that email');
      db.query('INSERT OR IGNORE INTO collaborators(run_id, teacher_id) VALUES (?,?)').run(row.id, target.id);
      return json({ ok: true });
    }

    const runQr = matchPath(path, ['api', 'runs', ':id', 'qr.svg']);
    if (runQr && method === 'GET') {
      const teacher = requireTeacher(req);
      const row = loadRunRow(runQr.id);
      requireRunAccess(teacher, row);
      const run = runFromRow(row);
      const svg = await QRCode.toString(`${baseUrl}/?code=${run.code}`, { type: 'svg', margin: 1, width: 256 });
      return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', ...SECURITY_HEADERS } });
    }

    const runExport = matchPath(path, ['api', 'runs', ':id', 'export']);
    if (runExport && method === 'GET') {
      const teacher = requireTeacher(req);
      const row = loadRunRow(runExport.id);
      requireRunAccess(teacher, row);
      const run = runFromRow(row);
      const participantRows = db.query('SELECT * FROM participants WHERE run_id = ? ORDER BY created_at').all(run.id) as ParticipantRow[];
      const participants = participantRows.map((r) => participantFromRow(db, r));
      const format = url.searchParams.get('format') ?? 'json';
      if (format === 'csv') {
        const lines = [['participant_id', 'participant_name', 'message_id', 'role', 'created_at', 'content'].map(csvCell).join(',')];
        for (const p of participants)
          for (const m of p.messages)
            lines.push([p.id, p.name, m.id, m.role, m.createdAt, m.content].map(csvCell).join(','));
        return new Response(lines.join('\n'), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="run-${run.code}.csv"`,
            ...SECURITY_HEADERS,
          },
        });
      }
      const payload = JSON.stringify({ run, participants, summary: runSummaryFromRow(row) }, null, 2);
      return new Response(payload, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="run-${run.code}.json"`,
          ...SECURITY_HEADERS,
        },
      });
    }

    const runInsights = matchPath(path, ['api', 'runs', ':id', 'insights']);
    if (runInsights && method === 'POST') {
      const teacher = requireTeacher(req);
      const row = loadRunRow(runInsights.id);
      requireRunAccess(teacher, row);
      return await runGroupInsights(teacher, row);
    }

    const participantAction = matchPath(path, ['api', 'runs', ':id', 'participants', ':pid', ':action']);
    if (participantAction && method === 'POST') {
      const teacher = requireTeacher(req);
      const row = loadRunRow(participantAction.id);
      requireRunAccess(teacher, row);
      const pRow = db.query('SELECT * FROM participants WHERE id = ? AND run_id = ?').get(participantAction.pid, row.id) as ParticipantRow | null;
      if (!pRow) throw new HttpError(404, 'Student not found in this session');
      const action = participantAction.action;
      if (action === 'pause' || action === 'resume') {
        db.query('UPDATE participants SET paused = ?, updated_at = ? WHERE id = ?').run(action === 'pause' ? 1 : 0, nowIso(), pRow.id);
        return json({ participant: fullParticipant(db.query('SELECT * FROM participants WHERE id = ?').get(pRow.id) as ParticipantRow) });
      }
      if (action === 'message') {
        const body = await parseBody(req);
        if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
        const text = requireString(body.message, 'message', 1, 4000);
        const message = insertMessage(pRow.id, 'teacher', text, null, null);
        queueAssessment(pRow.id);
        return json({ message });
      }
      if (action === 'insights') {
        return await runParticipantInsights(teacher, row, pRow);
      }
      throw new HttpError(404, 'Not found');
    }

    return err('Not found', 404);
  }

  return {
    async fetch(req: Request, server?: ServerLike): Promise<Response> {
      try {
        return await route(req, server);
      } catch (e) {
        if (e instanceof HttpError) return err(e.message, e.status);
        const message = e instanceof Error ? e.message : 'unexpected error';
        // Provider errors arrive pre-sanitized from ./providers; surface them as-is.
        return err(message.length > 300 ? message.slice(0, 300) : message, 500);
      }
    },
    close(): void {
      closed = true;
      db.close();
      oauthFlows.clear();
      oauthFinishes.clear();
    },
  };
}

if (import.meta.main) {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 9272);
  const dataDir = process.env.DATA_DIR ?? join(homedir(), '.local', 'share', 'classroomai');
  const baseUrl = process.env.BASE_URL ?? `http://${host}:${port}`;
  const app = createApp({ dataDir, baseUrl });
  serve({
    hostname: host,
    port,
    idleTimeout: SERVER_IDLE_SECONDS,
    maxRequestBodySize: MAX_JSON_BODY,
    fetch: (req, server) => app.fetch(req, server),
  });
  console.log(`ClassRoomAI listening on ${baseUrl} (data: ${dataDir})`);
}
