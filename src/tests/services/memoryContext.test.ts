import { describe, it, expect } from 'vitest';
import { formatRelevantHits, type RagHit } from '../../services/memoryContext';

const hit = (title: string, score: number): RagHit => ({ path: `/${title}`, title, snippet: `snippet of ${title}`, score });

describe('memoryContext — relevance gating (Tier 2)', () => {
  it('drops hits below the similarity cutoff', () => {
    const out = formatRelevantHits([hit('A', 0.9), hit('B', 0.2), hit('C', 0.4)]);
    expect(out).toContain('A');
    expect(out).toContain('C');
    expect(out).not.toContain('B'); // 0.2 < 0.35 cutoff
  });

  it('caps the number of injected hits', () => {
    const many = [hit('A', 0.9), hit('B', 0.8), hit('C', 0.7), hit('D', 0.6), hit('E', 0.5)];
    const out = formatRelevantHits(many);
    // Only the first 4 (max) survive.
    expect(out.match(/\[\d\]/g)?.length).toBe(4);
    expect(out).not.toContain('snippet of E');
  });

  it('returns empty string when nothing clears the bar', () => {
    expect(formatRelevantHits([hit('A', 0.1), hit('B', 0.2)])).toBe('');
    expect(formatRelevantHits([])).toBe('');
  });

  it('honors custom threshold + max', () => {
    const out = formatRelevantHits([hit('A', 0.5), hit('B', 0.45)], 0.48, 5);
    expect(out).toContain('A');
    expect(out).not.toContain('B');
  });
});
