import { Database } from 'bun:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Artifact, Message, Participant, Run, Space, Teacher } from './types';
import { asAgenda, asMaterials, asRunSummary, asSpaceType, asStringArray, asStudentInsight, asTaskAssessment, asVideoQuestions, asVisibility, isJsonValue, parseJson, type RunSummary } from './validate';

export interface TeacherRow { id: string; name: string; email: string; pass_hash: string; admin: number; custom_instructions: string; created_at: string }
export interface ProviderRow { id: string; name: string; kind: string; base_url: string; model: string; api_key_enc: string | null; keychain_id: string | null; oauth_provider: string | null; oauth_secret_enc: string | null; image_model: string | null; max_output_tokens: number; context_chars: number; created_at: string; updated_at: string }
export interface SpaceRow { id: string; owner_id: string; title: string; subtitle: string; teacher_description: string; student_description: string; instructions: string; standard: string; grade_level: string; subject: string; outcomes: string; agenda: string; show_agenda: number; allow_language_choice: number; audience_details: string; interaction_style: string; space_type: string; visibility: string; materials: string; provider_id: string; tools: string; video_url: string; video_questions: string; cover: string; folder: string; created_at: string; updated_at: string }
export interface RunRow { id: string; space_id: string; title: string; code: string; status: string; session_prompt: string; expires_at: string | null; max_turns: number; space_snapshot: string; summary: string | null; created_at: string; updated_at: string }
export interface ParticipantRow { id: string; run_id: string; name: string; paused: number; progress: number; insights: string | null; created_at: string; updated_at: string }
export interface MessageRow { id: string; participant_id: string; role: string; content: string; attachments: string | null; request_id: string | null; feedback: string | null; created_at: string }
export interface ArtifactRow { id: string; participant_id: string; type: string; title: string; data: string; created_at: string; updated_at: string }

