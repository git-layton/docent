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

interface AssessConversationMemoryInput {
  question: string;
  answer: string;
  chatKind?: string;
  contributions?: string[];
  attachments?: any[];
}

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

export const assessConversationMemory = ({
  question,
  answer,
  chatKind = 'dm',
  contributions = [],
  attachments = [],
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
    score += 3;
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

  if (trivial || silly || score < 3) {
    return {
      shouldSave: false,
      level: 'skip',
      notification: 'none',
      reason: trivial ? 'trivial acknowledgement' : silly ? 'low-value casual exchange' : 'not enough durable signal',
      tags: Array.from(new Set(tags)),
      score,
    };
  }

  const level: MemoryLevel = explicitMemory ? 'explicit' : score >= 7 ? 'notable' : 'background';

  return {
    shouldSave: true,
    level,
    notification: level === 'background' ? 'none' : 'toast',
    reason: reasons[0] ?? 'meaningful conversation',
    tags: Array.from(new Set([...tags, `memory-${level}`])),
    score,
  };
};
