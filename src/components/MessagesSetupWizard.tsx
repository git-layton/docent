import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  MessageCircle, ShieldCheck, Send, ArrowRight, ChevronLeft, Check, CheckCircle2,
  Loader2, ExternalLink, Users, Reply,
} from 'lucide-react';

const TOTAL = 3;

type AccessState = { state: 'idle' | 'checking' | 'ok' | 'error'; count?: number; msg?: string };

/**
 * First-open setup flow for the Messages tab. Walks the user through the two macOS permissions
 * iMessage needs (Full Disk Access to read, Automation to send) and verifies access live. Renders
 * inside the panel (not a modal). Calls `onComplete` once the user finishes or skips — the caller
 * persists `imessage.setupComplete` so this only auto-shows once.
 */
export function MessagesSetupWizard({ onComplete }: { onComplete: (accessOk: boolean) => void }) {
  const [step, setStep] = useState(1);
  const [access, setAccess] = useState<AccessState>({ state: 'idle' });

  const check = useCallback(async () => {
    setAccess({ state: 'checking' });
    try {
      const count = await invoke<number>('imessage_check_access');
      setAccess({ state: 'ok', count });
    } catch (e) {
      setAccess({ state: 'error', msg: String(e) });
    }
  }, []);

  // Auto-probe when the user lands on the Full Disk Access step — catches the case where access was
  // already granted (e.g. via Settings) so we can skip straight ahead.
  useEffect(() => {
    if (step === 2) check();
  }, [step, check]);

  const finish = () => onComplete(access.state === 'ok');

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
      {/* Header: back + progress dots + skip */}
      <div className="h-12 flex items-center gap-2 px-3 border-b border-edge shrink-0">
        <button
          onClick={() => setStep(s => Math.max(1, s - 1))}
          className={`p-1.5 rounded-lg transition-colors ${step > 1 ? 'text-ink-3 hover:bg-wash hover:text-ink' : 'invisible'}`}
          title="Back"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 flex items-center justify-center gap-1.5">
          {Array.from({ length: TOTAL }, (_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i + 1 === step ? 'w-5 bg-accent' : 'w-1.5 bg-edge-2'}`} />
          ))}
        </div>
        <button onClick={finish} className="text-[11px] font-semibold text-ink-3 hover:text-ink px-2 py-1 rounded-lg transition-colors">
          Skip
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-8 py-8">
        <div className="w-full max-w-sm">
          {step === 1 && (
            <div className="flex flex-col items-center text-center gap-6">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-accent to-accent-strong flex items-center justify-center shadow-xl shadow-accent/20">
                <MessageCircle className="w-8 h-8 text-on-accent" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-black tracking-tight text-ink">Bring your Messages in</h1>
                <p className="text-sm text-ink-2 leading-relaxed">
                  Your iMessage &amp; SMS, right here in Agent Forge. Everything stays on your Mac — no servers, no accounts, nothing uploaded.
                </p>
              </div>
              <div className="w-full space-y-2.5 text-left">
                {[
                  { icon: MessageCircle, text: 'Read all your conversations' },
                  { icon: Users, text: 'Match numbers & emails to contact names' },
                  { icon: Reply, text: 'Reply right from here' },
                ].map(({ icon: Icon, text }, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm text-ink-2">
                    <div className="w-7 h-7 rounded-xl bg-inset flex items-center justify-center shrink-0">
                      <Icon className="w-3.5 h-3.5 text-accent" />
                    </div>
                    {text}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setStep(2)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-accent text-on-accent hover:bg-accent-strong transition-all shadow-md"
              >
                Set it up <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-inset flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <h2 className="text-xl font-black tracking-tight text-ink">Allow access</h2>
                  <p className="text-xs text-ink-2 mt-0.5">macOS gates your messages behind Full Disk Access.</p>
                </div>
              </div>

              <ol className="text-sm text-ink-2 leading-relaxed flex flex-col gap-2.5">
                {[
                  <>Click <span className="font-semibold text-ink">Open Full Disk Access</span> below.</>,
                  <>Toggle <span className="font-semibold text-ink">Agent Forge</span> on in the list.</>,
                  <>Come back here — it detects automatically.</>,
                ].map((node, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-inset text-ink-3 flex items-center justify-center font-black text-[10px] mt-0.5">{i + 1}</span>
                    <span>{node}</span>
                  </li>
                ))}
              </ol>

              <button
                onClick={() => invoke('imessage_open_fda_settings').catch(() => {})}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all shadow-sm"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open Full Disk Access
              </button>

              {/* Live access status */}
              <div className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-colors ${
                access.state === 'ok' ? 'bg-success-soft border-success/30'
                : access.state === 'checking' ? 'bg-inset border-edge'
                : access.state === 'error' ? 'bg-inset border-edge'
                : 'bg-inset border-edge'
              }`}>
                {access.state === 'checking' && <Loader2 className="w-5 h-5 animate-spin text-ink-3 shrink-0" />}
                {access.state === 'ok' && <CheckCircle2 className="w-5 h-5 text-success shrink-0" />}
                {(access.state === 'error' || access.state === 'idle') && <ShieldCheck className="w-5 h-5 text-ink-3 shrink-0" />}
                <div className="min-w-0 flex-1">
                  {access.state === 'checking' && <p className="text-sm text-ink-2">Checking access…</p>}
                  {access.state === 'ok' && <p className="text-sm font-bold text-success">Connected — {(access.count ?? 0).toLocaleString()} conversations found</p>}
                  {access.state === 'error' && <p className="text-sm text-ink-2">Not detected yet — flip the switch, then check again.</p>}
                  {access.state === 'idle' && <p className="text-sm text-ink-2">Grant access, then check.</p>}
                </div>
              </div>

              {access.state === 'ok' ? (
                <button
                  onClick={() => setStep(3)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-accent text-on-accent hover:bg-accent-strong transition-all shadow-md"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={check}
                    disabled={access.state === 'checking'}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black uppercase tracking-widest border border-edge-2 text-ink-2 hover:bg-wash transition-all disabled:opacity-40"
                  >
                    {access.state === 'checking' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</> : <><Check className="w-3.5 h-3.5" /> I've enabled it — check again</>}
                  </button>
                  <button onClick={() => setStep(3)} className="text-[11px] font-semibold text-ink-3 hover:text-ink py-1 transition-colors">
                    Continue anyway
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center text-center gap-6">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-accent to-accent-strong flex items-center justify-center shadow-xl shadow-accent/20">
                <Send className="w-7 h-7 text-on-accent" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-black tracking-tight text-ink">One more thing — sending</h1>
                <p className="text-sm text-ink-2 leading-relaxed">
                  The first time you send a message, macOS will ask to let Agent Forge control the Messages app. Just click <span className="font-semibold text-ink">OK</span> — that's the last permission.
                </p>
              </div>

              {access.state === 'ok' ? (
                <div className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-success-soft border border-success/30 text-left">
                  <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                  <p className="text-sm font-bold text-success">You're connected — {(access.count ?? 0).toLocaleString()} conversations ready.</p>
                </div>
              ) : (
                <div className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-inset border border-edge text-left">
                  <ShieldCheck className="w-5 h-5 text-ink-3 shrink-0" />
                  <p className="text-sm text-ink-2">If messages don't load, you can grant Full Disk Access any time — there's a shortcut on the empty screen.</p>
                </div>
              )}

              <button
                onClick={finish}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-accent text-on-accent hover:bg-accent-strong transition-all shadow-md"
              >
                Start messaging <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