export function openDb(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const path = join(dataDir, 'classroomai.db');
  const db = new Database(path, { create: true });
  chmodSync(path, 0o600);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run(`CREATE TABLE IF NOT EXISTS teachers(
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0,
    custom_instructions TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS teacher_sessions(
    token_hash TEXT PRIMARY KEY, teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS providers(
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, base_url TEXT NOT NULL,
    model TEXT NOT NULL, api_key_enc TEXT, keychain_id TEXT, image_model TEXT,
    max_output_tokens INTEGER NOT NULL DEFAULT 1024, context_chars INTEGER NOT NULL DEFAULT 24000,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  const providerColumns = db.query('PRAGMA table_info(providers)').all() as { name: string }[];
  if (!providerColumns.some(column => column.name === 'keychain_id')) db.run('ALTER TABLE providers ADD COLUMN keychain_id TEXT');
  if (!providerColumns.some(column => column.name === 'oauth_provider')) db.run('ALTER TABLE providers ADD COLUMN oauth_provider TEXT');
  if (!providerColumns.some(column => column.name === 'oauth_secret_enc')) db.run('ALTER TABLE providers ADD COLUMN oauth_secret_enc TEXT');
  db.run(`CREATE TABLE IF NOT EXISTS spaces(
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES teachers(id),
    title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
    teacher_description TEXT NOT NULL DEFAULT '', student_description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL, standard TEXT NOT NULL DEFAULT '', grade_level TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '', outcomes TEXT NOT NULL DEFAULT '[]', agenda TEXT NOT NULL DEFAULT '[]',
    show_agenda INTEGER NOT NULL DEFAULT 1, allow_language_choice INTEGER NOT NULL DEFAULT 0,
    audience_details TEXT NOT NULL DEFAULT '',
    interaction_style TEXT NOT NULL DEFAULT '', space_type TEXT NOT NULL DEFAULT 'student-learning',
    visibility TEXT NOT NULL DEFAULT 'private',
    materials TEXT NOT NULL DEFAULT '[]', provider_id TEXT NOT NULL DEFAULT '', tools TEXT NOT NULL DEFAULT '[]',
    video_url TEXT NOT NULL DEFAULT '', video_questions TEXT NOT NULL DEFAULT '[]',
    cover TEXT NOT NULL DEFAULT '', folder TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  // Migration for pre-cutover databases: add the new columns where missing.
  const spaceCols = (db.query('PRAGMA table_info(spaces)').all() as { name: string }[]).map((c) => c.name);
  const addedColumns: Record<string, string> = {
    show_agenda: "show_agenda INTEGER NOT NULL DEFAULT 1",
    allow_language_choice: "allow_language_choice INTEGER NOT NULL DEFAULT 0",
    audience_details: "audience_details TEXT NOT NULL DEFAULT ''",
    interaction_style: "interaction_style TEXT NOT NULL DEFAULT ''",
    space_type: "space_type TEXT NOT NULL DEFAULT 'student-learning'",
    visibility: "visibility TEXT NOT NULL DEFAULT 'private'",
  };
  for (const [col, ddl] of Object.entries(addedColumns))
    if (!spaceCols.includes(col)) db.run(`ALTER TABLE spaces ADD COLUMN ${ddl}`);
  db.run(`CREATE TABLE IF NOT EXISTS runs(
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL, title TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active', session_prompt TEXT NOT NULL DEFAULT '',
    expires_at TEXT, max_turns INTEGER NOT NULL DEFAULT 40, space_snapshot TEXT NOT NULL, summary TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS collaborators(
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    PRIMARY KEY(run_id, teacher_id))`);
  db.run(`CREATE TABLE IF NOT EXISTS participants(
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0, progress REAL NOT NULL DEFAULT 0,
    insights TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS participant_assessments(
    participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL, status TEXT NOT NULL, assessment_json TEXT, updated_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS student_sessions(
    token_hash TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS messages(
    id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, attachments TEXT, request_id TEXT, feedback TEXT, created_at TEXT NOT NULL)`);
  const messageColumns = (db.query('PRAGMA table_info(messages)').all() as { name: string }[]).map((c) => c.name);
  if (!messageColumns.includes('feedback')) db.run('ALTER TABLE messages ADD COLUMN feedback TEXT');
  db.run(`CREATE TABLE IF NOT EXISTS artifacts(
    id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    type TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS chat_dedup(
    participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(participant_id, request_id))`);
  return db;
}

export function teacherFromRow(row: TeacherRow): Teacher {
  return { id: row.id, name: row.name, email: row.email, admin: row.admin === 1, customInstructions: row.custom_instructions };
}

export function spaceFromRow(row: SpaceRow): Space {
  return {
    id: row.id, ownerId: row.owner_id, title: row.title, subtitle: row.subtitle,
    teacherDescription: row.teacher_description, studentDescription: row.student_description,
    instructions: row.instructions, standard: row.standard, gradeLevel: row.grade_level, subject: row.subject,
    outcomes: asStringArray(parseJson(row.outcomes), 6, 'outcomes'),
    agenda: asAgenda(parseJson(row.agenda)),
    showAgenda: row.show_agenda === 1,
    allowLanguageChoice: row.allow_language_choice === 1,
    audienceDetails: row.audience_details,
    interactionStyle: row.interaction_style,
    spaceType: asSpaceType(row.space_type),
    visibility: asVisibility(row.visibility),
    materials: asMaterials(parseJson(row.materials)),
    providerId: row.provider_id,
    tools: asStringArray(parseJson(row.tools), 8, 'tools'),
    videoUrl: row.video_url,
    videoQuestions: asVideoQuestions(parseJson(row.video_questions)),
    cover: row.cover, folder: row.folder, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** Parse the JSON space snapshot embedded in a run row. */
export function spaceFromSnapshot(json: string): Space {
  const raw = parseJson(json);
  if (typeof raw !== 'object' || raw === null) throw new Error('corrupt run snapshot');
  const r = raw as Record<string, unknown>;
  return {
    id: String(r.id), ownerId: String(r.ownerId), title: String(r.title),
    subtitle: typeof r.subtitle === 'string' ? r.subtitle : '',
    teacherDescription: typeof r.teacherDescription === 'string' ? r.teacherDescription : '',
    studentDescription: typeof r.studentDescription === 'string' ? r.studentDescription : '',
    instructions: typeof r.instructions === 'string' ? r.instructions : '',
    standard: typeof r.standard === 'string' ? r.standard : '',
    gradeLevel: typeof r.gradeLevel === 'string' ? r.gradeLevel : '',
    subject: typeof r.subject === 'string' ? r.subject : '',
    outcomes: asStringArray(r.outcomes ?? [], 6, 'outcomes'),
    agenda: asAgenda(r.agenda ?? []),
    showAgenda: r.showAgenda !== false,
    allowLanguageChoice: r.allowLanguageChoice === true,
    audienceDetails: typeof r.audienceDetails === 'string' ? r.audienceDetails : '',
    interactionStyle: typeof r.interactionStyle === 'string' ? r.interactionStyle : '',
    spaceType: r.spaceType === undefined ? 'student-learning' : asSpaceType(r.spaceType),
    visibility: r.visibility === undefined ? 'private' : asVisibility(r.visibility),
    materials: asMaterials(r.materials ?? []),
    providerId: typeof r.providerId === 'string' ? r.providerId : '',
    tools: asStringArray(r.tools ?? [], 8, 'tools'),
    videoUrl: typeof r.videoUrl === 'string' ? r.videoUrl : '',
    videoQuestions: asVideoQuestions(r.videoQuestions ?? []),
    cover: typeof r.cover === 'string' ? r.cover : '',
    folder: typeof r.folder === 'string' ? r.folder : '',
    createdAt: String(r.createdAt ?? ''), updatedAt: String(r.updatedAt ?? ''),
  };
}

export function runFromRow(row: RunRow): Run {
  const status = row.status;
  if (status !== 'active' && status !== 'paused' && status !== 'ended') throw new Error('corrupt run status');
  return {
    id: row.id, spaceId: row.space_id, title: row.title, code: row.code, status,
    sessionPrompt: row.session_prompt, expiresAt: row.expires_at, maxTurns: row.max_turns,
    createdAt: row.created_at, space: spaceFromSnapshot(row.space_snapshot),
  };
}

export function runSummaryFromRow(row: RunRow): RunSummary | null {
  if (row.summary === null) return null;
  try {
    return asRunSummary(parseJson(row.summary));
  } catch {
    return null; // discard corrupt stored summary rather than failing the dashboard
  }
}

export function messageFromRow(row: MessageRow): Message {
  const role = row.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'teacher') throw new Error('corrupt message role');
  const msg: Message = { id: row.id, role, content: row.content, createdAt: row.created_at };
  if (row.attachments !== null) msg.attachments = asMaterials(parseJson(row.attachments));
  if (row.feedback === 'positive' || row.feedback === 'negative') msg.feedback = row.feedback;
  return msg;
}

export function artifactFromRow(row: ArtifactRow): Artifact {
  const data: unknown = parseJson(row.data);
  if (!isJsonValue(data)) throw new Error('corrupt artifact data');
  return { id: row.id, type: row.type, title: row.title, data, updatedAt: row.updated_at };
}

export function participantFromRow(db: Database, row: ParticipantRow): Participant {
  const messages = db
    .query('SELECT * FROM messages WHERE participant_id = ? ORDER BY created_at, rowid')
    .all(row.id)
    .map((r) => messageFromRow(r as MessageRow));
  const artifacts = db
    .query('SELECT * FROM artifacts WHERE participant_id = ? ORDER BY created_at, rowid')
    .all(row.id)
    .map((r) => artifactFromRow(r as ArtifactRow));
  const p: Participant = {
    id: row.id, runId: row.run_id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at,
    paused: row.paused === 1, messages, progress: null, progressStatus: 'not-assessed', progressEvidence: [], artifacts,
  };
  const assessmentRow = db.query('SELECT status, assessment_json FROM participant_assessments WHERE participant_id = ?').get(row.id) as { status: string; assessment_json: string | null } | null;
  if (assessmentRow && (assessmentRow.status === 'not-assessed' || assessmentRow.status === 'current' || assessmentRow.status === 'pending' || assessmentRow.status === 'unavailable')) {
    p.progressStatus = assessmentRow.status;
    if (assessmentRow.status === 'current' && assessmentRow.assessment_json) {
      try {
        const result = asTaskAssessment(parseJson(assessmentRow.assessment_json));
        p.progress = result.progress;
        p.progressEvidence = result.progressEvidence;
        p.taskProgressMeta = { criteria: result.criteria, assessedAt: result.assessedAt };
      } catch { p.progressStatus = 'unavailable'; }
    }
  }
  if (row.insights !== null) {
    const parsed: unknown = parseJson(row.insights);
    try {
      p.insights = asStudentInsight(parsed);
    } catch {
      // discard corrupt stored insight rather than failing the whole dashboard
    }
  }
  return p;
}

/** Provider row in camelCase form; apiKeyEnc remains encrypted ciphertext. */
export interface StoredProvider {
  id: string; name: string; kind: string; baseUrl: string; model: string;
  apiKeyEnc: string | null; keychainId?: string; oauthProvider?: string; oauthSecretEnc: string | null; imageModel?: string; maxOutputTokens: number; contextChars: number;
}

export function providerFromRow(row: ProviderRow): StoredProvider {
  const out: StoredProvider = {
    id: row.id, name: row.name, kind: row.kind, baseUrl: row.base_url, model: row.model,
    apiKeyEnc: row.api_key_enc, oauthSecretEnc: row.oauth_secret_enc, maxOutputTokens: row.max_output_tokens, contextChars: row.context_chars,
  };
  if (row.image_model) out.imageModel = row.image_model;
  if (row.keychain_id) out.keychainId = row.keychain_id;
  if (row.oauth_provider) out.oauthProvider = row.oauth_provider;
  return out;
}
