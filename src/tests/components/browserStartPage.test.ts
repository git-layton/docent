import { describe, it, expect } from 'vitest';
import { resolveQuery } from '../../components/BrowserStartPage';

describe('resolveQuery', () => {
  it('treats a bare domain as a destination', () => {
    expect(resolveQuery('github.com')).toBe('github.com');
    expect(resolveQuery('news.ycombinator.com')).toBe('news.ycombinator.com');
  });

  it('keeps an explicit scheme untouched', () => {
    expect(resolveQuery('https://example.com/a/b?c=1')).toBe('https://example.com/a/b?c=1');
  });

  it('keeps a path on a bare domain', () => {
    expect(resolveQuery('github.com/anthropics')).toBe('github.com/anthropics');
  });

  it('searches for plain prose', () => {
    expect(resolveQuery('best coffee in berlin')).toBe('https://duckduckgo.com/?q=best%20coffee%20in%20berlin');
  });

  // The dot alone can't decide — these all contain one and are all questions, not addresses.
  it('searches for prose that happens to contain a dot', () => {
    expect(resolveQuery('what is a .gitignore')).toContain('duckduckgo.com/?q=');
    expect(resolveQuery('is 3.5 better than 4')).toContain('duckduckgo.com/?q=');
  });

  it('escapes characters that would corrupt the search url', () => {
    expect(resolveQuery('a&b=c')).toBe('https://duckduckgo.com/?q=a%26b%3Dc');
  });

  it('trims surrounding whitespace before deciding', () => {
    expect(resolveQuery('  github.com  ')).toBe('github.com');
  });
});
