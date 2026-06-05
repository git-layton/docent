import {
  assessConversationMemory,
  type MemoryLevel,
  type MemoryNotification,
} from './memoryPolicy.ts';
import {
  type ConfidenceState,
  type EvidenceState,
  type VerificationState,
} from './grounding.ts';
import { routeToolForMessage, type RoutedTool } from './toolRouter.ts';

export type GatekeeperSourceKind = 'conversation' | 'capture' | 'research' | 'manual' | 'integration';
export type GatekeeperDestination = 'agent_memory' | 'channel_memory' | 'library' | 'task' | 'inbox_only' | 'skip';
export type GatekeeperMemoryType =
  | 'preference'
  | 'decision'
  | 'requirement'
  | 'fact'
  | 'project_context'
  | 'medical'
  | 'research'
  | 'todo'
  | 'document'
  | 'multimodal'
  | 'conversation'
  | 'capture';
export type SensitivityLevel = 'normal' | 'sensitive' | 'high';

export interface MemoryGatekeeperInput {
  sourceKind: GatekeeperSourceKind;
  text: string;
  answer?: string;
  chatKind?: 'dm' | 'channel' | 'local';
  explicitTargetKind?: 'agent' | 'channel' | 'library' | 'task' | '';
  agentTools?: Record<string, any>;
  forcedTool?: string | null;
  urls?: string[];
  sourcePaths?: string[];
  attachments?: Array<{ name?: string; type?: string; mimeType?: string; isImage?: boolean }>;
  contributions?: string[];
  captureId?: string;
}

export interface MemoryGatekeeperDecision {
  schemaVersion: 'memory-gatekeeper-v1';
  shouldSave: boolean;
  destination: GatekeeperDestination;
  memoryType: GatekeeperMemoryType;
  level: MemoryLevel;
  notification: MemoryNotification;
  evidenceState: EvidenceState;
  verification: VerificationState;
  confidence: ConfidenceState;
  toolRoute: RoutedTool | 'None';
  toolReason: string;
  sensitivity: SensitivityLevel;
  reason: string;
  tags: string[];
  score: number;
}

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const wordCount = (text: string) =>
  String(text || '').trim().split(/\s+/).filter(Boolean).length;

