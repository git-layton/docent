import { useState, useMemo } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, Circle, Plus, RotateCw, Trash2, Zap } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { usePanelResource } from '../lib/panelCache';
import { useToolContextStore } from '../store/useToolContextStore';
import { getTasks } from '../services/connectors';
import type { TaskItem } from '../services/connectors';
import { toLocalISODate, addISODays, formatTime, formatDuration, computeFreeMinutes, capacityHint, MONTHS, WEEKDAYS, CalEventSlice } from '../lib/dates';

type CalEvent = { title: string; start: number; end: number; allDay: boolean; location: string; calendar: string };

const WORK_START_HOUR = 8;
const WORK_END_HOUR = 18;

function dayBounds(iso: string): { startMs: number; endMs: number } {
  const [y, m, d] = iso.split('-').map(Number);
  const start = new Date(y, m - 1, d, WORK_START_HOUR, 0, 0, 0);
  const end   = new Date(y, m - 1, d, WORK_END_HOUR,   0, 0, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function formatDayHeading(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
  const weekday = WEEKDAYS[date.getDay()];
  const month   = MONTHS[date.getMonth()];
  const label   = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : weekday;
  return `${label} · ${month} ${d}`;
}

export function DayPanel() {
  const [viewIso, setViewIso] = useState(() => toLocalISODate(new Date()));
  const [newTask, setNewTask] = useState('');
  const todayStr = toLocalISODate(new Date());

  const tasks = useTaskStore(s => s.tasks);
  const calendarBackend: string = useSettingsStore(s => (s.integrations as any).calendar?.backend ?? 'local');
  const tasksBackend: string    = useSettingsStore(s => (s.integrations as any).tasks?.backend ?? 'local');
  const eventkitTasksActive = tasksBackend === 'eventkit';

  // Native Reminders
  const { data: nativeItems = [], refresh: reloadNative } = usePanelResource<TaskItem[]>({
    key: 'tasks:eventkit',
    fetch: async () => { try { return await getTasks().listTasks(); } catch { return []; } },
    enabled: eventkitTasksActive,
  });

  // Calendar events for the viewed day (±1h buffer so events straddling midnight show)
  const { startMs, endMs } = dayBounds(viewIso);
  const bufferMs = 60 * 60_000;
  const { data: calEvents = [], loading: evLoading, refresh: reloadEvents } = usePanelResource<CalEvent[]>({
    key: `day:events:${viewIso}:${calendarBackend}`,
    fetch: () => calendarBackend === 'eventkit'
      ? invoke<CalEvent[]>('eventkit_list_events', { startMs: startMs - bufferMs, endMs: endMs + bufferMs })
      : Promise.resolve([]),
    enabled: calendarBackend === 'eventkit',
  });

  const displayTasks: any[] = eventkitTasksActive ? nativeItems : tasks;

  // Tasks due today or undated (the fluid queue for this day)
  const todayTasks = useMemo(() =>
    displayTasks.filter((t: any) => !t.completed && (!t.dueDate || t.dueDate === viewIso)),
  [displayTasks, viewIso]);

  // Events sorted by start time, filtered to the viewed day
  const todayEvents = useMemo(() =>
    calEvents
      .filter(e => {
        if (e.allDay) return true; // include all-day events
        return e.start < endMs + bufferMs && e.end > startMs - bufferMs;
      })
      .sort((a, b) => a.start - b.start),
  [calEvents, startMs, endMs, bufferMs]);

  // Capacity math (pure)
  const freeMinutes = useMemo(() => {
    const slices: CalEventSlice[] = todayEvents.map(e => ({ title: e.title, startMs: e.start, endMs: e.end, allDay: e.allDay }));
    return computeFreeMinutes(slices, startMs, endMs);
  }, [todayEvents, startMs, endMs]);

  const hint = useMemo(() => capacityHint(freeMinutes, todayTasks.length), [freeMinutes, todayTasks.length]);

  // Publish to docked agent context
  useMemo(() => {
    const text = [
      `Day: ${formatDayHeading(viewIso)}`,
      todayEvents.length ? `Events:\n${todayEvents.map(e => `- ${e.allDay ? 'All day' : `${formatTime(e.start)}–${formatTime(e.end)}`}: ${e.title}`).join('\n')}` : 'No events.',
      todayTasks.length ? `Tasks:\n${todayTasks.map((t: any) => `- ${t.title}`).join('\n')}` : 'No tasks.',
      hint,
    ].join('\n\n');
    useToolContextStore.getState().setToolContext({ label: `Day: ${viewIso}`, text, source: 'tasks' });
  }, [viewIso, todayEvents, todayTasks, hint]);

  const addTask = (title: string) => {
    if (!title.trim()) return;
    if (eventkitTasksActive) {
      getTasks().createTask({ title: title.trim(), dueDate: viewIso }).then(reloadNative).catch(() => {});
    } else {
      useTaskStore.getState().addTask(title.trim(), viewIso);
    }
    setNewTask('');
  };

  const toggleTask = (id: string, completed: boolean) => {
    if (eventkitTasksActive) getTasks().setCompleted(id, !completed).then(reloadNative).catch(() => {});
    else useTaskStore.getState().toggleTask(id);
  };

  const deleteTask = (id: string) => {
    if (eventkitTasksActive) getTasks().deleteTask(id).then(reloadNative).catch(() => {});
    else useTaskStore.getState().deleteTask(id);
  };

  const isToday = viewIso === todayStr;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
      {/* ── Header ── */}
      <div className="h-12 flex items-center gap-3 px-4 border-b border-edge shrink-0">
        <CalendarDays className="w-4 h-4 text-ink-3" />
        <span className="text-sm font-semibold text-ink truncate">{formatDayHeading(viewIso)}</span>
        <div className="flex-1" />
        <button onClick={() => setViewIso(v => addISODays(v, -1))} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Previous day">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {!isToday && (
          <button onClick={() => setViewIso(todayStr)} className="px-2.5 py-1 rounded-lg text-xs font-semibold text-accent bg-accent-soft hover:bg-accent hover:text-on-accent transition-colors">
            Today
          </button>
        )}
        <button onClick={() => setViewIso(v => addISODays(v, 1))} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Next day">
          <ChevronRight className="w-4 h-4" />
        </button>
        <button onClick={() => { reloadEvents(); }} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Refresh">
          <RotateCw className={clsx('w-3.5 h-3.5', evLoading && 'animate-spin')} />
        </button>
      </div>

      {/* ── Capacity hint ── */}
      <div className="px-4 py-2 border-b border-edge shrink-0 flex items-center gap-2">
        <Zap className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="text-xs text-ink-2">{hint}</span>
        {freeMinutes > 0 && (
          <span className="ml-auto text-xs text-ink-3">{formatDuration(freeMinutes)} free</span>
        )}
      </div>

      {/* ── Main two-column body ── */}
      <div className="flex-1 overflow-hidden flex gap-0">

        {/* Left: Calendar events */}
        <div className="w-1/2 border-r border-edge flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-3 border-b border-edge shrink-0">
            Events
          </div>
          <div className="flex-1 overflow-y-auto">
            {calendarBackend !== 'eventkit' ? (
              <div className="p-4 text-xs text-ink-3">Connect macOS Calendar in Settings → Integrations to see events here.</div>
            ) : evLoading && todayEvents.length === 0 ? (
              <div className="p-4 flex items-center gap-2 text-ink-3 text-xs"><RotateCw className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
            ) : todayEvents.length === 0 ? (
              <div className="p-4 text-xs text-ink-3">No events today.</div>
            ) : (
              <div className="divide-y divide-edge">
                {todayEvents.map((ev, i) => (
                  <div key={i} className="px-4 py-3 flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-ink truncate">{ev.title}</span>
                    <span className="text-xs text-ink-3">
                      {ev.allDay ? 'All day' : `${formatTime(ev.start)} – ${formatTime(ev.end)}`}
                    </span>
                    {ev.location ? <span className="text-xs text-ink-3 truncate">{ev.location}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Task queue */}
        <div className="w-1/2 flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-3 border-b border-edge shrink-0 flex items-center gap-2">
            Tasks
            <span className="ml-auto text-ink-3 font-normal">{todayTasks.length} open</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-edge">
            {todayTasks.length === 0 ? (
              <div className="p-4 text-xs text-ink-3">No tasks for this day.</div>
            ) : (
              todayTasks.map((t: any) => (
                <div key={t.id} className="group px-4 py-3 flex items-start gap-3 hover:bg-wash transition-colors">
                  <button
                    onClick={() => toggleTask(t.id, t.completed)}
                    className="mt-0.5 shrink-0 text-ink-3 hover:text-accent transition-colors"
                    title="Mark complete"
                  >
                    {t.completed ? <CheckCircle2 className="w-4 h-4 text-accent" /> : <Circle className="w-4 h-4" />}
                  </button>
                  <span className={clsx('flex-1 text-sm leading-snug', t.completed && 'line-through text-ink-3')}>
                    {t.title}
                  </span>
                  <button
                    onClick={() => deleteTask(t.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-ink-3 hover:text-danger transition-all"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Quick add */}
          <div className="shrink-0 border-t border-edge p-3">
            <form
              onSubmit={e => { e.preventDefault(); addTask(newTask); }}
              className="flex items-center gap-2"
            >
              <Plus className="w-3.5 h-3.5 text-ink-3 shrink-0" />
              <input
                value={newTask}
                onChange={e => setNewTask(e.target.value)}
                placeholder="Add task for this day…"
                className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
              />
              {newTask.trim() && (
                <button type="submit" className="text-xs font-semibold text-accent hover:underline shrink-0">Add</button>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
