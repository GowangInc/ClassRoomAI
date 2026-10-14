import type { AgendaStep, InteractionAssessment, JsonValue, Material, SafeguardingFinding, SpaceType, StudentInsight, TaskAssessment, TaskCriterionResult, TaskEvidence } from './types';

/** Tool types a teacher can enable; also the allowed artifact types. */
export const TOOL_TYPES: Record<string, true> = {
  document: true,
  doodle: true,
  mindmap: true,
  flashcards: true,
  presentation: true,
  graph: true,
  video: true,
  image: true,
};

export function asSpaceType(x: unknown): SpaceType {
  if (x === 'student-learning' || x === 'teacher-productivity' || x === 'staff-operations') return x;
  throw new Error('spaceType must be student-learning, teacher-productivity, or staff-operations');
}

export function asVisibility(x: unknown): 'private' | 'shared' {
  if (x !== 'private' && x !== 'shared') throw new Error("visibility must be 'private' or 'shared'");
  return x;
}

/** Strict AgendaStep list: max 8 steps, per-step tool from the tool registry or null. */
export function asAgenda(x: unknown): AgendaStep[] {
  if (!Array.isArray(x)) throw new Error('agenda must be an array');
  if (x.length > 8) throw new Error('agenda allows at most 8 steps');
  return x.map((v) => {
    if (!isRecord(v) || typeof v.title !== 'string' || typeof v.instructions !== 'string')
      throw new Error('agenda steps require string title and instructions');
    if (v.title.length === 0 || v.title.length > 300) throw new Error('agenda step title must be 1-300 characters');
    if (v.instructions.length > 2000) throw new Error('agenda step instructions too long (max 2000 characters)');
    if (v.tool !== null && (typeof v.tool !== 'string' || !TOOL_TYPES[v.tool]))
      throw new Error('agenda step tool must be a known tool or null');
    return { title: v.title, instructions: v.instructions, tool: v.tool };
  });
}

/** Run-level AI summary stored on runs.summary and served on the dashboard. */
export interface RunSummary {
  summary: string;
  misconceptions: string[];
  /** participant ids whose assessed mastery indicates they need support */
  support: string[];
  /** participant ids whose assessed mastery indicates they are ready to move on */
  ready: string[];
}

export function isJsonValue(x: unknown): x is JsonValue {
  if (x === null) return true;
  switch (typeof x) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(x);
    case 'object':
      if (Array.isArray(x)) return x.every(isJsonValue);
      return Object.values(x as Record<string, unknown>).every(isJsonValue);
    default:
      return false;
  }
}

export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

/** Canonical object guard for this package; import from here, never redefine. */
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function asStringArray(x: unknown, maxLen: number, label: string): string[] {
  if (!Array.isArray(x)) throw new Error(`${label} must be an array`);
  if (x.length > maxLen) throw new Error(`${label} allows at most ${maxLen} entries`);
  return x.map((v) => {
    if (typeof v !== 'string') throw new Error(`${label} entries must be strings`);
    return v;
  });
}

const MATERIAL_MIMES: Record<string, true> = {
  'text/plain': true,
  'text/markdown': true,
  'text/csv': true,
  'application/pdf': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'image/png': true,
  'image/jpeg': true,
  'image/gif': true,
};

export function asMaterials(x: unknown): Material[] {
  if (!Array.isArray(x)) throw new Error('materials must be an array');
  return x.map((v) => {
    if (!isRecord(v)) throw new Error('material must be an object');
    const { id, name, text, mime, data } = v;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof text !== 'string' || typeof mime !== 'string')
      throw new Error('material requires string id, name, text, mime');
    if (!MATERIAL_MIMES[mime]) throw new Error(`unsupported material mime: ${mime}`);
    if (data !== undefined && typeof data !== 'string') throw new Error('material data must be base64 string');
    const m: Material = { id, name, text, mime };
    if (typeof data === 'string') m.data = data;
    return m;
  });
}

export function asVideoQuestions(x: unknown): { time: number; question: string }[] {
  if (!Array.isArray(x)) throw new Error('videoQuestions must be an array');
  return x.map((v) => {
    if (!isRecord(v) || typeof v.time !== 'number' || !Number.isFinite(v.time) || typeof v.question !== 'string')
      throw new Error('videoQuestions entries require numeric time and string question');
    return { time: v.time, question: v.question };
  });
}

function asEvidence(x: unknown): string[] {
  return asStringArray(x, 50, 'evidence');
}

