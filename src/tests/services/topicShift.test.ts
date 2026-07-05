import { describe, it, expect } from 'vitest';
import { cosine, updateCentroid, isTopicShift, CENTROID_ALPHA, MIN_MESSAGES_FOR_SHIFT, type TopicState } from '../../services/topicShift';

const unit = (i: number, dim = 4): number[] => {
  const v = new Array(dim).fill(0);
  v[i] = 1;
  return v;
};

describe('cosine', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('handles zero and mismatched vectors without NaN', () => {
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(cosine([], [1])).toBe(0);
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
  });
});

describe('updateCentroid', () => {
  it('adopts the first vector as the centroid', () => {
    const s = updateCentroid(null, [1, 0, 0, 0]);
    expect(s.centroid).toEqual([1, 0, 0, 0]);
    expect(s.n).toBe(1);
  });
  it('EMA-blends subsequent vectors toward the new message', () => {
    let s = updateCentroid(null, [1, 0]);
    s = updateCentroid(s, [0, 1]);
    expect(s.centroid[0]).toBeCloseTo(1 - CENTROID_ALPHA);
    expect(s.centroid[1]).toBeCloseTo(CENTROID_ALPHA);
    expect(s.n).toBe(2);
  });
});

describe('isTopicShift', () => {
  const grown = (v: number[]): TopicState => ({ centroid: v, n: MIN_MESSAGES_FOR_SHIFT });

  it('never fires on a young chat (no topic established yet)', () => {
    const young: TopicState = { centroid: unit(0), n: MIN_MESSAGES_FOR_SHIFT - 1 };
    expect(isTopicShift(young, unit(1))).toBe(false);
    expect(isTopicShift(null, unit(1))).toBe(false);
  });
  it('fires when the message is orthogonal to an established topic', () => {
    expect(isTopicShift(grown(unit(0)), unit(1))).toBe(true);
  });
  it('does not fire when the message matches the topic', () => {
    expect(isTopicShift(grown(unit(0)), unit(0))).toBe(false);
  });
});
