import { useState } from 'react';
import { Check, Undo2, RotateCcw } from 'lucide-react';
import { useReceiptStore } from '../../services/receipts';

/**
 * What Docent actually did, pinned under the reply that did it.
 *
 * The receipt ledger already recorded all of this — it was just only visible in the Activity
 * Center, a panel you had to know to go open. In the conversation the only signal was a toast,
 * which expires in seconds, so by the time you wondered "wait, what did it just touch?" the
 * answer was gone. This shows the same receipts, in place, permanently, and keeps the undo
 * affordance attached to the thing it undoes.
 *
 * Undo is offered only when a handler is genuinely still registered: `isUndoable` consults the
 * live registry rather than a stored flag, so a receipt from before a restart correctly shows as
 * no-longer-reversible instead of dangling a button that would throw.
 */
export function ActivityTrail({ receiptIds }: { receiptIds: string[] }) {
  const receipts = useReceiptStore(s => s.receipts);
  const undo = useReceiptStore(s => s.undo);
  const isUndoable = useReceiptStore(s => s.isUndoable);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const mine = receiptIds.map(id => receipts.find(r => r.id === id)).filter(Boolean) as typeof receipts;
  if (mine.length === 0) return null;

  // One action is self-evident from its own line; several collapse so a busy turn doesn't bury
  // the reply it belongs to.
  const collapsed = mine.length > 2 && !expanded;
  const shown = collapsed ? mine.slice(0, 2) : mine;

  return (
    <div className="mt-2 w-full max-w-[92%] rounded-xl border border-edge/50 glass-sky px-3 py-2">
      <div className="flex flex-col gap-1.5">
        {shown.map(r => {
          const undone = r.status === 'undone';
          return (
            <div key={r.id} className="flex items-start gap-2 text-[11px]">
              <span className={`mt-[3px] flex h-3 w-3 shrink-0 items-center justify-center rounded-full ${undone ? 'bg-wash' : 'bg-success/20'}`}>
                {undone
                  ? <RotateCcw className="h-2 w-2 text-ink-3" />
                  : <Check className="h-2 w-2 text-success" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`font-medium ${undone ? 'text-ink-3 line-through' : 'text-ink-2'}`}>{r.action}</span>
                {r.summary && r.summary !== r.action && (
                  <span className="text-ink-3"> — {r.summary}</span>
                )}
              </span>
              {!undone && isUndoable(r.id) && (
                <button
                  disabled={busy === r.id}
                  onClick={async () => {
                    setBusy(r.id);
                    try { await undo(r.id); } catch { /* handler gone; the row re-renders as-is */ }
                    setBusy(null);
                  }}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-ink-3 transition-colors hover:bg-wash hover:text-ink disabled:opacity-50"
                  title="Undo this action"
                >
                  <Undo2 className="h-2.5 w-2.5" /> Undo
                </button>
              )}
            </div>
          );
        })}
      </div>
      {mine.length > 2 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-1.5 text-[10px] font-medium text-ink-3 transition-colors hover:text-ink-2"
        >
          {collapsed ? `Show ${mine.length - 2} more` : 'Show less'}
        </button>
      )}
    </div>
  );
}
