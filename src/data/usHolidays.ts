// US Federal Holidays — fixed-date and nth-weekday rules.
// Returns holidays for a given year as { name, date (YYYY-MM-DD), emoji }.

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toISODate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Returns the date of the nth occurrence of `dow` (0=Sun…6=Sat) in month (1-12).
// Use n=-1 for the last occurrence.
function getNthWeekday(year: number, month: number, dow: number, n: number): Date {
  if (n === -1) {
    // Last occurrence: start from last day of month and go backwards
    const last = new Date(year, month, 0); // day 0 = last day of previous month
    while (last.getDay() !== dow) last.setDate(last.getDate() - 1);
    return last;
  }
  const first = new Date(year, month - 1, 1);
  const diff = (dow - first.getDay() + 7) % 7;
  return new Date(year, month - 1, 1 + diff + (n - 1) * 7);
}

export interface HolidayEntry {
  name: string;
  date: string;   // YYYY-MM-DD
  emoji: string;
}

export function getHolidaysForYear(year: number): HolidayEntry[] {
  const h: HolidayEntry[] = [];

  const fixed = (name: string, month: number, day: number, emoji: string) => {
    h.push({ name, date: toISODate(year, month, day), emoji });
  };

  const nth = (name: string, month: number, dow: number, n: number, emoji: string) => {
    const d = getNthWeekday(year, month, dow, n);
    h.push({ name, date: toISODate(d.getFullYear(), d.getMonth() + 1, d.getDate()), emoji });
  };

  fixed("New Year's Day",   1,  1, '🎊');
  nth('MLK Jr. Day',        1,  1, 3,   '✊');   // 3rd Mon Jan
  nth("Presidents' Day",    2,  1, 3,   '🏛️');  // 3rd Mon Feb
  nth('Memorial Day',       5,  1, -1,  '🪖');  // Last Mon May
  fixed('Juneteenth',       6, 19, '✊');
  fixed('Independence Day', 7,  4, '🎆');
  nth('Labor Day',          9,  1, 1,   '👷');   // 1st Mon Sep
  nth('Columbus Day',      10,  1, 2,   '⚓');   // 2nd Mon Oct
  fixed('Veterans Day',    11, 11, '🎖️');
  nth('Thanksgiving',      11,  4, 4,   '🦃');   // 4th Thu Nov
  fixed('Christmas Day',   12, 25, '🎄');

  return h.sort((a, b) => a.date.localeCompare(b.date));
}
