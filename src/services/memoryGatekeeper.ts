export type MemoryClassification = 'skip' | 'background' | 'notable' | 'explicit';
export type MemoryDestination = 'agent_memory' | 'channel_memory' | 'library' | 'task' | 'inbox_only' | 'skip';
export type MemoryType =
  | 'preference'
  | 'decision'
  | 'fact'
  | 'project_context'
  | 'medical'
  | 'research'
  | 'todo'
  | 'none';
export type EvidenceState = 'first_party' | 'source_backed' | 'inferred' | 'needs_verification' | 'conflicting';
export type ConfidenceLabel = 'low' | 'medium' | 'high';
export type ToolRoute = 'memory_search' | 'web_search' | 'browser' | 'integrations' | 'files' | 'calendar' | 'another_agent' | 'none';
export type PrivacyLabel = 'normal' | 'personal' | 'sensitive';

export interface MemoryGatekeeperInput {
  text: string;
  agentId?: string | null;
  agentName?: string | null;
  channelId?: string | null;
  chatId?: string | null;
  forcedTool?: string | null;
  enabledTools?: Record<string, boolean>;
  sourcePaths?: string[];
  sourceUrls?: string[];
  attachedFiles?: Array<{ name?: string; type?: string; isImage?: boolean }>;
}

export interface MemoryGatekeeperDecision {
  shouldSave: boolean;
  classification: MemoryClassification;
  destination: MemoryDestination;
  memoryType: MemoryType;
  evidenceState: EvidenceState;
  confidence: ConfidenceLabel;
  privacy: PrivacyLabel;
  reason: string;
  tags: string[];
  toolRoutes: ToolRoute[];
  warnings: string[];
  provenance: {
    source: 'user' | 'file' | 'web' | 'mixed';
    sourcePaths: string[];
    sourceUrls: string[];
  };
}

const CLASSIFICATIONS = ['skip', 'background', 'notable', 'explicit'] as const;
const DESTINATIONS = ['agent_memory', 'channel_memory', 'library', 'task', 'inbox_only', 'skip'] as const;
const MEMORY_TYPES = ['preference', 'decision', 'fact', 'project_context', 'medical', 'research', 'todo', 'none'] as const;
const EVIDENCE_STATES = ['first_party', 'source_backed', 'inferred', 'needs_verification', 'conflicting'] as const;
const CONFIDENCE_LABELS = ['low', 'medium', 'high'] as const;
const TOOL_ROUTES = ['memory_search', 'web_search', 'browser', 'integrations', 'files', 'calendar', 'another_agent', 'none'] as const;
const PRIVACY_LABELS = ['normal', 'personal', 'sensitive'] as const;

const TRIVIAL_RE = /^(lol|lmao|haha|thanks|thank you|thx|ok|okay|yes|no|yep|nah|cool|nice|got it|sounds good|perfect)[.!?\s]*$/i;
const EXPLICIT_MEMORY_RE = /\b(remember this|remember that|remember my|remember:|please remember|save this|save that|save to memory|add to memory|note this|take a note|pin this|log this|add this to (my )?(memory|library)|save to library)\b/i;
const TASK_RE = /\b(to-?do|task|remind me|schedule|appointment|meeting|deadline|follow up|call .* by|email .* by|add .* to planner)\b/i;
const DECISION_RE = /\b(we decided|decision|agreed|approved|chosen|final decision|supported|not supported|standardize|settled on|ship with|decided that)\b/i;
const PREFERENCE_RE = /\b(prefers?|preference|likes?|dislikes?|favorite|always wants?|never wants?|morning appointments?|evening appointments?)\b/i;
const MEDICAL_RE = /\b(medical|doctor|medication|medicine|diagnosis|symptom|allerg(?:y|ic)|blood pressure|lab result|prescription|dose|health note|medical note|appointment with)\b/i;
const RESEARCH_RE = /\b(research|paper|study|source|claim|evidence|according to|article|citation|web claim|wikipedia|brave search)\b/i;
const PROJECT_RE = /\b(project|product|architecture|feature|bug|deck|failed because|root cause|star wars|ccg|force generation|agent forge|implementation)\b/i;
const EXTERNAL_CLAIM_RE = /\b(according to|the web says|research says|study says|source says|claim:|unsourced|i read that|article says|wikipedia says)\b/i;
const INFERRED_RE = /\b(i think|maybe|probably|seems like|might be|my guess|inferred|appears to)\b/i;
const CONFLICT_RE = /\b(conflicts? with|contradicts?|actually|correction|correcting|no longer|replace the previous|supersedes)\b/i;
const CHANNEL_RE = /\b(in this channel|for this channel|channel memory|product channel|team channel)\b/i;
const PERSONAL_RE = /\b(my|me|i|wife|husband|partner|child|kid|daughter|son|family|home|address|phone|email)\b/i;

