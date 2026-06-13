import { useState } from 'react';
import { X } from 'lucide-react';
import { useAgentStore } from '../store/useAgentStore';
import { AgentIcon } from './ui/AgentIcon';

interface ArtifactStartModalProps {
  type: 'code' | 'doc';
  onConfirm: (agentId: string) => void;
  onCancel: () => void;
}

export function ArtifactStartModal({ type, onConfirm, onCancel }: ArtifactStartModalProps) {
  const assistants = useAgentStore(s => s.assistants);
  const visibleAgents = assistants.filter(a => a.id !== 'forge-guide' && a.id !== 'f-default');
  const [selectedId, setSelectedId] = useState(visibleAgents[0]?.id ?? '');

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-150" onClick={onCancel}>
      <div className="bg-panel-2 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-sm font-black tracking-tight">
            {type === 'code' ? 'New App' : 'New Doc'} — work on it with…
          </h2>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-wash text-ink-3">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-2 flex flex-wrap gap-2">
          {visibleAgents.map(agent => (
            <button
              key={agent.id}
              onClick={() => setSelectedId(agent.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all text-sm font-bold ${
                selectedId === agent.id
                  ? 'border-accent bg-accent-soft/40 text-accent'
                  : 'border-edge text-ink-2 hover:border-edge-2'
              }`}
            >
              <AgentIcon agent={agent} sizeClass="w-3.5 h-3.5" containerClass="p-1 rounded-md" />
              {agent.name}
            </button>
          ))}
        </div>

        <div className="px-5 py-4">
          <button
            onClick={() => selectedId && onConfirm(selectedId)}
            disabled={!selectedId}
            className="w-full py-3 bg-accent hover:bg-accent-strong text-on-accent font-black text-[11px] uppercase tracking-widest rounded-xl transition-all active:scale-95 disabled:opacity-50 shadow-lg"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
