// Provenance for imported copies — so a copy is never a confusing orphan. Every file imported into
// the workspace records where it came from; the workspace UI can then offer Open original / Re-sync /
// Push back / Detach. See docs/agent-file-access-design.md §4b.

export interface Provenance {
  source: string;   // absolute path of the original
  imported: string; // ISO timestamp
}

const FENCE_START = '<!-- agentforge:provenance';
const FENCE_END = '-->';

/** A trailing HTML comment we can append to imported text files without disturbing their content. */
export function provenanceComment(source: string, now: Date): string {
  const data: Provenance = { source, imported: now.toISOString() };
  return `\n${FENCE_START} ${JSON.stringify(data)} ${FENCE_END}\n`;
}

/** Recover provenance from a file's contents (null if it wasn't an import). */
export function parseProvenance(content: string): Provenance | null {
  const start = content.lastIndexOf(FENCE_START);
  if (start === -1) return null;
  const end = content.indexOf(FENCE_END, start);
  if (end === -1) return null;
  const json = content.slice(start + FENCE_START.length, end).trim();
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.source === 'string' && typeof parsed.imported === 'string') {
      return parsed as Provenance;
    }
  } catch {
    /* not valid provenance */
  }
  return null;
}

/** Remove the provenance comment from a file's contents — used by "Detach" (make it a plain workspace
 * file) and "Push back" (don't write our bookkeeping comment into the user's real file). */
export function stripProvenance(content: string): string {
  const start = content.lastIndexOf(FENCE_START);
  if (start === -1) return content;
  const end = content.indexOf(FENCE_END, start);
  if (end === -1) return content;
  const before = content.slice(0, start).replace(/\n+$/, '');
  const after = content.slice(end + FENCE_END.length).replace(/^\n+/, '');
  return after ? `${before}\n${after}` : before;
}

/** A safe, unique workspace filename for an imported source path. */
export function importTargetName(sourcePath: string, now: number): string {
  const base = sourcePath.split('/').pop() || 'imported-file';
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'file';
  const ext = dot > 0 ? base.slice(dot) : '';
  return `imports/${stem}-${now}${ext}`;
}