// MEMS: Emotional Enhancement (McGaugh 2003) — affective language encodes more durably
const EMOTIONAL_RE = /\b(i'?m (so |really )?(worried|scared|excited|frustrated|angry|upset|thrilled|devastated|anxious|nervous|stressed|overwhelmed|terrified)|can'?t believe (this|it|what)|oh no|this is (terrible|amazing|awful|incredible)|i feel (like|that|so))\b/i;

// MEMS: Self-Reference Effect (Rogers 1977) — aspiration and identity statements
const ASPIRATION_RE = /\b(i (want to|'?d love to|dream of|hope to|am trying to|'?m working toward)|my (goal|dream|ambition|aspiration) is|i'?ve always wanted to|someday i'?ll|i'?m going to (make|become|build|create|achieve))\b/i;

// MEMS: Prospective Memory (Brandimonte 1996) — future intentions must be captured
const PROSPECTIVE_RE = /\b(remind me (to|about|that)|don'?t (let me )?forget (to|about|that)|i need to remember (to|that)|note to (self|me):?|must (remember|not forget) (to|that))\b/i;
const QUESTION_RE = /^(what|who|when|where|why|how|can you|could you|please (search|find)|search|look up|find)\b/i;
const MEMORY_SEARCH_RE = /\b(notes?|memos?|memory|knowledge base|goals?|decisions?|research|workspace|saved|wrote|recall|pinned|what did we decide|what do you remember)\b/i;
const WEB_SEARCH_RE = /\b(search for|look up|google|web search|current (weather|news|price|score)|today'?s (weather|news)|latest (news|update)|breaking news|weather (in|for)|stock (price|market)|news about|what'?s happening)\b/i;
const BROWSER_RE = /\b(browser|open (the )?(site|page|url)|current page|web page|navigate to|inspect this page)\b/i;
const FILES_RE = /\b(file|folder|document|pdf|screenshot|attached|attachment|download|upload)\b/i;
const INTEGRATIONS_RE = /\b(slack|gmail|email|google drive|drive|gus|work item|calendar event|spreadsheet|sheet)\b/i;
const URL_RE = /\bhttps?:\/\/[^\s)>\]]+/gi;

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function pickOne<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function stripSystemPrefixes(text: string): string {
  return String(text ?? '').replace(/^\[PLANNING MODE[^\]]*\]\n+/i, '').trim();
}

function extractUrls(text: string): string[] {
  return text.match(URL_RE)?.map(url => url.replace(/[.,;:]+$/, '')) ?? [];
}

function provenanceSource(sourcePaths: string[], sourceUrls: string[]): MemoryGatekeeperDecision['provenance']['source'] {
  if (sourcePaths.length > 0 && sourceUrls.length > 0) return 'mixed';
  if (sourcePaths.length > 0) return 'file';
  if (sourceUrls.length > 0) return 'web';
  return 'user';
}

function makeDefaultDecision(input?: Partial<MemoryGatekeeperInput>): MemoryGatekeeperDecision {
  const text = stripSystemPrefixes(input?.text ?? '');
  const sourcePaths = uniq(input?.sourcePaths ?? []);
  const sourceUrls = uniq([...(input?.sourceUrls ?? []), ...extractUrls(text)]);
  return {
    shouldSave: false,
    classification: 'skip',
    destination: 'skip',
    memoryType: 'none',
    evidenceState: 'first_party',
    confidence: 'low',
    privacy: 'normal',
    reason: 'No durable memory signal found.',
    tags: [],
    toolRoutes: ['none'],
    warnings: [],
    provenance: {
      source: provenanceSource(sourcePaths, sourceUrls),
      sourcePaths,
      sourceUrls,
    },
  };
}

