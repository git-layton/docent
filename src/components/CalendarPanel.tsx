import { useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, X, Plus,
  ListTodo, Cake, CalendarPlus,
} from 'lucide-react';
import clsx from 'clsx';
import { useTaskStore } from '../store/useTaskStore';
import type { RecurringEvent } from '../store/useTaskStore';
import { getHolidaysForYear } from '../data/usHolidays';

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

  // Group active (incomplete) tasks by their dueDate for O(1) per-cell lookup.
  const tasksByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of tasks) {
      if (!t || t.completed || !t.dueDate) continue;
      const list = map.get(t.dueDate);
      if (list) list.push(t);
      else map.set(t.dueDate, [t]);
    }
    return map;
  }, [tasks]);

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

  const submitEvent = () => {
    if (!selectedDay || !evName.trim()) return;
    const [, m, d] = selectedDay.split('-').map(n => parseInt(n, 10));
    const name = evName.trim();
    // Recurring events repeat every year, so the picked calendar year is not
    // a meaningful "birth/event year" — store month/day only and leave year
    // unset (the contract makes `year` optional).
    addRecurringEvent({ type: evType, name, month: m, day: d });
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
    <div className="flex flex-col h-full bg-[#0a0b0e] text-neutral-200 overflow-hidden">
      {/* Header / month navigation */}
      <div className="shrink-0 px-4 py-3 border-b border-white/[0.06] flex items-center gap-3">
        <span className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-neutral-300 shrink-0">
          <CalendarDays className="w-4 h-4 text-[#6A829E]" />
          Calendar
        </span>

        <div className="flex items-center gap-1 ml-auto">
          <button
            aria-label="Previous month"
            onClick={() => goToMonth(-1)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="min-w-[160px] text-center text-sm font-black tracking-tight text-neutral-100">
            {MONTHS[month]} {year}
          </h2>
          <button
            aria-label="Next month"
            onClick={() => goToMonth(1)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToToday}
            className="ml-2 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-white/[0.05] text-neutral-300 hover:bg-white/[0.1] transition-colors"
          >
            Today
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map(d => (
            <div
              key={d}
              className="text-center text-[9px] font-black uppercase tracking-widest text-neutral-500 py-1.5"
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
                  className="min-h-[88px] rounded-xl bg-[#0d0e12]/40"
                  aria-hidden="true"
                />
              );
            }
            const iso = toLocalISODate(dateObj);
            const dayNum = dateObj.getDate();
            const isToday = iso === todayISO;
            const isSelected = iso === selectedDay;
            const dayTasks = tasksByDate.get(iso) ?? [];
            const dayEvents = recurringEvents.filter(
              ev => ev.month === monthNum && ev.day === dayNum,
            );
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
                    ? 'border-[#6A829E] bg-[#6A829E]/10'
                    : isToday
                      ? 'border-[#6A829E]/50 bg-[#12141a]'
                      : 'border-white/[0.05] bg-[#12141a] hover:border-white/[0.12]',
                )}
              >
                <span
                  className={clsx(
                    'inline-flex items-center justify-center w-5 h-5 text-[11px] font-bold shrink-0',
                    isToday
                      ? 'rounded-full bg-[#6A829E] text-white'
                      : 'text-neutral-400',
                  )}
                >
                  {dayNum}
                </span>

                <div className="flex flex-col gap-0.5 overflow-hidden">
                  {dayTasks.map(t => (
                    <span
                      key={t.id}
                      title={t.title}
                      className="text-[9px] font-bold truncate px-1.5 py-0.5 rounded bg-[#6A829E]/25 text-[#C5D3E0]"
                    >
                      {t.title}
                    </span>
                  ))}
                  {dayEvents.map(ev => (
                    <span
                      key={ev.id}
                      title={ev.name}
                      className="text-[9px] font-bold truncate px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300"
                    >
                      {EVENT_EMOJI[ev.type]} {ev.name.split(' ')[0]}
                    </span>
                  ))}
                  {dayHolidays.map(h => (
                    <span
                      key={h.name}
                      title={h.name}
                      className="text-[9px] font-bold truncate px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300"
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

      {/* Inline add affordance for the selected day */}
      {selectedDay && (
        <div className="shrink-0 border-t border-white/[0.06] bg-[#0d0e12] px-4 py-3 animate-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black tracking-tight text-neutral-100">
              {selectedLabel}
            </span>
            <button
              aria-label="Close"
              onClick={closeForm}
              className="p-1 rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.06] transition-colors"
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
                  ? 'bg-[#6A829E] text-white'
                  : 'bg-white/[0.05] text-neutral-400 hover:text-neutral-200',
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
                  : 'bg-white/[0.05] text-neutral-400 hover:text-neutral-200',
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
                className="flex-1 bg-[#12141a] border border-white/[0.08] outline-none focus:border-[#6A829E] px-3 py-2 rounded-xl text-sm font-medium text-neutral-100 placeholder:text-neutral-500 transition-colors"
              />
              <button
                type="submit"
                disabled={!taskTitle.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#6A829E] disabled:opacity-40 text-white font-black text-[9px] uppercase tracking-widest rounded-xl hover:bg-[#5a708a] transition-colors"
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
                className="flex-1 bg-[#12141a] border border-white/[0.08] outline-none focus:border-indigo-500 px-3 py-2 rounded-xl text-sm font-medium text-neutral-100 placeholder:text-neutral-500 transition-colors"
              />
              <select
                value={evType}
                onChange={e => setEvType(e.target.value as RecurringEvent['type'])}
                aria-label="Event type"
                className="bg-[#12141a] border border-white/[0.08] outline-none focus:border-indigo-500 px-3 py-2 rounded-xl text-xs font-bold text-neutral-300 transition-colors"
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
