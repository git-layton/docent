// Agent → tool actions. The agent can emit fenced ```forge:action``` JSON block(s) to act on the
// user's tools through the existing connectors. Safety model (user-chosen): local writes
// (note/task/calendar create, task complete) auto-apply; sends and deletes require explicit approval.
//
// This module is pure-ish: parse/classify/describe are side-effect-free and unit-tested; execute()
// is the only part that touches connectors/commands.

import { invoke } from '@tauri-apps/api/core';
import { getCalendar, getTasks, getNotes } from './connectors';
import { useSettingsStore } from '../store/useSettingsStore';
import { validateAgentAction } from './modelBlocks';
import { useReceiptStore, type ReceiptSurface } from './receipts';

export interface AgentAction {
  tool: string; // 'note' | 'task' | 'calendar' | 'message'
  op: string;   // 'create' | 'complete' | 'send' | 'delete' | …
  [k: string]: any;
}

/** Outbound (send) and destructive (delete) actions need explicit user approval, and running a saved
 * playbook always does (it expands into multiple real actions). Additionally — trust model §3 rule 2:
 * "authority actions are never driven solely by untrusted content" — when the current turn ingested
 * untrusted-external content (a viewed web page, received mail, or messages), even the normally
 * auto-applied writes (note/task/calendar create, task complete) require approval, because
 * prompt-injection rides in on exactly that content. */
export function actionNeedsApproval(a: AgentAction, turnIngestedUntrusted = false): boolean {
  if (a.tool === 'playbook' && a.op === 'execute') return true;
  if (a.op === 'send' || a.op === 'delete') return true;
  if (turnIngestedUntrusted) return true;
  return false;
}

/** Extract ```forge:action``` JSON blocks from an agent message. Tolerant — skips malformed
 * blocks AND known ops whose load-bearing fields are missing/invalid (schema-checked in
 * modelBlocks), so an action that would apply garbage never reaches execution. */
export function parseAgentActions(text: string): AgentAction[] {
  if (!text) return [];
  const out: AgentAction[] = [];
  const seen = new Set<string>();
  // Any fenced block, not only ```forge:action. Models drift off the documented fence — the same
  // drift that produced raw tool JSON in a reply — and a legitimate, fully-valid action should still
  // run when it arrives as ```json. Widening the FENCE is safe because it widens nothing else:
  // validateAgentAction is still the only gate, so a block reaches execution only if it names a real
  // tool and op and satisfies that op's schema. Prose and ordinary code fences fail it and are
  // ignored, exactly as before.
  const re = /```[a-zA-Z:]*\s*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      for (const raw of Array.isArray(parsed) ? parsed : [parsed]) {
        const a = validateAgentAction(raw);
        if (!a) continue;
        // The same action emitted twice (once per fence style) must not run twice.
        const key = JSON.stringify(a);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(a as AgentAction);
      }
    } catch {
      /* not JSON, or malformed — ordinary code block, skip */
    }
  }
  return out;
}

/** Does this fenced body look like a tool call the model meant to make? */
function isToolCallJson(body: string): boolean {
  try {
    const parsed = JSON.parse(body.trim());
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.length > 0 && items.every(
      it => it && typeof it === 'object' && typeof (it as any).tool === 'string',
    );
  } catch {
    return false;
  }
}

/**
 * Strip action blocks so they don't render as raw code to the user.
 *
 * Strips ANY fenced JSON carrying a `tool` field, not just ```forge:action``` — because the failure
 * this exists to prevent is the model drifting off the documented fence. Observed in the wild: asked
 * to search, the model emitted ```json {"tool":"web_search","query":"…"}```. `web_search` is a
 * *capability* (routed by toolRouter), not a forge:action verb, so the model had invented a call
 * that no grammar accepts — and because the fence wasn't `forge:action`, the old regex neither
 * executed it NOR removed it. The user got a wall of raw tool JSON in the middle of a reply.
 *
 * Nothing is executed by this widening; it only decides what the user SEES. An unrunnable tool call
 * is a bug either way, and showing it to the user is strictly worse than hiding it.
 */
export function stripActionBlocks(text: string): string {
  return text
    .replace(/```forge:action\s*[\s\S]*?```/g, '')
    // Any other fenced block (```json, ``` , ```forge:action already handled) whose body is a tool call.
    .replace(/```[a-zA-Z:]*\s*\n?([\s\S]*?)```/g, (whole, body) => (isToolCallJson(body) ? '' : whole))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Card actions ─────────────────────────────────────────────────────────────
// These ops don't execute through connectors — they render as the app's existing editable/
// confirm cards. The model emits them in the ONE forge:action grammar; the app translates them
// back into the legacy fenced-block form (```event, ```save, ```profile, …) that the message
// renderer and its card components already understand. Legacy blocks emitted directly by a
// model still parse too (deprecated fallback), so nothing breaks during the transition.
const CARD_OP_TO_BLOCK: Record<string, string> = {
  'event.create': 'event',
  'event.update': 'event_update',
  'event.delete': 'event_delete',
  'library.save': 'save',
  'profile.update': 'profile',
};

