import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, X, Plus,
  ListTodo, Cake, CalendarPlus,
} from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { useTaskStore } from '../store/useTaskStore';
import type { RecurringEvent } from '../store/useTaskStore';
import { getHolidaysForYear } from '../data/usHolidays';
import { getCalendar } from '../services/connectors';
import type { CalEvent } from '../services/connectors';
import { useSettingsStore } from '../store/useSettingsStore';
import { ConnectorAccessGate } from './ui/ConnectorAccessGate';
import { useToolContextStore } from '../store/useToolContextStore';
import { usePanelResource } from '../lib/panelCache';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local (timezone-safe) ISO date string 'YYYY-MM-DD' for a Date. */
function toLocalISODate(dateObj: Date): string {
  const offset = dateObj.getTimezoneOffset() * 60000;
  return new Date(dateObj.getTime() - offset).toISOString().split('T')[0];
}

/** Add `n` days to an ISO date string, returning a new ISO date string. */
function addISODays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toLocalISODate(new Date(y, m - 1, d + n));
}

const EVENT_EMOJI: Record<RecurringEvent['type'], string> = {
  birthday: '🎂',
  anniversary: '💍',
  custom: '🎉',
};

export interface CalendarPanelProps {
  onToast: (msg: string, action?: { label: string; onClick: () => void }) => void;
}