function routeToolCandidates(input: MemoryGatekeeperInput, text: string, isExplicitMemory: boolean): ToolRoute[] {
  const enabled = input.enabledTools ?? {};
  const forced = input.forcedTool;
  const routes: ToolRoute[] = [];

  if (forced === 'workspace') routes.push('memory_search');
  if (forced === 'search') routes.push('web_search');
  if (forced) return routes.length > 0 ? routes : ['none'];

  if ((enabled.calendar_sync || enabled.google_calendar) && TASK_RE.test(text)) routes.push('calendar');
  if (enabled.local_workspace && !isExplicitMemory && MEMORY_SEARCH_RE.test(text)) routes.push('memory_search');
  if (enabled.web_search && WEB_SEARCH_RE.test(text)) routes.push('web_search');
  if (BROWSER_RE.test(text)) routes.push('browser');
  if (FILES_RE.test(text) || (input.attachedFiles?.length ?? 0) > 0) routes.push('files');
  if (Object.keys(enabled).some(key => enabled[key] && ['slack', 'gmail', 'google_drive', 'google_calendar', 'gus'].includes(key)) && INTEGRATIONS_RE.test(text)) {
    routes.push('integrations');
  }

  return uniq(routes).length > 0 ? uniq(routes) : ['none'];
}

export function validateMemoryGatekeeperDecision(
  raw: Partial<MemoryGatekeeperDecision>,
  fallbackInput?: Partial<MemoryGatekeeperInput>,
): MemoryGatekeeperDecision {
  const fallback = makeDefaultDecision(fallbackInput);
  const classification = pickOne(raw.classification, CLASSIFICATIONS, fallback.classification);
  const shouldSave = Boolean(raw.shouldSave) && classification !== 'skip';
  const destination = shouldSave
    ? pickOne(raw.destination, DESTINATIONS, fallback.destination === 'skip' ? 'agent_memory' : fallback.destination)
    : 'skip';

  return {
    shouldSave,
    classification,
    destination,
    memoryType: pickOne(raw.memoryType, MEMORY_TYPES, fallback.memoryType),
    evidenceState: pickOne(raw.evidenceState, EVIDENCE_STATES, fallback.evidenceState),
    confidence: pickOne(raw.confidence, CONFIDENCE_LABELS, fallback.confidence),
    privacy: pickOne(raw.privacy, PRIVACY_LABELS, fallback.privacy),
    reason: String(raw.reason || fallback.reason),
    tags: uniq((raw.tags ?? fallback.tags).map(tag => String(tag).trim().toLowerCase()).filter(tag => tag.length > 0)),
    toolRoutes: uniq((raw.toolRoutes ?? fallback.toolRoutes).map(route => pickOne(route, TOOL_ROUTES, 'none'))),
    warnings: uniq((raw.warnings ?? fallback.warnings).map(warning => String(warning)).filter(warning => warning.length > 0)),
    provenance: {
      source: pickOne(raw.provenance?.source, ['user', 'file', 'web', 'mixed'] as const, fallback.provenance.source),
      sourcePaths: uniq(raw.provenance?.sourcePaths ?? fallback.provenance.sourcePaths),
      sourceUrls: uniq(raw.provenance?.sourceUrls ?? fallback.provenance.sourceUrls),
    },
  };
}

