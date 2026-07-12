import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles, ArrowRight, X } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { db } from '../services/database';
import { pickSetupNudge, type SetupNudge, type NudgeId } from '../services/setupNudge';

const DISMISS_KEY = 'setupNudgeDismissed';

/**
 * The proactive setup nudge (home page). Shows the single highest-value unconfigured capability as a
 * gentle, dismissible banner. "Not now" hides it for the session; the × permanently dismisses it
 * (persisted) and it never returns — autonomy first. See services/setupNudge.ts for the design.
 */
export function SetupNudgeBar() {
  const models = useSettingsStore(s => s.models);
  const integrations = useSettingsStore(s => s.integrations);
  const onboardingComplete = useSettingsStore(s => s.onboardingComplete);

  const [dismissed, setDismissed] = useState<NudgeId[]>([]);
  const [screenGranted, setScreenGranted] = useState<boolean | null>(null);
  const [snoozed, setSnoozed] = useState(false);

  useEffect(() => { void db.get(DISMISS_KEY, []).then(setDismissed); }, []);
  useEffect(() => { invoke<boolean>('screen_capture_authorized').then(setScreenGranted).catch(() => setScreenGranted(null)); }, []);

  const hasUsableModel = models.some(m => !m.isLocal ? !!m.apiKey || m.provider === 'web-llm' : true);
  const mailAccountCount = ((integrations as any)?.mailAccounts ?? []).length;

  const nudge: SetupNudge | null = snoozed ? null : pickSetupNudge({
    onboardingComplete, hasUsableModel, mailAccountCount, screenGranted, routineCount: 0, dismissed,
  });
  if (!nudge) return null;

  const act = () => {
    const s = useSettingsStore.getState();
    if (nudge.id === 'connect-mail') { s.setProfileSettingsTab('connect'); s.setShowProfileSettings(true); }
    else if (nudge.id === 'grant-screen') { s.setProfileSettingsTab('connect'); s.setShowProfileSettings(true); }
  };

  const dismissForever = async () => {
    const next = [...dismissed, nudge.id];
    setDismissed(next);
    await db.set(DISMISS_KEY, next);
  };

  return (
    <div className="flex items-center gap-4 p-4 rounded-2xl border border-accent/30 bg-accent-soft/30 animate-in fade-in slide-in-from-top-2">
      <div className="p-2.5 rounded-xl bg-accent/15 shrink-0"><Sparkles className="w-5 h-5 text-accent" /></div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-black text-ink">{nudge.title}</span>
        <span className="text-xs text-ink-2 leading-relaxed">{nudge.body}</span>
      </div>
      <button onClick={act}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest bg-accent text-on-accent hover:bg-accent-strong transition-all shadow-sm shrink-0">
        {nudge.cta} <ArrowRight className="w-3 h-3" />
      </button>
      <button onClick={() => setSnoozed(true)} title="Not now"
        className="text-[11px] text-ink-3 hover:text-ink-2 px-1 shrink-0">Not now</button>
      <button onClick={() => void dismissForever()} title="Don't remind me"
        className="p-1 text-ink-3 hover:text-ink-2 transition-colors shrink-0"><X className="w-4 h-4" /></button>
    </div>
  );
}
