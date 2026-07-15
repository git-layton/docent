import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  Monitor, CalendarDays, ListChecks, StickyNote, Send, MessageSquare,
  CheckCircle2, Loader2, ExternalLink, ShieldCheck, RotateCw, Globe, Compass, MousePointer2
} from 'lucide-react';

/**
 * The "Mac permissions" hub — every macOS grant the assistant needs, in one card, requestable
 * up-front instead of failing mid-task. Sits at the top of Settings → Connect your apps.
 *
 * macOS quirks this encodes so the user doesn't have to know them:
 *  - Most grants prompt exactly ONCE; after a deny the OS goes silent, so denied rows swap the
 *    Grant button for a deep link to the exact System Settings pane.
 *  - Screen Recording and Full Disk Access only take effect after an app relaunch → Restart button.
 *  - Automation (Notes/Messages) consent can only be requested by actually sending the app an
 *    AppleEvent — which launches it. No silent status probe exists, so those rows remember the
 *    last known result (localStorage) instead of auto-probing on mount.
 */

type RowState = 'unknown' | 'checking' | 'granted' | 'denied' | 'needsRestart';

interface RowDef {
  id: string;
  label: string;
  desc: string;
  icon: typeof Monitor;
  /** Silent status probe run on mount; omit when macOS offers none (Automation). */
  probe?: () => Promise<RowState>;
  /** Fire the real consent prompt; returns the resulting state. */
  grant: () => Promise<RowState>;
  /** System Settings pane for the no-re-prompt case. */
  settingsPane: () => Promise<unknown>;
  /** Grant needs an app relaunch to take effect. */
  restartToApply?: boolean;
}

const AUTOMATION_LS_KEY = (id: string) => `af-perm-${id}`;

// Automation rows: no silent probe exists, so persist the last probe result.
const automationRow = (id: string, target: string, label: string, desc: string, icon: typeof Monitor): RowDef => ({
  id, label, desc, icon,
  grant: async () => {
    const res = await invoke<string>('automation_grant', { target });
    const state: RowState = res === 'granted' ? 'granted' : 'denied';
    localStorage.setItem(AUTOMATION_LS_KEY(id), state);
    return state;
  },
  settingsPane: () => invoke('open_privacy_settings', { pane: 'automation' }),
});

const eventkitRow = (id: string, kind: 'event' | 'reminder', pane: string, label: string, desc: string, icon: typeof Monitor): RowDef => ({
  id, label, desc, icon,
  probe: async () => {
    const s = await invoke<string>('eventkit_authorization_status', { kind });
    return s === 'authorized' || s === 'writeOnly' ? 'granted' : s === 'denied' || s === 'restricted' ? 'denied' : 'unknown';
  },
  grant: async () => (await invoke<boolean>('eventkit_request_access', { kind })) ? 'granted' : 'denied',
  settingsPane: () => invoke('open_privacy_settings', { pane }),
});

const ROWS: RowDef[] = [
  {
    id: 'screen', label: 'Screen Reading', icon: Monitor,
    desc: 'Let the assistant read what’s on your screen (on-device OCR).',
    probe: async () => (await invoke<boolean>('screen_capture_authorized')) ? 'granted' : 'unknown',
    grant: async () => (await invoke<boolean>('request_screen_capture_access')) ? 'granted' : 'needsRestart',
    settingsPane: () => invoke('open_screen_recording_settings'),
    restartToApply: true,
  },
  {
    id: 'accessibility', label: 'Accessibility (Desktop Control)', icon: MousePointer2,
    desc: 'Let the assistant click and interact with your desktop natively.',
    probe: async () => (await invoke<boolean>('accessibility_authorized')) ? 'granted' : 'unknown',
    grant: async () => (await invoke<boolean>('accessibility_request_access')) ? 'granted' : 'needsRestart',
    settingsPane: () => invoke('open_privacy_settings', { pane: 'accessibility' }),
    restartToApply: true,
  },
  eventkitRow('calendar', 'event', 'calendars', 'Calendar', 'Read and create events in your real calendars (iCloud, Google…).', CalendarDays),
  eventkitRow('reminders', 'reminder', 'reminders', 'Reminders', 'Read and create to-dos in Apple Reminders.', ListChecks),
  automationRow('notes', 'notes', 'Apple Notes', 'Read, create, and update notes. Granting opens Notes once.', StickyNote),
  automationRow('messages-send', 'messages', 'Messages — send', 'Send iMessages on your behalf. Granting opens Messages once.', Send),
  // NOTE: this is the permission macOS's confusing "wants to control" dialog is about — it is
  // Automation, NOT Accessibility; ticking the app in the Accessibility pane does nothing.
  automationRow('chrome', 'chrome', 'Chrome — active tab', 'Read the current tab so answers can use the page. Full-page text also needs Chrome: View → Developer → Allow JavaScript from Apple Events.', Globe),
  automationRow('safari', 'safari', 'Safari — active tab', 'Read the current tab. Full-page text also needs Safari: Develop menu → Allow JavaScript from Apple Events.', Compass),
  {
    id: 'messages-read', label: 'Messages — read', icon: MessageSquare,
    desc: 'Read conversations (Full Disk Access — macOS never prompts for this one; grant it in System Settings).',
    probe: async () => { await invoke<number>('imessage_check_access'); return 'granted'; },
    grant: async () => { await invoke('imessage_open_fda_settings'); return 'needsRestart'; },
    settingsPane: () => invoke('imessage_open_fda_settings'),
    restartToApply: true,
  },
];

