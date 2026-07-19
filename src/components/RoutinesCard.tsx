import { useEffect, useState } from 'react';
import { Repeat, Plus, Trash2, Mail, Flag, X } from 'lucide-react';
import { db } from '../services/database';
import type { Routine } from '../services/routines';

/**
 * Routines — scheduled/watcher automations, listed and created here, EXECUTED by the scheduler in
 * App.tsx (runs while the app is open; missed daily slots catch up at launch). Read-only autonomy
 * by design: routines read mail, summarize, and flag; results land in the Inbox. Nothing outbound.
 */
export function RoutinesCard({ assistants }: { assistants: Array<{ id: string; name: string }> }) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('Morning mail report');
  const [action, setAction] = useState<'mailReport' | 'mailFlag' | 'digest'>('mailReport');
  const [time, setTime] = useState('08:00');
  const [fromContains, setFromContains] = useState('');
  const [subjectContains, setSubjectContains] = useState('');
  const [srcMail, setSrcMail] = useState(true);
  const [srcCalendar, setSrcCalendar] = useState(true);
  const [srcNotes, setSrcNotes] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [saveToMemory, setSaveToMemory] = useState(false);

  useEffect(() => { void db.get('routines', []).then(setRoutines); }, []);

  const persist = async (next: Routine[]) => { setRoutines(next); await db.set('routines', next); };

  const addRoutine = async () => {
    const owner = assistants[0];
    if (!owner || !name.trim()) return;
    const [h, m] = time.split(':').map(n => parseInt(n, 10));
    const routine: Routine = {
      id: `routine-${Date.now()}`,
      name: name.trim(),
      trigger: action === 'mailFlag'
        ? { kind: 'mailWatch', everyMinutes: 5 }
        : { kind: 'daily', hour: isNaN(h) ? 8 : h, minute: isNaN(m) ? 0 : m },
      action,
      sources: action === 'digest' ? { mail: srcMail, calendar: srcCalendar, notes: srcNotes } : undefined,
      instruction: action === 'digest' ? (instruction.trim() || undefined) : undefined,
      saveToMemory: action === 'digest' ? saveToMemory : undefined,
      fromContains: fromContains.trim() || undefined,
      subjectContains: subjectContains.trim() || undefined,
      ownerId: owner.id,
      ownerLabel: owner.name,
      enabled: true,
      createdAt: Date.now(),
    };
    await persist([routine, ...routines]);
    setShowForm(false);
    setName('Morning mail report'); setFromContains(''); setSubjectContains('');
  };

  const describe = (r: Routine): string => {
    if (r.trigger.kind === 'daily') {
      const time = `${String(r.trigger.hour).padStart(2, '0')}:${String(r.trigger.minute).padStart(2, '0')}`;
      const srcs = r.action === 'digest'
        ? Object.entries(r.sources ?? {}).filter(([, on]) => on).map(([k]) => k).join(' + ') || 'mail'
        : 'mail';
      return `daily at ${time} · ${srcs} → briefing to Inbox`;
    }
    const filters = [r.fromContains && `from “${r.fromContains}”`, r.subjectContains && `subject “${r.subjectContains}”`]
      .filter(Boolean).join(', ');
    return `watching mail (${filters || 'no filter — set one!'}) → flag + Inbox note`;
  };

  return (
    <div className="mb-6 p-5 rounded-3xl border border-edge bg-panel-2 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Repeat className="w-4 h-4 text-accent" />
          <span className="text-sm font-black uppercase tracking-widest">Routines</span>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all">
            <Plus className="w-3 h-3" /> New routine
          </button>
        )}
      </div>
      <p className="text-tiny text-ink-3 mb-3">
        Runs while Docent is open (missed schedules catch up at launch). Read-only: reports and flags land in your Inbox — nothing is ever sent without you.
      </p>

      {routines.length === 0 && !showForm && (
        <p className="text-tiny text-ink-3 text-center py-2">No routines yet — try a daily mail report or an email watcher.</p>
      )}

      {routines.map(r => (
        <div key={r.id} className="flex items-center gap-3 py-2 border-t border-edge">
          {r.action === 'mailReport' ? <Mail className="w-3.5 h-3.5 text-ink-3 shrink-0" /> : <Flag className="w-3.5 h-3.5 text-ink-3 shrink-0" />}
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-bold text-ink truncate">{r.name}</span>
            <span className="text-[10px] text-ink-3">{describe(r)}{r.lastRunAt ? ` · last ran ${new Date(r.lastRunAt).toLocaleString()}` : ' · not run yet'}</span>
          </div>
          <button
            onClick={() => void persist(routines.map(x => x.id === r.id ? { ...x, enabled: !x.enabled } : x))}
            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all shrink-0 ${
              r.enabled ? 'bg-accent-soft text-accent-soft-ink' : 'bg-inset text-ink-3'
            }`}>{r.enabled ? 'On' : 'Off'}</button>
          <button onClick={() => void persist(routines.filter(x => x.id !== r.id))}
            className="p-1.5 text-ink-3 hover:text-error transition-colors shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}

      {showForm && (
        <div className="mt-3 p-3 rounded-2xl bg-inset border border-edge space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex rounded-full border border-edge-2 p-0.5 gap-0.5">
              <button onClick={() => { setAction('mailReport'); setName('Morning mail report'); }}
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full transition-all ${action === 'mailReport' ? 'bg-accent text-on-accent' : 'text-ink-3 hover:bg-wash'}`}>Daily mail report</button>
              <button onClick={() => { setAction('mailFlag'); setName('Watch my mail'); }}
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full transition-all ${action === 'mailFlag' ? 'bg-accent text-on-accent' : 'text-ink-3 hover:bg-wash'}`}>Watch &amp; flag mail</button>
              <button onClick={() => { setAction('digest'); setName('Daily briefing'); }}
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full transition-all ${action === 'digest' ? 'bg-accent text-on-accent' : 'text-ink-3 hover:bg-wash'}`}>Custom briefing</button>
            </div>
            <button onClick={() => setShowForm(false)} className="p-1 text-ink-3 hover:text-ink-2"><X className="w-3.5 h-3.5" /></button>
          </div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Routine name"
            className="w-full bg-panel border border-edge-2 rounded-xl px-3 py-2 text-xs outline-none focus:border-secondary" />
          {action !== 'mailFlag' ? (
            <label className="flex items-center gap-2 text-tiny text-ink-2">
              Every day at
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="bg-panel border border-edge-2 rounded-lg px-2 py-1 text-xs outline-none focus:border-secondary" />
            </label>
          ) : (
            <div className="flex gap-2">
              <input value={fromContains} onChange={e => setFromContains(e.target.value)} placeholder="Sender contains… (e.g. acme.com)"
                className="flex-1 bg-panel border border-edge-2 rounded-xl px-3 py-2 text-xs outline-none focus:border-secondary" />
              <input value={subjectContains} onChange={e => setSubjectContains(e.target.value)} placeholder="Subject contains… (optional)"
                className="flex-1 bg-panel border border-edge-2 rounded-xl px-3 py-2 text-xs outline-none focus:border-secondary" />
            </div>
          )}
          {action === 'digest' && (
            <>
              <div className="flex items-center gap-3 text-tiny text-ink-2">
                Sources:
                {([['Mail', srcMail, setSrcMail], ['Calendar', srcCalendar, setSrcCalendar], ['Notes', srcNotes, setSrcNotes]] as const).map(([label, on, set]) => (
                  <label key={label} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} className="accent-current" />
                    {label}
                  </label>
                ))}
              </div>
              <textarea value={instruction} onChange={e => setInstruction(e.target.value)} rows={2}
                placeholder="What should the briefing focus on? (optional — e.g. 'Only things needing a reply today, then my schedule')"
                className="w-full bg-panel border border-edge-2 rounded-xl px-3 py-2 text-xs outline-none focus:border-secondary resize-none" />
              <label className="flex items-center gap-2 text-tiny text-ink-2 cursor-pointer">
                <input type="checkbox" checked={saveToMemory} onChange={e => setSaveToMemory(e.target.checked)} className="accent-current" />
                Also save to memory so Docent can reference this briefing later
              </label>
            </>
          )}
          <button onClick={() => void addRoutine()}
            disabled={!name.trim() || (action === 'mailFlag' && !fromContains.trim() && !subjectContains.trim()) || (action === 'digest' && !srcMail && !srcCalendar && !srcNotes)}
            className="px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all disabled:opacity-40">
            Create routine
          </button>
        </div>
      )}
    </div>
  );
}
