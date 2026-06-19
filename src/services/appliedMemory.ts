// ─── Applied Memory ───────────────────────────────────────────────────────────
// Typed, TRIGGER-KEYED memory records that are retrieved and APPLIED at the right moment — the shared
// substrate behind procedural playbooks (a task-intent → a procedure). Per-relationship voice is the
// other instance of the same idea, but lives in the synchronous appSettings.voiceProfile.byRecipient
// map for zero draft-time latency (see services/voice.ts); a voice_card type is reserved here for the
// day the dream cycle should refine voices on disk.
//
// PURE helpers (buildPlaybookRecord / parsePlaybook / playbookTriggerSlug / formatProceduresBlock)
// import nothing — unit-testable, no cycles. retrievePlaybooks is the one impure helper (Tauri invoke);
// it must NOT import llm.ts (mirrors memoryContext.ts) to avoid the voiceRuntime→llm cycle class.

import { invoke } from '@tauri-apps/api/core';

const isTauri = () => !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

export interface PlaybookStep {
  intent: string;     // one-line natural-language step ("pull the latest metrics")
  toolHint?: string;  // OPTIONAL soft hint ("web_search") — a label for retrieval/UI, NOT a bound action
}

export interface Playbook {
  title: string;
  trigger: string;    // slug the playbook is retrieved by (the task intent)
  steps: PlaybookStep[];
  verified: boolean;  // true only after the user approves its first run — gates whether it's suggestable
  accept: number;     // how many times the user has approved running it
}

const sanitizeInline = (s: string): string =>
  String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

const escQuote = (s: string): string => s.replace(/"/g, '\\"');

/** Slugify a task intent into the stable key a playbook is stored and retrieved under. */
export const playbookTriggerSlug = (intent: string): string =>
  sanitizeInline(intent).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'playbook';

/**
 * Build a playbook record (PURE). The filename IS the trigger slug, so re-capturing the same task
 * updates that playbook in place instead of spawning duplicates. Steps are natural-language intent +
 * an optional soft tool hint — never a bound, ready-to-fire action, so each run is re-derived and
 * re-gated. Title is YAML-sanitized (newlines stripped, quotes escaped) against frontmatter injection.
 */
export const buildPlaybookRecord = (input: {
  rootPath: string;
  agentId: string;
  title: string;
  intent: string;
  steps: PlaybookStep[];
  verified?: boolean;
  accept?: number;
  now?: Date;
}): { path: string; trigger: string; content: string } => {
  const now = input.now ?? new Date();
  const title = sanitizeInline(input.title).slice(0, 80) || 'Untitled playbook';
  const trigger = playbookTriggerSlug(input.intent || input.title);
  const agentId = String(input.agentId || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'default';
  const path = `${input.rootPath}/memory/${agentId}/playbooks/${trigger}.md`;
  const verified = input.verified === true;
  const accept = Number.isFinite(input.accept) ? Math.max(0, Math.floor(Number(input.accept))) : 0;
  const steps = (input.steps ?? []).filter((s) => s && sanitizeInline(s.intent));
  const tools = Array.from(new Set(steps.map((s) => sanitizeInline(s.toolHint || '')).filter(Boolean)));
  const tags = ['playbook', `trigger:${trigger}`, ...tools.map((t) => `tool:${t}`)];
  const stepsMd = steps
    .map((s, i) => `${i + 1}. ${sanitizeInline(s.intent)}${s.toolHint ? ` _(hint: ${sanitizeInline(s.toolHint)})_` : ''}`)
    .join('\n');
  const content = [
    '---',
    `title: "${escQuote(title)}"`,
    `created_at: "${now.toISOString()}"`,
    'memory_type: playbook',
    `trigger: "${escQuote(trigger)}"`,
    `verified: ${verified}`,
    `accept: ${accept}`,
    `tags: [${tags.map((t) => `"${escQuote(t)}"`).join(', ')}]`,
    '---',
    '',
    `# ${title}`,
    '',
    '## Procedure',
    stepsMd,
    '',
  ].join('\n');
  return { path, trigger, content };
};

/** Parse a playbook record back into structure (for suggestion/UI). Tolerant of partial files. */
export const parsePlaybook = (content: string): Playbook | null => {
  const text = String(content ?? '');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const head = fm ? fm[1] : '';
  const field = (k: string): string => {
    const m = head.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"(.*)"$/, '$1') : '';
  };
  const title = field('title');
  const trigger = field('trigger');
  if (!title && !trigger) return null;
  const verified = /^verified:\s*true\s*$/m.test(head);
  const accept = parseInt(field('accept') || '0', 10) || 0;
  const steps: PlaybookStep[] = [];
  const procIdx = text.indexOf('## Procedure');
  if (procIdx >= 0) {
    for (const line of text.slice(procIdx).split('\n')) {
      const m = line.match(/^\s*\d+\.\s+(.*)$/);
      if (!m) continue;
      let intent = m[1];
      let toolHint: string | undefined;
      const hint = intent.match(/_\(hint:\s*(.*?)\)_\s*$/);
      if (hint && hint.index !== undefined) {
        toolHint = hint[1].trim();
        intent = intent.slice(0, hint.index).trim();
      }
      if (intent) steps.push({ intent, toolHint });
    }
  }
  return { title: title || trigger, trigger, steps, verified, accept };
};

/**
 * Retrieve VERIFIED playbooks whose stored procedure is relevant to the current task intent. Reads the
 * matched records and keeps only verified ones (the suggest-gate). Returns [] outside Tauri / on error.
 */
export const retrievePlaybooks = async (
  intent: string,
  agentId: string | null | undefined,
  max = 2,
): Promise<Playbook[]> => {
  const q = (intent || '').trim();
  if (q.length < 4 || !isTauri()) return [];
  try {
    const res = await invoke<{ results: Array<{ path: string; score: number }> }>('search_knowledge_semantic', {
      query: q, agentId: agentId ?? null, maxResults: 6, snippetChars: 60,
    });
    const out: Playbook[] = [];
    for (const hit of res?.results ?? []) {
      if (out.length >= max) break;
      if (!hit?.path || !hit.path.includes('/playbooks/')) continue;
      const read = await invoke<{ ok: boolean; content: string }>('read_knowledge_file', { path: hit.path }).catch(() => ({ ok: false, content: '' }));
      if (!read?.ok) continue;
      const pb = parsePlaybook(read.content);
      if (pb && pb.verified && pb.steps.length) out.push(pb);
    }
    return out;
  } catch {
    return [];
  }
};

/**
 * PURE — format verified playbooks into a system-prompt block. The agent OFFERS to run one and then
 * carries it out via its NORMAL tool actions, one at a time (each individually approved) — there is no
 * auto-run and no special executor. Returns '' when there are none.
 */
export const formatProceduresBlock = (playbooks: Playbook[]): string => {
  const pbs = (playbooks ?? []).filter((p) => p && p.steps?.length);
  if (!pbs.length) return '';
  const body = pbs
    .map((p) => `• ${p.title}\n${p.steps.map((s, i) => `   ${i + 1}. ${s.intent}`).join('\n')}`)
    .join('\n');
  return (
    `[KNOWN PROCEDURES — offer, don't auto-run]\n` +
    `You've saved these step-by-step procedures with the user for tasks like this one. If one is clearly ` +
    `relevant, OFFER to do it; when the user agrees, carry out the steps yourself using your normal tools, ` +
    `ONE action at a time — each is confirmed as usual, so never bundle steps or skip a confirmation. Adapt ` +
    `the steps to the current context. Don't mention this block.\n${body}\n\n`
  );
};
