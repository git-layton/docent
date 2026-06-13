import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  ListTodo, LayoutList, CalendarDays, ChevronLeft, ChevronRight,
  GripVertical, Circle, Clock, MapPin, MessageSquare, Trash2,
  AlignLeft, CheckCircle2, X, ChevronRight as ChevronRightIcon,
  Cake, Plus
} from 'lucide-react';
import { AgentIcon } from './ui/AgentIcon';
import { useTaskStore, taskCoversDate } from '../store/useTaskStore';
import type { RecurringEvent } from '../store/useTaskStore';
import { useAgentStore } from '../store/useAgentStore';
import { useUIStore } from '../store/useUIStore';
import { useChatStore } from '../store/useChatStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { getTasks } from '../services/connectors';
import type { TaskItem } from '../services/connectors';
import { getHolidaysForYear } from '../data/usHolidays';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const toLocalISODate = (dateObj: Date) => {
  if (!dateObj) return null;
  const offset = dateObj.getTimezoneOffset() * 60000;
  return new Date(dateObj.getTime() - offset).toISOString().split('T')[0];
};

function formatCompletedAt(ms: number): string {
  const d = new Date(ms);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function upcomingEvents(
  recurringEvents: RecurringEvent[],
  windowDays = 7
): { label: string; date: string; emoji: string }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result: { label: string; date: string; emoji: string }[] = [];

  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const ds = toLocalISODate(d) as string;

    // Birthdays / anniversaries
    for (const ev of recurringEvents) {
      if (ev.month === m && ev.day === day) {
        const label = ev.type === 'birthday'
          ? `Wish ${ev.name} a happy birthday!`
          : ev.type === 'anniversary'
          ? `Happy anniversary, ${ev.name}!`
          : ev.name;
        result.push({ label, date: ds, emoji: ev.type === 'birthday' ? '🎂' : ev.type === 'anniversary' ? '💍' : '🎉' });
      }
    }

    // Holidays
    for (const h of getHolidaysForYear(d.getFullYear())) {
      if (h.date === ds) {
        result.push({ label: `Happy ${h.name}!`, date: ds, emoji: h.emoji });
      }
    }
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

interface PlannerPanelProps {
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetId?: string | null) => void;
}

