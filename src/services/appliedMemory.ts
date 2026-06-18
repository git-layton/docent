// ─── Applied Memory ───────────────────────────────────────────────────────────
// Typed, TRIGGER-KEYED memory records that are retrieved and APPLIED at the right moment — the shared
// substrate behind procedural playbooks (a task-intent → a procedure). Per-relationship voice is the
// other instance of the same idea, but lives in the synchronous appSettings.voiceProfile.byRecipient
// map for zero draft-time latency (see services/voice.ts); a voice_card type is reserved here for the
// day the dream cycle should refine voices on disk.
//
// PURE helpers only (no llm.ts, no Tauri invoke) — mirrors the voice.ts / voiceRuntime.ts split so
// this stays unit-testable and free of import cycles. The invoke-based retrieve/reinforce + the
// App.tsx capture/execute wiring land with the integration step (see docs/applied-memory.md).

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
