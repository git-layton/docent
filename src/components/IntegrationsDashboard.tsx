import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Mail, CalendarDays, ListChecks, StickyNote, Moon, CheckCircle2, ChevronRight, Loader2, Settings } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';

type RowState = 'unknown' | 'checking' | 'granted' | 'denied' | 'needsRestart';

const AUTOMATION_LS_KEY = (id: string) => `af-perm-${id}`;

export function IntegrationsDashboard() {
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [showMailConfig, setShowMailConfig] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle');
  const [oauthError, setOauthError] = useState('');
  
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
      setShowMailConfig(true);
      setRow(id, 'unknown');
    } else if (id === 'dream') {
      setProfileSettingsTab('privacy');
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
      description: 'Consolidates memory, saves insights, and flags loose ends. You get a digest after every run.',
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
          <p className="text-[13px] text-ink-3">Hook up your apps to unlock the true power of Docent.</p>
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

      {showMailConfig && (
        <div className="mt-6 p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4 animate-in slide-in-from-top-4">
          <div className="flex items-center gap-3 mb-2">
             <div className="p-3 bg-orange-500/15 rounded-xl shadow-sm"><Mail className="w-5 h-5 text-orange-600 dark:text-orange-400" /></div>
             <div>
               <h3 className="text-sm font-bold text-ink">Sign in with Google</h3>
               <p className="text-[11px] text-ink-3">Provide your own OAuth Client ID to securely connect your Gmail account via XOAUTH2.</p>
             </div>
          </div>
          
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-ink-3 block mb-1.5">Google Client ID</label>
              <input type="text" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="e.g. 12345-abcde.apps.googleusercontent.com" className="w-full bg-inset border border-edge-2 rounded-xl px-4 py-2.5 text-[13px] outline-none focus:border-accent transition-all" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-ink-3 block mb-1.5">Google Client Secret</label>
              <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="e.g. GOCSPX-12345..." className="w-full bg-inset border border-edge-2 rounded-xl px-4 py-2.5 text-[13px] outline-none focus:border-accent transition-all" />
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between gap-4">
            <button onClick={() => setShowMailConfig(false)} className="px-4 py-2 text-xs font-bold text-ink-3 hover:text-ink transition-colors">Cancel</button>
            <button 
              disabled={!clientId || !clientSecret || oauthStatus === 'waiting'}
              onClick={async () => {
                setOauthStatus('waiting');
                setOauthError('');
                try {
                  const port = 18451;
                  // Start the local server
                  const authPromise = invoke<string>('start_oauth_server', { port });
                  // Open the browser
                  const redirectUri = `http://127.0.0.1:${port}`;
                  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://mail.google.com/%20https://www.googleapis.com/auth/userinfo.email&access_type=offline&prompt=consent`;
                  await invoke('open_url', { url: authUrl }).catch(async () => {
                    // Fallback to Shell open
                    const { open } = await import('@tauri-apps/plugin-shell');
                    await open(authUrl);
                  });
                  // Wait for the server to get the code
                  const code = await authPromise;
                  
                  // Exchange code for token
                  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                      client_id: clientId,
                      client_secret: clientSecret,
                      code,
                      grant_type: 'authorization_code',
                      redirect_uri: redirectUri
                    }).toString()
                  });
                  const tokenData = await tokenRes.json();
                  if (!tokenData.refresh_token) throw new Error('No refresh token received. Ensure you are prompting for consent.');
                  
                  // Fetch user email
                  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: { Authorization: `Bearer ${tokenData.access_token}` }
                  });
                  const profileData = await profileRes.json();
                  if (!profileData.email) throw new Error('Could not fetch email from Google profile.');
                  const userEmail = profileData.email;

                  // Save the oauth payload to keychain
                  const oauthPayload = `oauth2:${clientId}:${clientSecret}:${tokenData.refresh_token}`;
                  await invoke('keychain_save', { host: `mail:${userEmail}`, username: 'oauth2', password: oauthPayload });
                  
                  useSettingsStore.getState().setIntegrations((prev: any) => {
                    const rest = (prev.mailAccounts ?? []).filter((a: any) => a.provider !== 'gmail');
                    return { ...prev, mailAccounts: [...rest, { id: `mail-${Date.now()}`, provider: 'gmail', email: userEmail }] };
                  });
                  await useSettingsStore.getState().persist();
                  
                  setOauthStatus('success');
                  setTimeout(() => setShowMailConfig(false), 2000);
                } catch (e: any) {
                  setOauthStatus('error');
                  setOauthError(e.message || String(e));
                }
              }}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-on-accent rounded-xl text-xs font-black uppercase tracking-widest hover:bg-accent-strong disabled:opacity-50 transition-all active:scale-95 shadow-sm"
            >
              {oauthStatus === 'waiting' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {oauthStatus === 'success' && <CheckCircle2 className="w-3.5 h-3.5" />}
              {oauthStatus === 'idle' || oauthStatus === 'error' ? 'Authenticate' : oauthStatus === 'waiting' ? 'Waiting for Browser...' : 'Success'}
            </button>
          </div>
          {oauthError && <div className="text-danger text-xs font-bold bg-danger-soft p-3 rounded-lg border border-danger/30">{oauthError}</div>}
        </div>
      )}
    </div>
  );
}
