import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ShieldCheck, CheckCircle2, Loader2, ExternalLink, Check } from 'lucide-react';

type AccessState = { state: 'idle' | 'checking' | 'ok' | 'error'; count?: number; msg?: string };

/**
 * Shared Full Disk Access grant + verify control for iMessage access. Used by BOTH the first-run
 * Messages wizard and the Settings → Connect your apps card, so the macOS permission walkthrough and
 * the `imessage_check_access` probe live in exactly one place (no more two drifting copies).
 * Calls `onVerified(count)` once a probe succeeds; the caller decides what to persist.
 */
export function FullDiskAccessGrant({
  onVerified,
  autoProbe = false,
}: {
  onVerified?: (count: number) => void;
  autoProbe?: boolean;
}) {
  const [access, setAccess] = useState<AccessState>({ state: 'idle' });
  // Keep the latest callback in a ref so `check` stays referentially stable (no autoProbe loop).
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;

  const check = useCallback(async () => {
    setAccess({ state: 'checking' });
    try {
      const count = await invoke<number>('imessage_check_access');
      setAccess({ state: 'ok', count });
      onVerifiedRef.current?.(count);
    } catch (e) {
      setAccess({ state: 'error', msg: String(e) });
    }
  }, []);

  // Auto-detect when the control mounts (e.g. the user lands on the wizard's access step) — catches
  // the case where access was already granted, so we can show "connected" without a manual click.
  useEffect(() => { if (autoProbe) void check(); }, [autoProbe, check]);

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => invoke('imessage_open_fda_settings').catch(() => {})}
        className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all shadow-sm"
      >
        <ExternalLink className="w-3.5 h-3.5" /> Open Full Disk Access
      </button>

      <div className={`flex items-center gap-3 p-3 rounded-2xl border transition-colors ${access.state === 'ok' ? 'bg-success-light/10 border-success-light/30' : 'bg-inset border-edge'}`}>
        {access.state === 'checking' && <Loader2 className="w-5 h-5 animate-spin text-ink-3 shrink-0" />}
        {access.state === 'ok' && <CheckCircle2 className="w-5 h-5 text-success-light shrink-0" />}
        {(access.state === 'error' || access.state === 'idle') && <ShieldCheck className="w-5 h-5 text-ink-3 shrink-0" />}
        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          {access.state === 'idle' && <span className="text-ink-2">Switch on Agent Forge above, then check access.</span>}
          {access.state === 'checking' && <span className="text-ink-2">Checking access…</span>}
          {access.state === 'ok' && <span className="font-bold text-success-light">Connected — {(access.count ?? 0).toLocaleString()} conversations found.</span>}
          {access.state === 'error' && (
            <span className="text-ink-2">Not detected yet — switch on Agent Forge in Full Disk Access, then check again. <span className="text-ink-3">(A full quit &amp; relaunch may be needed after granting.)</span></span>
          )}
        </div>
      </div>

      {access.state !== 'ok' && (
        <button
          onClick={check}
          disabled={access.state === 'checking'}
          className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest border border-edge-2 text-ink-2 hover:bg-wash transition-all disabled:opacity-40"
        >
          {access.state === 'checking' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</> : <><Check className="w-3.5 h-3.5" /> Check access</>}
        </button>
      )}
    </div>
  );
}
