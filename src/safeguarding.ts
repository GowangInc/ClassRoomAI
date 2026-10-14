import type { Database } from 'bun:sqlite';
import type { Artifact, Participant, Run, SafeguardingFinding, TaskEvidence } from './types';
import { taskArtifactEvidence } from './assessment';
import { isRecord, isJsonValue, parseJson } from './validate';

/** Teacher-only record of an advisory safeguarding alert. Never part of a student DTO. */
export interface TeacherAlert {
  id: string;
  runId: string;
  participantId: string;
  studentName: string;
  category: SafeguardingFinding['category'];
  severity: SafeguardingFinding['severity'];
  reason: string;
  evidence: TaskEvidence[];
  createdAt: string;
  acknowledgedAt: string | null;
}

interface AlertRow {
  id: string; run_id: string; participant_id: string; student_name: string; category: string;
  severity: string; reason: string; evidence: string; created_at: string; acknowledged_at: string | null;
}

interface ParticipantOwnerRow { name: string; run_id: string }
interface MessageSourceRow { id: string; role: string; content: string; attachments: string | null }
interface ArtifactSourceRow { id: string; type: string; data: string }
interface AlertEvidenceSource { role: 'student' | 'assistant' | 'student-work'; text: string }

// Twenty model findings plus one derived support-needed signal.
const MAX_FINDINGS = 21;
const MAX_EVIDENCE_PER_FINDING = 12;
const MAX_REASON_CHARS = 2000;

/**
 * Persistent teacher alert storage, scoped by run and participant. Idempotent; call on app startup.
 * No foreign keys: alerts are an audit trail that must survive participant/run cleanup.
 */
