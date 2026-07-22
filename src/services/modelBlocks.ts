// ─── Model block validation ───────────────────────────────────────────────────
// The single place where fenced blocks emitted by the chat model (```task, ```event,
// ```forge:action, …) are parsed and validated before they touch app state or render a card.
//
// Calibration matters here: blocks that render an EDITABLE card (task, event, gcal_*) are
// deliberately permissive — the user reviews and can fix every field before applying, so a
// junk optional field is dropped (.catch) rather than failing the whole block. Blocks whose
// button fires a REAL side effect with the parsed values (slack_post, gmail_draft) and
// forge:action ops that can auto-apply require their load-bearing fields outright.

import { z } from 'zod';

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Optional string that tolerates null and swallows wrong-typed junk instead of failing. */
const looseStr = z.string().nullish().catch(undefined).transform(v => v ?? undefined);
/** Optional YYYY-MM-DD; anything else (junk, datetime, null) is dropped, not fatal. */
const looseDate = z.string().regex(ISO_DATE_RE).nullish().catch(undefined).transform(v => v ?? undefined);
/** Required identifier — models sometimes emit numeric ids, so coerce. */
const requiredId = z.coerce.string().min(1);

// ── Card-rendered blocks (user edits/approves before anything happens) ────────

export const TaskBlock = z.object({
  title: z.string().min(1),
  dueDate: looseDate,
  location: looseStr,
  details: looseStr,
});

export const ProfileBlock = z.object({ fact: z.string().min(1) });

export const SaveBlock = z.object({ title: looseStr, content: looseStr });

// EventCard defaults/repairs every field and the user edits before adding — any object is fine.
export const EventBlock = z.looseObject({});
export const EventUpdateBlock = z.looseObject({ id: requiredId });
export const EventDeleteBlock = z.looseObject({ id: requiredId });

// Gcal cards are editable like EventCard; updates/deletes need the event id to act on.
export const GcalEventBlock = z.looseObject({});
export const GcalUpdateBlock = z.looseObject({ eventId: requiredId });
export const GcalDeleteBlock = z.looseObject({ eventId: requiredId });

// FileActionCard / CommandActionCard route through the fileAccess approval layer, which
// re-validates paths; here we only guarantee there IS a known action to route on.
export const FileOpBlock = z.looseObject({
  action: z.enum(['write', 'read', 'list', 'delete', 'move', 'import', 'command']),
});

// ── Direct-send blocks (button fires the side effect with these exact values) ─

export const SlackPostBlock = z.object({ channel: z.string().min(1), text: z.string().min(1) });

export const GmailDraftBlock = z.object({
  to: z.string().min(1),
  cc: looseStr,
  subject: z.string().catch(''),
  body: z.string().catch(''),
});

export const GusCreateBlock = z.object({
  subject: z.string().min(1),
  type: looseStr,
  priority: looseStr,
  assignee: looseStr,
  details: looseStr,
});

// ── forge:action ──────────────────────────────────────────────────────────────
// Base: any {tool, op} object passes (unknown combos surface as a toast at execute time, and
// future ops must not break parsing). Known ops additionally validate the fields
// executeAgentAction actually depends on — an action that would apply garbage is dropped.

export const AgentActionBase = z.looseObject({ tool: z.string().min(1), op: z.string().min(1) });

const AGENT_ACTION_OP_SCHEMAS: Record<string, z.ZodType<unknown>> = {
  'task.create': z.looseObject({ title: z.string().min(1), dueDate: looseDate }),
  'task.complete': z.looseObject({ id: requiredId }),
  'task.delete': z.looseObject({ id: requiredId }),
  'note.update': z.looseObject({ id: requiredId, body: z.string().min(1) }),
  'note.delete': z.looseObject({ id: requiredId }),
  'calendar.create': z.looseObject({ title: z.string().min(1), start: z.string().min(1) }),
  'calendar.delete': z.looseObject({ id: requiredId }),
  'message.send': z.looseObject({ text: z.string().min(1) })
    .refine(a => !!(a as any).to || !!(a as any).chatGuid, { message: 'message.send needs a "to" or "chatGuid"' }),
  'mail.send': z.looseObject({ to: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]) }),
  'memory.save': z.looseObject({ content: z.string().min(1) }),
  'music.create_playlist': z.looseObject({ name: z.string().min(1) }),
  'music.add_track': z.looseObject({ trackName: z.string().min(1), playlistName: z.string().min(1) }),
  'playbook.capture': z.looseObject({
    title: z.string().min(1),
    steps: z.array(z.looseObject({ intent: z.string().min(1) })).min(1),
  }),
  'desktop.click': z.looseObject({ targetLabel: z.string().min(1) }),
  'web.search': z.looseObject({ query: z.string().min(1) }),
  // Card ops — consolidated replacements for the legacy ```event/```save/```profile blocks.
  // They render as editable/confirm cards (never auto-execute), so field tolerance mirrors the
  // cards: EventCard repairs anything; updates/deletes need the id; save needs content; profile
  // needs the fact.
  'event.create': z.looseObject({}),
  'event.update': z.looseObject({ id: requiredId }),
  'event.delete': z.looseObject({ id: requiredId }),
  'library.save': z.looseObject({ title: looseStr, content: z.string().min(1) }),
  'profile.update': z.looseObject({ fact: z.string().min(1) }),
};

/** Validate one raw forge:action entry. Returns the (loosely typed) action or null. */
export function validateAgentAction(raw: unknown): Record<string, any> | null {
  const base = AgentActionBase.safeParse(raw);
  if (!base.success) return null;
  const opSchema = AGENT_ACTION_OP_SCHEMAS[`${base.data.tool}.${base.data.op}`];
  if (!opSchema) return base.data;
  const checked = opSchema.safeParse(raw);
  if (!checked.success) {
    console.warn(`[modelBlocks] dropped invalid ${base.data.tool}.${base.data.op}:`, checked.error.issues[0]?.message);
    return null;
  }
  return { ...(checked.data as Record<string, any>), tool: base.data.tool, op: base.data.op };
}

// ── parseModelBlock ───────────────────────────────────────────────────────────

const BLOCK_SCHEMAS = {
  task: TaskBlock,
  todo: TaskBlock,
  profile: ProfileBlock,
  save: SaveBlock,
  event: EventBlock,
  event_update: EventUpdateBlock,
  event_delete: EventDeleteBlock,
  gcal_event: GcalEventBlock,
  gcal_update: GcalUpdateBlock,
  gcal_delete: GcalDeleteBlock,
  file_op: FileOpBlock,
  slack_post: SlackPostBlock,
  gmail_draft: GmailDraftBlock,
  gus_create: GusCreateBlock,
} as const;

export type BlockLang = keyof typeof BLOCK_SCHEMAS;

export type ParsedBlock<L extends BlockLang> =
  | { ok: true; data: z.infer<(typeof BLOCK_SCHEMAS)[L]> }
  | { ok: false; error: string };

export function isBlockLang(lang: string): lang is BlockLang {
  return lang in BLOCK_SCHEMAS;
}

/** Parse + validate one fenced block body. Never throws — incomplete JSON (mid-stream) and
 * schema failures both come back as { ok: false }. */
export function parseModelBlock<L extends BlockLang>(lang: L, code: string): ParsedBlock<L> {
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  const result = BLOCK_SCHEMAS[lang].safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: issue ? `${issue.path.join('.') || 'block'}: ${issue.message}` : 'invalid block' };
  }
  return { ok: true, data: result.data as z.infer<(typeof BLOCK_SCHEMAS)[L]> };
}
