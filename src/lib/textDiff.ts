// Word/line diff for draft approvals — pure, dependency-free LCS.
//
// Draft approvals show WHAT Docent wants to change before it lands ("highlights what it
// wants to change so you can approve it" — the landing-page promise). This produces the
// classic ins/del/eq runs a tracked-changes view renders. LCS is O(n·m); doc-sized inputs
// are fine, and a guard degrades giant inputs to one whole-document replace instead of
// freezing the UI — honest, just less granular.

export interface DiffRun {
  op: 'eq' | 'ins' | 'del';
  text: string;
}

const MAX_CELLS = 4_000_000; // ~2000×2000 tokens — beyond this, degrade gracefully

function diffTokens(a: string[], b: string[], join: string): DiffRun[] {
  if (a.length * b.length > MAX_CELLS) {
    const runs: DiffRun[] = [];
    if (a.length) runs.push({ op: 'del', text: a.join(join) });
    if (b.length) runs.push({ op: 'ins', text: b.join(join) });
    return runs;
  }
  // LCS table (lengths only), then backtrack into runs.
  const n = a.length, m = b.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  const idx = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[idx(i, j)] = a[i] === b[j]
        ? dp[idx(i + 1, j + 1)] + 1
        : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
    }
  }
  const runs: DiffRun[] = [];
  const push = (op: DiffRun['op'], text: string) => {
    const last = runs[runs.length - 1];
    if (last && last.op === op) last.text += join + text;
    else runs.push({ op, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('eq', a[i]); i++; j++; }
    else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) { push('del', a[i]); i++; }
    else { push('ins', b[j]); j++; }
  }
  while (i < n) { push('del', a[i]); i++; }
  while (j < m) { push('ins', b[j]); j++; }
  return runs;
}

/** Word-level diff (whitespace-normalized) — for prose/doc review. */
export function diffWords(before: string, after: string): DiffRun[] {
  const tok = (s: string) => s.split(/\s+/).filter(Boolean);
  return diffTokens(tok(before), tok(after), ' ');
}

/** Line-level diff — for code review. */
export function diffLines(before: string, after: string): DiffRun[] {
  const tok = (s: string) => s.split('\n');
  return diffTokens(tok(before), tok(after), '\n');
}

/** Strip HTML to comparable text (doc canvases store HTML; the diff should read as prose). */
export function htmlToComparableText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*>/gi, '$&\n'); // block ends → line breaks
  return (el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Quick summary for the review bar: "+12 words · −4 words". */
export function diffStats(runs: DiffRun[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const r of runs) {
    const count = r.text.split(/\s+/).filter(Boolean).length;
    if (r.op === 'ins') added += count;
    else if (r.op === 'del') removed += count;
  }
  return { added, removed };
}