const explicitMemoryPattern = /\b(remember|save this|save that|keep this|note this|add this|add to memory|update memory|don't forget|for future reference)\b/i;
const preferencePattern = /\b(i prefer|i like|i hate|my preference|always use|never use|works best for me)\b/i;
const decisionPattern = /\b(decided|decision|we chose|we agreed|final call|ship with|officially)\b/i;
const requirementPattern = /\b(requirement|constraint|must|must not|needs to|has to|assumption|acceptance criteria)\b/i;
const projectPattern = /\b(project|repo|repository|release|feature|bug|fix|build|deploy|commit|architecture|roadmap|integration|model|agent|channel|knowledge base)\b/i;
const medicalPattern = /\b(medical|doctor|medication|medicine|allergy|symptom|diagnosis|health|clinic|hospital|prescription|lab result)\b/i;
const todoPattern = /\b(todo|to-do|task|remind|follow up|follow-up|deadline|appointment|schedule)\b/i;
const documentPattern = /\b(receipt|invoice|document|pdf|file|paper|form|tax|contract|letter)\b/i;

const classifyMemoryType = (text: string, input: MemoryGatekeeperInput): GatekeeperMemoryType => {
  const combined = text.toLowerCase();
  const hasImage = (input.attachments ?? []).some(a => a?.isImage || String(a?.type ?? a?.mimeType ?? '').startsWith('image/'));

  if (medicalPattern.test(combined)) return 'medical';
  if (todoPattern.test(combined)) return 'todo';
  if (input.sourceKind === 'research' || (input.urls ?? []).length > 0 && /\b(source|research|cite|verify|web|current|latest)\b/i.test(combined)) return 'research';
  if (preferencePattern.test(combined)) return 'preference';
  if (decisionPattern.test(combined)) return 'decision';
  if (requirementPattern.test(combined)) return 'requirement';
  if (documentPattern.test(combined)) return 'document';
  if (hasImage) return 'multimodal';
  if (projectPattern.test(combined)) return 'project_context';
  if (input.sourceKind === 'capture') return 'capture';
  return 'conversation';
};

const classifySensitivity = (text: string, memoryType: GatekeeperMemoryType): SensitivityLevel => {
  if (memoryType === 'medical') return 'high';
  if (/\b(api key|token|password|secret|ssn|social security|credit card|bank|legal|tax|salary)\b/i.test(text)) return 'high';
  if (/\b(family|child|wife|husband|partner|address|phone|email)\b/i.test(text)) return 'sensitive';
  return 'normal';
};

const destinationFor = (input: MemoryGatekeeperInput, memoryType: GatekeeperMemoryType): GatekeeperDestination => {
  if (input.explicitTargetKind === 'library') return 'library';
  if (input.explicitTargetKind === 'task') return 'task';
  if (input.explicitTargetKind === 'channel') return 'channel_memory';
  if (input.explicitTargetKind === 'agent') return 'agent_memory';
  if (memoryType === 'todo') return 'task';
  if (input.chatKind === 'channel') return 'channel_memory';
  if (input.sourceKind === 'capture') return 'inbox_only';
  return 'agent_memory';
};

const evidenceFor = (input: MemoryGatekeeperInput): EvidenceState => {
  if (input.sourceKind === 'research') return 'source_backed';
  if (input.sourceKind === 'capture') return 'capture_backed';
  if ((input.urls ?? []).length > 0 || (input.sourcePaths ?? []).length > 0) return 'source_backed';
  if ((input.answer ?? '').trim() || (input.contributions ?? []).length > 0) return 'mixed';
  if (input.sourceKind === 'conversation' || input.sourceKind === 'manual') return 'user_provided';
  return 'unverified';
};

const verificationFor = (
  evidenceState: EvidenceState,
  memoryType: GatekeeperMemoryType,
  input: MemoryGatekeeperInput,
): VerificationState => {
  if (memoryType === 'medical') return 'needs_verification';
  if (evidenceState === 'source_backed') return input.sourceKind === 'research' ? 'partially_verified' : 'needs_verification';
  if (evidenceState === 'capture_backed') return (input.urls ?? []).length > 0 ? 'partially_verified' : 'needs_verification';
  if (evidenceState === 'user_provided' && ['preference', 'decision', 'requirement'].includes(memoryType)) return 'verified';
  return 'needs_verification';
};

const confidenceFor = (
  level: MemoryLevel,
  evidenceState: EvidenceState,
  memoryType: GatekeeperMemoryType,
): ConfidenceState => {
  if (memoryType === 'medical') return 'low';
  if (evidenceState === 'source_backed' || evidenceState === 'capture_backed') return 'medium';
  if (level === 'explicit') return 'high';
  if (level === 'notable') return 'medium';
  if (level === 'background') return 'low';
  return 'unknown';
};

const saveDecisionForNonConversation = (input: MemoryGatekeeperInput) => {
  const text = input.text.trim();
  const hasPayload = Boolean(text || (input.urls ?? []).length || (input.attachments ?? []).length || input.captureId);
  const explicit = explicitMemoryPattern.test(text);
  const durable = [projectPattern, medicalPattern, todoPattern, documentPattern, preferencePattern, decisionPattern, requirementPattern]
    .some(pattern => pattern.test(text));
  const score = (explicit ? 7 : 0)
    + (durable ? 3 : 0)
    + ((input.urls ?? []).length > 0 ? 3 : 0)
    + ((input.attachments ?? []).length > 0 ? 3 : 0)
    + (wordCount(text) > 12 ? 1 : 0);

  if (!hasPayload || score < 2) {
    return {
      shouldSave: false,
      level: 'skip' as MemoryLevel,
      notification: 'none' as MemoryNotification,
      reason: hasPayload ? 'not enough durable signal' : 'empty capture',
      score,
      tags: ['gatekeeper'],
    };
  }

  const level: MemoryLevel = explicit ? 'explicit' : score >= 7 ? 'notable' : 'background';
  return {
    shouldSave: true,
    level,
    notification: level === 'background' ? 'none' as MemoryNotification : 'toast' as MemoryNotification,
    reason: explicit ? 'explicit memory request' : durable ? 'durable capture or work signal' : 'source or attachment should be preserved',
    score,
    tags: ['gatekeeper', `memory-${level}`],
  };
};

export const assessMemoryGatekeeper = (input: MemoryGatekeeperInput): MemoryGatekeeperDecision => {
  const text = String(input.text || '');
  const answer = String(input.answer || '');
  const combined = `${text}\n${answer}`.trim();
  const base = input.sourceKind === 'conversation'
    ? assessConversationMemory({
      question: text,
      answer,
      chatKind: input.chatKind,
      contributions: input.contributions ?? [],
      attachments: input.attachments ?? [],
    })
    : saveDecisionForNonConversation(input);

  const memoryType = classifyMemoryType(combined || text, input);
  const evidenceState = evidenceFor(input);
  const verification = verificationFor(evidenceState, memoryType, input);
  const confidence = confidenceFor(base.level, evidenceState, memoryType);
  const route = routeToolForMessage({
    message: text,
    agentTools: input.agentTools ?? {},
    forcedTool: input.forcedTool ?? null,
  });
  const destination = base.shouldSave ? destinationFor(input, memoryType) : 'skip';
  const sensitivity = classifySensitivity(combined || text, memoryType);
  const tags = unique([
    ...base.tags,
    'memory-gatekeeper',
    input.sourceKind,
    memoryType,
    destination,
    evidenceState,
    verification,
    confidence,
    sensitivity !== 'normal' ? `sensitivity-${sensitivity}` : '',
  ]);

  return {
    schemaVersion: 'memory-gatekeeper-v1',
    shouldSave: base.shouldSave,
    destination,
    memoryType,
    level: base.level,
    notification: base.notification,
    evidenceState,
    verification,
    confidence,
    toolRoute: route.tool ?? 'None',
    toolReason: route.reason,
    sensitivity,
    reason: base.reason,
    tags,
    score: base.score,
  };
};

export const validateMemoryGatekeeperDecision = (decision: MemoryGatekeeperDecision) => {
  const errors: string[] = [];
  if (decision.schemaVersion !== 'memory-gatekeeper-v1') errors.push('Unknown gatekeeper schema version.');
  if (!decision.shouldSave && decision.destination !== 'skip') errors.push('Skipped items must use destination "skip".');
  if (decision.shouldSave && decision.destination === 'skip') errors.push('Saved items cannot use destination "skip".');
  if (decision.level === 'skip' && decision.shouldSave) errors.push('Saved items cannot use level "skip".');
  if (decision.level !== 'skip' && !decision.shouldSave) errors.push('Unsaved items must use level "skip".');
  if (decision.evidenceState === 'source_backed' && decision.verification === 'verified') errors.push('Source-backed memories are only fully verified after source extraction/confirmation.');
  if (decision.evidenceState === 'unverified' && decision.confidence === 'high') errors.push('Unverified memories cannot be high confidence.');
  if (decision.memoryType === 'medical' && decision.verification === 'verified') errors.push('Medical memories cannot be marked verified by the gatekeeper alone.');
  if (!decision.tags.includes('memory-gatekeeper')) errors.push('Gatekeeper tag is required.');
  if (new Set(decision.tags).size !== decision.tags.length) errors.push('Tags must be unique.');
  return errors;
};

export const buildGatekeeperModelPrompt = (input: MemoryGatekeeperInput) => `You are a local Agent Forge Memory Gatekeeper classifier.
Return ONLY compact JSON with keys: memoryType, reason, tags.
Do not decide final verification, confidence, or destination. Local policy will enforce those.

Text:
${input.text}

Answer:
${input.answer ?? ''}`;

export const mergeModelGatekeeperSuggestion = (
  localDecision: MemoryGatekeeperDecision,
  suggestion: any,
): MemoryGatekeeperDecision => {
  if (!suggestion || typeof suggestion !== 'object') return localDecision;
  const memoryType = typeof suggestion.memoryType === 'string'
    ? suggestion.memoryType as GatekeeperMemoryType
    : localDecision.memoryType;
  const allowedTypes: GatekeeperMemoryType[] = [
    'preference', 'decision', 'requirement', 'fact', 'project_context', 'medical', 'research',
    'todo', 'document', 'multimodal', 'conversation', 'capture',
  ];
  const safeType = allowedTypes.includes(memoryType) ? memoryType : localDecision.memoryType;
  const extraTags = Array.isArray(suggestion.tags)
    ? suggestion.tags.map((tag: any) => String(tag).toLowerCase().replace(/[^a-z0-9_-]+/g, '-')).filter(Boolean).slice(0, 8)
    : [];

  return {
    ...localDecision,
    memoryType: safeType,
    reason: typeof suggestion.reason === 'string' && suggestion.reason.trim()
      ? suggestion.reason.trim().slice(0, 240)
      : localDecision.reason,
    tags: unique([...localDecision.tags, ...extraTags, safeType]),
  };
};
