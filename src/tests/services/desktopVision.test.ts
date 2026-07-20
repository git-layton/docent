import { describe, it, expect } from 'vitest';
import { resolveSemanticTarget, computeGridHashes, hasFrameChanged, type LayoutElement } from '../../services/desktopVision';

const el = (over: Partial<LayoutElement>): LayoutElement => ({
  id: 'e1', text: 'Submit', x: 100, y: 200, width: 80, height: 30, ...over,
});

describe('resolveSemanticTarget', () => {
  it('resolves an exact match to the element center', () => {
    const hit = resolveSemanticTarget('Submit', [el({})]);
    expect(hit).toEqual({ x: 140, y: 215, label: 'Submit', confidence: 1.0 });
  });

  it('falls through exact → contains → token overlap with descending confidence', () => {
    const contains = resolveSemanticTarget('subm', [el({ text: 'Submit form' })]);
    expect(contains?.confidence).toBe(0.85);
    const overlap = resolveSemanticTarget('submit the thing', [el({ text: 'Submit form' })]);
    expect(overlap?.confidence).toBe(0.65);
  });

  it('NEVER resolves synthetic (fabricated-bounds) elements — clicking them would press blind', () => {
    const synthetic = el({ text: 'Grant Access', synthetic: true });
    expect(resolveSemanticTarget('Grant Access', [synthetic])).toBeNull();
    // …but a real element with the same text still resolves.
    expect(resolveSemanticTarget('Grant Access', [synthetic, el({ id: 'e2', text: 'Grant Access' })])?.label).toBe('Grant Access');
  });

  it('returns null for empty targets and empty screens', () => {
    expect(resolveSemanticTarget('', [el({})])).toBeNull();
    expect(resolveSemanticTarget('anything', [])).toBeNull();
  });
});

describe('delta filter', () => {
  it('same elements → same hashes → no change reported', () => {
    const a = computeGridHashes([el({})]);
    const b = computeGridHashes([el({})]);
    expect(hasFrameChanged(b, a)).toBe(false);
  });

  it('first frame always reports changed', () => {
    expect(hasFrameChanged(computeGridHashes([el({})]), [])).toBe(true);
  });
});
