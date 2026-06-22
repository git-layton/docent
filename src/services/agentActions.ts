// Agent → tool actions. The agent can emit fenced ```forge:action``` JSON block(s) to act on the
// user's tools through the existing connectors. Safety model (user-chosen): local writes
// (note/task/calendar create, task complete) auto-apply; sends and deletes require explicit approval.
//
// This module is pure-ish: parse/classify/describe are side-effect-free and unit-tested; execute()
// is the only part that touches connectors/commands.

import { invoke } from '@tauri-apps/api/core';
import { getCalendar, getTasks, getNotes } from './connectors';
import { useSettingsStore } from '../store/useSettingsStore';

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

/** Extract ```forge:action``` JSON blocks from an agent message. Tolerant — skips malformed blocks. */
export function parseAgentActions(text: string): AgentAction[] {
  if (!text) return [];
  const out: AgentAction[] = [];
  const re = /```forge:action\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      for (const a of Array.isArray(parsed) ? parsed : [parsed]) {
        if (a && typeof a.tool === 'string' && typeof a.op === 'string') out.push(a as AgentAction);
      }
    } catch {
      /* skip malformed block */
    }
  }
  return out;
}

/** Strip the action blocks from a message so they don't render as raw code to the user. */
export function stripActionBlocks(text: string): string {
  return text.replace(/```forge:action\s*[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Human-readable summary for a result/approval card. */
export function describeAction(a: AgentAction): string {
  switch (`${a.tool}.${a.op}`) {
    case 'note.create': return `Create note “${a.title ?? 'Untitled'}”`;
    case 'task.create': return `Add to-do “${a.title ?? ''}”${a.dueDate ? ` (due ${a.dueDate})` : ''}`;
    case 'task.complete': return `Mark a to-do complete`;
    case 'calendar.create': return `Add event “${a.title ?? ''}”${a.start ? ` on ${String(a.start).slice(0, 10)}` : ''}`;
    case 'message.send': return `Send iMessage to ${a.to ?? a.chatGuid ?? 'a conversation'}: “${a.text ?? ''}”`;
    case 'mail.send': return `Send email to ${Array.isArray(a.to) ? a.to.join(', ') : (a.to ?? '?')}: “${a.subject ?? ''}”`;
    case 'note.delete': return `Delete a note`;
    case 'task.delete': return `Delete a to-do`;
    case 'calendar.delete': return `Delete a calendar event`;
    case 'playbook.capture': return `Save “${a.title ?? 'this'}” as a reusable playbook`;
    case 'playbook.execute': return `Run the “${a.title ?? a.id ?? ''}” playbook — you'll approve each step`;
    default: return `${a.tool} ${a.op}`;
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Execute one action via the connectors/commands. Returns a short result string; throws on failure. */
export async function executeAgentAction(a: AgentAction): Promise<string> {
  switch (`${a.tool}.${a.op}`) {
    case 'note.create': {
      const body = `<div>${escapeHtml(String(a.body ?? '')).split('\n').join('</div><div>')}</div>`;
      await getNotes().createNote(a.folder, String(a.title ?? 'Untitled'), body);
      return `Created note “${a.title ?? 'Untitled'}”`;
    }
    case 'task.create': {
      await getTasks().createTask({ title: String(a.title ?? ''), dueDate: a.dueDate, details: a.details, location: a.location });
      return `Added to-do “${a.title ?? ''}”`;
    }
    case 'task.complete': {
      await getTasks().setCompleted(String(a.id), true);
      return 'Marked to-do complete';
    }
    case 'calendar.create': {
      await getCalendar().createEvent({
        title: String(a.title ?? ''),
        start: String(a.start),
        end: String(a.end ?? a.start),
        allDay: a.allDay ?? !String(a.start).includes('T'),
        location: a.location,
        notes: a.notes,
        recurrence: a.yearly ? 'yearly' : 'none',
      });
      return `Added event “${a.title ?? ''}”`;
    }
    case 'message.send': {
      let guid: string | undefined = a.chatGuid;
      if (!guid && a.to) {
        const chats = await invoke<Array<{ guid: string; name: string }>>('imessage_list_chats', { limit: 50 }).catch(() => []);
        guid = chats.find(c => c.name.toLowerCase().includes(String(a.to).toLowerCase()))?.guid;
      }
      if (!guid) throw new Error(`No conversation matching "${a.to ?? ''}"`);
      await invoke('imessage_send', { chatGuid: guid, text: String(a.text ?? '') });
      return 'Sent iMessage';
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
      return 'Sent email';
    }
    case 'note.delete': { await getNotes().deleteNote(String(a.id)); return 'Deleted note'; }
    case 'task.delete': { await getTasks().deleteTask(String(a.id)); return 'Deleted to-do'; }
    case 'calendar.delete': { await getCalendar().deleteEvent(String(a.id)); return 'Deleted event'; }
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
