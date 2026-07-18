import { invoke } from '@tauri-apps/api/core';

// Memory ledger — the Knowledge Core's git history rendered as a human story.
// The backend (`memory_git_log`) returns raw `git log --name-only` output with unit/record
// separators; everything here is pure parsing + humanizing, unit-tested without Tauri.
// Read-only by design: the ledger shows what the app learned and when — auditing, not editing.

export interface LedgerEntry {
  hash: string;
  ts: number; // unix ms
  subject: string;
  files: string[];
}

export interface LedgerDay {
  /** Local ISO date 'YYYY-MM-DD'. */
  date: string;
  entries: LedgerEntry[];
}

const RECORD_SEP = '\u001e';
const FIELD_SEP = '\u001f';

/** PURE — parse the backend's raw log format into entries (already newest-first). */
export function parseGitLog(raw: string): LedgerEntry[] {
  if (!raw) return [];
  return raw
    .split(RECORD_SEP)
    .map(block => block.trim())
    .filter(Boolean)
    .flatMap(block => {
      const [head, ...fileLines] = block.split('\n');
      const [hash, secs, ...subjectParts] = head.split(FIELD_SEP);
      const ts = Number(secs) * 1000;
      if (!hash || !Number.isFinite(ts)) return [];
      return [{
        hash,
        ts,
        subject: subjectParts.join(FIELD_SEP).trim(),
        files: fileLines.map(l => l.trim()).filter(Boolean),
      }];
    });
}

/** PURE — a friendly one-liner for what a commit touched, from its file paths. */
export function describeFiles(files: string[]): string {
  if (files.length === 0) return '';
  const areas = new Set<string>();
  for (const f of files) {
    if (f.startsWith('memory/')) areas.add('memory');
    else if (f.startsWith('notes/')) areas.add('notes');
    else if (f.startsWith('library/')) areas.add('the library');
    else if (f.startsWith('workspace/')) areas.add('the workspace');
    else areas.add('files');
  }
  const list = [...areas];
  const where = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `${files.length} file${files.length === 1 ? '' : 's'} in ${where}`;
}

/** PURE — group entries into day buckets (local time), preserving newest-first order. */
export function groupByDay(entries: LedgerEntry[]): LedgerDay[] {
  const days: LedgerDay[] = [];
  for (const e of entries) {
    const d = new Date(e.ts);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const last = days[days.length - 1];
    if (last && last.date === date) last.entries.push(e);
    else days.push({ date, entries: [e] });
  }
  return days;
}

/** Fetch and parse the ledger. Returns [] when the core isn't a git repo yet (first run). */
export async function fetchMemoryLedger(limit = 50): Promise<LedgerDay[]> {
  const res = await invoke<{ ok: boolean; log?: string; error?: string }>('memory_git_log', { limit }).catch(() => null);
  if (!res?.ok || !res.log) return [];
  return groupByDay(parseGitLog(res.log));
}
