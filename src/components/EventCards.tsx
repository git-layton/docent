import { useState } from 'react';
import {
  CalendarDays, CalendarClock, CalendarPlus, Check, Loader2,
  Pencil, Trash2, ArrowRight, AlertTriangle,
} from 'lucide-react';
import { useTaskStore } from '../store/useTaskStore';
import type { RecurringEvent } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';

/** Local (timezone-safe) ISO date string 'YYYY-MM-DD' for a Date. */
function toLocalISODate(d: Date): string {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().split('T')[0];
}

/** Add `n` days to an ISO date string, returning a new ISO date string. */
function addISODays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toLocalISODate(new Date(y, m - 1, d + n));
}

/** Strip an ISO datetime down to what an <input type="datetime-local"> wants. */
function toDatetimeLocal(s?: string): string {
  if (!s) return '';
  // "2026-06-10T14:30:00" / "2026-06-10T14:30:00-07:00" -> "2026-06-10T14:30"
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (m) return `${m[1]}T${m[2]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T09:00`;
  return '';
}

const fieldCls =
  'w-full bg-panel border border-edge outline-none focus:border-accent px-3 py-2 rounded-lg text-sm font-medium text-ink placeholder:text-ink-3 transition-colors';
const labelCls =
  'font-black text-ink-3 uppercase tracking-widest text-[10px] block mb-1';

