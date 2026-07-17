import { describe, it, expect, vi } from 'vitest';
import { createBasisFilter, stripBasisLine } from '../../services/searchAnswer';

const run = (chunks: string[]) => {
  const out: string[] = [];
  const onBasis = vi.fn();
  const f = createBasisFilter((c) => out.push(c), onBasis);
  for (const c of chunks) f.push(c);
  f.flush();
  return { text: out.join(''), basis: onBasis.mock.calls[0]?.[0], calls: onBasis.mock.calls.length };
};

describe('createBasisFilter', () => {
  it('parses and strips a grounded tag arriving in one chunk', () => {
    const r = run(['BASIS: grounded\nYour standup is at 10am [[Team Notes]].']);
    expect(r.basis).toBe('grounded');
    expect(r.text).toBe('Your standup is at 10am [[Team Notes]].');
  });

  it('handles the tag split across many small chunks', () => {
    const r = run(['BA', 'SIS: gen', 'eral', '\nParis is the capital', ' of France.']);
    expect(r.basis).toBe('general');
    expect(r.text).toBe('Paris is the capital of France.');
  });

  it('reports basis exactly once', () => {
    const r = run(['BASIS: unsure\nHmm.', ' More text.']);
    expect(r.calls).toBe(1);
    expect(r.basis).toBe('unsure');
  });

  it('degrades to unknown and forwards everything when there is no tag', () => {
    const r = run(['The answer is 42.\nSecond line.']);
    expect(r.basis).toBe('unknown');
    expect(r.text).toBe('The answer is 42.\nSecond line.');
  });

  it('stops holding the stream once the prefix clearly is not a BASIS line', () => {
    const out: string[] = [];
    const f = createBasisFilter((c) => out.push(c));
    f.push('This is a long answer without any tag whatsoever, streaming on');
    // No newline yet, but the filter must have released the text already.
    expect(out.join('')).toContain('long answer');
    f.flush();
  });

  it('handles a reply that is only a tag with no newline', () => {
    const r = run(['BASIS: unsure']);
    expect(r.basis).toBe('unsure');
    expect(r.text).toBe('');
  });

  it('treats a malformed basis value as unknown', () => {
    const r = run(['BASIS: vibes\nWho knows.']);
    expect(r.basis).toBe('unknown');
    expect(r.text).toBe('BASIS: vibes\nWho knows.');
  });
});

describe('stripBasisLine', () => {
  it('strips the tag from a completed answer', () => {
    expect(stripBasisLine('BASIS: grounded\nAnswer here.')).toBe('Answer here.');
  });
  it('leaves untagged answers alone', () => {
    expect(stripBasisLine('Just an answer.')).toBe('Just an answer.');
  });
});
