import { useMemo, useState } from 'react';
import { X, Check, Hash, Target, Users, Bot } from 'lucide-react';
import { AgentIcon } from './ui/AgentIcon';
import { useAgentStore } from '../store/useAgentStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSpaceStore } from '../store/useSpaceStore';
import { useChatStore } from '../store/useChatStore';
import { useUIStore } from '../store/useUIStore';
import { normalizeChatRecord } from '../services/channels';

// ---------------------------------------------------------------------------
// NewSpaceModal — the "wizard" for creating a Space: name it, give it a goal,
// and invite the agents (and people) who belong in it. Replaces the old
// one-click createSpace('New Space', []) that produced an empty, goal-less space.
// ---------------------------------------------------------------------------
export function NewSpaceModal() {
  const assistants = useAgentStore((s) => s.assistants);
  const appSettings = useSettingsStore((s) => s.appSettings);

  const selectableAgents = useMemo(
    () => assistants.filter((a: any) => a.id !== 'forge-guide' && a.id !== 'f-default'),
    [assistants],
  );
  const people = (appSettings?.people ?? []) as Array<{ id: string; label: string; role?: string }>;

  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>(() =>
    selectableAgents[0] ? [selectableAgents[0].id] : [],
  );
  const [peopleIds, setPeopleIds] = useState<string[]>([]);

  const toggle = (id: string, list: string[], set: (v: string[]) => void) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const close = () => useUIStore.getState().setShowNewSpace(false);

  const create = () => {
    const finalName = name.trim() || 'New Space';
    // A space needs at least one agent; fall back to the first available.
    const ids = agentIds.length ? agentIds : selectableAgents[0] ? [selectableAgents[0].id] : [];
    const space = useSpaceStore.getState().createSpace(finalName, ids);

    // Goal + invited people live on the space's own chat / record.
    const g = goal.trim();
    if (g) {
      useChatStore.getState().setChats((prev: any[]) =>
        prev.map((c: any) =>
          c.id === space.chatId
            ? normalizeChatRecord({ ...c, name: finalName, goal: g }, ids[0] ?? 'alexis')
            : c,
        ),
      );
      useChatStore.getState().persist();
    }
    if (peopleIds.length) useSpaceStore.getState().updateSpace(space.id, { peopleIds });

    useSpaceStore.getState().setActiveSpaceId(space.id);
    close();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-md max-h-[88vh] flex flex-col rounded-[1.75rem] border border-edge bg-panel shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-edge shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent">
              <Hash className="h-4 w-4 text-on-accent" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-ink">New Space</h2>
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-wash transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 custom-scrollbar">
          {/* Name */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-1.5">
              Name
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  create();
                }
              }}
              placeholder="e.g. Q3 Launch, Research, Trip planning…"
              className="w-full rounded-xl border border-edge bg-inset px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-accent"
            />
          </div>

          {/* Goal */}
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-1.5">
              <Target className="h-3 w-3" /> Goal
            </label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              placeholder="What is this space for? The agents use this to stay on-task."
              className="w-full resize-none rounded-xl border border-edge bg-inset px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-accent custom-scrollbar"
            />
          </div>

          {/* Invite agents */}
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-2">
              <Bot className="h-3 w-3" /> Invite agents
              {agentIds.length > 0 && (
                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-bold text-accent-soft-ink">
                  {agentIds.length}
                </span>
              )}
            </label>
            <div className="space-y-1">
              {selectableAgents.map((agent: any) => {
                const on = agentIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => toggle(agent.id, agentIds, setAgentIds)}
                    className={`group flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-all ${
                      on ? 'border-accent bg-accent-soft' : 'border-edge hover:bg-wash'
                    }`}
                  >
                    <AgentIcon agent={agent} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink">{agent.name}</p>
                      {agent.description && <p className="truncate text-[10px] text-ink-3">{agent.description}</p>}
                    </div>
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        on ? 'border-accent bg-accent text-on-accent' : 'border-edge-2 text-transparent'
                      }`}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </button>
                );
              })}
              {selectableAgents.length === 0 && (
                <p className="text-[11px] text-ink-3">No agents yet — create one from the sidebar.</p>
              )}
            </div>
          </div>

          {/* Invite people (only when the user has any) */}
          {people.length > 0 && (
            <div>
              <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-2">
                <Users className="h-3 w-3" /> Invite people
              </label>
              <div className="flex flex-wrap gap-1.5">
                {people.map((p) => {
                  const on = peopleIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggle(p.id, peopleIds, setPeopleIds)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all ${
                        on ? 'border-accent bg-accent-soft text-accent-soft-ink' : 'border-edge text-ink-2 hover:bg-wash'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-6 py-4 border-t border-edge shrink-0">
          <button
            onClick={close}
            className="flex-1 rounded-xl border border-edge py-2.5 text-xs font-bold uppercase tracking-widest text-ink-2 hover:bg-wash transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={create}
            className="flex-[2] rounded-xl bg-accent py-2.5 text-xs font-bold uppercase tracking-widest text-on-accent hover:opacity-90 transition-opacity"
          >
            Create Space
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewSpaceModal;
