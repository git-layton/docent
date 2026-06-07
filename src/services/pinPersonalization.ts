// ─── Pin Personalization ──────────────────────────────────────────────────────
// Builds a user memory fingerprint from their pin history and exposes utilities
// for scoring, deduplication, and LLM prompt injection.
//
// MEMS protection contract: MEMS_PROTECTED categories (self-referential, relational,
// temporal, medical) are never penalised by pin history — they get a gap boost
// instead. Pin history only calibrates the discretionary middle range.

export interface GlobalPin {
  id: string;
  chatId: string;
  msgId: string;
  agentId: string;
  content: string;
  savedAt: number;
}

// Content category detection — ordered so first match wins
const CATEGORY_RE: [string, RegExp][] = [
  ['code',         /```|function\b|\bconst\s+\w+\s*=|\bimport\s+|\bclass\s+\w|\basync\s+function|\.(tsx?|py|rs|go|sh)\b|npm\s+\w|git\s+\w/i],
  ['recipe',       /\b(ingredient|tablespoon|teaspoon|cup of|tbsp|tsp|recipe|preheat|oven|bake|simmer|chop|boil|stir fry)\b/i],
  ['medical',      /\b(doctor|medication|diagnosis|symptom|allerg|prescription|dosage|\bmg\b|blood pressure|health condition|lab result)\b/i],
  ['event',        /\b(birthday|anniversary|appointment|deadline|remind me on|\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i],
  ['relationship', /\bmy\s+(wife|husband|partner|mom|dad|mother|father|sister|brother|friend|colleague|boss|client|son|daughter|child|kids?|family|team)\b/i],
  ['preference',   /\b(i (prefer|like|love|hate|enjoy|adore|can'?t stand)|(my|our) (favorite|preferred)|i'?d (rather|love to)|don'?t like|always use|never use)\b/i],
  ['decision',     /\b(decided|agreed|chosen|going with|settled on|final decision|we('ll| will) (use|go with)|approved|signed off)\b/i],
  ['research',     /\b(study|paper|research|according to|citation|evidence|article|published|found that|data shows)\b/i],
  ['project',      /\b(project|feature|bug|deploy|release|architecture|roadmap|sprint|ticket|pull request|PR\b)\b/i],
];

// These categories carry high MEMS salience (self-reference, relational, temporal, medical).
// Pin history must NEVER penalise them — gaps get a protective boost instead.
export const MEMS_PROTECTED: string[] = ['preference', 'relationship', 'event', 'medical'];

// Recency half-life: 30 days — pin from a month ago weighs ~37% of today's pin
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

function decayWeight(savedAt: number, now: number): number {
  const ageMs = Math.max(0, now - savedAt);
  return Math.exp(-(Math.LN2 * ageMs) / HALF_LIFE_MS);
}

function detectCategory(content: string): string {
  for (const [cat, re] of CATEGORY_RE) {
    if (re.test(content)) return cat;
  }
  return 'fact';
}

const STOPWORDS = new Set([
  'the','and','for','that','this','with','have','from','they','will','been',
  'what','when','your','about','there','their','would','could','should','which',
  'after','before','then','than','just','some','more','into','over','also',
  'very','only','here','were','where','dont','does','like','make','want',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, '') // strip code blocks
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export interface PinProfile {
  categoryWeights: Record<string, number>; // recency-weighted sum per category
  topKeywords: string[];                   // top keywords from recent pin content
  gapCategories: string[];                 // MEMS_PROTECTED categories the user barely pins
  recentPinCount: number;                  // pins in last 30 days
  totalPins: number;
  isCalibrated: boolean;                   // false when < 5 pins — skip personalization
}

export const EMPTY_PROFILE: PinProfile = {
  categoryWeights: {},
  topKeywords: [],
  gapCategories: MEMS_PROTECTED,
  recentPinCount: 0,
  totalPins: 0,
  isCalibrated: false,
};

export function computePinProfile(pins: GlobalPin[]): PinProfile {
  if (pins.length === 0) return EMPTY_PROFILE;

  const now = Date.now();
  const recentCutoff = now - 30 * 24 * 60 * 60 * 1000;
  const categoryWeights: Record<string, number> = {};
  const keywordFreq: Record<string, number> = {};
  let recentPinCount = 0;

  for (const pin of pins) {
    const w = decayWeight(pin.savedAt, now);
    const cat = detectCategory(pin.content);
    categoryWeights[cat] = (categoryWeights[cat] ?? 0) + w;

    if (pin.savedAt > recentCutoff) {
      recentPinCount++;
      for (const kw of extractKeywords(pin.content).slice(0, 20)) {
        keywordFreq[kw] = (keywordFreq[kw] ?? 0) + 1;
      }
    }
  }

  const topKeywords = Object.entries(keywordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([kw]) => kw);

  // A gap is a MEMS_PROTECTED category where the user's weighted total is < 0.3
  // (roughly: fewer than 1 strong recent pin in that category)
  const gapCategories = MEMS_PROTECTED.filter(cat => (categoryWeights[cat] ?? 0) < 0.3);

  return {
    categoryWeights,
    topKeywords,
    gapCategories,
    recentPinCount,
    totalPins: pins.length,
    isCalibrated: pins.length >= 5,
  };
}

// ─── LLM prompt injection ─────────────────────────────────────────────────────

export function formatPinProfileForPrompt(profile: PinProfile): string {
  if (!profile.isCalibrated) return '';

  const heavy = Object.entries(profile.categoryWeights)
    .filter(([, w]) => w > 0.8)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([cat]) => cat);

  const lines: string[] = ['\n[USER MEMORY FINGERPRINT]'];
  lines.push(`Total pins: ${profile.totalPins} (${profile.recentPinCount} in last 30 days)`);
  if (heavy.length > 0) lines.push(`Actively saves: ${heavy.join(', ')} → lean SAVE for similar content`);
  if (profile.gapCategories.length > 0) {
    lines.push(`Rarely pins: ${profile.gapCategories.join(', ')} → MEMS protection applies — save anyway if salient`);
  }
  if (profile.topKeywords.length > 0) {
    lines.push(`Recent pin topics: ${profile.topKeywords.slice(0, 6).join(', ')}`);
  }
  lines.push(`Dedup rule: if content near-duplicates a recent pin (>55% keyword overlap) → lean SKIP.`);
  return lines.join('\n');
}

// ─── Score boost for memoryPolicy ────────────────────────────────────────────

export function computePinBoost(
  content: string,
  profile: PinProfile,
): { boost: number; reason: string } {
  if (!profile.isCalibrated) return { boost: 0, reason: '' };

  const cat = detectCategory(content);
  const weight = profile.categoryWeights[cat] ?? 0;

  // MEMS-protected: gap → protective boost; present → neutral (MEMS handles it)
  if (MEMS_PROTECTED.includes(cat)) {
    if (profile.gapCategories.includes(cat)) {
      return { boost: +1, reason: `pin-gap protection (${cat} underrepresented)` };
    }
    return { boost: 0, reason: '' };
  }

  // Non-protected: calibrate by pin weight
  if (weight > 2.0) return { boost: +2, reason: `heavy pin pattern (${cat})` };
  if (weight > 0.8) return { boost: +1, reason: `moderate pin pattern (${cat})` };
  if (weight < 0.1) return { boost: -1, reason: `low pin interest (${cat})` };
  return { boost: 0, reason: '' };
}

// ─── Duplicate detection (Jaccard similarity) ────────────────────────────────

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function isDuplicateOfRecentPins(
  content: string,
  pins: GlobalPin[],
  windowDays = 14,
  threshold = 0.55,
): boolean {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const recentPins = pins.filter(p => p.savedAt > cutoff);
  if (recentPins.length === 0) return false;

  const contentWords = extractKeywords(content);
  if (contentWords.length < 3) return false;

  return recentPins.some(pin => {
    const pinWords = extractKeywords(pin.content);
    return jaccardSimilarity(contentWords, pinWords) >= threshold;
  });
}
