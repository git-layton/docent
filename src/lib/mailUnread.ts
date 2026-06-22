import { invoke } from '@tauri-apps/api/core';

interface MailAccount {
  id: string;
  provider: string;
  email: string;
}

let cache: { total: number; at: number } | null = null;
let inflight: Promise<number | null> | null = null;

const TTL_MS = 5 * 60 * 1000;

/**
 * Total unread (UNSEEN) count across connected mail accounts via a cheap IMAP
 * SEARCH per account. Cached for 5 minutes and de-duplicated so re-opening the
 * Home tab doesn't hammer the mail servers. Returns null when nothing is
 * connected or every account fails (no password, offline, …).
 */
export async function getUnreadTotal(accounts: MailAccount[]): Promise<number | null> {
  if (!accounts || accounts.length === 0) return null;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.total;
  if (inflight) return inflight;

  inflight = (async () => {
    let total = 0;
    let anyOk = false;
    for (const acct of accounts) {
      try {
        const cred = await invoke<{ ok: boolean }>('keychain_get', { host: `mail:${acct.email}` });
        if (!cred?.ok) continue;
        const n = await invoke<number>('mail_unread_count', {
          provider: acct.provider,
          email: acct.email,
        });
        total += n;
        anyOk = true;
      } catch {
        // Account unreachable — skip it rather than fail the whole badge.
      }
    }
    if (!anyOk) return null;
    cache = { total, at: Date.now() };
    return total;
  })().finally(() => { inflight = null; });

  return inflight;
}

/** Drop the cache (e.g. after the user reads mail) so the next call refetches. */
export function invalidateUnreadCache(): void {
  cache = null;
}