export function PlannerPanel({ onDragStart, onDragOver, onDrop }: PlannerPanelProps) {
  const tasks = useTaskStore(s => s.tasks);
  const recurringEvents = useTaskStore(s => s.recurringEvents);
  const newTaskInput = useTaskStore(s => s.newTaskInput);
  const newTaskDate = useTaskStore(s => s.newTaskDate);
  const newTaskDetails = useTaskStore(s => s.newTaskDetails);
  const newTaskLocation = useTaskStore(s => s.newTaskLocation);
  const showTaskDetailsForm = useTaskStore(s => s.showTaskDetailsForm);
  const taskToDiscuss = useTaskStore(s => s.taskToDiscuss);
  const draggedTaskId = useTaskStore(s => s.draggedTaskId);
  const plannerView = useTaskStore(s => s.plannerView);
  const currentMonthDate = useTaskStore(s => s.currentMonthDate);
  const assistants = useAgentStore(s => s.assistants);

  const { setNewTaskInput, setNewTaskDate, setNewTaskDetails, setNewTaskLocation,
    setShowTaskDetailsForm, setTaskToDiscuss, setDraggedTaskId,
    setPlannerView, setCurrentMonthDate, setShowPlanner } = useTaskStore.getState();
  const { toggleTask, deleteTask, addTask, addRecurringEvent, deleteRecurringEvent } = useTaskStore.getState();
  const { setActiveFolderId } = useAgentStore.getState();
  const { setInput, setViewMode } = useUIStore.getState();
  const { setActiveChatId } = useChatStore.getState();

  // Tasks flow through the connector so the planner shows whichever backend is active. For 'local'
  // this wraps useTaskStore (behavior-preserving); for 'eventkit' it shows the real Reminders app.
  const tasksBackend = useSettingsStore(s => (s.integrations as any).tasks?.backend ?? 'local');
  const eventkitTasksActive = tasksBackend === 'eventkit';
  const [nativeItems, setNativeItems] = useState<TaskItem[]>([]);
  const loadNativeTasks = useCallback(async () => {
    try { setNativeItems(await getTasks().listTasks()); } catch { setNativeItems([]); }
  }, []);
  useEffect(() => { if (eventkitTasksActive) loadNativeTasks(); }, [eventkitTasksActive, loadNativeTasks]);

  // Unified source + mutation wrappers — local uses the reactive store, native re-reads after writes.
  const displayTasks: any[] = eventkitTasksActive ? nativeItems : tasks;
  const onToggle = (id: string, completed: boolean) => {
    if (eventkitTasksActive) getTasks().setCompleted(id, !completed).then(loadNativeTasks).catch(() => {});
    else toggleTask(id);
  };
  const onDelete = (id: string) => {
    if (eventkitTasksActive) getTasks().deleteTask(id).then(loadNativeTasks).catch(() => {});
    else deleteTask(id);
  };
  const onAddTask = (title: string, dueDate: string | null, details = '', location = '') => {
    if (eventkitTasksActive) getTasks().createTask({ title, dueDate: dueDate ?? undefined, details, location }).then(loadNativeTasks).catch(() => {});
    else addTask(title, dueDate, details, location);
  };

  // Day-detail panel state
  const [selectedDayDetail, setSelectedDayDetail] = useState<string | null>(null);

  // Birthday/event quick-add form state
  const [showEventForm, setShowEventForm] = useState(false);
  const [evName, setEvName] = useState('');
  const [evMonth, setEvMonth] = useState(new Date().getMonth() + 1);
  const [evDay, setEvDay] = useState(1);
  const [evYear, setEvYear] = useState('');
  const [evType, setEvType] = useState<RecurringEvent['type']>('birthday');

  const calendarYear = currentMonthDate.getFullYear();
  const calendarMonth = currentMonthDate.getMonth() + 1; // 1-12

  const calendarDays = useMemo(() => {
    const year = currentMonthDate.getFullYear(), month = currentMonthDate.getMonth();
    const days: (Date | null)[] = Array(new Date(year, month, 1).getDay()).fill(null);
    for (let i = 1; i <= new Date(year, month + 1, 0).getDate(); i++) days.push(new Date(year, month, i));
    return days;
  }, [currentMonthDate]);

  const holidaysThisMonth = useMemo(() =>
    getHolidaysForYear(calendarYear).filter(h => {
      const hMonth = parseInt(h.date.split('-')[1]);
      return hMonth === calendarMonth;
    }),
  [calendarYear, calendarMonth]);

  const upcoming = useMemo(() => upcomingEvents(recurringEvents), [recurringEvents]);

  const handleManualTaskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskInput.trim()) return;
    onAddTask(newTaskInput, newTaskDate || null, newTaskDetails, newTaskLocation);
    setNewTaskInput(''); setNewTaskDate(''); setNewTaskDetails(''); setNewTaskLocation(''); setShowTaskDetailsForm(false);
  };

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!evName.trim()) return;
    addRecurringEvent({
      type: evType,
      name: evName.trim(),
      month: evMonth,
      day: evDay,
      year: evYear ? parseInt(evYear) : undefined,
    });
    setEvName(''); setEvMonth(new Date().getMonth() + 1); setEvDay(1); setEvYear(''); setEvType('birthday');
    setShowEventForm(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-panel no-scrollbar relative">

      {/* Task Discuss Bot Selector Modal */}
      {taskToDiscuss && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
           <div className="bg-panel-2 w-full max-w-sm rounded-2xl shadow-xl p-5 border border-edge">
              <div className="flex justify-between items-center mb-4">
                 <h3 className="text-sm font-black uppercase tracking-widest text-accent">Ask which Agent?</h3>
                 <button onClick={() => setTaskToDiscuss(null)} className="text-ink-3 hover:text-ink-2"><X className="w-4 h-4"/></button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                 {assistants.map(a => (
                    <button key={a.id} onClick={() => {
                        setActiveFolderId(a.id);
                        setInput(`I need help with this task: ${taskToDiscuss.title}${taskToDiscuss.details ? `\nDetails: ${taskToDiscuss.details}` : ''}`);
                        setShowPlanner(false);
                        setViewMode('chat');
                        setActiveChatId(null);
                        setTaskToDiscuss(null);
                    }} className="w-full flex items-center gap-3 p-3 rounded-xl border border-edge hover:bg-wash transition-all text-left">
                        <AgentIcon agent={a} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm" />
                        <span className="text-sm font-bold text-ink flex-1">{a.name}</span>
                        <ChevronRightIcon className="w-4 h-4 text-ink-3" />
                    </button>
                 ))}
              </div>
           </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto space-y-8">
        <div className="bg-panel-2 p-6 rounded-3xl border border-edge shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-black tracking-tight flex items-center gap-2"><ListTodo className="w-5 h-5 text-accent" /> Agenda</h2>
            <div className="flex bg-inset p-1 rounded-lg">
              <button onClick={() => setPlannerView('list')} className={`p-1.5 rounded-md transition-all ${plannerView === 'list' ? 'bg-panel shadow-sm text-accent' : 'text-ink-3'}`}><LayoutList className="w-4 h-4" /></button>
              <button onClick={() => setPlannerView('calendar')} className={`p-1.5 rounded-md transition-all ${plannerView === 'calendar' ? 'bg-panel shadow-sm text-accent' : 'text-ink-3'}`}><CalendarDays className="w-4 h-4" /></button>
            </div>
          </div>

          {plannerView === 'calendar' ? (
            <div className="animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between mb-4 px-2">
                <button onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1))} className="p-2 hover:bg-wash rounded-full"><ChevronLeft className="w-5 h-5" /></button>
                <span className="text-sm font-black uppercase tracking-widest">{MONTHS[currentMonthDate.getMonth()]} {currentMonthDate.getFullYear()}</span>
                <button onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1))} className="p-2 hover:bg-wash rounded-full"><ChevronRight className="w-5 h-5" /></button>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="text-center text-[10px] font-black uppercase tracking-widest text-ink-3 py-2">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((dateObj, i) => {
                  if (!dateObj) return <div key={`empty-${i}`} className="min-h-[80px] bg-wash rounded-xl" />;
                  const ds = toLocalISODate(dateObj) as string;
                  const isToday = ds === toLocalISODate(new Date());
                  const isSelected = ds === newTaskDate;
                  const dayTasks = displayTasks.filter(t => !t.completed && taskCoversDate(t, ds));
                  const dayBirthdays = recurringEvents.filter(ev => ev.month === calendarMonth && ev.day === dateObj.getDate());
                  const dayHolidays = holidaysThisMonth.filter(h => h.date === ds);
                  return (
                    <div key={ds} onClick={() => { setNewTaskDate(ds); setSelectedDayDetail(ds === selectedDayDetail ? null : ds); }} className={`min-h-[80px] p-2 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 ${isSelected ? 'border-accent bg-accent-soft/40' : isToday ? 'border-edge-2' : 'border-edge hover:border-accent/50'}`}>
                      <span className={`text-xs font-bold ${isToday ? 'text-accent' : 'text-ink-3'}`}>{dateObj.getDate()}</span>
                      {dayTasks.map(t => <div key={t.id} className="text-[9px] font-bold truncate bg-accent-soft text-accent-soft-ink px-1.5 py-0.5 rounded" title={t.title}>{t.title}</div>)}
                      {dayHolidays.map(h => <div key={h.date + h.name} className="text-[9px] font-bold truncate bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded" title={h.name}>{h.emoji} {h.name}</div>)}
                      {dayBirthdays.map(ev => <div key={ev.id} className="text-[9px] font-bold truncate bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded" title={ev.name}>🎂 {ev.name.split(' ')[0]}</div>)}
                    </div>
                  );
                })}
              </div>

              {/* Day-detail panel */}
              {selectedDayDetail && (() => {
                const [yyyy, mm, dd] = selectedDayDetail.split('-');
                const monthNum = parseInt(mm);
                const dayNum = parseInt(dd);
                const detailDate = new Date(parseInt(yyyy), monthNum - 1, dayNum);
                const detailTasks = displayTasks.filter(t => taskCoversDate(t, selectedDayDetail));
                const detailHolidays = holidaysThisMonth.filter(h => h.date === selectedDayDetail);
                const detailBirthdays = recurringEvents.filter(ev => ev.month === monthNum && ev.day === dayNum);
                return (
                  <div className="mt-4 p-4 rounded-2xl border border-edge bg-inset animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-black text-accent">
                        {detailDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                      </h3>
                      <button onClick={() => setSelectedDayDetail(null)} className="text-ink-3 hover:text-ink-2"><X className="w-4 h-4"/></button>
                    </div>
                    {detailHolidays.map(h => (
                      <div key={h.name} className="flex items-center gap-2 px-3 py-2 mb-1 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800">
                        <span>{h.emoji}</span>
                        <span className="text-sm font-bold text-rose-700 dark:text-rose-300">Happy {h.name}!</span>
                      </div>
                    ))}
                    {detailBirthdays.map(ev => (
                      <div key={ev.id} className="flex items-center gap-2 px-3 py-2 mb-1 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
                        <span>{ev.type === 'birthday' ? '🎂' : ev.type === 'anniversary' ? '💍' : '🎉'}</span>
                        <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">
                          {ev.type === 'birthday' ? `Happy Birthday, ${ev.name}!` : ev.type === 'anniversary' ? `Happy Anniversary, ${ev.name}!` : ev.name}
                        </span>
                      </div>
                    ))}
                    {detailTasks.length === 0 && detailHolidays.length === 0 && detailBirthdays.length === 0 && (
                      <p className="text-xs text-ink-3 text-center py-2">Nothing scheduled</p>
                    )}
                    {detailTasks.map(task => (
                      <div key={task.id} className="flex items-center gap-2 px-3 py-2 mb-1 rounded-xl border border-edge hover:bg-wash transition-all">
                        <button onClick={() => onToggle(task.id, task.completed)} className={`shrink-0 ${task.completed ? 'text-accent' : 'text-ink-3 hover:text-accent'} transition-colors`}>
                          {task.completed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                        </button>
                        <span className={`text-sm font-bold flex-1 ${task.completed ? 'line-through text-ink-3' : 'text-ink'}`}>{task.title}</span>
                        <button onClick={() => onDelete(task.id)} className="text-ink-3 hover:text-danger transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      if (!newTaskInput.trim()) return;
                      onAddTask(newTaskInput, selectedDayDetail, newTaskDetails, newTaskLocation);
                      setNewTaskInput('');
                      setNewTaskDetails('');
                      setNewTaskLocation('');
                    }} className="flex gap-2 mt-3">
                      <input
                        type="text"
                        value={newTaskInput}
                        onChange={e => setNewTaskInput(e.target.value)}
                        placeholder={`Add task for ${detailDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}...`}
                        className="flex-1 bg-panel border border-edge outline-none px-3 py-2 rounded-xl text-sm font-medium"
                      />
                      <button type="submit" disabled={!newTaskInput.trim()} className="px-4 py-2 bg-accent disabled:opacity-50 text-on-accent font-black text-xs uppercase tracking-widest rounded-xl hover:bg-accent-strong transition-all">Add</button>
                    </form>
                  </div>
                );
              })()}

              {/* Upcoming Events in calendar view */}
              {upcoming.length > 0 && (
                <div className="mt-4 space-y-1">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-ink-3 px-1 mb-2">Upcoming 7 Days</h3>
                  {upcoming.map((ev, idx) => {
                    const [, mm, dd] = ev.date.split('-');
                    const dateLabel = `${MONTH_NAMES[parseInt(mm) - 1]} ${parseInt(dd)}`;
                    const isToday = ev.date === toLocalISODate(new Date());
                    return (
                      <div key={idx} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-inset border border-edge">
                        <span className="text-sm shrink-0">{ev.emoji}</span>
                        <span className="text-xs font-bold text-ink-2 flex-1">{ev.label}</span>
                        <span className={`text-[10px] font-black uppercase tracking-widest shrink-0 ${isToday ? 'text-accent' : 'text-ink-3'}`}>{isToday ? 'Today' : dateLabel}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 animate-in fade-in duration-200">
              {/* ── Upcoming Events ── */}
              {upcoming.length > 0 && (
                <div className="space-y-1.5 mb-4">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-ink-3 px-1 mb-2">Upcoming Events</h3>
                  {upcoming.map((ev, idx) => {
                    const [, mm, dd] = ev.date.split('-');
                    const dateLabel = `${MONTH_NAMES[parseInt(mm) - 1]} ${parseInt(dd)}`;
                    const isToday = ev.date === toLocalISODate(new Date());
                    return (
                      <div key={idx} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-inset border border-edge">
                        <span className="text-base shrink-0">{ev.emoji}</span>
                        <span className="text-sm font-bold text-ink flex-1">{ev.label}</span>
                        <span className={`text-[10px] font-black uppercase tracking-widest shrink-0 ${isToday ? 'text-accent' : 'text-ink-3'}`}>{isToday ? 'Today' : dateLabel}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Pending Tasks ── */}
              {displayTasks.filter(t => !t.completed).length === 0 ? (
                <div className="text-center py-6 text-ink-3 text-sm font-bold">No pending tasks — you're clear!</div>
              ) : displayTasks.filter(t => !t.completed).map(task => (
                <div key={task.id}
                     draggable
                     onDragStart={(e) => onDragStart(e, task.id)}
                     onDragOver={onDragOver}
                     onDrop={(e) => onDrop(e, task.id)}
                     onDragEnd={() => setDraggedTaskId(null)}
                     className={`flex items-start justify-between group p-3 hover:bg-wash rounded-xl border transition-all ${draggedTaskId === task.id ? 'opacity-50 border-accent bg-wash' : 'border-transparent hover:border-edge'}`}>
                  <div className="flex items-start gap-3 mt-1">
                    <div className="cursor-grab text-ink-3 hover:text-ink-2 mt-1 flex shrink-0" title="Drag to reorder"><GripVertical className="w-4 h-4" /></div>
                    <button onClick={() => onToggle(task.id, task.completed)} className="text-ink-3 hover:text-accent transition-colors mt-0.5"><Circle className="w-5 h-5" /></button>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-ink">{task.title}</span>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {task.dueDate    && <span className="text-[10px] font-black uppercase text-accent tracking-wider flex items-center gap-1"><Clock className="w-3 h-3" /> {task.dueDate}{task.endDate && task.endDate > task.dueDate ? ` → ${task.endDate}` : ''}</span>}
                        {task.location  && <span className="text-[10px] font-bold text-success flex items-center gap-1"><MapPin className="w-3 h-3" /> {task.location}</span>}
                      </div>
                      {task.details && <p className="text-xs text-ink-2 mt-1.5 max-w-xl bg-inset p-2 rounded-lg">{task.details}</p>}
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 flex items-center transition-all">
                    <button onClick={() => setTaskToDiscuss(task)} className="p-2 text-ink-3 hover:text-accent transition-all" title="Get Help"><MessageSquare className="w-4 h-4" /></button>
                    <button onClick={() => onDelete(task.id)} className="p-2 text-ink-3 hover:text-danger transition-all" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Add Task Form ── */}
          <div className="mt-auto pt-6 border-t border-edge space-y-3">
            <form onSubmit={handleManualTaskSubmit} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input type="text" value={newTaskInput} onChange={e => setNewTaskInput(e.target.value)} placeholder="Add new task..." className="flex-1 bg-inset border-none outline-none px-4 py-3 rounded-xl text-sm font-medium" />
                <input type="date" value={newTaskDate} onChange={e => setNewTaskDate(e.target.value)} className="bg-inset border-none outline-none px-3 py-3 rounded-xl text-xs font-bold text-ink-2" />
                <button type="button" onClick={() => setShowTaskDetailsForm(!showTaskDetailsForm)} className={`p-3 rounded-xl transition-all ${showTaskDetailsForm ? 'bg-accent-soft text-accent-soft-ink' : 'bg-inset text-ink-3 hover:bg-wash'}`}><AlignLeft className="w-4 h-4" /></button>
                <button type="submit" disabled={!newTaskInput.trim()} className="px-6 py-3 bg-accent disabled:opacity-50 text-on-accent font-black text-xs uppercase tracking-widest rounded-xl hover:bg-accent-strong transition-all">Add</button>
              </div>
              {showTaskDetailsForm && (
                <div className="flex gap-2 animate-in slide-in-from-top-2">
                  <div className="flex items-center bg-inset rounded-xl px-3 w-1/3"><MapPin className="w-4 h-4 text-ink-3 shrink-0" /><input type="text" value={newTaskLocation} onChange={e => setNewTaskLocation(e.target.value)} placeholder="Location..." className="w-full bg-transparent border-none outline-none p-2 text-xs font-medium" /></div>
                  <div className="flex items-center bg-inset rounded-xl px-3 flex-1"><AlignLeft className="w-4 h-4 text-ink-3 shrink-0" /><input type="text" value={newTaskDetails} onChange={e => setNewTaskDetails(e.target.value)} placeholder="Notes..." className="w-full bg-transparent border-none outline-none p-2 text-xs font-medium" /></div>
                </div>
              )}
            </form>

            {/* ── Quick-Add Birthday / Event ── */}
            <div>
              <button
                type="button"
                onClick={() => setShowEventForm(v => !v)}
                className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all ${showEventForm ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-ink-3 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'}`}
              >
                <Cake className="w-3.5 h-3.5" />
                {showEventForm ? 'Cancel' : '+ Birthday / Event'}
              </button>

              {showEventForm && (
                <form onSubmit={handleAddEvent} className="mt-3 p-4 bg-inset rounded-2xl border border-edge space-y-3 animate-in slide-in-from-top-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={evName}
                      onChange={e => setEvName(e.target.value)}
                      placeholder="Full name..."
                      required
                      className="flex-1 bg-panel border border-edge outline-none px-3 py-2 rounded-xl text-sm font-medium"
                    />
                    <select
                      value={evType}
                      onChange={e => setEvType(e.target.value as RecurringEvent['type'])}
                      className="bg-panel border border-edge outline-none px-3 py-2 rounded-xl text-xs font-bold text-ink-2"
                    >
                      <option value="birthday">🎂 Birthday</option>
                      <option value="anniversary">💍 Anniversary</option>
                      <option value="custom">🎉 Custom</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={evMonth}
                      onChange={e => setEvMonth(parseInt(e.target.value))}
                      className="flex-1 bg-panel border border-edge outline-none px-3 py-2 rounded-xl text-xs font-bold text-ink-2"
                    >
                      {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                    <input
                      type="number"
                      min={1} max={31}
                      value={evDay}
                      onChange={e => setEvDay(parseInt(e.target.value))}
                      placeholder="Day"
                      className="w-20 bg-panel border border-edge outline-none px-3 py-2 rounded-xl text-xs font-bold text-ink-2"
                    />
                    <input
                      type="number"
                      min={1900} max={2099}
                      value={evYear}
                      onChange={e => setEvYear(e.target.value)}
                      placeholder="Year (optional)"
                      className="w-32 bg-panel border border-edge outline-none px-3 py-2 rounded-xl text-xs font-bold text-ink-2"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!evName.trim()}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    <Plus className="w-3.5 h-3.5" /> Save Event
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

        {/* ── Completed Tasks ── */}
        {displayTasks.filter(t => t.completed).length > 0 && (
          <div className="opacity-60 hover:opacity-100 transition-all">
            <h3 className="text-xs font-black uppercase tracking-widest mb-4 px-2 text-ink-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Completed</h3>
            {displayTasks.filter(t => t.completed).map(task => (
              <div key={task.id} className="flex items-center justify-between p-2 px-4 bg-wash rounded-lg mb-2 group">
                <div className="flex items-center gap-3">
                  <button onClick={() => onToggle(task.id, task.completed)} className="text-success"><CheckCircle2 className="w-4 h-4" /></button>
                  <span className="text-sm font-medium line-through text-ink-2">{task.title}</span>
                  {task.completedAt && (
                    <span className="text-[9px] font-bold text-ink-3 uppercase tracking-wide">Done {formatCompletedAt(task.completedAt)}</span>
                  )}
                </div>
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={() => { setInput(`I need help with this completed task: ${task.title}${task.details ? `\nDetails: ${task.details}` : ''}`); setShowPlanner(false); setViewMode('chat'); }} className="p-2 text-ink-3 hover:text-accent transition-all" title="Get Help"><MessageSquare className="w-3.5 h-3.5" /></button>
                  <button onClick={() => onDelete(task.id)} className="p-2 text-ink-3 hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Recurring Events Management ── */}
        {recurringEvents.length > 0 && (
          <div className="opacity-60 hover:opacity-100 transition-all">
            <h3 className="text-xs font-black uppercase tracking-widest mb-4 px-2 text-ink-2 flex items-center gap-2"><Cake className="w-4 h-4" /> Birthdays & Events</h3>
            {recurringEvents.map(ev => (
              <div key={ev.id} className="flex items-center justify-between p-2 px-4 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/20 rounded-lg mb-2 group">
                <div className="flex items-center gap-3">
                  <span className="text-sm">{ev.type === 'birthday' ? '🎂' : ev.type === 'anniversary' ? '💍' : '🎉'}</span>
                  <span className="text-sm font-bold text-ink">{ev.name}</span>
                  <span className="text-[10px] font-black text-ink-3 uppercase tracking-wide">{MONTHS[ev.month - 1]} {ev.day}{ev.year ? `, ${ev.year}` : ''}</span>
                </div>
                <button onClick={() => deleteRecurringEvent(ev.id)} className="p-2 text-ink-3 hover:text-danger opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