export function evaluateMemoryGate(input: MemoryGatekeeperInput): MemoryGatekeeperDecision {
  const cleanedText = stripSystemPrefixes(input.text);
  const text = cleanedText.toLowerCase();
  const sourcePaths = uniq(input.sourcePaths ?? []);
  const sourceUrls = uniq([...(input.sourceUrls ?? []), ...extractUrls(cleanedText)]);
  const tags = new Set<string>();
  const warnings = new Set<string>();

  if (!cleanedText || TRIVIAL_RE.test(cleanedText)) {
    return validateMemoryGatekeeperDecision({
      ...makeDefaultDecision({ ...input, text: cleanedText, sourcePaths, sourceUrls }),
      toolRoutes: routeToolCandidates(input, text, false),
    }, input);
  }

  const explicit = EXPLICIT_MEMORY_RE.test(cleanedText);
  const isTask = TASK_RE.test(cleanedText);
  const isDecision = DECISION_RE.test(cleanedText);
  const isPreference = PREFERENCE_RE.test(cleanedText);
  const isMedical = MEDICAL_RE.test(cleanedText);
  const isResearch = RESEARCH_RE.test(cleanedText);
  const isProject = PROJECT_RE.test(cleanedText);
  const isExternalClaim = EXTERNAL_CLAIM_RE.test(cleanedText);
  const isInferred = INFERRED_RE.test(cleanedText);
  const isConflicting = CONFLICT_RE.test(cleanedText);
  const isChannelScoped = CHANNEL_RE.test(cleanedText) || Boolean(input.channelId);
  const hasSource = sourcePaths.length > 0 || sourceUrls.length > 0;
  const hasAttachment = (input.attachedFiles?.length ?? 0) > 0;
  const isQuestion = QUESTION_RE.test(cleanedText);
  const isEmotional = EMOTIONAL_RE.test(cleanedText);
  const isAspiration = ASPIRATION_RE.test(cleanedText);
  const isProspective = PROSPECTIVE_RE.test(cleanedText);

  let classification: MemoryClassification = 'background';
  if (explicit) classification = 'explicit';
  else if (isDecision || isPreference || isMedical || isTask || (isProject && !isQuestion)) classification = 'notable';
  // MEMS: emotional content and aspirations carry strong encoding signals
  else if (isEmotional || isAspiration) classification = 'notable';

  let memoryType: MemoryType = 'fact';
  if (isPreference || isAspiration) memoryType = 'preference';
  else if (isDecision) memoryType = 'decision';
  else if (isTask || isProspective) memoryType = 'todo';
  else if (isMedical) memoryType = 'medical';
  else if (isResearch || hasSource) memoryType = 'research';
  else if (isProject) memoryType = 'project_context';
  else if (classification === 'background') memoryType = 'none';

  let evidenceState: EvidenceState = 'first_party';
  if (hasSource) evidenceState = 'source_backed';
  else if (isConflicting) evidenceState = 'conflicting';
  else if (isExternalClaim) evidenceState = 'needs_verification';
  else if (isInferred) evidenceState = 'inferred';

  let confidence: ConfidenceLabel = 'medium';
  if (evidenceState === 'source_backed' || (classification === 'explicit' && evidenceState === 'first_party')) confidence = 'high';
  if (evidenceState === 'first_party' && (memoryType === 'decision' || memoryType === 'medical')) confidence = 'high';
  if (evidenceState === 'needs_verification' || evidenceState === 'conflicting') confidence = 'low';
  if (classification === 'background') confidence = 'low';

  let privacy: PrivacyLabel = 'normal';
  if (isMedical) privacy = 'sensitive';
  else if (PERSONAL_RE.test(cleanedText) || isPreference || isEmotional || isAspiration) privacy = 'personal';

  let shouldSave = classification === 'explicit' || classification === 'notable';
  if (classification === 'background' && (hasSource || hasAttachment)) shouldSave = true;
  if (isQuestion && !explicit && !isDecision && !isTask && !isProspective) shouldSave = false;
  if (evidenceState === 'needs_verification' && !explicit && !hasSource) shouldSave = false;

  let destination: MemoryDestination = 'skip';
  if (shouldSave) {
    if (isTask || isProspective) destination = 'task';
    else if (isChannelScoped && (isDecision || explicit)) destination = 'channel_memory';
    else if (hasSource || hasAttachment || (explicit && /\blibrary\b/i.test(cleanedText))) destination = 'library';
    else if (evidenceState === 'needs_verification' || evidenceState === 'conflicting') destination = 'inbox_only';
    else destination = 'agent_memory';
  }

  if (destination === 'channel_memory' && !input.channelId) {
    warnings.add('Channel-scoped memory was detected without a concrete channel id.');
  }
  if (evidenceState === 'needs_verification') {
    warnings.add('Unsourced external claim must not be promoted as verified knowledge.');
  }
  if (privacy === 'sensitive') {
    warnings.add('Sensitive memory requires narrow provenance and careful surfacing.');
  }

  [memoryType, evidenceState, confidence, privacy, destination].forEach(tag => {
    if (tag !== 'none' && tag !== 'skip') tags.add(tag);
  });
  if (isEmotional) tags.add('emotional-signal');
  if (isAspiration) tags.add('aspiration');
  if (isProspective) tags.add('prospective-memory');
  if (input.agentId) tags.add(`agent:${input.agentId}`);
  if (input.channelId) tags.add(`channel:${input.channelId}`);
  if (/star wars|ccg|force generation/i.test(cleanedText)) tags.add('star-wars-ccg');

  const reason = shouldSave
    ? `Classified as ${classification} ${memoryType} memory with ${evidenceState} evidence.`
    : evidenceState === 'needs_verification'
      ? 'External claim lacks provenance, so it should be verified before saving.'
      : 'No durable memory save is recommended.';

  return validateMemoryGatekeeperDecision({
    shouldSave,
    classification,
    destination,
    memoryType,
    evidenceState,
    confidence,
    privacy,
    reason,
    tags: Array.from(tags),
    toolRoutes: routeToolCandidates(input, text, explicit),
    warnings: Array.from(warnings),
    provenance: {
      source: provenanceSource(sourcePaths, sourceUrls),
      sourcePaths,
      sourceUrls,
    },
  }, input);
}

