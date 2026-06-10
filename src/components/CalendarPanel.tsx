import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { useTaskStore } from '../store/useTaskStore';

// ---------------------------------------------------------------------------
// CalendarPanel — built-in Calendar tool tab (toolId='calendar'). v1 renders a
// month grid with recurring events (birthdays/anniversaries) from useTaskStore.
// A leaf worker wires live MCP calendar events (list_events/create_event) behind
// a try/catch fallback so this degrades gracefully when no calendar is connected.
// ---------------------------------------------------------------------------

interface CalendarPanelProps {
  onToast: (msg: string, action?: { label: string; onClick: () => void }) => void;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarPanel(_props: CalendarPanelProps): React.ReactElement {
  const recurringEvents = useTaskStore(s => s.recurringEvents);
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() }; // month 0–11
  });

  const firstDay = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const eventsOn = (day: number) =>
    recurringEvents.filter(e => e.month === view.month + 1 && e.day === day);

  const shift = (delta: number) => {
    setView(v => {
      const m = v.month + delta;
      if (m < 0) return { year: v.year - 1, month: 11 };
      if (m > 11) return { year: v.year + 1, month: 0 };
      return { ...v, month: m };
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0b0e] text-neutral-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.05)]">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-[#9EADC8]" />
          <span className="text-sm font-bold">{MONTHS[view.month]} {view.year}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="p-1.5 rounded-lg hover:bg-[rgba(255,255,255,0.06)] transition-colors"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => shift(1)} className="p-1.5 rounded-lg hover:bg-[rgba(255,255,255,0.06)] transition-colors"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-[rgba(255,255,255,0.05)]">
        {DOW.map(d => (
          <div key={d} className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 text-center py-2">{d}</div>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-y-auto">
        {cells.map((day, i) => (
          <div key={i} className="border-b border-r border-[rgba(255,255,255,0.04)] p-1.5 min-h-[64px]">
            {day !== null && (
              <>
                <div className="text-[11px] text-neutral-400">{day}</div>
                {eventsOn(day).map(e => (
                  <div key={e.id} className="mt-1 text-[10px] px-1.5 py-0.5 rounded bg-[#4A5D75]/30 text-[#9EADC8] truncate" title={e.name}>
                    {e.name}
                  </div>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
