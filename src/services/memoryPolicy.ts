export type MemoryLevel = 'skip' | 'background' | 'notable' | 'explicit';
export type MemoryNotification = 'none' | 'toast';

export interface ConversationMemoryAssessment {
  shouldSave: boolean;
  level: MemoryLevel;
  notification: MemoryNotification;
  reason: string;
  tags: string[];
  score: number;
}

export interface AssessConversationMemoryInput {
  question: string;
  answer: string;
  chatKind?: string;
  contributions?: string[];
  attachments?: any[];
  pinBoost?: number;   // pre-computed boost from computePinBoost() in pinPersonalization
  pinReason?: string;  // human-readable reason for the boost (appended to assessment reason)
}

const memoryLevels = new Set<MemoryLevel>(['skip', 'background', 'notable', 'explicit']);
const notifications = new Set<MemoryNotification>(['none', 'toast']);

const wordCount = (text: string) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

const hasAny = (text: string, patterns: RegExp[]) => patterns.some(pattern => pattern.test(text));

const explicitMemoryPatterns = [
  /\b(remember|save this|save that|keep this|note this|add this|add to memory|update memory|don't forget|for future reference)\b/i,
  /\b(always|never)\s+(?:remember|do|use|say|assume|ask|treat)\b/i,
];

const durableUserPatterns = [
  /\b(i prefer|i like|i hate|i need|i want|my goal|my plan|my preference|my workflow|my setup)\b/i,
  /\b(decided|decision|requirement|constraint|assumption|architecture|roadmap|next phase|release|ship|launch)\b/i,
  /\b(project|repo|repository|feature|bug|fix|test|build|deploy|commit|api key|integration|model|agent|channel)\b/i,
  /\b(medical|doctor|medication|allergy|school|family|travel|tax|receipt|document|invoice)\b/i,
];

const durableAnswerPatterns = [
  /\b(implemented|fixed|changed|added|removed|verified|committed|pushed|built|tested|released)\b/i,
  /\b(plan|roadmap|architecture|decision|recommendation|tradeoff|requirements|next steps)\b/i,
  /```/,
];

const trivialPatterns = [
  /^(ok|okay|k|yes|no|yep|nope|thanks|thank you|thx|cool|nice|great|got it|sounds good|lol|haha|ha|continue|go on)[.!?]*$/i,
  /^(what\?|why\?|huh\?|wait\??)$/i,
];

const sillyPatterns = [
  /\b(lol|haha|joke|silly|random thought|goofy|messing around)\b/i,
];

// ─── MEMS — Memory Encoding Multi-Salience ────────────────────────────────────
// Six cognitive psychology principles that predict what humans retain long-term.
// Sources: Rogers 1977 (self-reference), Brandimonte 1996 (prospective memory),
// McGaugh 2003 (emotional enhancement), Zeigarnik 1927 (completion drive).

// MEMS: Emotional Enhancement (McGaugh 2003) — affective language signals durability
const emotionalPatterns = [
  /\b(i('m| am) (so |really )?(worried|scared|excited|frustrated|angry|upset|thrilled|devastated|anxious|nervous|stressed|overwhelmed|terrified))\b/i,
  /\b(can'?t believe (this|it|what)|oh no|this is (terrible|amazing|awful|incredible|horrible)|i feel (like|that|so))\b/i,
];

// MEMS: Self-Reference Effect (Rogers 1977) — self-concept statements encode deeply
const selfConceptPatterns = [
  /\b(i'?m (someone who|the kind of person|a person who)|i always (do|say|think|feel|try)|i never (do|say|want|like))\b/i,
  /\b(i'?ve always been|that'?s (just |so )?me|part of who i am|just how i (am|work))\b/i,
];

// MEMS: Prospective Memory (Brandimonte 1996) — future intentions must be preserved
const prospectivePatterns = [
  /\b(remind me (to|about|that)|don'?t (let me )?forget (to|about|that)|i need to remember (to|that)|note to (self|me):?)\b/i,
  /\b(i'?m going to (make sure|remember|try to)|must (remember|not forget) (to|that)|need to follow up on)\b/i,
];

// MEMS: Zeigarnik Effect (1927) — incomplete tasks create cognitive tension that demands resolution
const zeigarnikPatterns = [
  /\b(still (haven'?t|need to|working on|trying to)|not (yet |done |finished |resolved )|pending|unresolved|in progress)\b/i,
  /\b(haven'?t (finished|completed|figured out|resolved)|need to (follow up|circle back|revisit|check on)|left (off|hanging))\b/i,
];

export const validateConversationMemoryAssessment = (assessment: ConversationMemoryAssessment) => {
  const errors: string[] = [];

  if (!memoryLevels.has(assessment.level)) errors.push(`Unknown memory level: ${assessment.level}`);
  if (!notifications.has(assessment.notification)) errors.push(`Unknown memory notification: ${assessment.notification}`);
  if (!Number.isFinite(assessment.score)) errors.push('Score must be finite.');
  if (!assessment.reason.trim()) errors.push('Reason is required.');
  if (!assessment.tags.length) errors.push('At least one tag is required.');
  if (new Set(assessment.tags).size !== assessment.tags.length) errors.push('Tags must be unique.');
  if (assessment.tags.some(tag => !tag || /\s/.test(tag))) errors.push('Tags must be non-empty slug tokens.');

  if (!assessment.shouldSave) {
    if (assessment.level !== 'skip') errors.push('Skipped memories must use level "skip".');
    if (assessment.notification !== 'none') errors.push('Skipped memories must not notify.');
    if (assessment.tags.some(tag => tag.startsWith('memory-'))) errors.push('Skipped memories must not include persisted memory level tags.');
  } else {
    if (assessment.level === 'skip') errors.push('Saved memories cannot use level "skip".');
    if (!assessment.tags.includes(`memory-${assessment.level}`)) errors.push(`Saved memories must include memory-${assessment.level}.`);
    if (assessment.level === 'background' && assessment.notification !== 'none') errors.push('Background saves must be silent.');
    if ((assessment.level === 'explicit' || assessment.level === 'notable') && assessment.notification !== 'toast') {
      errors.push('Explicit and notable saves must use a toast notification.');
    }
  }

  if (assessment.level === 'explicit' && !assessment.tags.includes('explicit-memory')) {
    errors.push('Explicit memories must include explicit-memory tag.');
  }

  return errors;
};

const finalizeAssessment = (assessment: ConversationMemoryAssessment): ConversationMemoryAssessment => {
  const errors = validateConversationMemoryAssessment(assessment);
  if (errors.length > 0) {
    throw new Error(`Invalid memory policy assessment: ${errors.join(' ')}`);
  }
  return assessment;
};

export const assessConversationMemory = ({
  question,
  answer,
  chatKind = 'dm',
  contributions = [],
  attachments = [],
  pinBoost = 0,
  pinReason = '',
}: AssessConversationMemoryInput): ConversationMemoryAssessment => {
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  const qWords = wordCount(q);
  const aWords = wordCount(a.replace(/<think>[\s\S]*?<\/think>/gi, ''));
  const hasAttachments = attachments.length > 0;
  const hasImages = attachments.some(file => file?.isImage);
  const hasContributions = contributions.length > 0;
  const explicitMemory = hasAny(q, explicitMemoryPatterns);
  const durableUserSignal = hasAny(q, durableUserPatterns);
  const durableAnswerSignal = hasAny(a, durableAnswerPatterns);
  const trivial = hasAny(q, trivialPatterns) && aWords < 80 && !hasAttachments;
  const silly = hasAny(q, sillyPatterns) && qWords < 24 && aWords < 140 && !explicitMemory;

  let score = 0;
  const tags: string[] = ['conversation'];
  const reasons: string[] = [];

  if (explicitMemory) {
    score += 7;
    tags.push('explicit-memory');
    reasons.push('explicit memory request');
  }
  if (durableUserSignal) {
    score += 2;
    tags.push('durable-user-signal');
    reasons.push('durable user/project signal');
  }
  if (durableAnswerSignal) {
    score += 2;
    tags.push('durable-answer');
    reasons.push('durable assistant work product');
  }
  if (hasAttachments) {
    score += hasImages ? 4 : 3;
    tags.push(hasImages ? 'multimodal-input' : 'attached-context');
    reasons.push(hasImages ? 'image or screenshot context' : 'attached file context');
  }
  if (hasContributions) {
    score += 3;
    tags.push('multi-agent');
    reasons.push('multi-agent collaboration');
  }
  if (chatKind === 'channel') {
    score += 1;
    tags.push('channel-memory');
  } else {
    tags.push('agent-memory');
  }
  if (qWords >= 18) score += 1;
  if (aWords >= 180) score += 1;
  if (aWords >= 450) score += 1;
  if (trivial) score -= 5;
  if (silly) score -= 3;

  // MEMS dimensions — applied after base scoring, before threshold decision
  const emotionalSignal = hasAny(q, emotionalPatterns);
  const selfConceptSignal = hasAny(q, selfConceptPatterns);
  const prospectiveSignal = hasAny(q, prospectivePatterns);
  const zeigarnikSignal = hasAny(q, zeigarnikPatterns) || hasAny(a, zeigarnikPatterns);

  if (emotionalSignal)   { score += 2; tags.push('emotional-signal');    reasons.push('emotional enhancement (McGaugh 2003)'); }
  if (selfConceptSignal) { score += 2; tags.push('self-concept');         reasons.push('self-reference effect (Rogers 1977)'); }
  if (prospectiveSignal) { score += 2; tags.push('prospective-memory');   reasons.push('prospective memory (Brandimonte 1996)'); }
  if (zeigarnikSignal)   { score += 2; tags.push('zeigarnik');            reasons.push('Zeigarnik unfinished thread'); }

  // Pin personalization boost — calibrated against user's actual save behaviour
  if (pinBoost !== 0) {
    score += pinBoost;
    if (pinReason) reasons.push(pinReason);
    tags.push(pinBoost > 0 ? 'pin-boosted' : 'pin-deprioritised');
  }

  if (trivial || silly || score < 3) {
    return finalizeAssessment({
      shouldSave: false,
      level: 'skip',
      notification: 'none',
      reason: trivial ? 'trivial acknowledgement' : silly ? 'low-value casual exchange' : 'not enough durable signal',
      tags: Array.from(new Set(tags)),
      score,
    });
  }

  const level: MemoryLevel = explicitMemory ? 'explicit' : score >= 7 ? 'notable' : 'background';

  return finalizeAssessment({
    shouldSave: true,
    level,
    notification: level === 'background' ? 'none' : 'toast',
    reason: reasons[0] ?? 'meaningful conversation',
    tags: Array.from(new Set([...tags, `memory-${level}`])),
    score,
  });
};