export function CalendarPanel({ onToast }: CalendarPanelProps) {
  const tasks = useTaskStore(s => s.tasks);
  const recurringEvents = useTaskStore(s => s.recurringEvents);
  const addRecurringEvent = useTaskStore(s => s.addRecurringEvent);
  const addTask = useTaskStore(s => s.addTask);

  // Events are read/written through the connector facade, so the panel shows whichever backend the
  // user selected (local birthdays/anniversaries, or their real macOS/Google calendar).
  const calendarBackend: string = useSettingsStore(s => (s.integrations as any).calendar?.backend ?? 'local');

  // Native (EventKit) access gate: probe TCC status so we can guide first-run setup instead of just
  // showing an empty grid. Only relevant when the active backend is the native macOS calendar.
  const [calAuth, setCalAuth] = useState<string>('unknown');
  const [granting, setGranting] = useState(false);
  useEffect(() => {
    if (calendarBackend !== 'eventkit') return;
    invoke<string>('eventkit_authorization_status', { kind: 'event' }).then(setCalAuth).catch(() => setCalAuth('unknown'));
  }, [calendarBackend]);
  const needsCalendarAccess = calendarBackend === 'eventkit' && calAuth !== 'authorized' && calAuth !== 'unknown';

  // Self-contained month navigation (local UI state, decoupled from the store).
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Inline add-form state, keyed by the selected day's ISO date.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'task' | 'event'>('task');
  const [taskTitle, setTaskTitle] = useState('');
  const [evName, setEvName] = useState('');
  const [evType, setEvType] = useState<RecurringEvent['type']>('birthday');

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth(); // 0-indexed
  const monthNum = month + 1; // 1–12, matches RecurringEvent.month
  const todayISO = toLocalISODate(new Date());

  // Build the visible grid: leading blanks for the first weekday, then each day.
  const cells = useMemo(() => {
    const leading = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (Date | null)[] = Array.from({ length: leading }, () => null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(year, month, d));
    return out;
  }, [year, month]);

  const holidaysThisMonth = useMemo(
    () => getHolidaysForYear(year).filter(h => parseInt(h.date.split('-')[1], 10) === monthNum),
    [year, monthNum],
  );

  // Group active (incomplete) tasks by date for O(1) per-cell lookup. Multi-day
  // tasks (those with an `endDate` after their start) are registered on every
  // day they span.
  const tasksByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    const push = (iso: string, t: any) => {
      const list = map.get(iso);
      if (list) list.push(t);
      else map.set(iso, [t]);
    };
    for (const t of tasks) {
      if (!t || t.completed || !t.dueDate) continue;
      const end = t.endDate && t.endDate > t.dueDate ? t.endDate : t.dueDate;
      for (let iso = t.dueDate, guard = 0; iso <= end && guard < 366; iso = addISODays(iso, 1), guard++) {
        push(iso, t);
      }
    }
    return map;
  }, [tasks]);

  // Events for the visible month — state-alive and keyed per backend + month, so paging between
  // months (or reopening the tab) paints instantly from cache and revalidates in the background.
  const monthStartISO = toLocalISODate(new Date(year, month, 1));
  const monthEndISO = toLocalISODate(new Date(year, month + 1, 0));
  const { data: events = [], refresh: loadEvents } = usePanelResource<CalEvent[]>({
    key: `calendar:${calendarBackend}:${monthStartISO}:${monthEndISO}`,
    fetch: async () => {
      try {
        return await getCalendar().listEvents(monthStartISO, monthEndISO);
      } catch {
        return []; // no native access yet, etc. — degrade to empty rather than crash
      }
    },
  });
  // Local recurring-event edits should reflect immediately (they feed the local backend).
  useEffect(() => { loadEvents(); }, [loadEvents, recurringEvents]);

  // Publish the visible month to the docked agent's context.
  useEffect(() => {
    const text = events.length
      ? events.map(e => `${e.start.slice(0, 10)} — ${e.title}`).join('\n')
      : '(no events this month)';
    useToolContextStore.getState().setToolContext({ label: `Calendar — ${MONTHS[month]} ${year}`, text, source: 'calendar' });
    return () => useToolContextStore.getState().clearToolContext();
  }, [events, month, year]);

  const grantCalendarAccess = async () => {
    setGranting(true);
    try {
      const ok = await invoke<boolean>('eventkit_request_access', { kind: 'event' });
      if (ok) { setCalAuth('authorized'); await loadEvents(); } else setCalAuth('denied');
    } catch { setCalAuth('denied'); }
    finally { setGranting(false); }
  };

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const ev of events) {
      const key = ev.start.slice(0, 10);
      const list = map.get(key);
      if (list) list.push(ev);
      else map.set(key, [ev]);
    }
    return map;
  }, [events]);

  const goToMonth = (delta: number) =>
    setViewDate(new Date(year, month + delta, 1));

  const goToToday = () => {
    const now = new Date();
    setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const closeForm = () => {
    setSelectedDay(null);
    setTaskTitle('');
    setEvName('');
    setEvType('birthday');
    setFormMode('task');
  };

  const openDay = (iso: string) => {
    if (iso === selectedDay) {
      closeForm();
      return;
    }
    setSelectedDay(iso);
    setFormMode('task');
    setTaskTitle('');
    setEvName('');
    setEvType('birthday');
  };

  const submitTask = () => {
    if (!selectedDay || !taskTitle.trim()) return;
    const title = taskTitle.trim();
    addTask(title, selectedDay);
    onToast(`Added task "${title}"`);
    closeForm();
  };

  const submitEvent = async () => {
    if (!selectedDay || !evName.trim()) return;
    const name = evName.trim();
    if (calendarBackend === 'local') {
      // Local store keeps the typed birthday/anniversary/custom concept (drives emoji + Planner's
      // upcoming list). Recurring events repeat yearly, so the picked year isn't meaningful — store
      // month/day only and leave year unset (the contract makes `year` optional).
      const [, m, d] = selectedDay.split('-').map(n => parseInt(n, 10));
      addRecurringEvent({ type: evType, name, month: m, day: d });
    } else {
      // Native/cloud backends don't model our types — create a yearly all-day event titled with the
      // type emoji so it still reads as a birthday/anniversary on the device.
      await getCalendar().createEvent({
        title: `${EVENT_EMOJI[evType]} ${name}`,
        start: selectedDay,
        end: selectedDay,
        allDay: true,
        recurrence: 'yearly',
      });
      await loadEvents();
      onToast(`Added ${name} to your macOS Calendar — syncing to your devices`);
      closeForm();
      return;
    }
    onToast(`Added ${evType} for ${name}`);
    closeForm();
  };

  const selectedLabel = useMemo(() => {
    if (!selectedDay) return '';
    const [y, m, d] = selectedDay.split('-').map(n => parseInt(n, 10));
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  }, [selectedDay]);

  return (
    <div className="flex flex-col h-full bg-base text-ink overflow-hidden">
      {/* Header / month navigation */}
      <div className="shrink-0 px-4 py-3 border-b border-edge flex items-center gap-3">
        <span className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-ink-2 shrink-0">
          <CalendarDays className="w-4 h-4 text-accent" />
          Calendar
        </span>

        <div className="flex items-center gap-1 ml-auto">
          <button
            aria-label="Previous month"
            onClick={() => goToMonth(-1)}
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-wash transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="min-w-[160px] text-center text-sm font-black tracking-tight text-ink">
            {MONTHS[month]} {year}
          </h2>
          <button
            aria-label="Next month"
            onClick={() => goToMonth(1)}
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-wash transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToToday}
            className="ml-2 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-wash text-ink-2 hover:bg-inset transition-colors"
          >
            Today
          </button>
        </div>
      </div>

      {/* Grid (or the native-access gate when the macOS Calendar backend isn't authorized yet) */}
      {needsCalendarAccess ? (
        <ConnectorAccessGate
          icon={CalendarDays}
          title="Connect your macOS Calendar"
          body="Agent Forge can show and add events in your real calendar — and they sync to your iPhone via iCloud. Grant access to get started."
          buttonLabel="Grant Calendar access"
          onConnect={grantCalendarAccess}
          busy={granting}
          error={calAuth === 'denied' ? 'Access was denied. You can enable it in System Settings → Privacy & Security → Calendars (a rebuild/relaunch may be needed).' : null}
        />
      ) : (
      <div className="flex-1 overflow-y-auto no-scrollbar p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map(d => (
            <div
              key={d}
              className="text-center text-[9px] font-black uppercase tracking-widest text-ink-3 py-1.5"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((dateObj, i) => {
            if (!dateObj) {
              return (
                <div
                  key={`blank-${i}`}
                  className="min-h-[88px] rounded-xl bg-wash"
                  aria-hidden="true"
                />
              );
            }
            const iso = toLocalISODate(dateObj);
            const dayNum = dateObj.getDate();
            const isToday = iso === todayISO;
            const isSelected = iso === selectedDay;
            const dayTasks = tasksByDate.get(iso) ?? [];
            const dayEvents = eventsByDate.get(iso) ?? [];
            const dayHolidays = holidaysThisMonth.filter(h => h.date === iso);

            return (
              <button
                key={iso}
                type="button"
                onClick={() => openDay(iso)}
                aria-label={`${MONTHS[month]} ${dayNum}, ${year}`}
                aria-current={isToday ? 'date' : undefined}
                className={clsx(
                  'group min-h-[88px] p-1.5 rounded-xl border text-left flex flex-col gap-1 transition-all',
                  isSelected
                    ? 'border-accent bg-accent-soft/40'
                    : isToday
                      ? 'border-accent/50 bg-panel'
                      : 'border-edge bg-panel hover:border-edge-2',
                )}
              >
                <span
                  className={clsx(
                    'inline-flex items-center justify-center w-5 h-5 text-[11px] font-bold shrink-0',
                    isToday
                      ? 'rounded-full bg-accent text-on-accent'
                      : 'text-ink-3',
                  )}
                >
                  {dayNum}
                </span>

                <div className="flex flex-col gap-0.5 overflow-hidden">
                  {dayTasks.map(t => {
                    const isSpan = t.endDate && t.endDate > t.dueDate;
                    return (
                      <span
                        key={t.id}
                        title={isSpan ? `${t.title} (${t.dueDate} → ${t.endDate})` : t.title}
                        className={clsx(
                          'text-[9px] font-bold truncate px-1.5 py-0.5 rounded text-accent-soft-ink',
                          isSpan ? 'bg-accent-soft border-l-2 border-accent' : 'bg-accent-soft/60',
                        )}
                      >
                        {t.title}
                      </span>
                    );
                  })}
                  {dayEvents.map(ev => (
                    <span
                      key={ev.id}
                      title={ev.title}
                      className="text-[9px] font-bold truncate px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-700 dark:text-indigo-300"
                    >
                      {ev.title}
                    </span>
                  ))}
                  {dayHolidays.map(h => (
                    <span
                      key={h.name}
                      title={h.name}
                      className="text-[9px] font-bold truncate px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300"
                    >
                      {h.emoji} {h.name}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* Inline add affordance for the selected day */}
      {selectedDay && (
        <div className="shrink-0 border-t border-edge bg-inset px-4 py-3 animate-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black tracking-tight text-ink">
              {selectedLabel}
            </span>
            <button
              aria-label="Close"
              onClick={closeForm}
              className="p-1 rounded-lg text-ink-3 hover:text-ink hover:bg-wash transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 mb-3">
            <button
              type="button"
              onClick={() => setFormMode('task')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors',
                formMode === 'task'
                  ? 'bg-accent text-on-accent'
                  : 'bg-wash text-ink-3 hover:text-ink-2',
              )}
            >
              <ListTodo className="w-3.5 h-3.5" /> Task
            </button>
            <button
              type="button"
              onClick={() => setFormMode('event')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors',
                formMode === 'event'
                  ? 'bg-indigo-500 text-white'
                  : 'bg-wash text-ink-3 hover:text-ink-2',
              )}
            >
              <Cake className="w-3.5 h-3.5" /> Event
            </button>
          </div>

          {formMode === 'task' ? (
            <form
              onSubmit={e => { e.preventDefault(); submitTask(); }}
              className="flex gap-2"
            >
              <input
                type="text"
                autoFocus
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                placeholder="Add a task…"
                aria-label="Task title"
                className="flex-1 bg-panel border border-edge-2 outline-none focus:border-accent px-3 py-2 rounded-xl text-sm font-medium text-ink placeholder:text-ink-3 transition-colors"
              />
              <button
                type="submit"
                disabled={!taskTitle.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-accent disabled:opacity-40 text-on-accent font-black text-[9px] uppercase tracking-widest rounded-xl hover:bg-accent-strong transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </form>
          ) : (
            <form
              onSubmit={e => { e.preventDefault(); submitEvent(); }}
              className="flex gap-2"
            >
              <input
                type="text"
                autoFocus
                value={evName}
                onChange={e => setEvName(e.target.value)}
                placeholder="Name…"
                aria-label="Event name"
                className="flex-1 bg-panel border border-edge-2 outline-none focus:border-indigo-500 px-3 py-2 rounded-xl text-sm font-medium text-ink placeholder:text-ink-3 transition-colors"
              />
              <select
                value={evType}
                onChange={e => setEvType(e.target.value as RecurringEvent['type'])}
                aria-label="Event type"
                className="bg-panel border border-edge-2 outline-none focus:border-indigo-500 px-3 py-2 rounded-xl text-xs font-bold text-ink-2 transition-colors"
              >
                <option value="birthday">🎂 Birthday</option>
                <option value="anniversary">💍 Anniversary</option>
                <option value="custom">🎉 Custom</option>
              </select>
              <button
                type="submit"
                disabled={!evName.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500 disabled:opacity-40 text-white font-black text-[9px] uppercase tracking-widest rounded-xl hover:bg-indigo-600 transition-colors"
              >
                <CalendarPlus className="w-3.5 h-3.5" /> Add
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
