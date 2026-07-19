import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Mail, CalendarDays, ListChecks, StickyNote, Moon, CheckCircle2, ChevronRight, Loader2, Settings } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';

type RowState = 'unknown' | 'checking' | 'granted' | 'denied' | 'needsRestart';

const AUTOMATION_LS_KEY = (id: string) => `af-perm-${id}`;

export function IntegrationsDashboard() {
  const [states, setStates] = useState<Record<string, RowState>>({});
  
  const integrations = useSettingsStore(s => s.integrations);
  const appSettings = useSettingsStore(s => s.appSettings);
  const setShowProfileSettings = useSettingsStore(s => s.setShowProfileSettings);
  const setProfileSettingsTab = useSettingsStore(s => s.setProfileSettingsTab);

  const setRow = useCallback((id: string, s: RowState) => setStates(prev => ({ ...prev, [id]: s })), []);

  // ── Connection logic ──

  const probeEventKit = async (kind: 'event' | 'reminder') => {
    try {
      const s = await invoke<string>('eventkit_authorization_status', { kind });
      return s === 'authorized' || s === 'writeOnly' ? 'granted' : s === 'denied' || s === 'restricted' ? 'denied' : 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const grantEventKit = async (kind: 'event' | 'reminder') => {
    try {
      const ok = await invoke<boolean>('eventkit_request_access', { kind });
      return ok ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  };

  const grantAutomation = async (id: string, target: string) => {
    try {
      const res = await invoke<string>('automation_grant', { target });
      const state: RowState = res === 'granted' ? 'granted' : 'denied';
      localStorage.setItem(AUTOMATION_LS_KEY(id), state);
      return state;
    } catch {
      return 'denied';
    }
  };

  useEffect(() => {
    // Probe Calendar
    probeEventKit('event').then(s => setRow('calendar', s));
    // Probe Reminders
    probeEventKit('reminder').then(s => setRow('reminders', s));
    // Probe Notes (Automation)
    const notesKnown = localStorage.getItem(AUTOMATION_LS_KEY('notes')) as RowState | null;
    setRow('notes', notesKnown || 'unknown');
  }, [setRow]);

  const hasMail = ((integrations as any)?.mailAccounts ?? []).length > 0;
  const dreamEnabled = appSettings.dreamAutoEnabled ?? false;

  const handleAction = async (id: string) => {
    setRow(id, 'checking');
    if (id === 'calendar') {
      const s = await grantEventKit('event');
      setRow(id, s);
      if (s === 'denied') invoke('open_privacy_settings', { pane: 'calendars' });
    } else if (id === 'reminders') {
      const s = await grantEventKit('reminder');
      setRow(id, s);
      if (s === 'denied') invoke('open_privacy_settings', { pane: 'reminders' });
    } else if (id === 'notes') {
      const s = await grantAutomation('notes', 'notes');
      setRow(id, s);
      if (s === 'denied') invoke('open_privacy_settings', { pane: 'automation' });
    } else if (id === 'mail') {
      setProfileSettingsTab('connect');
      setShowProfileSettings(true);
      setRow(id, 'unknown'); // Re-probe isn't strictly needed as it relies on store state
    } else if (id === 'dream') {
      setProfileSettingsTab('agent');
      setShowProfileSettings(true);
      setRow(id, 'unknown');
    }
  };

  const cards = [
    {
      id: 'mail',
      title: 'Mail',
      description: 'Unlock daily briefings and email watcher routines.',
      icon: Mail,
      iconBg: 'bg-orange-500/15',
      iconColor: 'text-orange-600 dark:text-orange-400',
      status: hasMail ? 'granted' : 'unknown',
    },
    {
      id: 'calendar',
      title: 'Calendar',
      description: 'Read and create events in your real calendars.',
      icon: CalendarDays,
      iconBg: 'bg-violet-500/15',
      iconColor: 'text-violet-600 dark:text-violet-400',
      status: states['calendar'] || 'unknown',
    },
    {
      id: 'reminders',
      title: 'To-Dos',
      description: 'Manage tasks via Apple Reminders directly.',
      icon: ListChecks,
      iconBg: 'bg-emerald-500/15',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      status: states['reminders'] || 'unknown',
    },
    {
      id: 'notes',
      title: 'Notes',
      description: 'Read and update Apple Notes instantly.',
      icon: StickyNote,
      iconBg: 'bg-amber-500/15',
      iconColor: 'text-amber-600 dark:text-amber-400',
      status: states['notes'] || 'unknown',
    },
    {
      id: 'dream',
      title: 'Dream Cycle',
      description: 'Consolidates memory and plans your next day overnight.',
      icon: Moon,
      iconBg: 'bg-indigo-500/15',
      iconColor: 'text-indigo-600 dark:text-indigo-400',
      status: dreamEnabled ? 'granted' : 'unknown',
    }
  ];

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent/15">
          <Settings className="w-4 h-4 text-accent" />
        </div>
        <div>
          <h2 className="text-lg font-black text-ink tracking-tight">Connect your life</h2>
          <p className="text-[13px] text-ink-3">Hook up your apps to unlock the true power of Agent Forge.</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map(c => {
          const isGranted = c.status === 'granted';
          const isChecking = c.status === 'checking';
          const isDenied = c.status === 'denied';

          return (
            <div key={c.id} className="group flex flex-col p-4 rounded-2xl border border-edge bg-panel-2 hover:bg-panel transition-all shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <div className={`p-2 rounded-xl ${c.iconBg}`}>
                  <c.icon className={`w-4 h-4 ${c.iconColor}`} />
                </div>
                {isGranted && (
                  <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-success">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                  </div>
                )}
              </div>
              <h3 className="text-sm font-bold text-ink mb-1">{c.title}</h3>
              <p className="text-[11px] text-ink-3 leading-relaxed mb-4 flex-1">
                {c.description}
              </p>
              
              {!isGranted && (
                <button
                  onClick={() => handleAction(c.id)}
                  disabled={isChecking}
                  className={`flex items-center justify-center gap-1.5 w-full py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
                    isDenied 
                      ? 'bg-danger-soft text-danger hover:bg-danger hover:text-danger-soft'
                      : 'bg-accent/10 text-accent hover:bg-accent hover:text-on-accent'
                  }`}
                >
                  {isChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {!isChecking && isDenied ? 'Fix Permission' : null}
                  {!isChecking && !isDenied ? (c.id === 'mail' || c.id === 'dream' ? 'Configure' : 'Connect') : null}
                  {!isChecking && <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
