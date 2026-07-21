import { describe, it, expect } from 'vitest';
import { parseGitLog, describeFiles, groupByDay } from '../../services/memoryLedger';

const RS = '\u001e';
const FS = '\u001f';

// Raw shape mirrors memory_git_log's --pretty=format:\x1e%h\x1f%ct\x1f%s --name-only output.
const raw =
  `${RS}abc1234${FS}1752700000${FS}memory: learned venue pricing\nmemory/docent/venue.md\nmemory/docent/budget.md\n\n` +
  `${RS}def5678${FS}1752600000${FS}library: saved contract.pdf\nlibrary/contract.pdf\n\n` +
  `${RS}0a1b2c3${FS}1752500000${FS}dream: merged 3 notes`;

describe('parseGitLog', () => {
  it('parses hash, timestamp (ms), subject, and changed files per commit', () => {
    const entries = parseGitLog(raw);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      hash: 'abc1234',
      ts: 1752700000000,
      subject: 'memory: learned venue pricing',
      files: ['memory/docent/venue.md', 'memory/docent/budget.md'],
    });
    expect(entries[2].files).toEqual([]); // commit with no file list still parses
  });

  it('tolerates empty input and garbage blocks', () => {
    expect(parseGitLog('')).toEqual([]);
    expect(parseGitLog(`${RS}not-a-real-block`)).toEqual([]);
    expect(parseGitLog(`${RS}abc${FS}notanumber${FS}subject`)).toEqual([]);
  });

  it('keeps field separators appearing inside a subject', () => {
    const entries = parseGitLog(`${RS}aaa1111${FS}1752500000${FS}odd${FS}subject`);
    expect(entries[0].subject).toBe(`odd${FS}subject`);
  });
});

describe('describeFiles', () => {
  it('names the areas touched', () => {
    expect(describeFiles(['memory/a.md', 'memory/b.md'])).toBe('2 files in memory');
    expect(describeFiles(['notes/n.md', 'library/c.pdf'])).toBe('2 files in notes and the library');
    expect(describeFiles([])).toBe('');
  });
});

describe('groupByDay', () => {
  it('buckets consecutive same-day entries, preserving newest-first order', () => {
    const base = new Date(2026, 6, 16, 12, 0, 0).getTime(); // local noon avoids midnight edges
    const entries = [
      { hash: 'a', ts: base, subject: 's1', files: [] },
      { hash: 'b', ts: base - 3600_000, subject: 's2', files: [] },
      { hash: 'c', ts: base - 26 * 3600_000, subject: 's3', files: [] },
    ];
    const days = groupByDay(entries);
    expect(days).toHaveLength(2);
    expect(days[0].date).toBe('2026-07-16');
    expect(days[0].entries.map(e => e.hash)).toEqual(['a', 'b']);
    expect(days[1].entries.map(e => e.hash)).toEqual(['c']);
  });
});