/** True when this action renders as a user-confirmed card instead of executing. */
export function isCardAction(a: AgentAction): boolean {
  return `${a.tool}.${a.op}` in CARD_OP_TO_BLOCK;
}

/** Render card actions back into the legacy fenced blocks the message renderer displays. */
export function renderCardActionBlocks(actions: AgentAction[]): string {
  return actions
    .filter(isCardAction)
    .map(a => {
      const { tool: _tool, op: _op, ...fields } = a;
      return '```' + CARD_OP_TO_BLOCK[`${a.tool}.${a.op}`] + '\n' + JSON.stringify(fields) + '\n```';
    })
    .join('\n\n');
}

/** Resolve fuzzy targets to exact ones BEFORE the approval card renders, so the user approves the
 * real destination — not the model's guess, which used to be fuzzy-matched only AFTER approval.
 * Stamps the resolved identifiers onto the action (execute then uses them verbatim); an
 * unresolvable target is stamped as `unresolved` so the card can say so up front. */
export async function resolveActionTargets(a: AgentAction): Promise<AgentAction> {
  if (a.tool === 'message' && a.op === 'send' && !a.chatGuid && a.to) {
    const chats = await invoke<Array<{ guid: string; name: string }>>('imessage_list_chats', { limit: 50 }).catch(() => [] as Array<{ guid: string; name: string }>);
    const match = chats.find(c => c.name.toLowerCase().includes(String(a.to).toLowerCase()));
    return match
      ? { ...a, chatGuid: match.guid, resolvedName: match.name }
      : { ...a, unresolved: `no conversation matching “${a.to}”` };
  }
  if (a.tool === 'mail' && a.op === 'send') {
    const accounts = ((useSettingsStore.getState().integrations as any)?.mailAccounts ?? []) as Array<{ email: string; provider: string }>;
    const acct = a.account ? accounts.find(x => x.email === a.account) : accounts[0];
    return acct
      ? { ...a, account: acct.email, resolvedAccount: acct.email }
      : { ...a, unresolved: a.account ? `no connected mail account “${a.account}”` : 'no mail account is connected' };
  }
  return a;
}

