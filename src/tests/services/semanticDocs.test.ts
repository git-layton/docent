import { describe, it, expect } from 'vitest';
import { ragHitsToDocs, mergeRanked, isKnowledgeDoc, KNOWLEDGE_DOC_PREFIX } from '../../services/semanticDocs';
import type { RagHit } from '../../services/memoryContext';
import type { ScoredDoc } from '../../services/universalSearch';

const hit = (over: Partial<RagHit> = {}): RagHit => ({
  path: 'memory/codey/rust-notes.md', title: 'Rust notes', snippet: 'borrow checker tips', score: 0.7, ...over,
});

describe('ragHitsToDocs', () => {
  it('maps a hit to a knowledge Doc with a prefixed id and scaled score', () => {
    const [doc] = ragHitsToDocs([hit({ score: 0.8 })]);
    expect(doc.kind).toBe('Doc');
    expect(doc.id).toBe(`${KNOWLEDGE_DOC_PREFIX}memory/codey/rust-notes.md`);
    expect(isKnowledgeDoc(doc.id)).toBe(true);
    expect(doc.title).toBe('Rust notes');
    expect(doc.score).toBe(120); // 0.8 * 150
  });

  it('drops hits below the min score', () => {
    expect(ragHitsToDocs([hit({ score: 0.1 })])).toHaveLength(0);
    expect(ragHitsToDocs([hit({ score: 0.5 })])).toHaveLength(1);
  });

  it('derives a title from the path when the hit has none', () => {
    const [doc] = ragHitsToDocs([hit({ title: '', path: 'library/Q3 Plan.md' })]);
    expect(doc.title).toBe('Q3 Plan');
  });

  it('collapses snippet whitespace and truncates to 120 chars', () => {
    const [doc] = ragHitsToDocs([hit({ snippet: 'a\n\n  b   c'.padEnd(300, 'x') })]);
    expect(doc.sub!.length).toBeLessThanOrEqual(120);
    expect(doc.sub!.startsWith('a b c')).toBe(true);
  });

  it('tolerates null/garbage input', () => {
    expect(ragHitsToDocs(null as any)).toEqual([]);
    expect(ragHitsToDocs([{ path: 5 } as any])).toEqual([]);
  });
});

describe('mergeRanked', () => {
  const lex = (id: string, title: string, score: number): ScoredDoc =>
    ({ kind: 'Doc', id, title, score } as ScoredDoc);
  const sem = (id: string, title: string, score: number): ScoredDoc =>
    ({ kind: 'Doc', id: `${KNOWLEDGE_DOC_PREFIX}${id}`, title, score } as ScoredDoc);

  it('appends semantic hits the lexical pass missed and sorts by score', () => {
    const out = mergeRanked([lex('app-x', 'Calendar', 60)], [sem('a.md', 'Trip ideas', 130)]);
    expect(out.map((d) => d.title)).toEqual(['Trip ideas', 'Calendar']);
  });

  it('drops a semantic hit already shown lexically (same normalised title)', () => {
    const out = mergeRanked([lex('doc-1', 'Rust Notes', 90)], [sem('r.md', 'rust   notes', 140)]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('doc-1');
  });

  it('drops a semantic hit whose id already appears lexically', () => {
    const id = `${KNOWLEDGE_DOC_PREFIX}r.md`;
    const out = mergeRanked([{ kind: 'Doc', id, title: 'A', score: 50 } as ScoredDoc], [sem('r.md', 'B', 99)]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('A');
  });

  it('caps the merged list', () => {
    const lexMany = Array.from({ length: 10 }, (_, i) => lex(`l${i}`, `L${i}`, 100 - i));
    expect(mergeRanked(lexMany, [], 8)).toHaveLength(8);
  });
});