export function selectPrimaryToolRoute(decision: MemoryGatekeeperDecision): ToolRoute | null {
  return decision.toolRoutes.find(route => route !== 'none') ?? null;
}

export function extractMemoryCandidateText(text: string): string {
  let cleaned = stripSystemPrefixes(text);
  cleaned = cleaned
    .replace(/^(please\s+)?(remember|save this to library|save to library|add this to library|add to library|save|note|take a note|add to memory|log this|pin this)\s*/i, '')
    .replace(/^(this|that)\s*[:\-]?\s*/i, '')
    .trim();
  if (/^(this|that|save this|remember this|note this)$/i.test(cleaned)) return '';
  return cleaned;
}

export function shouldPersistGatekeeperDecision(decision: MemoryGatekeeperDecision, originalText: string): boolean {
  if (!decision.shouldSave || decision.classification !== 'explicit') return false;
  if (!['agent_memory', 'channel_memory', 'library'].includes(decision.destination)) return false;
  return extractMemoryCandidateText(originalText).length >= 12;
}

function sanitizeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'default';
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function titleFromText(text: string): string {
  const candidate = extractMemoryCandidateText(text) || stripSystemPrefixes(text);
  return candidate.replace(/\s+/g, ' ').split(/[.!?\n]/)[0].trim().slice(0, 80) || 'Saved Memory';
}

export function buildGatekeeperMemoryWrite(input: {
  rootPath: string;
  agentId: string;
  chatId?: string | null;
  channelId?: string | null;
  text: string;
  decision: MemoryGatekeeperDecision;
  now?: Date;
}): { path: string; title: string; content: string } {
  const now = input.now ?? new Date();
  const title = titleFromText(input.text);
  const slug = `${sanitizeSegment(title)}-${now.getTime()}`;
  const agentId = sanitizeSegment(input.agentId || 'default');
  const chatId = input.chatId ? sanitizeSegment(input.chatId) : '';
  const channelId = input.channelId ? sanitizeSegment(input.channelId) : chatId;
  const basePath = input.decision.destination === 'library'
    ? `${input.rootPath}/library`
    : input.decision.destination === 'channel_memory'
      ? `${input.rootPath}/memory/${agentId}/channels/${channelId || 'default'}`
      : `${input.rootPath}/memory/${agentId}/gatekeeper`;
  const path = `${basePath}/${slug}.md`;
  const candidate = extractMemoryCandidateText(input.text);
  const frontmatter = [
    '---',
    `title: ${yamlString(title)}`,
    `created_at: ${yamlString(now.toISOString())}`,
    `destination: ${input.decision.destination}`,
    `memory_type: ${input.decision.memoryType}`,
    `evidence_state: ${input.decision.evidenceState}`,
    `confidence: ${input.decision.confidence}`,
    `privacy: ${input.decision.privacy}`,
    `agent_id: ${yamlString(agentId)}`,
    input.chatId ? `chat_id: ${yamlString(input.chatId)}` : null,
    input.channelId ? `channel_id: ${yamlString(input.channelId)}` : null,
    `tags: [${input.decision.tags.map(yamlString).join(', ')}]`,
    `source_paths: [${input.decision.provenance.sourcePaths.map(yamlString).join(', ')}]`,
    `source_urls: [${input.decision.provenance.sourceUrls.map(yamlString).join(', ')}]`,
    '---',
  ].filter(Boolean).join('\n');

  const body = [
    frontmatter,
    '',
    `# ${title}`,
    '',
    `Gatekeeper reason: ${input.decision.reason}`,
    '',
    '## Memory',
    candidate,
  ].join('\n');

  return { path, title, content: body };
}
