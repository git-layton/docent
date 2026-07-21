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
import { useSpaceStore } from '../store/useSpaceStore';

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
  seen?: number;      // times this task-pattern recurred and completed on its own (organic-learning counter)
  proposed?: boolean; // the dream cycle has already offered this candidate for the user to trust (no re-nag)
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
  seen?: number;
  proposed?: boolean;
  now?: Date;
}): { path: string; trigger: string; content: string } => {
  const now = input.now ?? new Date();
  const title = sanitizeInline(input.title).slice(0, 80) || 'Untitled playbook';
  const trigger = playbookTriggerSlug(input.intent || input.title);
  const spaceId = useSpaceStore.getState().activeSpaceId || 'space-home';
  const path = `${input.rootPath}/memory/spaces/${spaceId}/playbooks/${trigger}.md`;

  const verified = input.verified === true;
  const accept = Number.isFinite(input.accept) ? Math.max(0, Math.floor(Number(input.accept))) : 0;
  const seen = Number.isFinite(input.seen) ? Math.max(0, Math.floor(Number(input.seen))) : 0;
  const proposed = input.proposed === true;
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
    `seen: ${seen}`,
    `proposed: ${proposed}`,
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
  const seen = parseInt(field('seen') || '0', 10) || 0;
  const proposed = /^proposed:\s*true\s*$/m.test(head);
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
  return { title: title || trigger, trigger, steps, verified, accept, seen, proposed };
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
      query: q, agentId: agentId ?? null,
      spaceId: useSpaceStore.getState().activeSpaceId || null,
      maxResults: 6, snippetChars: 60,
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

/** List every playbook for an agent (verified or not) for the management UI. [] outside Tauri/on error. */
export const listPlaybooks = async (agentId: string | null | undefined): Promise<Array<Playbook & { path: string }>> => {
  const aid = String(agentId ?? '').trim();
  if (!aid || !isTauri()) return [];
  try {
    const spaceId = useSpaceStore.getState().activeSpaceId || null;
    const listed = await invoke<{ files: Array<{ path: string; name: string }> }>('list_agent_memory_files', { agentId: aid, spaceId: spaceId || undefined }).catch(() => ({ files: [] }));
    const out: Array<Playbook & { path: string }> = [];
    for (const f of listed?.files ?? []) {
      if (!f?.path || !f.path.includes('/playbooks/')) continue;
      const read = await invoke<{ ok: boolean; content: string }>('read_knowledge_file', { path: f.path }).catch(() => ({ ok: false, content: '' }));
      if (!read?.ok) continue;
      const pb = parsePlaybook(read.content);
      if (pb) out.push({ ...pb, path: f.path });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  } catch {
    return [];
  }
};

/**
 * Update a stored playbook in place (read → parse → rebuild → write to the same trigger-keyed path).
 * Used to verify/un-verify (the trust gate) and to bump the accept counter on an approved run.
 */
export const reinforcePlaybook = async (
  rootPath: string,
  agentId: string,
  trigger: string,
  opts: { verify?: boolean; bumpAccept?: boolean } = {},
): Promise<boolean> => {
  if (!rootPath || !isTauri()) return false;
  const slug = playbookTriggerSlug(trigger);
  const spaceId = useSpaceStore.getState().activeSpaceId || 'space-home';
  const path = `${rootPath}/memory/spaces/${spaceId}/playbooks/${slug}.md`;

  try {
    const read = await invoke<{ ok: boolean; content: string }>('read_knowledge_file', { path }).catch(() => ({ ok: false, content: '' }));
    if (!read?.ok) return false;
    const pb = parsePlaybook(read.content);
    if (!pb) return false;
    const rebuilt = buildPlaybookRecord({
      rootPath, agentId, title: pb.title, intent: pb.trigger, steps: pb.steps,
      verified: opts.verify !== undefined ? opts.verify : pb.verified,
      accept: pb.accept + (opts.bumpAccept ? 1 : 0),
    });
    const result = await invoke<{ blocked?: boolean }>('write_memory', {
      path: rebuilt.path, content: rebuilt.content, commitMessage: `playbook: reinforce ${slug}`,
      agentId, contextTokens: null, ramState: null,
    });
    return !result?.blocked;
  } catch {
    return false;
  }
};

/**
 * Read + parse a single playbook by its trigger (the store is trigger-keyed, one file per procedure).
 * Returns null when it doesn't exist yet or outside Tauri. Used by organic capture to fold a fresh
 * observation into the existing record without listing every playbook on the turn's hot path.
 */
export const readPlaybookByTrigger = async (rootPath: string, trigger: string): Promise<Playbook | null> => {
  if (!rootPath || !isTauri()) return null;
  const slug = playbookTriggerSlug(trigger);
  const spaceId = useSpaceStore.getState().activeSpaceId || 'space-home';
  const path = `${rootPath}/memory/spaces/${spaceId}/playbooks/${slug}.md`;
  try {
    const read = await invoke<{ ok: boolean; content: string }>('read_knowledge_file', { path }).catch(() => ({ ok: false, content: '' }));
    if (!read?.ok) return null;
    return parsePlaybook(read.content);
  } catch {
    return null;
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
    .map((p) => `• ${p.title} (trigger: ${p.trigger})\n${p.steps.map((s, i) => `   ${i + 1}. ${s.intent}`).join('\n')}`)
    .join('\n');
  return (
    `[KNOWN PROCEDURES — offer, don't auto-run]\n` +
    `You've saved these step-by-step procedures with the user for tasks like this one. If one is clearly ` +
    `relevant, OFFER to do it; when the user agrees, FIRST emit \`\`\`forge:action {"tool":"playbook","op":"execute","trigger":"<the trigger>","title":"<the title>"}\`\`\` once to log the run, THEN carry out the steps yourself using your normal tools, ONE action at a time — each is confirmed as usual, so never bundle steps or skip a confirmation. Adapt ` +
    `the steps to the current context. Don't mention this block.\n${body}\n\n`
  );
};
