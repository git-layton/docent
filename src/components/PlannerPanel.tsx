import React, { useMemo, useState } from 'react';
import {
  ListTodo, LayoutList, CalendarDays, ChevronLeft, ChevronRight,
  GripVertical, Circle, Clock, MapPin, MessageSquare, Trash2,
  AlignLeft, CheckCircle2, X, ChevronRight as ChevronRightIcon,
  Cake, Plus
} from 'lucide-react';
import { AgentIcon } from './ui/AgentIcon';
import { useTaskStore } from '../store/useTaskStore';
import type { RecurringEvent } from '../store/useTaskStore';
import { useAgentStore } from '../store/useAgentStore';
import { useUIStore } from '../store/useUIStore';
import { useChatStore } from '../store/useChatStore';
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
    addTask(newTaskInput, newTaskDate || null, newTaskDetails, newTaskLocation);
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
    <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-neutral-50/50 dark:bg-neutral-900/50 no-scrollbar relative">

      {/* Task Discuss Bot Selector Modal */}
      {taskToDiscuss && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
           <div className="bg-white dark:bg-neutral-900 w-full max-w-sm rounded-2xl shadow-xl p-5 border border-neutral-200 dark:border-neutral-800">
              <div className="flex justify-between items-center mb-4">
                 <h3 className="text-sm font-black uppercase tracking-widest text-[#4A5D75] dark:text-[#899AB5]">Ask which Agent?</h3>
                 <button onClick={() => setTaskToDiscuss(null)} className="text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4"/></button>
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
                    }} className="w-full flex items-center gap-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all text-left">
                        <AgentIcon agent={a} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm" />
                        <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200 flex-1">{a.name}</span>
                        <ChevronRightIcon className="w-4 h-4 text-neutral-400" />
                    </button>
                 ))}
              </div>
           </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto space-y-8">
        <div className="bg-white dark:bg-neutral-950 p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-black tracking-tight flex items-center gap-2"><ListTodo className="w-5 h-5 text-[#6A829E]" /> Agenda</h2>
            <div className="flex bg-neutral-100 dark:bg-neutral-900 p-1 rounded-lg">
              <button onClick={() => setPlannerView('list')} className={`p-1.5 rounded-md transition-all ${plannerView === 'list' ? 'bg-white dark:bg-neutral-800 shadow-sm text-[#4A5D75]' : 'text-neutral-400'}`}><LayoutList className="w-4 h-4" /></button>
              <button onClick={() => setPlannerView('calendar')} className={`p-1.5 rounded-md transition-all ${plannerView === 'calendar' ? 'bg-white dark:bg-neutral-800 shadow-sm text-[#4A5D75]' : 'text-neutral-400'}`}><CalendarDays className="w-4 h-4" /></button>
            </div>
          </div>

          {plannerView === 'calendar' ? (
            <div className="animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between mb-4 px-2">
                <button onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - 1, 1))} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"><ChevronLeft className="w-5 h-5" /></button>
                <span className="text-sm font-black uppercase tracking-widest">{MONTHS[currentMonthDate.getMonth()]} {currentMonthDate.getFullYear()}</span>
                <button onClick={() => setCurrentMonthDate(new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 1))} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"><ChevronRight className="w-5 h-5" /></button>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="text-center text-[10px] font-black uppercase tracking-widest text-neutral-400 py-2">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((dateObj, i) => {
                  if (!dateObj) return <div key={`empty-${i}`} className="min-h-[80px] bg-neutral-50/50 dark:bg-neutral-900/20 rounded-xl" />;
                  const ds = toLocalISODate(dateObj) as string;
                  const isToday = ds === toLocalISODate(new Date());
                  const isSelected = ds === newTaskDate;
                  const dayTasks = tasks.filter(t => t.dueDate === ds && !t.completed);
                  const dayBirthdays = recurringEvents.filter(ev => ev.month === calendarMonth && ev.day === dateObj.getDate());
                  const dayHolidays = holidaysThisMonth.filter(h => h.date === ds);
                  return (
                    <div key={ds} onClick={() => { setNewTaskDate(ds); setSelectedDayDetail(ds === selectedDayDetail ? null : ds); }} className={`min-h-[80px] p-2 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 ${isSelected ? 'border-[#6A829E] bg-[#F0F4F8] dark:bg-[#1E2B38]/30' : isToday ? 'border-neutral-300 dark:border-neutral-600' : 'border-neutral-100 dark:border-neutral-800 hover:border-[#899AB5]'}`}>
                      <span className={`text-xs font-bold ${isToday ? 'text-[#4A5D75]' : 'text-neutral-500'}`}>{dateObj.getDate()}</span>
                      {dayTasks.map(t => <div key={t.id} className="text-[9px] font-bold truncate bg-[#D6E0EA] dark:bg-[#1E2B38]/50 text-[#1E2B38] dark:text-[#C5D3E0] px-1.5 py-0.5 rounded" title={t.title}>{t.title}</div>)}
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
                const detailTasks = tasks.filter(t => t.dueDate === selectedDayDetail);
                const detailHolidays = holidaysThisMonth.filter(h => h.date === selectedDayDetail);
                const detailBirthdays = recurringEvents.filter(ev => ev.month === monthNum && ev.day === dayNum);
                return (
                  <div className="mt-4 p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-black text-[#4A5D75] dark:text-[#899AB5]">
                        {detailDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                      </h3>
                      <button onClick={() => setSelectedDayDetail(null)} className="text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4"/></button>
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
                      <p className="text-xs text-neutral-400 text-center py-2">Nothing scheduled</p>
                    )}
                    {detailTasks.map(task => (
                      <div key={task.id} className="flex items-center gap-2 px-3 py-2 mb-1 rounded-xl border border-neutral-100 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all">
                        <button onClick={() => toggleTask(task.id)} className={`shrink-0 ${task.completed ? 'text-[#6A829E]' : 'text-neutral-300 hover:text-[#6A829E]'} transition-colors`}>
                          {task.completed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                        </button>
                        <span className={`text-sm font-bold flex-1 ${task.completed ? 'line-through text-neutral-400' : 'text-neutral-800 dark:text-neutral-200'}`}>{task.title}</span>
                        <button onClick={() => deleteTask(task.id)} className="text-neutral-300 hover:text-rose-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      if (!newTaskInput.trim()) return;
                      addTask(newTaskInput, selectedDayDetail, newTaskDetails, newTaskLocation);
                      setNewTaskInput('');
                      setNewTaskDetails('');
                      setNewTaskLocation('');
                    }} className="flex gap-2 mt-3">
                      <input
                        type="text"
                        value={newTaskInput}
                        onChange={e => setNewTaskInput(e.target.value)}
                        placeholder={`Add task for ${detailDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}...`}
                        className="flex-1 bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 outline-none px-3 py-2 rounded-xl text-sm font-medium"
                      />
                      <button type="submit" disabled={!newTaskInput.trim()} className="px-4 py-2 bg-[#4A5D75] disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#3D4D61] transition-all">Add</button>
                    </form>
                  </div>
                );
              })()}

              {/* Upcoming Events in calendar view */}
              {upcoming.length > 0 && (
                <div className="mt-4 space-y-1">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-neutral-400 px-1 mb-2">Upcoming 7 Days</h3>
                  {upcoming.map((ev, idx) => {
                    const [, mm, dd] = ev.date.split('-');
                    const dateLabel = `${MONTH_NAMES[parseInt(mm) - 1]} ${parseInt(dd)}`;
                    const isToday = ev.date === toLocalISODate(new Date());
                    return (
                      <div key={idx} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                        <span className="text-sm shrink-0">{ev.emoji}</span>
                        <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300 flex-1">{ev.label}</span>
                        <span className={`text-[10px] font-black uppercase tracking-widest shrink-0 ${isToday ? 'text-[#4A5D75]' : 'text-neutral-400'}`}>{isToday ? 'Today' : dateLabel}</span>
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
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-neutral-400 px-1 mb-2">Upcoming Events</h3>
                  {upcoming.map((ev, idx) => {
                    const [, mm, dd] = ev.date.split('-');
                    const dateLabel = `${MONTH_NAMES[parseInt(mm) - 1]} ${parseInt(dd)}`;
                    const isToday = ev.date === toLocalISODate(new Date());
                    return (
                      <div key={idx} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
                        <span className="text-base shrink-0">{ev.emoji}</span>
                        <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200 flex-1">{ev.label}</span>
                        <span className={`text-[10px] font-black uppercase tracking-widest shrink-0 ${isToday ? 'text-[#4A5D75]' : 'text-neutral-400'}`}>{isToday ? 'Today' : dateLabel}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Pending Tasks ── */}
              {tasks.filter(t => !t.completed).length === 0 ? (
                <div className="text-center py-6 text-neutral-400 text-sm font-bold">No pending tasks — you're clear!</div>
              ) : tasks.filter(t => !t.completed).map(task => (
                <div key={task.id}
                     draggable
                     onDragStart={(e) => onDragStart(e, task.id)}
                     onDragOver={onDragOver}
                     onDrop={(e) => onDrop(e, task.id)}
                     onDragEnd={() => setDraggedTaskId(null)}
                     className={`flex items-start justify-between group p-3 hover:bg-neutral-50 dark:hover:bg-neutral-900 rounded-xl border transition-all ${draggedTaskId === task.id ? 'opacity-50 border-[#6A829E] bg-neutral-100 dark:bg-neutral-800' : 'border-transparent hover:border-neutral-100 dark:hover:border-neutral-800'}`}>
                  <div className="flex items-start gap-3 mt-1">
                    <div className="cursor-grab text-neutral-300 hover:text-neutral-500 mt-1 flex shrink-0" title="Drag to reorder"><GripVertical className="w-4 h-4" /></div>
                    <button onClick={() => toggleTask(task.id)} className="text-neutral-300 hover:text-[#6A829E] transition-colors mt-0.5"><Circle className="w-5 h-5" /></button>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{task.title}</span>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {task.dueDate    && <span className="text-[10px] font-black uppercase text-[#6A829E] tracking-wider flex items-center gap-1"><Clock className="w-3 h-3" /> {task.dueDate}</span>}
                        {task.location  && <span className="text-[10px] font-bold text-[#7A9E8D] flex items-center gap-1"><MapPin className="w-3 h-3" /> {task.location}</span>}
                      </div>
                      {task.details && <p className="text-xs text-neutral-500 mt-1.5 max-w-xl bg-neutral-50 dark:bg-neutral-900 p-2 rounded-lg">{task.details}</p>}
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 flex items-center transition-all">
                    <button onClick={() => setTaskToDiscuss(task)} className="p-2 text-neutral-400 hover:text-[#4A5D75] transition-all" title="Get Help"><MessageSquare className="w-4 h-4" /></button>
                    <button onClick={() => deleteTask(task.id)} className="p-2 text-neutral-400 hover:text-[#C98A8A] transition-all" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Add Task Form ── */}
          <div className="mt-auto pt-6 border-t border-neutral-100 dark:border-neutral-800 space-y-3">
            <form onSubmit={handleManualTaskSubmit} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input type="text" value={newTaskInput} onChange={e => setNewTaskInput(e.target.value)} placeholder="Add new task..." className="flex-1 bg-neutral-100 dark:bg-neutral-900 border-none outline-none px-4 py-3 rounded-xl text-sm font-medium" />
                <input type="date" value={newTaskDate} onChange={e => setNewTaskDate(e.target.value)} className="bg-neutral-100 dark:bg-neutral-900 border-none outline-none px-3 py-3 rounded-xl text-xs font-bold text-neutral-600 dark:text-neutral-300" />
                <button type="button" onClick={() => setShowTaskDetailsForm(!showTaskDetailsForm)} className={`p-3 rounded-xl transition-all ${showTaskDetailsForm ? 'bg-[#D6E0EA] text-[#4A5D75]' : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-500 hover:bg-neutral-200'}`}><AlignLeft className="w-4 h-4" /></button>
                <button type="submit" disabled={!newTaskInput.trim()} className="px-6 py-3 bg-[#4A5D75] disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#3D4D61] transition-all">Add</button>
              </div>
              {showTaskDetailsForm && (
                <div className="flex gap-2 animate-in slide-in-from-top-2">
                  <div className="flex items-center bg-neutral-100 dark:bg-neutral-900 rounded-xl px-3 w-1/3"><MapPin className="w-4 h-4 text-neutral-400 shrink-0" /><input type="text" value={newTaskLocation} onChange={e => setNewTaskLocation(e.target.value)} placeholder="Location..." className="w-full bg-transparent border-none outline-none p-2 text-xs font-medium" /></div>
                  <div className="flex items-center bg-neutral-100 dark:bg-neutral-900 rounded-xl px-3 flex-1"><AlignLeft className="w-4 h-4 text-neutral-400 shrink-0" /><input type="text" value={newTaskDetails} onChange={e => setNewTaskDetails(e.target.value)} placeholder="Notes..." className="w-full bg-transparent border-none outline-none p-2 text-xs font-medium" /></div>
                </div>
              )}
            </form>

            {/* ── Quick-Add Birthday / Event ── */}
            <div>
              <button
                type="button"
                onClick={() => setShowEventForm(v => !v)}
                className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all ${showEventForm ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'}`}
              >
                <Cake className="w-3.5 h-3.5" />
                {showEventForm ? 'Cancel' : '+ Birthday / Event'}
              </button>

              {showEventForm && (
                <form onSubmit={handleAddEvent} className="mt-3 p-4 bg-neutral-50 dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 space-y-3 animate-in slide-in-from-top-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={evName}
                      onChange={e => setEvName(e.target.value)}
                      placeholder="Full name..."
                      required
                      className="flex-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 outline-none px-3 py-2 rounded-xl text-sm font-medium"
                    />
                    <select
                      value={evType}
                      onChange={e => setEvType(e.target.value as RecurringEvent['type'])}
                      className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 outline-none px-3 py-2 rounded-xl text-xs font-bold text-neutral-600 dark:text-neutral-300"
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
                      className="flex-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 outline-none px-3 py-2 rounded-xl text-xs font-bold text-neutral-600 dark:text-neutral-300"
                    >
                      {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                    <input
                      type="number"
                      min={1} max={31}
                      value={evDay}
                      onChange={e => setEvDay(parseInt(e.target.value))}
                      placeholder="Day"
                      className="w-20 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 outline-none px-3 py-2 rounded-xl text-xs font-bold text-neutral-600 dark:text-neutral-300"
                    />
                    <input
                      type="number"
                      min={1900} max={2099}
                      value={evYear}
                      onChange={e => setEvYear(e.target.value)}
                      placeholder="Year (optional)"
                      className="w-32 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 outline-none px-3 py-2 rounded-xl text-xs font-bold text-neutral-600 dark:text-neutral-300"
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
        {tasks.filter(t => t.completed).length > 0 && (
          <div className="opacity-60 hover:opacity-100 transition-all">
            <h3 className="text-xs font-black uppercase tracking-widest mb-4 px-2 text-neutral-500 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Completed</h3>
            {tasks.filter(t => t.completed).map(task => (
              <div key={task.id} className="flex items-center justify-between p-2 px-4 bg-neutral-100 dark:bg-neutral-800/30 rounded-lg mb-2 group">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleTask(task.id)} className="text-[#9FBBAF]"><CheckCircle2 className="w-4 h-4" /></button>
                  <span className="text-sm font-medium line-through text-neutral-500">{task.title}</span>
                  {task.completedAt && (
                    <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-wide">Done {formatCompletedAt(task.completedAt)}</span>
                  )}
                </div>
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={() => { setInput(`I need help with this completed task: ${task.title}${task.details ? `\nDetails: ${task.details}` : ''}`); setShowPlanner(false); setViewMode('chat'); }} className="p-2 text-neutral-400 hover:text-[#4A5D75] transition-all" title="Get Help"><MessageSquare className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteTask(task.id)} className="p-2 text-neutral-400 hover:text-[#C98A8A]"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Recurring Events Management ── */}
        {recurringEvents.length > 0 && (
          <div className="opacity-60 hover:opacity-100 transition-all">
            <h3 className="text-xs font-black uppercase tracking-widest mb-4 px-2 text-neutral-500 flex items-center gap-2"><Cake className="w-4 h-4" /> Birthdays & Events</h3>
            {recurringEvents.map(ev => (
              <div key={ev.id} className="flex items-center justify-between p-2 px-4 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/20 rounded-lg mb-2 group">
                <div className="flex items-center gap-3">
                  <span className="text-sm">{ev.type === 'birthday' ? '🎂' : ev.type === 'anniversary' ? '💍' : '🎉'}</span>
                  <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{ev.name}</span>
                  <span className="text-[10px] font-black text-neutral-400 uppercase tracking-wide">{MONTHS[ev.month - 1]} {ev.day}{ev.year ? `, ${ev.year}` : ''}</span>
                </div>
                <button onClick={() => deleteRecurringEvent(ev.id)} className="p-2 text-neutral-300 hover:text-[#C98A8A] opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