export function MacPermissionsCard() {
  const [states, setStates] = useState<Record<string, RowState>>({});
  const setRow = useCallback((id: string, s: RowState) => setStates(prev => ({ ...prev, [id]: s })), []);

  // Silent probes on mount; Automation rows restore their last known result instead.
  useEffect(() => {
    for (const row of ROWS) {
      if (row.probe) {
        row.probe().then(s => setRow(row.id, s)).catch(() => setRow(row.id, 'unknown'));
      } else {
        const remembered = localStorage.getItem(AUTOMATION_LS_KEY(row.id)) as RowState | null;
        setRow(row.id, remembered === 'granted' || remembered === 'denied' ? remembered : 'unknown');
      }
    }
  }, [setRow]);

  const runGrant = async (row: RowDef) => {
    setRow(row.id, 'checking');
    try {
      setRow(row.id, await row.grant());
    } catch (e) {
      // Real transport/invoke failures land here too — log them so a broken bridge isn't
      // silently misread as a permission denial.
      console.warn(`[mac-permissions] grant failed for ${row.id}:`, e);
      setRow(row.id, row.restartToApply ? 'needsRestart' : 'denied');
    }
  };

  return (
    <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-inset rounded-xl shadow-sm border border-edge-2"><ShieldCheck className="w-5 h-5 text-secondary" /></div>
        <div className="flex flex-col">
          <span className="text-sm font-black uppercase tracking-widest block">Mac permissions</span>
          <span className="text-xs text-ink-3 font-medium mt-0.5">
            Grant everything up-front instead of hitting pop-ups mid-task. All access stays on this Mac.
          </span>
        </div>
      </div>

      {ROWS.map(row => {
        const state = states[row.id] ?? 'unknown';
        const Icon = row.icon;
        return (
          <div key={row.id} className="flex items-center gap-3 pt-4 border-t border-edge">
            <Icon className="w-4 h-4 text-ink-3 shrink-0" />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-bold">{row.label}</span>
              <span className="text-tiny font-medium text-ink-3">{row.desc}</span>
            </div>

            {state === 'checking' && <Loader2 className="w-4 h-4 animate-spin text-ink-3 shrink-0" />}
            {state === 'granted' && (
              <span className="flex items-center gap-1.5 text-tiny font-black uppercase tracking-widest text-success-light shrink-0">
                <CheckCircle2 className="w-4 h-4" /> Granted
              </span>
            )}

            {state === 'unknown' && (
              <button
                onClick={() => void runGrant(row)}
                className="px-4 py-2 rounded-xl text-tiny font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all shadow-sm shrink-0"
              >Grant</button>
            )}

            {state === 'denied' && (
              <button
                onClick={() => void row.settingsPane().catch(() => {})}
                title="macOS won't re-prompt after a deny — flip it on in System Settings instead"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-tiny font-black uppercase tracking-widest border border-edge-2 text-ink-2 hover:bg-wash transition-all shrink-0"
              ><ExternalLink className="w-3 h-3" /> Open Settings</button>
            )}

            {state === 'needsRestart' && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => void row.settingsPane().catch(() => {})}
                  title="If you denied the prompt, flip it on here — macOS won't ask again"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-tiny font-black uppercase tracking-widest border border-edge-2 text-ink-2 hover:bg-wash transition-all"
                ><ExternalLink className="w-3 h-3" /> Settings</button>
                <button
                  onClick={() => { void relaunch(); }}
                  title="macOS applies this permission only after the app restarts"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-tiny font-black uppercase tracking-widest bg-accent text-on-accent hover:bg-accent-strong transition-all shadow-sm"
                ><RotateCw className="w-3 h-3" /> Restart to apply</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
