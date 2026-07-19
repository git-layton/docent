// ─── Shared date utilities ────────────────────────────────────────────────────
// Extracted from PlannerPanel + CalendarPanel — both previously duplicated these.
// Import from here; do not re-implement in individual panels.

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local (timezone-safe) ISO date string 'YYYY-MM-DD' for a Date object. */
export function toLocalISODate(dateObj: Date): string {
  const offset = dateObj.getTimezoneOffset() * 60000;
  return new Date(dateObj.getTime() - offset).toISOString().split('T')[0];
}

/** Add `n` days to an ISO date string, returning a new ISO date string. */
export function addISODays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toLocalISODate(new Date(y, m - 1, d + n));
}

/** Today's ISO date string. */
export function todayISO(): string {
  return toLocalISODate(new Date());
}

/** Format a Unix-ms timestamp as a short human time: '2:30 PM'. */
export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Format a Unix-ms timestamp as 'Jul 19'. */
export function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

export interface CalEventSlice { title: string; startMs: number; endMs: number; allDay: boolean }

/**
 * Given a list of calendar events, compute total free minutes within the working day window.
 */
export function computeFreeMinutes(
  events: CalEventSlice[],
  dayStartMs: number,
  dayEndMs: number,
): number {
  const timed = events
    .filter(e => !e.allDay && e.endMs > dayStartMs && e.startMs < dayEndMs)
    .sort((a, b) => a.startMs - b.startMs);
  let freeMs = 0;
  let cursor = dayStartMs;
  for (const ev of timed) {
    const start = Math.max(ev.startMs, dayStartMs);
    const end = Math.min(ev.endMs, dayEndMs);
    if (start > cursor) freeMs += start - cursor;
    cursor = Math.max(cursor, end);
  }
  if (cursor < dayEndMs) freeMs += dayEndMs - cursor;
  return Math.floor(freeMs / 60_000);
}

/** Format a minute count as "2h 30m" or "45m". */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** PURE capacity hint — how many tasks fit in free time. */
export function capacityHint(freeMinutes: number, openTaskCount: number, avgTaskMins = 30): string {
  if (openTaskCount === 0) return 'No open tasks — enjoy your day!';
  const fits = Math.floor(freeMinutes / avgTaskMins);
  const freeStr = formatDuration(freeMinutes);
  if (freeMinutes <= 0) return `${openTaskCount} task${openTaskCount !== 1 ? 's' : ''} queued · No free time found`;
  if (fits === 0) return `${freeStr} free · ${openTaskCount} task${openTaskCount !== 1 ? 's' : ''} queued — too short for a full task`;
  if (fits >= openTaskCount) return `${freeStr} free · All ${openTaskCount} task${openTaskCount !== 1 ? 's' : ''} fit today`;
  return `${freeStr} free · ${fits} of ${openTaskCount} tasks fit today`;
}
