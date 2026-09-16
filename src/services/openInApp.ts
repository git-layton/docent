// Open the REAL app at the REAL item.
//
// The whole argument for retiring Docent's copies of Mail, Notes and Messages rests on this being
// possible: ask in the conversation, get handles back, click one, and the actual app opens at the
// actual thing. Without it, removing the panels would just remove the ability to look.
//
// Previously the only way to read a message was `openMessage`, a useCallback trapped INSIDE
// MailInboxPanel — the panel scheduled for deletion. The capability existed; nothing else could
// reach it.
//
// Note what this is not: it does not drive Mail.app through the UI, move the pointer, or take the
// screen. It hands macOS a URL and lets the system do what it does for any link.

import { invoke } from '@tauri-apps/api/core';

export interface MailHandle {
  provider: 'gmail' | 'icloud';
  account: string;
  uid: number;
}

/**
 * Build the `message:` URL Mail.app understands.
 *
 * Mail addresses messages by RFC-822 Message-ID, not by IMAP uid — the uid is per-mailbox and
 * meaningless to the app. The angle brackets are REQUIRED and must be percent-encoded, which is
 * the part that silently fails if you skip it: Mail opens to nothing and reports no error.
 */
export function mailMessageUrl(messageId: string): string | null {
  const id = String(messageId ?? '').trim().replace(/^<|>$/g, '');
  if (!id) return null;
  return `message://%3c${encodeURIComponent(id)}%3e`;
}

export type OpenResult =
  | { opened: true }
  | { opened: false; reason: 'no-message-id' | 'lookup-failed' | 'open-failed'; detail?: string };

/**
 * Open one message in Mail.app.
 *
 * Two steps, because the pieces live in different places: the Message-ID comes from fetching the
 * body over IMAP (the uid alone cannot address it), then the system opens the URL.
 *
 * Returns a result rather than throwing — this is called from a click handler, and an unhandled
 * rejection there is invisible to everyone including the user who just clicked.
 */
export async function openMailMessage(handle: MailHandle): Promise<OpenResult> {
  let messageId = '';
  try {
    const body = await invoke<{ messageId?: string }>('mail_fetch_body', {
      provider: handle.provider,
      email: handle.account,
      uid: handle.uid,
    });
    messageId = body?.messageId ?? '';
  } catch (e: any) {
    return { opened: false, reason: 'lookup-failed', detail: e?.message ?? String(e) };
  }

  const url = mailMessageUrl(messageId);
  if (!url) {
    // A message with no Message-ID is rare but real (some drafts, some senders). Better to say so
    // than to open Mail at an empty window and let the user wonder what happened.
    return { opened: false, reason: 'no-message-id' };
  }

  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return { opened: true };
  } catch (e: any) {
    return { opened: false, reason: 'open-failed', detail: e?.message ?? String(e) };
  }
}

/** Human-readable failure, for a toast. Never blame the user for a missing Message-ID. */
export function describeOpenFailure(result: Extract<OpenResult, { opened: false }>): string {
  switch (result.reason) {
    case 'no-message-id':
      return "That message has no ID Mail can open — it may be a draft. It's still readable here.";
    case 'lookup-failed':
      return 'Could not reach the mail server to locate that message.';
    case 'open-failed':
      return 'Mail could not open that message.';
  }
}
