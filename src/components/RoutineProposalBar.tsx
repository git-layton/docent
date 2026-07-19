import { Repeat, Check, X } from 'lucide-react';
import { useUIStore } from '../store/useUIStore';
import { useAgentStore } from '../store/useAgentStore';
import { db } from '../services/database';
import type { Routine } from '../services/routines';

/**
 * The "ask Docent to set up a routine" confirmation. When a chat message reads as a recurring or
 * watch request (`detectRoutineIntent`), this bar offers to create it — the user always confirms
 * before anything is scheduled (propose-don't-run, same discipline as playbooks). Saved routines
 * are executed by the scheduler in App.tsx; the Planner's Routines card manages them afterward.
 */
export function RoutineProposalBar() {
  const proposed = useUIStore(s => s.proposedRoutine);
  const setProposed = useUIStore(s => s.setProposedRoutine);
  if (!proposed) return null;

  const create = async () => {
    const { assistants, activeFolderId } = useAgentStore.getState();
    const owner = assistants.find(a => a.id === activeFolderId) ?? assistants[0];
    if (!owner) { setProposed(null); return; }
    const routine: Routine = {
      id: `routine-${Date.now()}`,
      name: proposed.name,
      trigger: proposed.trigger,
      action: proposed.action,
      sources: proposed.sources,
      fromContains: proposed.fromContains,
      subjectContains: proposed.subjectContains,
      ownerId: owner.id,
      ownerLabel: owner.name,
      enabled: true,
      createdAt: Date.now(),
    };
    const existing: Routine[] = await db.get('routines', []);
    await db.set('routines', [routine, ...existing]);
    setProposed(null);
  };

  return (
    <div className="mb-2 p-3 rounded-2xl bg-accent-soft/40 border border-accent/30 animate-in slide-in-from-bottom-2">
      <div className="flex items-center gap-2 mb-1 text-ink font-bold text-xs">
        <Repeat className="w-4 h-4 text-accent shrink-0" /> Set this up as a routine?
      </div>
      <p className="text-tiny text-ink-2 mb-2 leading-relaxed">{proposed.summary} You can tweak or remove it in Planner → Routines.</p>
      <div className="flex items-center gap-2">
        <button onClick={() => void create()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest bg-accent text-on-accent hover:bg-accent-strong transition-all">
          <Check className="w-3 h-3" /> Create routine
        </button>
        <button onClick={() => setProposed(null)}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-bold text-ink-3 hover:text-ink-2 transition-colors">
          <X className="w-3 h-3" /> Not now
        </button>
      </div>
    </div>
  );
}