/** Human-readable summary for a result/approval card. */
export function describeAction(a: AgentAction): string {
  switch (`${a.tool}.${a.op}`) {
    case 'note.create': return `Create note “${a.title ?? 'Untitled'}”`;
    case 'task.create': return `Add to-do “${a.title ?? ''}”${a.dueDate ? ` (due ${a.dueDate})` : ''}`;
    case 'task.complete': return `Mark a to-do complete`;
    case 'calendar.create': return `Add event “${a.title ?? ''}”${a.start ? ` on ${String(a.start).slice(0, 10)}` : ''}`;
    case 'message.send': return a.unresolved
      ? `Send iMessage — ${a.unresolved}`
      : `Send iMessage to ${a.resolvedName ?? a.to ?? a.chatGuid ?? 'a conversation'}: “${a.text ?? ''}”`;
    case 'mail.send': return a.unresolved
      ? `Send email — ${a.unresolved}`
      : `Send email to ${Array.isArray(a.to) ? a.to.join(', ') : (a.to ?? '?')}${a.resolvedAccount ? ` (from ${a.resolvedAccount})` : ''}: “${a.subject ?? ''}”`;
    case 'note.delete': return `Delete a note`;
    case 'task.delete': return `Delete a to-do`;
    case 'calendar.delete': return `Delete a calendar event`;
    case 'music.play': return `Play Apple Music`;
    case 'music.pause': return `Pause Apple Music`;
    case 'music.create_playlist': return `Create Apple Music playlist “${a.name ?? ''}”`;
    case 'music.add_track': return `Add “${a.trackName ?? ''}” to playlist “${a.playlistName ?? ''}”`;
    case 'playbook.capture': return `Save “${a.title ?? 'this'}” as a reusable playbook`;
    case 'playbook.execute': return `Run the “${a.title ?? a.id ?? ''}” playbook — you'll approve each step`;
    default: return `${a.tool} ${a.op}`;
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Which ledger surface an action's tool belongs to. */
const TOOL_SURFACE: Record<string, ReceiptSurface> = {
  note: 'notes', task: 'tasks', calendar: 'calendar',
  message: 'messages', mail: 'mail', music: 'music', playbook: 'playbook',
};

/** Execute one action via the connectors/commands. Returns a short result string; throws on
 * failure. Every SUCCESSFUL action lands in the receipt ledger — what happened, in the words
 * the approval card used — with a working undo where the action is genuinely reversible
 * (creates and completes). Sends and deletes are recorded but not undoable; the ledger never
 * claims reversibility it can't deliver. */
export async function executeAgentAction(a: AgentAction): Promise<string> {
  const { result, undo } = await executeInner(a);
  useReceiptStore.getState().record(
    { surface: TOOL_SURFACE[a.tool] ?? 'system', action: result, summary: describeAction(a) },
    undo,
  );
  return result;
}

async function executeInner(a: AgentAction): Promise<{ result: string; undo?: () => Promise<void> }> {
  switch (`${a.tool}.${a.op}`) {
    case 'note.create': {
      const body = `<div>${escapeHtml(String(a.body ?? '')).split('\n').join('</div><div>')}</div>`;
      const id = await getNotes().createNote(a.folder, String(a.title ?? 'Untitled'), body);
      return { result: `Created note “${a.title ?? 'Untitled'}”`, undo: () => getNotes().deleteNote(id) };
    }
    case 'task.create': {
      const id = await getTasks().createTask({ title: String(a.title ?? ''), dueDate: a.dueDate, details: a.details, location: a.location });
      return { result: `Added to-do “${a.title ?? ''}”`, undo: () => getTasks().deleteTask(id) };
    }
    case 'task.complete': {
      const id = String(a.id);
      await getTasks().setCompleted(id, true);
      return { result: 'Marked to-do complete', undo: () => getTasks().setCompleted(id, false) };
    }
    case 'calendar.create': {
      const id = await getCalendar().createEvent({
        title: String(a.title ?? ''),
        start: String(a.start),
        end: String(a.end ?? a.start),
        allDay: a.allDay ?? !String(a.start).includes('T'),
        location: a.location,
        notes: a.notes,
        recurrence: a.yearly ? 'yearly' : 'none',
      });
      return { result: `Added event “${a.title ?? ''}”`, undo: () => getCalendar().deleteEvent(id) };
    }
    case 'message.send': {
      let guid: string | undefined = a.chatGuid;
      if (!guid && a.to) {
        const chats = await invoke<Array<{ guid: string; name: string }>>('imessage_list_chats', { limit: 50 }).catch(() => []);
        guid = chats.find(c => c.name.toLowerCase().includes(String(a.to).toLowerCase()))?.guid;
      }
      if (!guid) throw new Error(`No conversation matching "${a.to ?? ''}"`);
      await invoke('imessage_send', { chatGuid: guid, text: String(a.text ?? '') });
      return { result: 'Sent iMessage' };
    }
    case 'mail.send': {
      const accounts = ((useSettingsStore.getState().integrations as any)?.mailAccounts ?? []) as Array<{ email: string; provider: string }>;
      const acct = a.account ? accounts.find(x => x.email === a.account) : accounts[0];
      if (!acct) throw new Error('No mail account is connected');
      const cred = await invoke<{ ok: boolean }>('keychain_get', { host: `mail:${acct.email}` }).catch(() => ({ ok: false }));
      if (!cred?.ok) throw new Error(`No saved password for ${acct.email}`);
      await invoke('mail_send', {
        provider: acct.provider, email: acct.email,
        to: Array.isArray(a.to) ? a.to : [a.to].filter(Boolean),
        cc: Array.isArray(a.cc) ? a.cc : [], subject: String(a.subject ?? ''), body: String(a.body ?? ''), inReplyTo: null,
      });
      return { result: 'Sent email' };
    }
    case 'note.delete': { await getNotes().deleteNote(String(a.id)); return { result: 'Deleted note' }; }
    case 'task.delete': { await getTasks().deleteTask(String(a.id)); return { result: 'Deleted to-do' }; }
    case 'calendar.delete': { await getCalendar().deleteEvent(String(a.id)); return { result: 'Deleted event' }; }
    case 'music.play': { await invoke('music_play'); return { result: 'Playing Apple Music' }; }
    case 'music.pause': { await invoke('music_pause'); return { result: 'Paused Apple Music' }; }
    case 'music.create_playlist': {
      const id = await invoke<string>('music_create_playlist', { name: String(a.name ?? '') });
      return { result: `Created playlist “${a.name ?? ''}” (ID: ${id})` };
    }
    case 'music.add_track': {
      try {
        await invoke('music_add_track_to_playlist', { trackName: String(a.trackName ?? ''), playlistName: String(a.playlistName ?? '') });
        return { result: `Added “${a.trackName ?? ''}” to playlist` };
      } catch (e: any) {
        if (e?.includes('Track not found')) {
          return { result: `Failed: Track "${a.trackName}" is not in your Apple Music library. Find and add it manually first.` };
        }
        throw e;
      }
    }
    // SAFETY BACKSTOP: a playbook is a PROPOSAL, never an executor. Approving a playbook.execute must
    // re-emit each step as its own forge:action (so any per-step send/delete still hits the approval
    // gate) — steps must NEVER run from here. Reaching this means the proposal-expansion was bypassed.
    case 'playbook.execute':
      throw new Error('A playbook cannot be executed directly — each step must be re-emitted and approved.');
    case 'playbook.capture':
      throw new Error('playbook.capture is persisted at the app layer, not run through the connectors.');
    default:
      throw new Error(`Unknown action: ${a.tool}.${a.op}`);
  }
}
