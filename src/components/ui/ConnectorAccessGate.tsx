import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * First-run / no-access gate for a native-backed connector panel (Calendar, Reminders, Notes).
 * Shown when the panel's backend is native but macOS hasn't granted access yet — replaces the empty
 * grid / raw error with a clear "here's how to turn this on" card + a button that fires the OS prompt.
 */
export function ConnectorAccessGate({
  icon: Icon, title, body, buttonLabel, onConnect, busy, error,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
  buttonLabel: string;
  onConnect: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-8 py-10">
      <div className="w-14 h-14 rounded-2xl bg-inset border border-edge-2 flex items-center justify-center shrink-0">
        <Icon className="w-7 h-7 text-accent" />
      </div>
      <div className="space-y-1.5 max-w-sm">
        <h2 className="text-base font-bold text-ink">{title}</h2>
        <p className="text-sm text-ink-2 leading-relaxed">{body}</p>
      </div>
      <button
        onClick={onConnect}
        disabled={busy}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-accent text-on-accent hover:bg-accent-strong transition-all shadow-md disabled:opacity-40"
      >
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} {buttonLabel}
      </button>
      {error && <p className="text-xs text-danger max-w-sm break-words">{error}</p>}
      <p className="text-[11px] text-ink-3 max-w-sm leading-relaxed">
        You can switch back to keeping this on-device anytime in Settings → Integrations.
      </p>
    </div>
  );
}
