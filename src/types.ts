export type ProviderKind = 'openai' | 'anthropic' | 'gemini';
export type OAuthProvider = 'openrouter' | 'gemini';
export interface ProviderConnection { name: string; kind: ProviderKind; baseUrl: string; apiKey?: string; authMode?: 'bearer'; quotaProject?: string }
export interface ProviderConfig extends ProviderConnection { id: string; model: string; keychainId?: string; oauthProvider?: OAuthProvider; imageModel?: string; maxOutputTokens: number; contextChars: number }
export interface ProviderModel { id: string; name: string }
export type ProviderPublic = Omit<ProviderConfig, 'apiKey'> & { hasKey: boolean };
export interface ChatMessage { role: 'user' | 'assistant'; content: string; images?: { mime: string; data: string }[] }
export interface Material { id: string; name: string; text: string; mime: string; data?: string }
export type SpaceType = 'student-learning' | 'teacher-productivity' | 'staff-operations';
export interface AgendaStep { title: string; instructions: string; tool: string | null }
export interface Space {
  id: string; ownerId: string; title: string; subtitle: string;
  teacherDescription: string; studentDescription: string; instructions: string;
  standard: string; gradeLevel: string; subject: string; outcomes: string[];
  agenda: AgendaStep[]; showAgenda: boolean; audienceDetails: string; interactionStyle: string;
  spaceType: SpaceType; visibility: 'private' | 'shared';
  allowLanguageChoice: boolean;
  materials: Material[]; providerId: string; tools: string[];
  videoUrl: string; videoQuestions: { time: number; question: string }[];
  cover: string; folder: string; createdAt: string; updatedAt: string;
}
export interface Run { id: string; spaceId: string; title: string; code: string; status: 'active' | 'paused' | 'ended'; sessionPrompt: string; expiresAt: string | null; maxTurns: number; createdAt: string; space: Space }
/** Learner rating of one assistant reply; absent means the student has not rated it. */
export type MessageFeedback = 'positive' | 'negative';
export interface Message { id: string; role: 'user' | 'assistant' | 'teacher'; content: string; createdAt: string; attachments?: Material[]; feedback?: MessageFeedback }
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface Artifact { id: string; type: string; title: string; data: JsonValue; updatedAt: string }
export interface OutcomeInsight { outcome: string; mastery: number | null; evidence: string[] }
export interface StudentInsight { headline: string; summary: string; outcomes: OutcomeInsight[]; flags: { severity: string; reason: string; evidence: string[] }[] }
export type ProgressStatus = 'not-assessed' | 'current' | 'pending' | 'unavailable';
export interface TaskEvidence { sourceId: string; quote: string }
export interface TaskCriterionResult { id: string; label: string; status: 'not-started' | 'partial' | 'complete'; evidence: TaskEvidence[] }
export interface SafeguardingFinding { category: 'off-task' | 'inappropriate' | 'danger'; severity: 'attention' | 'urgent'; reason: string; evidence: TaskEvidence[] }
export interface TaskAssessment { progress: number | null; progressEvidence: string[]; criteria: TaskCriterionResult[]; alerts: SafeguardingFinding[]; assessedAt: string }
export interface Participant { id: string; runId: string; name: string; createdAt: string; updatedAt: string; paused: boolean; messages: Message[]; progress: number | null; progressStatus: ProgressStatus; progressEvidence: string[]; taskProgressMeta?: { criteria: TaskCriterionResult[]; assessedAt: string }; artifacts: Artifact[]; insights?: StudentInsight }
export interface Teacher { id: string; name: string; email: string; admin: boolean; customInstructions: string }