export function createAlertTables(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS teacher_alerts(
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence TEXT NOT NULL,
    evidence_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    acknowledged_at TEXT,
    acknowledged_by TEXT)`);
  db.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS teacher_alerts_evidence ON teacher_alerts(participant_id, category, evidence_key)',
  );
  db.run('CREATE INDEX IF NOT EXISTS teacher_alerts_run ON teacher_alerts(run_id, created_at)');
}

/**
 * Persist admissible alerts for one participant. Evidence is re-validated against persisted
 * student-owned messages/attachments/artifacts and assistant messages only for inappropriate/danger,
 * so forged IDs, teacher quotes, off-task or support-needed assistant quotes, and absent verbatim
 * quotes cannot alert. Support-needed findings are attention-only advisory signals.
 * Alerts dedupe on participant + category + sorted evidence source ids; acknowledged alerts are not
 * re-opened for the same evidence, while genuinely new evidence still alerts.
 */
export function recordAlerts(db: Database, run: Run, participant: Participant, findings: SafeguardingFinding[]): void {
  if (!Array.isArray(findings) || findings.length === 0) return;
  const owner = db.query('SELECT name, run_id FROM participants WHERE id = ?').get(participant.id) as ParticipantOwnerRow | null;
  if (!owner || owner.run_id !== run.id) return;
  const sources = eligibleSourceText(db, participant.id, run);
  const insert = db.query(
    `INSERT OR IGNORE INTO teacher_alerts(
      id, run_id, participant_id, student_name, category, severity, reason, evidence, evidence_key,
      created_at, acknowledged_at, acknowledged_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL)`,
  );
  for (const finding of findings.slice(0, MAX_FINDINGS)) {
    const candidate: unknown = finding;
    if (!isRecord(candidate)) continue;
    const category = candidate.category;
    const severity = candidate.severity;
    if (category !== 'off-task' && category !== 'inappropriate' && category !== 'danger' && category !== 'support-needed') continue;
    if (severity !== 'attention' && severity !== 'urgent') continue;
    if (category === 'support-needed' && severity !== 'attention') continue;
    const evidence = admissibleEvidence(candidate.evidence, sources, category);
    if (evidence.length === 0) continue;
    const aiOutput = evidence.some((entry) => sources.get(entry.sourceId)?.role === 'assistant');
    const reason = aiOutput
      ? 'AI-generated assistant output flagged for teacher review; this alert concerns the assistant response, not the student.'
      : typeof candidate.reason === 'string' ? candidate.reason.trim().slice(0, MAX_REASON_CHARS) : '';
    if (!reason) continue;
    const evidenceKey = JSON.stringify([...new Set(evidence.map((entry) => entry.sourceId))].sort());
    insert.run(
      crypto.randomUUID(), run.id, participant.id, owner.name, category, severity, reason,
      JSON.stringify(evidence), evidenceKey, new Date().toISOString(),
    );
  }
}

/** Alerts for one run, newest first. Callers must authorize the teacher before exposing these. */
export function listAlerts(db: Database, runId: string): TeacherAlert[] {
  const rows = db.query(
    `SELECT id, run_id, participant_id, student_name, category, severity, reason, evidence, created_at, acknowledged_at
     FROM teacher_alerts WHERE run_id = ? ORDER BY created_at DESC, rowid DESC`,
  ).all(runId) as AlertRow[];
  const alerts: TeacherAlert[] = [];
  for (const row of rows) {
    const alert = alertFromRow(row);
    if (alert) alerts.push(alert);
  }
  return alerts;
}

/**
 * Mark one alert acknowledged by a teacher. Returns false only when the alert does not exist in the
 * run; repeating an acknowledgement is a no-op that still reports success.
 */
export function acknowledgeAlert(db: Database, runId: string, alertId: string, teacherId: string): boolean {
  const row = db.query('SELECT acknowledged_at FROM teacher_alerts WHERE id = ? AND run_id = ?').get(alertId, runId) as
    | { acknowledged_at: string | null }
    | null;
  if (!row) return false;
  if (row.acknowledged_at === null) {
    db.query('UPDATE teacher_alerts SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ? AND run_id = ? AND acknowledged_at IS NULL').run(
      new Date().toISOString(), teacherId, alertId, runId,
    );
  }
  return true;
}

function alertFromRow(row: AlertRow): TeacherAlert | null {
  if (row.category !== 'off-task' && row.category !== 'inappropriate' && row.category !== 'danger' && row.category !== 'support-needed') return null;
  if (row.severity !== 'attention' && row.severity !== 'urgent') return null;
  if (row.category === 'support-needed' && row.severity !== 'attention') return null;
  const evidence: TaskEvidence[] = [];
  try {
    const parsed: unknown = parseJson(row.evidence);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (isTaskEvidence(entry)) evidence.push({ sourceId: entry.sourceId, quote: entry.quote });
      }
    }
  } catch {
    // Keep the alert visible even if its stored evidence JSON is unreadable.
  }
  return {
    id: row.id, runId: row.run_id, participantId: row.participant_id, studentName: row.student_name,
    category: row.category, severity: row.severity, reason: row.reason, evidence,
    createdAt: row.created_at, acknowledgedAt: row.acknowledged_at,
  };
}

function isTaskEvidence(value: unknown): value is TaskEvidence {
  return isRecord(value) && typeof value.sourceId === 'string' && typeof value.quote === 'string';
}

/**
 * Admissible evidence only: ids must belong to this participant, quotes must occur verbatim in the
 * persisted source text, and entries are deduplicated. Unusable citations are dropped rather than
 * discarding the whole finding, so a real safety signal survives one bad citation.
 */
function admissibleEvidence(
  value: unknown,
  sources: Map<string, AlertEvidenceSource>,
  category: SafeguardingFinding['category'],
): TaskEvidence[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_PER_FINDING) return [];
  const evidence: TaskEvidence[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const sourceId = entry.sourceId;
    const quote = entry.quote;
    if (typeof sourceId !== 'string' || typeof quote !== 'string' || !quote.trim()) continue;
    const source = sources.get(sourceId);
    if (!source || !source.text.includes(quote)) continue;
    if (category === 'off-task' && source.role !== 'student') continue;
    if (source.role === 'assistant' && category !== 'inappropriate' && category !== 'danger') continue;
    if (!evidence.some((existing) => existing.sourceId === sourceId && existing.quote === quote)) evidence.push({ sourceId, quote });
  }
  return evidence;
}

/** Persisted source text; assistant messages are admissible only for generated-output safety alerts. */
function eligibleSourceText(db: Database, participantId: string, run: Run): Map<string, AlertEvidenceSource> {
  const sources = new Map<string, AlertEvidenceSource>();
  const add = (id: string, role: AlertEvidenceSource['role'], text: string): void => {
    if (id && text.trim() && !sources.has(id)) sources.set(id, { role, text });
  };
  const messages = db.query(
    'SELECT id, role, content, attachments FROM messages WHERE participant_id = ? ORDER BY created_at, rowid',
  ).all(participantId) as MessageSourceRow[];
  for (const message of messages) {
    if (message.role === 'user') {
      add(message.id, 'student', message.content);
      if (message.attachments === null) continue;
      let attachments: unknown;
      try {
        attachments = parseJson(message.attachments);
      } catch {
        continue;
      }
      if (!Array.isArray(attachments)) continue;
      for (const attachment of attachments) {
        if (!isRecord(attachment) || typeof attachment.id !== 'string') continue;
        const text = typeof attachment.text === 'string' ? attachment.text : '';
        const imageAvailable = typeof attachment.mime === 'string'
          && /^image\/(?:png|jpe?g|gif|webp|bmp)$/i.test(attachment.mime)
          && typeof attachment.data === 'string' && attachment.data.length > 0;
        add(attachment.id, 'student', [text, imageAvailable ? '[attached image available for review]' : ''].filter(Boolean).join('\n'));
      }
    } else if (message.role === 'assistant') {
      add(message.id, 'assistant', message.content);
    }
  }
  const artifacts = db.query(
    'SELECT id, type, data FROM artifacts WHERE participant_id = ? ORDER BY created_at, rowid',
  ).all(participantId) as ArtifactSourceRow[];
  for (const row of artifacts) {
    let data: unknown;
    try {
      data = parseJson(row.data);
    } catch {
      continue;
    }
    if (!isJsonValue(data)) continue;
    const artifact: Artifact = { id: row.id, type: row.type, title: '', data, updatedAt: '' };
    const normalized = taskArtifactEvidence(artifact, run);
    if (normalized) add(row.id, 'student-work', normalized.text);
  }
  return sources;
}