const EVENT_TYPE_OPTS: { value: RecurringEvent['type']; label: string }[] = [
  { value: 'birthday', label: '🎂 Birthday' },
  { value: 'anniversary', label: '💍 Anniversary' },
  { value: 'custom', label: '🎉 Custom' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Local calendar event — editable before it's added to the planner.
// Handles both recurring (birthday/anniversary/custom) and one-time/multi-day.
// ─────────────────────────────────────────────────────────────────────────────
export function EventCard({ data, onToast }: { data: any; onToast: (m: string) => void }) {
  const isRecurring = data?.type !== 'date';

  // Recurring state
  const [name, setName] = useState<string>(data?.name ?? data?.title ?? '');
  const [type, setType] = useState<RecurringEvent['type']>(
    (['birthday', 'anniversary', 'custom'].includes(data?.type) ? data.type : 'birthday') as RecurringEvent['type'],
  );
  const thisYear = new Date().getFullYear();
  const [recurDate, setRecurDate] = useState<string>(() => {
    const m = String(data?.month ?? 1).padStart(2, '0');
    const d = String(data?.day ?? 1).padStart(2, '0');
    return `${data?.year ?? thisYear}-${m}-${d}`;
  });

  // One-time / multi-day state
  const [title, setTitle] = useState<string>(data?.title ?? data?.name ?? '');
  const [start, setStart] = useState<string>(data?.dueDate ?? toLocalISODate(new Date()));
  const [end, setEnd] = useState<string>(data?.endDate ?? '');
  const [details, setDetails] = useState<string>(data?.details ?? '');

  const [added, setAdded] = useState(false);

  const submit = () => {
    const store = useTaskStore.getState();
    if (isRecurring) {
      if (!name.trim()) { onToast('Add a name first.'); return; }
      const [y, m, d] = recurDate.split('-').map(Number);
      store.addRecurringEvent({
        type, name: name.trim(), month: m, day: d,
        year: data?.year ?? (type === 'birthday' || type === 'anniversary' ? y : undefined),
      });
      onToast(`Added ${type} for ${name.trim()}`);
    } else {
      if (!title.trim()) { onToast('Add a title first.'); return; }
      const cleanEnd = end && end > start ? end : null;
      store.addTask(title.trim(), start, details.trim(), '', cleanEnd);
      onToast(cleanEnd ? `Added "${title.trim()}" (${start} → ${cleanEnd})` : `Added "${title.trim()}"`);
    }
    store.setShowPlanner(true);
    setAdded(true);
  };

  return (
    <div className="my-3 p-4 rounded-xl border-2 border-accent/25 bg-accent-soft/30 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center gap-2 text-accent font-bold text-xs uppercase tracking-widest">
        <CalendarDays className="w-4 h-4" /> Add to Calendar
      </div>

      {isRecurring ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className={labelCls}>Name</label>
            <input aria-label="Event name" className={fieldCls} value={name} onChange={e => setName(e.target.value)} placeholder="Full name…" />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select aria-label="Event type" className={fieldCls} value={type} onChange={e => setType(e.target.value as RecurringEvent['type'])}>
              {EVENT_TYPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Date</label>
            <input aria-label="Event date" type="date" className={fieldCls} value={recurDate} onChange={e => setRecurDate(e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className={labelCls}>Title</label>
            <input aria-label="Event title" className={fieldCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title…" />
          </div>
          <div>
            <label className={labelCls}>Start date</label>
            <input aria-label="Start date" type="date" className={fieldCls} value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>End date <span className="normal-case text-ink-3">(optional)</span></label>
            <input aria-label="End date" type="date" className={fieldCls} value={end} min={start} onChange={e => setEnd(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Details</label>
            <textarea aria-label="Details" className={`${fieldCls} resize-y min-h-[60px]`} value={details} onChange={e => setDetails(e.target.value)} placeholder="Notes, agenda, links…" />
          </div>
        </div>
      )}

      <button
        onClick={submit}
        disabled={added}
        className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-accent hover:bg-accent-strong disabled:bg-success disabled:cursor-default text-on-accent shadow-md transition-all active:scale-95"
      >
        {added ? <><Check className="w-3.5 h-3.5" /> Added to Planner</> : <><CalendarPlus className="w-3.5 h-3.5" /> Add Event</>}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Calendar event — editable before it's booked. Supports timed events,
// all-day events, and multi-day spans (all-day end date is inclusive in the UI;
// converted to Google's exclusive end on submit).
// ─────────────────────────────────────────────────────────────────────────────
export function GcalEventCard({ data, onToast }: { data: any; onToast: (m: string) => void }) {
  const integrations = useSettingsStore(s => s.integrations);
  const workspaces: any[] = (integrations as any)?.googleWorkspaces ?? [];
  const calendarAccounts = workspaces.filter(a => a?.scopes?.calendar && a?.clientId && a?.refreshToken);

  const startIsDateOnly = typeof data?.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.start);
  const [allDay, setAllDay] = useState<boolean>(!!data?.allDay || startIsDateOnly);
  const [title, setTitle] = useState<string>(data?.title ?? '');
  const [startDay, setStartDay] = useState<string>(() => (data?.start ?? toLocalISODate(new Date())).slice(0, 10));
  const [endDay, setEndDay] = useState<string>(() => (data?.end ?? data?.start ?? toLocalISODate(new Date())).slice(0, 10));
  const [startDt, setStartDt] = useState<string>(toDatetimeLocal(data?.start));
  const [endDt, setEndDt] = useState<string>(toDatetimeLocal(data?.end) || toDatetimeLocal(data?.start));
  const [location, setLocation] = useState<string>(data?.location ?? '');
  const [description, setDescription] = useState<string>(data?.description ?? '');
  const [accountLabel, setAccountLabel] = useState<string>(data?.accountLabel ?? calendarAccounts[0]?.label ?? '');

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!title.trim()) { onToast('Add a title first.'); return; }
    const acct = accountLabel
      ? calendarAccounts.find(a => a.label === accountLabel) ?? calendarAccounts[0]
      : calendarAccounts[0];
    if (!acct) { onToast('No Google Calendar account configured.'); return; }

    setBusy(true);
    try {
      const { fetchWithRetry: fw } = await import('../services/llm');
      const tokenRes = await fw('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: acct.clientId, client_secret: acct.clientSecret, refresh_token: acct.refreshToken, grant_type: 'refresh_token' }).toString(),
      }, 1);
      if (!tokenRes.access_token) throw new Error('Token refresh failed');

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const event: any = { summary: title.trim() };
      if (allDay) {
        const s = startDay;
        const lastDay = endDay && endDay >= startDay ? endDay : startDay;
        // Google all-day events use an exclusive end date — add one day so the
        // event visually covers through the user's chosen last day.
        event.start = { date: s };
        event.end = { date: addISODays(lastDay, 1) };
      } else {
        const s = startDt || toDatetimeLocal(toLocalISODate(new Date()));
        const e = endDt && endDt > s ? endDt : s;
        event.start = { dateTime: `${s}:00`, timeZone: tz };
        event.end = { dateTime: `${e}:00`, timeZone: tz };
      }
      if (description.trim()) event.description = description.trim();
      if (location.trim()) event.location = location.trim();

      const res = await fw('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST', headers: { Authorization: `Bearer ${tokenRes.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }, 1);
      if (res.id) { onToast('✅ Event created in Google Calendar'); setDone(true); }
      else { onToast('Calendar create failed'); }
    } catch (e: any) {
      onToast(`Calendar error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-3 p-4 rounded-xl border-2 border-accent/25 bg-accent-soft/30 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-accent font-bold text-xs uppercase tracking-widest">
          <CalendarClock className="w-4 h-4" /> Create Google Calendar Event
        </span>
        <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-ink-3 cursor-pointer select-none">
          <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="accent-accent" />
          All-day
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className={labelCls}>Title</label>
          <input aria-label="Event title" className={fieldCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title…" />
        </div>

        {allDay ? (
          <>
            <div>
              <label className={labelCls}>Start date</label>
              <input aria-label="Start date" type="date" className={fieldCls} value={startDay} onChange={e => setStartDay(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>End date</label>
              <input aria-label="End date" type="date" className={fieldCls} value={endDay} min={startDay} onChange={e => setEndDay(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelCls}>Start</label>
              <input aria-label="Start" type="datetime-local" className={fieldCls} value={startDt} onChange={e => setStartDt(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>End</label>
              <input aria-label="End" type="datetime-local" className={fieldCls} value={endDt} min={startDt} onChange={e => setEndDt(e.target.value)} />
            </div>
          </>
        )}

        <div className="col-span-2">
          <label className={labelCls}>Location <span className="normal-case text-ink-3">(optional)</span></label>
          <input aria-label="Location" className={fieldCls} value={location} onChange={e => setLocation(e.target.value)} placeholder="Address or video link…" />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Description <span className="normal-case text-ink-3">(optional)</span></label>
          <textarea aria-label="Description" className={`${fieldCls} resize-y min-h-[60px]`} value={description} onChange={e => setDescription(e.target.value)} placeholder="Agenda, notes…" />
        </div>
        {calendarAccounts.length > 1 && (
          <div className="col-span-2">
            <label className={labelCls}>Account</label>
            <select aria-label="Calendar account" className={fieldCls} value={accountLabel} onChange={e => setAccountLabel(e.target.value)}>
              {calendarAccounts.map(a => <option key={a.id ?? a.label} value={a.label}>{a.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <button
        onClick={submit}
        disabled={busy || done}
        className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-accent hover:bg-accent-strong disabled:bg-success disabled:cursor-default text-on-accent shadow-md transition-all active:scale-95"
      >
        {done ? <><Check className="w-3.5 h-3.5" /> Event Created</>
          : busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</>
          : <><CalendarClock className="w-3.5 h-3.5" /> Create Event</>}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve which local item an agent is referring to. Prefers the stable id
// (surfaced to the agent in context) and falls back to a case-insensitive
// title/name match so a slightly-off reference still finds its target.
// ─────────────────────────────────────────────────────────────────────────────
type LocalTarget = { kind: 'task' | 'recurring' | null; item: any };

function resolveLocalTarget(data: any): LocalTarget {
  const { tasks, recurringEvents } = useTaskStore.getState();
  const id = data?.id;
  if (id) {
    const t = tasks.find((x: any) => x.id === id);
    if (t) return { kind: 'task', item: t };
    const r = recurringEvents.find((x: any) => x.id === id);
    if (r) return { kind: 'recurring', item: r };
  }
  const query = String(data?.title ?? data?.name ?? data?.match ?? '').trim().toLowerCase();
  if (query) {
    const t = tasks.find((x: any) => (x.title ?? '').toLowerCase() === query)
      ?? tasks.find((x: any) => (x.title ?? '').toLowerCase().includes(query));
    if (t) return { kind: 'task', item: t };
    const r = recurringEvents.find((x: any) => (x.name ?? '').toLowerCase() === query)
      ?? recurringEvents.find((x: any) => (x.name ?? '').toLowerCase().includes(query));
    if (r) return { kind: 'recurring', item: r };
  }
  return { kind: null, item: null };
}

function NotFoundCard({ tone, what }: { tone: 'amber' | 'rose'; what: string }) {
  return (
    <div className={`my-3 p-4 rounded-xl border-2 ${tone === 'rose' ? 'border-danger/40 bg-danger-soft/40' : 'border-warning/40 bg-warning-soft/40'} flex items-center gap-2 text-xs font-bold text-ink-2 shadow-sm`}>
      <AlertTriangle className={`w-4 h-4 shrink-0 ${tone === 'rose' ? 'text-danger' : 'text-warning'}`} />
      Couldn't find “{what}” on your calendar — it may have already been changed or removed.
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Move / edit a saved local item (one-time task or recurring event).
// ─────────────────────────────────────────────────────────────────────────────
export function EventUpdateCard({ data, onToast }: { data: any; onToast: (m: string) => void }) {
  const [{ kind, item }] = useState<LocalTarget>(() => resolveLocalTarget(data));

  // Task fields
  const [title, setTitle] = useState<string>(data?.title ?? item?.title ?? '');
  const [dueDate, setDueDate] = useState<string>(data?.dueDate ?? item?.dueDate ?? '');
  const [endDate, setEndDate] = useState<string>(data?.endDate ?? item?.endDate ?? '');
  const [details, setDetails] = useState<string>(data?.details ?? item?.details ?? '');

  // Recurring fields
  const [name, setName] = useState<string>(data?.name ?? item?.name ?? '');
  const [type, setType] = useState<RecurringEvent['type']>((item?.type ?? 'birthday') as RecurringEvent['type']);
  const thisYear = new Date().getFullYear();
  const [recurDate, setRecurDate] = useState<string>(() => {
    const m = String(data?.month ?? item?.month ?? 1).padStart(2, '0');
    const d = String(data?.day ?? item?.day ?? 1).padStart(2, '0');
    return `${item?.year ?? thisYear}-${m}-${d}`;
  });

  const [done, setDone] = useState(false);

  if (kind === null) return <NotFoundCard tone="amber" what={String(data?.title ?? data?.name ?? data?.id ?? 'that item')} />;

  const submit = () => {
    const store = useTaskStore.getState();
    if (kind === 'task') {
      const cleanEnd = endDate && endDate > dueDate ? endDate : null;
      store.updateTask(item.id, { title: title.trim() || item.title, dueDate: dueDate || item.dueDate, endDate: cleanEnd, details });
      onToast(`Updated "${title.trim() || item.title}"`);
    } else {
      const [, m, d] = recurDate.split('-').map(Number);
      store.updateRecurringEvent(item.id, { name: name.trim() || item.name, type, month: m, day: d });
      onToast(`Updated "${name.trim() || item.name}"`);
    }
    store.setShowPlanner(true);
    setDone(true);
  };

  const oldDateLabel = kind === 'task'
    ? `${item.dueDate ?? '—'}${item.endDate && item.endDate > item.dueDate ? ` → ${item.endDate}` : ''}`
    : `${String(item.month).padStart(2, '0')}-${String(item.day).padStart(2, '0')}`;

  return (
    <div className="my-3 p-4 rounded-xl border-2 border-accent/25 bg-accent-soft/30 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center gap-2 text-accent font-bold text-xs uppercase tracking-widest">
        <Pencil className="w-4 h-4" /> Update Calendar Item
      </div>
      <p className="text-[11px] text-ink-2 flex items-center gap-1.5">
        Currently: <span className="font-bold text-ink">{kind === 'task' ? item.title : item.name}</span> · {oldDateLabel}
      </p>

      {kind === 'task' ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className={labelCls}>Title</label>
            <input aria-label="Event title" className={fieldCls} value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>New start date</label>
            <input aria-label="Start date" type="date" className={fieldCls} value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>End date <span className="normal-case text-ink-3">(optional)</span></label>
            <input aria-label="End date" type="date" className={fieldCls} value={endDate} min={dueDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Details</label>
            <textarea aria-label="Details" className={`${fieldCls} resize-y min-h-[60px]`} value={details} onChange={e => setDetails(e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className={labelCls}>Name</label>
            <input aria-label="Event name" className={fieldCls} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select aria-label="Event type" className={fieldCls} value={type} onChange={e => setType(e.target.value as RecurringEvent['type'])}>
              {EVENT_TYPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>New date</label>
            <input aria-label="Event date" type="date" className={fieldCls} value={recurDate} onChange={e => setRecurDate(e.target.value)} />
          </div>
        </div>
      )}

      <button
        onClick={submit}
        disabled={done}
        className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-accent hover:bg-accent-strong disabled:bg-success disabled:cursor-default text-on-accent shadow-md transition-all active:scale-95"
      >
        {done ? <><Check className="w-3.5 h-3.5" /> Updated</> : <><ArrowRight className="w-3.5 h-3.5" /> Save Changes</>}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete a saved local item (task or recurring event). Destructive → confirm.
// ─────────────────────────────────────────────────────────────────────────────
export function EventDeleteCard({ data, onToast }: { data: any; onToast: (m: string) => void }) {
  const [{ kind, item }] = useState<LocalTarget>(() => resolveLocalTarget(data));
  const [done, setDone] = useState(false);

  if (kind === null) return <NotFoundCard tone="rose" what={String(data?.title ?? data?.name ?? data?.id ?? 'that item')} />;

  const label = kind === 'task' ? item.title : item.name;
  const onDelete = () => {
    const store = useTaskStore.getState();
    if (kind === 'task') store.deleteTask(item.id);
    else store.deleteRecurringEvent(item.id);
    onToast(`Deleted "${label}"`);
    setDone(true);
  };

  return (
    <div className="my-3 p-4 rounded-xl border-2 border-danger/40 bg-danger-soft/40 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center gap-2 text-danger font-bold text-xs uppercase tracking-widest">
        <Trash2 className="w-4 h-4" /> Remove from Calendar
      </div>
      <p className="text-sm text-ink-2">
        Remove <span className="font-bold">{label}</span>
        <span className="text-ink-3"> · {kind === 'task' ? (item.dueDate ?? 'no date') : `${String(item.month).padStart(2, '0')}-${String(item.day).padStart(2, '0')}`}</span>?
      </p>
      <button
        onClick={onDelete}
        disabled={done}
        className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-danger hover:opacity-90 disabled:bg-success disabled:cursor-default text-danger-soft shadow-md transition-all active:scale-95"
      >
        {done ? <><Check className="w-3.5 h-3.5" /> Removed</> : <><Trash2 className="w-3.5 h-3.5" /> Delete</>}
      </button>
    </div>
  );
}

/** Find a Google Calendar account, preferring an explicit label. */
function pickCalendarAccount(integrations: any, accountLabel?: string) {
  const workspaces: any[] = integrations?.googleWorkspaces ?? [];
  const usable = workspaces.filter(a => a?.scopes?.calendar && a?.clientId && a?.refreshToken);
  if (accountLabel) return usable.find(a => a.label === accountLabel) ?? usable[0] ?? null;
  return usable[0] ?? null;
}

async function refreshAccessToken(acct: any): Promise<string> {
  const { fetchWithRetry: fw } = await import('../services/llm');
  const tokenRes = await fw('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: acct.clientId, client_secret: acct.clientSecret, refresh_token: acct.refreshToken, grant_type: 'refresh_token' }).toString(),
  }, 1);
  if (!tokenRes.access_token) throw new Error('Token refresh failed');
  return tokenRes.access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Move / edit an existing Google Calendar event (PATCH by id).
// ─────────────────────────────────────────────────────────────────────────────
export function GcalUpdateCard({ data, onToast }: { data: any; onToast: (m: string) => void }) {
  const integrations = useSettingsStore(s => s.integrations);
  const eventId: string | undefined = data?.eventId ?? data?.id;

  const startIsDateOnly = typeof data?.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.start);
  const [allDay, setAllDay] = useState<boolean>(!!data?.allDay || startIsDateOnly);
  const [title, setTitle] = useState<string>(data?.title ?? '');
  const [startDay, setStartDay] = useState<string>((data?.start ?? toLocalISODate(new Date())).slice(0, 10));
  const [endDay, setEndDay] = useState<string>((data?.end ?? data?.start ?? toLocalISODate(new Date())).slice(0, 10));
  const [startDt, setStartDt] = useState<string>(toDatetimeLocal(data?.start));
  const [endDt, setEndDt] = useState<string>(toDatetimeLocal(data?.end) || toDatetimeLocal(data?.start));
  const [location, setLocation] = useState<string>(data?.location ?? '');
  const [description, setDescription] = useState<string>(data?.description ?? '');

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!eventId) return <NotFoundCard tone="amber" what={String(data?.title ?? 'that event')} />;

  const submit = async () => {
    const acct = pickCalendarAccount(integrations, data?.accountLabel);
    if (!acct) { onToast('No Google Calendar account configured.'); return; }
    setBusy(true);
    try {
      const { fetchWithRetry: fw } = await import('../services/llm');
      const token = await refreshAccessToken(acct);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // PATCH only the fields the user can see/edit on this card.
      const patch: any = {};
      if (title.trim()) patch.summary = title.trim();
      if (allDay) {
        const lastDay = endDay && endDay >= startDay ? endDay : startDay;
        patch.start = { date: startDay };
        patch.end = { date: addISODays(lastDay, 1) };
      } else if (startDt) {
        const e = endDt && endDt > startDt ? endDt : startDt;
        patch.start = { dateTime: `${startDt}:00`, timeZone: tz };
        patch.end = { dateTime: `${e}:00`, timeZone: tz };
      }
      patch.location = location.trim() || undefined;
      patch.description = description.trim() || undefined;

      const res = await fw(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }, 1);
      if (res.id) { onToast('✅ Event updated in Google Calendar'); setDone(true); }
      else { onToast('Calendar update failed'); }
    } catch (e: any) {
      onToast(`Calendar error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-3 p-4 rounded-xl border-2 border-accent/25 bg-accent-soft/30 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-accent font-bold text-xs uppercase tracking-widest">
          <CalendarClock className="w-4 h-4" /> Reschedule Google Calendar Event
        </span>
        <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-ink-3 cursor-pointer select-none">
          <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="accent-accent" />
          All-day
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className={labelCls}>Title <span className="normal-case text-ink-3">(leave blank to keep)</span></label>
          <input aria-label="Event title" className={fieldCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="Keep current title…" />
        </div>
        {allDay ? (
          <>
            <div>
              <label className={labelCls}>Start date</label>
              <input aria-label="Start date" type="date" className={fieldCls} value={startDay} onChange={e => setStartDay(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>End date</label>
              <input aria-label="End date" type="date" className={fieldCls} value={endDay} min={startDay} onChange={e => setEndDay(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelCls}>Start</label>
              <input aria-label="Start" type="datetime-local" className={fieldCls} value={startDt} onChange={e => setStartDt(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>End</label>
              <input aria-label="End" type="datetime-local" className={fieldCls} value={endDt} min={startDt} onChange={e => setEndDt(e.target.value)} />
            </div>
          </>
        )}
        <div className="col-span-2">
          <label className={labelCls}>Location <span className="normal-case text-ink-3">(optional)</span></label>
          <input aria-label="Location" className={fieldCls} value={location} onChange={e => setLocation(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Description <span className="normal-case text-ink-3">(optional)</span></label>
          <textarea aria-label="Description" className={`${fieldCls} resize-y min-h-[60px]`} value={description} onChange={e => setDescription(e.target.value)} />
        </div>
      </div>

      <button
        onClick={submit}
        disabled={busy || done}
        className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-accent hover:bg-accent-strong disabled:bg-success disabled:cursor-default text-on-accent shadow-md transition-all active:scale-95"
      >
        {done ? <><Check className="w-3.5 h-3.5" /> Event Updated</>
          : busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Updating…</>
          : <><ArrowRight className="w-3.5 h-3.5" /> Save Changes</>}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete an existing Google Calendar event (DELETE by id). Destructive.
// ─────────────────────────────────────────────────────────────────────────────
export function GcalDeleteCard({ data, onToast }: { data: any; onToast: (m: string) => void }) {
  const integrations = useSettingsStore(s => s.integrations);
  const eventId: string | undefined = data?.eventId ?? data?.id;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!eventId) return <NotFoundCard tone="rose" what={String(data?.title ?? 'that event')} />;

  const submit = async () => {
    const acct = pickCalendarAccount(integrations, data?.accountLabel);
    if (!acct) { onToast('No Google Calendar account configured.'); return; }
    setBusy(true);
    try {
      const { fetchWithRetry: fw } = await import('../services/llm');
      const token = await refreshAccessToken(acct);
      // DELETE returns 204 with no body; returnRaw avoids a JSON-parse failure.
      await fw(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      }, 1, undefined, true);
      onToast('✅ Event deleted from Google Calendar');
      setDone(true);
    } catch (e: any) {
      onToast(`Calendar error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-3 p-4 rounded-xl border-2 border-danger/40 bg-danger-soft/40 flex flex-col gap-3 shadow-sm">
      <div className="flex items-center gap-2 text-danger font-bold text-xs uppercase tracking-widest">
        <Trash2 className="w-4 h-4" /> Delete Google Calendar Event
      </div>
      <p className="text-sm text-ink-2">
        Delete <span className="font-bold">{data?.title ?? 'this event'}</span> from your calendar?
      </p>
      <button
        onClick={submit}
        disabled={busy || done}
        className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-danger hover:opacity-90 disabled:bg-success disabled:cursor-default text-danger-soft shadow-md transition-all active:scale-95"
      >
        {done ? <><Check className="w-3.5 h-3.5" /> Deleted</>
          : busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting…</>
          : <><Trash2 className="w-3.5 h-3.5" /> Delete Event</>}
      </button>
    </div>
  );
}
