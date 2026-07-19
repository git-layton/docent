import { describe, it, expect } from 'vitest';
import { diffWords, diffLines, diffStats, htmlToComparableText } from '../../lib/textDiff';

describe('diffWords', () => {
  it('marks insertions, deletions, and unchanged runs', () => {
    const runs = diffWords('the quick brown fox', 'the slow brown fox jumps');
    expect(runs).toEqual([
      { op: 'eq', text: 'the' },
      { op: 'del', text: 'quick' },
      { op: 'ins', text: 'slow' },
      { op: 'eq', text: 'brown fox' },
      { op: 'ins', text: 'jumps' },
    ]);
  });

  it('identical inputs produce a single eq run', () => {
    expect(diffWords('same text here', 'same text here')).toEqual([{ op: 'eq', text: 'same text here' }]);
  });

  it('handles empty sides', () => {
    expect(diffWords('', 'all new')).toEqual([{ op: 'ins', text: 'all new' }]);
    expect(diffWords('all gone', '')).toEqual([{ op: 'del', text: 'all gone' }]);
    expect(diffWords('', '')).toEqual([]);
  });
});

describe('diffLines', () => {
  it('diffs at line granularity', () => {
    const runs = diffLines('a\nb\nc', 'a\nB\nc');
    expect(runs).toEqual([
      { op: 'eq', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'ins', text: 'B' },
      { op: 'eq', text: 'c' },
    ]);
  });
});

describe('diffStats', () => {
  it('counts added and removed words', () => {
    const runs = diffWords('one two three', 'one four five six');
    const { added, removed } = diffStats(runs);
    expect(added).toBe(3);
    expect(removed).toBe(2);
  });
});

describe('htmlToComparableText', () => {
  it('strips tags and keeps block structure as line breaks', () => {
    const text = htmlToComparableText('<div>Hello <b>world</b></div><div>Second line</div>');
    expect(text).toContain('Hello world');
    expect(text).toContain('Second line');
    expect(text).not.toContain('<');
  });
});
