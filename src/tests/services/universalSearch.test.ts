import { describe, it, expect } from 'vitest';
import { rankSearchDocs, scoreDoc, tokenize, type SearchDoc } from '../../services/universalSearch';

const doc = (over: Partial<SearchDoc> = {}): SearchDoc => ({
  kind: over.kind ?? 'Doc',
  id: over.id ?? `d-${over.title ?? 'x'}`,
  title: over.title ?? 'Untitled',
  body: over.body,
  sub: over.sub,
  url: over.url,
  timestamp: over.timestamp,
});

describe('universalSearch — ranking', () => {
  it('returns nothing for an empty query', () => {
    expect(rankSearchDocs([doc({ title: 'Inbox' })], '')).toEqual([]);
    expect(rankSearchDocs([doc({ title: 'Inbox' })], '   ')).toEqual([]);
  });

  it('ranks an exact title match above a partial one', () => {
    const hits = rankSearchDocs(
      [doc({ id: 'partial', title: 'Inbox rules and filters' }), doc({ id: 'exact', title: 'Inbox' })],
      'inbox',
    );
    expect(hits[0].id).toBe('exact');
  });

  it('ignores stopwords so natural phrasing still matches', () => {
    const hits = rankSearchDocs([doc({ id: 'rust', title: 'Rust notes' })], 'find my rust notes please');
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('rust');
  });

  it('rewards covering more of the query (specificity wins)', () => {
    const broad = doc({ id: 'broad', title: 'async' });
    const specific = doc({ id: 'specific', title: 'async rust tokio guide' });
    const hits = rankSearchDocs([broad, specific], 'async rust tokio');
    expect(hits[0].id).toBe('specific');
  });

  it('matches body text, not just the title', () => {
    const hits = rankSearchDocs(
      [doc({ id: 'task', kind: 'Task', title: 'Quarterly review', body: 'remember to mention the kubernetes migration' })],
      'kubernetes migration',
    );
    expect(hits.map((h) => h.id)).toContain('task');
  });

  it('tolerates a typo via subsequence fallback', () => {
    // "kuberntes" (missing the 'e') is a subsequence of "kubernetes".
    const hits = rankSearchDocs([doc({ id: 'k', title: 'Kubernetes runbook' })], 'kuberntes');
    expect(hits.map((h) => h.id)).toContain('k');
  });

  it('breaks ties toward the more recent item', () => {
    const old = doc({ id: 'old', title: 'Standup notes', timestamp: 1_000 });
    const recent = doc({ id: 'recent', title: 'Standup notes', timestamp: 5_000_000_000 });
    const now = 5_000_100_000;
    const hits = rankSearchDocs([old, recent], 'standup notes', 8, now);
    expect(hits[0].id).toBe('recent');
  });

  it('attaches a score and preserves extra caller fields', () => {
    const run = () => {};
    const hits = rankSearchDocs([{ ...doc({ title: 'Calendar' }), icon: 'CalIcon', run } as any], 'calendar');
    expect(hits[0].score).toBeGreaterThan(0);
    expect((hits[0] as any).icon).toBe('CalIcon');
    expect((hits[0] as any).run).toBe(run);
  });

  it('respects the result limit', () => {
    const docs = Array.from({ length: 20 }, (_, i) => doc({ id: `n${i}`, title: `note ${i}` }));
    expect(rankSearchDocs(docs, 'note', 5)).toHaveLength(5);
  });

  it('scoreDoc returns 0 when nothing matches', () => {
    expect(scoreDoc(doc({ title: 'Calendar' }), 'xyzzy', tokenize('xyzzy'))).toBe(0);
  });
});