/** Strict StudentInsight validation: mastery 1-4 or null, evidence = message id citations. */
export function asStudentInsight(x: unknown): StudentInsight {
  if (!isRecord(x)) throw new Error('insights must be an object');
  const { headline, summary, outcomes, flags } = x;
  if (typeof headline !== 'string' || headline.length > 300) throw new Error('insights.headline must be a short string');
  if (typeof summary !== 'string' || summary.length > 4000) throw new Error('insights.summary must be a string');
  if (!Array.isArray(outcomes)) throw new Error('insights.outcomes must be an array');
  const parsedOutcomes = outcomes.map((o) => {
    if (!isRecord(o) || typeof o.outcome !== 'string') throw new Error('outcome entries require a string outcome');
    let mastery: number | null = null;
    if (o.mastery !== null) {
      if (typeof o.mastery !== 'number' || !Number.isInteger(o.mastery) || o.mastery < 1 || o.mastery > 4)
        throw new Error('outcome mastery must be an integer 1-4 or null');
      mastery = o.mastery;
    }
    return { outcome: o.outcome, mastery, evidence: asEvidence(o.evidence) };
  });
  if (!Array.isArray(flags)) throw new Error('insights.flags must be an array');
  const parsedFlags = flags.map((f) => {
    if (!isRecord(f) || typeof f.severity !== 'string' || typeof f.reason !== 'string')
      throw new Error('flag entries require severity and reason strings');
    return { severity: f.severity, reason: f.reason, evidence: asEvidence(f.evidence) };
  });
  return { headline, summary, outcomes: parsedOutcomes, flags: parsedFlags };
}

export function asTaskAssessment(value: unknown): TaskAssessment {
  if (!isRecord(value) || (value.progress !== null && (typeof value.progress !== 'number' || !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 100)) || typeof value.assessedAt !== 'string' || !Number.isFinite(Date.parse(value.assessedAt))) throw new Error('Invalid stored task assessment.');
  const progressEvidence = asStringArray(value.progressEvidence, 100, 'progressEvidence');
  function evidenceList(raw: unknown): TaskEvidence[] {
    if (!Array.isArray(raw) || raw.length > 100) throw new Error('Invalid task evidence.');
    return raw.map(item => {
      if (!isRecord(item) || typeof item.sourceId !== 'string' || typeof item.quote !== 'string' || !item.sourceId || !item.quote || item.sourceId.length > 200 || item.quote.length > 8192) throw new Error('Invalid task evidence.');
      return { sourceId: item.sourceId, quote: item.quote };
    });
  }
  if (!Array.isArray(value.criteria) || value.criteria.length > 40) throw new Error('Invalid task criteria.');
  const criteria: TaskCriterionResult[] = value.criteria.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.label !== 'string' || (item.status !== 'not-started' && item.status !== 'partial' && item.status !== 'complete')) throw new Error('Invalid task criterion.');
    const evidence = evidenceList(item.evidence);
    if (item.status !== 'not-started' && !evidence.length) throw new Error('Task completion needs evidence.');
    return { id: item.id, label: item.label, status: item.status, evidence };
  });
  const INTERACTION_STATUSES = ['getting-started', 'on-track', 'deepening', 'needs-guidance', 'struggling', 'discouraged', 'frustrated', 'off-task'];
  let interaction: InteractionAssessment | null = null;
  if (value.interaction !== undefined && value.interaction !== null) {
    const item = value.interaction;
    if (!isRecord(item) || typeof item.status !== 'string' || !INTERACTION_STATUSES.includes(item.status)) throw new Error('Invalid interaction status.');
    if (typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 1200) throw new Error('Invalid interaction summary.');
    const interactionEvidence = evidenceList(item.evidence);
    if (!interactionEvidence.length || interactionEvidence.length > 12) throw new Error('Invalid interaction evidence.');
    interaction = { status: item.status as InteractionAssessment['status'], summary: item.summary, evidence: interactionEvidence };
  }
  // Twenty model findings plus one reserved, evidence-grounded support signal.
  if (!Array.isArray(value.alerts) || value.alerts.length > 21) throw new Error('Invalid task alerts.');
  const alerts: SafeguardingFinding[] = value.alerts.map(item => {
    if (!isRecord(item) || (item.category !== 'off-task' && item.category !== 'inappropriate' && item.category !== 'danger' && item.category !== 'support-needed') || (item.severity !== 'attention' && item.severity !== 'urgent') || typeof item.reason !== 'string') throw new Error('Invalid task alert.');
    if (item.category === 'support-needed' && item.severity !== 'attention') throw new Error('Invalid task alert.');
    return { category: item.category, severity: item.severity, reason: item.reason, evidence: evidenceList(item.evidence) };
  });
  return { progress: value.progress, progressEvidence, criteria, interaction, alerts, assessedAt: value.assessedAt };
}

export function asRunSummary(x: unknown): RunSummary {
  if (!isRecord(x)) throw new Error('summary must be an object');
  if (typeof x.summary !== 'string') throw new Error('summary.summary must be a string');
  return {
    summary: x.summary,
    misconceptions: asStringArray(x.misconceptions, 20, 'misconceptions'),
    support: asStringArray(x.support, 200, 'support'),
    ready: asStringArray(x.ready, 200, 'ready'),
  };
}
