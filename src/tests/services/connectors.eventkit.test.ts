import { describe, it, expect } from 'vitest';
import { isoToMs, msToIso, rangeToMs } from '../../services/connectors/backends/eventkit';

// These exercise only the pure ISO<->epoch-ms helpers (no Tauri/native bridge). They're written to
// be timezone-agnostic: all-day conversions go through local-midnight on both sides.

describe('eventkit date helpers', () => {
  it('round-trips an all-day date through local midnight', () => {
    expect(msToIso(isoToMs('2026-03-07', true), true)).toBe('2026-03-07');
  });

  it('an all-day date anchors to local midnight', () => {
    const d = new Date(isoToMs('2026-03-07', true));
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()])
      .toEqual([2026, 3, 7, 0, 0]);
  });

  it('timed ISO round-trips exactly', () => {
    const iso = '2026-03-07T15:30:00.000Z';
    const ms = isoToMs(iso, false);
    expect(ms).toBe(Date.parse(iso));
    expect(msToIso(ms, false)).toBe(iso);
  });

  it('rangeToMs widens a date-only window to whole local days', () => {
    const { startMs, endMs } = rangeToMs('2026-03-01', '2026-03-31');
    expect(startMs).toBe(new Date(2026, 2, 1).getTime());
    expect(endMs).toBe(new Date(2026, 2, 31).getTime() + 24 * 60 * 60 * 1000 - 1);
  });
});
