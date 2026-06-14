import { describe, it, expect } from 'vitest';
import { scoreWebHistory, renderWebRecall } from '../../services/webHistory';

const visit = (over: Partial<any> = {}) => ({
  id: over.id ?? `v-${Math.random()}`,
  url: over.url ?? 'https://example.com/rust-async-guide',
  title: over.title ?? 'A practical guide to async Rust',
  timestamp: over.timestamp ?? 1_700_000_000_000,
  wordCount: over.wordCount ?? 800,
  wasDigested: false,
  isPrivate: over.isPrivate ?? false,
});

describe('webHistory — recall scoring', () => {
  it('matches on title/url tokens and ignores stopwords', () => {
    const hits = scoreWebHistory([visit()], 'remember that article about async rust?');
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toContain('rust-async');
  });

  it('excludes private (incognito) visits', () => {
    const hits = scoreWebHistory([visit({ isPrivate: true })], 'async rust');
    expect(hits).toEqual([]);
  });

  it('excludes pages with too little dwell (redirects/blank)', () => {
    const hits = scoreWebHistory([visit({ wordCount: 5 })], 'async rust');
    expect(hits).toEqual([]);
  });

  it('requires a couple of token overlaps (avoids noise)', () => {
    const hits = scoreWebHistory([visit({ title: 'async only', url: 'https://x.com/async' })], 'rust');
    expect(hits).toEqual([]); // only one weak match → below MIN_SCORE
  });

  it('ranks by score then recency and de-dupes by url', () => {
    const a = visit({ url: 'https://a.com/async-rust-tokio', title: 'async rust tokio', timestamp: 1 });
    const b = visit({ url: 'https://a.com/async-rust-tokio', title: 'async rust tokio', timestamp: 2 }); // dup url
    const c = visit({ url: 'https://b.com/cooking', title: 'easy dinner recipes', timestamp: 9 }); // unrelated
    const hits = scoreWebHistory([a, b, c], 'async rust tokio');
    expect(hits.map(h => h.url)).toEqual(['https://a.com/async-rust-tokio']); // c below threshold; dup collapsed
  });

  it('renders provenance and empty-on-no-hits', () => {
    expect(renderWebRecall([])).toBe('');
    const block = renderWebRecall([{ title: 'Async Rust', url: 'https://a.com', timestamp: 1_700_000_000_000, score: 3 }]);
    expect(block).toContain('FROM YOUR BROWSING HISTORY');
    expect(block).toContain('https://a.com');
  });
});
