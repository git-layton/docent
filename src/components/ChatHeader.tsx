import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Menu, Settings,
  BookOpen, Search,
  Hash, Users, FileText, Zap, Bookmark, Info
} from 'lucide-react';
import { AgentIcon } from './ui/AgentIcon';
import { useChatStore } from '../store/useChatStore';
import { useAgentStore } from '../store/useAgentStore';
import { useSpaceStore } from '../store/useSpaceStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useTaskStore } from '../store/useTaskStore';
import { useUIStore } from '../store/useUIStore';
import { normalizeChatRecord } from '../services/channels';

interface ChatHeaderProps {
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  llamaPaused: boolean;
  llamaCoolingDown: boolean;
  activeMessages: any[];
  systemPromptLen: number;
  hasErrorLogs: boolean;
  errorLogsCount: number;
  onRunDreamCycle: () => void;
  onToast: (msg: string, action?: { label: string; onClick: () => void }) => void;
}

export function ChatHeader({
  dropdownRef,
  llamaPaused: _llamaPaused,
  llamaCoolingDown: _llamaCoolingDown,
  activeMessages: _activeMessages,
  systemPromptLen: _systemPromptLen,
  hasErrorLogs: _hasErrorLogs,
  errorLogsCount: _errorLogsCount,
  onRunDreamCycle: _onRunDreamCycle,
  onToast: _onToast,
}: ChatHeaderProps) {
  // Store reads
  const showPlanner = useTaskStore(s => s.showPlanner);

  const assistants = useAgentStore(s => s.assistants);
  const activeFolderId = useAgentStore(s => s.activeFolderId);

  const chats = useChatStore(s => s.chats);
  const activeChatId = useChatStore(s => s.activeChatId);
  const globalPins = useMemoryStore(s => s.globalPins);
  const showMemmoPanel = useMemoryStore(s => s.showMemmoPanel);
  const memmoPanelTab = useMemoryStore(s => s.memmoPanelTab);

  const ramStats = useUIStore(s => s.ramStats);
  const hwProfile = useUIStore(s => s.hwProfile);
  const isAgentDropdownOpen = useUIStore(s => s.isAgentDropdownOpen);

  const [agentSearch, setAgentSearch] = useState('');
  const [showContextPeek, setShowContextPeek] = useState(false);
  const contextPeekRef = useRef<HTMLDivElement>(null);

  const activeAssistant = useMemo(() => assistants.find(a => a.id === activeFolderId) ?? assistants[0], [assistants, activeFolderId]);
  const activeAgentPinnedMessageObjects = useMemo(() => globalPins.filter(p => p.agentId === activeAssistant?.id), [globalPins, activeAssistant?.id]);
  const activeChat = useMemo(() => chats.find((c: any) => c.id === activeChatId) ?? null, [chats, activeChatId]);
  const normalizedChat = useMemo(() => activeChat ? normalizeChatRecord(activeChat, activeFolderId) : null, [activeChat, activeFolderId]);
  const isChannel = normalizedChat?.kind === 'channel';
  const participantCount = normalizedChat?.participantAgentIds?.length ?? 0;
  const pinnedCount = activeAgentPinnedMessageObjects.length;
  // The name trigger only opens the context peek in 1:1 DMs (not planner, not channels).
  const isPeekable = !showPlanner && !isChannel;

  useEffect(() => {
    if (!showContextPeek) return;
    const handler = (e: MouseEvent) => {
      if (contextPeekRef.current && !contextPeekRef.current.contains(e.target as Node)) {
        setShowContextPeek(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showContextPeek]);

  const updateActiveChat = (patch: any) => {
    if (!activeChatId) return;
    useChatStore.getState().setChats((prev: any[]) => prev.map((chat: any) =>
      chat.id === activeChatId ? normalizeChatRecord({ ...chat, ...patch, updatedAt: Date.now() }, activeFolderId) : chat
    ));
    // Persist so goal / members / norm edits survive a reload.
    useChatStore.getState().persist();
  };

  const toggleChannelAgent = (agentId: string) => {
    if (!normalizedChat || normalizedChat.kind !== 'channel') return;
    const ids = normalizedChat.participantAgentIds ?? [];
    const next = ids.includes(agentId)
      ? ids.filter(id => id !== agentId)
      : [...ids, agentId];
    const safeNext = next.length === 0 ? [normalizedChat.primaryAgentId ?? activeFolderId] : next;
    updateActiveChat({ participantAgentIds: safeNext });
    // Keep the owning Space's agent roster in sync so the sidebar reflects membership.
    const sp = useSpaceStore.getState().spaces.find(s => s.chatId === activeChatId);
    if (sp) useSpaceStore.getState().updateSpace(sp.id, { agentIds: safeNext });
  };

  // Enter in the agent search invites the first matching agent who isn't a member yet.
  const inviteFirstMatch = () => {
    const q = agentSearch.toLowerCase();
    const matches = assistants.filter(a => a.id !== 'forge-guide' && a.id !== 'f-default' && a.name.toLowerCase().includes(q));
    const target = matches.find(a => !normalizedChat?.participantAgentIds?.includes(a.id)) ?? matches[0];
    if (target) { toggleChannelAgent(target.id); setAgentSearch(''); }
  };

  return (
    <>
      <header className="h-12 shrink-0 flex items-center justify-between px-3 lg:px-4 border-b border-edge bg-panel z-10">
        <div className="flex items-center gap-3 relative" ref={dropdownRef}>
          <button onClick={() => useUIStore.getState().setIsSidebarOpen(v => !v)} className="p-2 -ml-2 rounded-lg hover:bg-wash text-ink-3 transition-colors"><Menu className="w-5 h-5" /></button>
          <div className="relative" ref={contextPeekRef}>
            {/* The name trigger acts as a button only in 1:1 DMs (toggles the context peek).
                In channels it's a plain container hosting the Members button, so it must NOT
                be a real <button> — a nested <button> is invalid HTML. */}
            <div
              {...(isPeekable
                ? {
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => setShowContextPeek(v => !v),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowContextPeek(v => !v); }
                    },
                  }
                : {})}
              className={`flex items-center gap-2 p-2 rounded-xl transition-opacity outline-none ${isPeekable ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
            >
              {!showPlanner && activeAssistant && <AgentIcon agent={activeAssistant} sizeClass="w-4 h-4" containerClass="p-1 rounded-md shadow-sm" />}
              {isChannel && <Hash className="w-4 h-4 text-accent" />}
              <span className="text-sm font-black tracking-tight text-ink">{showPlanner ? 'My Planner' : isChannel ? normalizedChat?.name : activeAssistant?.name ?? 'Assistant'}</span>
              {!showPlanner && !isChannel && activeAssistant && (
                <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-medium text-ink-3">
                  <span className="w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
                  is here
                </span>
              )}
              {isChannel && !showPlanner && (
                <button
                  onClick={e => { e.stopPropagation(); useUIStore.getState().setIsAgentDropdownOpen(v => !v); setAgentSearch(''); }}
                  className="flex items-center gap-1 text-[9px] font-medium bg-accent-soft text-accent-soft-ink hover:bg-accent-soft/80 px-2 py-0.5 rounded-full transition-colors"
                  title="Members"
                >
                  <Users className="w-3 h-3" />{participantCount}
                </button>
              )}
              {!showPlanner && !isChannel && <Info className="w-3 h-3 text-ink-3" />}
            </div>

            {showContextPeek && !showPlanner && !isChannel && (
              <div className="absolute top-full left-0 mt-2 w-72 bg-panel-2 border border-edge rounded-2xl shadow-2xl z-50 p-4 animate-in fade-in slide-in-from-top-2 duration-150">
                {/* Agent identity */}
                <div className="flex items-start gap-3 mb-3 pb-3 border-b border-edge">
                  <div>
                    <div className="text-sm font-bold text-ink mb-0.5">{activeAssistant?.name}</div>
                    {activeAssistant?.description && (
                      <div className="text-[10px] text-ink-3 line-clamp-2">{activeAssistant.description}</div>
                    )}
                  </div>
                </div>

                {/* System prompt snippet */}
                {activeAssistant?.prompt && (
                  <div className="mb-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1.5">Instructions</div>
                    <div className="text-[10px] text-ink-2 leading-relaxed line-clamp-3 bg-inset rounded-lg p-2.5">
                      {activeAssistant.prompt.slice(0, 160)}{activeAssistant.prompt.length > 160 ? '…' : ''}
                    </div>
                  </div>
                )}

                {/* Stats */}
                <div className="flex items-center gap-4 mb-3">
                  {pinnedCount > 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] text-ink-3">
                      <Bookmark className="w-3 h-3 text-warning" />{pinnedCount} pinned
                    </div>
                  )}
                  {(activeAssistant?.trainingDocs?.length ?? 0) > 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] text-ink-3">
                      <FileText className="w-3 h-3 text-accent" />{activeAssistant!.trainingDocs.length} docs
                    </div>
                  )}
                  {activeAssistant?.driveEnabled && activeAssistant?.drive && (
                    <div className="flex items-center gap-1.5 text-[10px] text-ink-3">
                      <Zap className="w-3 h-3 text-accent" />Core drive
                    </div>
                  )}
                </div>

                {/* Edit link */}
                <button
                  onClick={() => { setShowContextPeek(false); useAgentStore.getState().setShowAssistantSettings(true); }}
                  className="w-full text-[10px] font-bold text-accent hover:text-accent-strong transition-colors text-center pt-2 border-t border-edge"
                >
                  Edit in Settings →
                </button>
              </div>
            )}
          </div>

          {isChannel && isAgentDropdownOpen && !showPlanner && (
            <div className="absolute top-full left-10 mt-1 w-72 bg-panel-2 border border-edge rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in fade-in zoom-in duration-150">
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2 px-3 py-2 bg-inset rounded-xl">
                  <Search className="w-3 h-3 text-ink-3 shrink-0" />
                  <input
                    autoFocus
                    value={agentSearch}
                    onChange={e => setAgentSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); inviteFirstMatch(); } }}
                    placeholder="Search agents to invite, ↵ to add…"
                    className="flex-1 bg-transparent text-xs outline-none text-ink placeholder-ink-3"
                  />
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto p-1.5 custom-scrollbar space-y-1">
                <div className="px-2 py-2 mb-1 rounded-xl bg-accent-soft border border-edge">
                  <div className="flex items-center gap-2 mb-2 text-[10px] font-black uppercase tracking-widest text-accent-soft-ink">
                    <Hash className="w-3.5 h-3.5" />Channel Members
                  </div>
                  <input
                    value={normalizedChat?.goal ?? ''}
                    onChange={e => updateActiveChat({ goal: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); useUIStore.getState().setIsAgentDropdownOpen(false); } }}
                    placeholder="Channel goal — what is this chat for?"
                    className="w-full mb-2 bg-panel border border-edge-2 text-ink placeholder-ink-3 rounded-lg px-2.5 py-1.5 text-[10px] font-bold outline-none focus:border-accent"
                  />
                  <div className="flex gap-1 mb-2">
                    {(['social', 'work', 'creative', 'default'] as const).map(n => (
                      <button
                        key={n}
                        onClick={() => updateActiveChat({ norm: n })}
                        className={`flex-1 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                          (normalizedChat?.norm ?? 'default') === n
                            ? 'bg-accent text-on-accent'
                            : 'bg-inset text-ink-3 hover:bg-wash'
                        }`}
                      >
                        {n === 'default' ? 'general' : n}
                      </button>
                    ))}
                  </div>
                </div>
                {assistants.filter(a => a.id !== 'forge-guide' && a.id !== 'f-default' && a.name.toLowerCase().includes(agentSearch.toLowerCase())).map(agent => (
                  <div key={agent.id} onClick={() => toggleChannelAgent(agent.id)} className="group flex items-center justify-between px-2 py-2 rounded-xl cursor-pointer transition-all hover:bg-wash">
                    <div className="flex items-center gap-3 truncate flex-1">
                      <AgentIcon agent={agent} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm" />
                      <div className="flex flex-col truncate"><span className="text-xs font-bold truncate text-ink">{agent.name}</span>{agent.description && <span className="text-[9px] text-ink-3 truncate">{agent.description}</span>}</div>
                    </div>
                    <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase ${normalizedChat?.participantAgentIds?.includes(agent.id) ? 'bg-success-soft text-success' : 'bg-inset text-ink-3'}`}>{normalizedChat?.participantAgentIds?.includes(agent.id) ? 'Invited' : 'Invite'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Search — find across memory, channels, and the Knowledge Core */}
          <button
            onClick={() => {
              useUIStore.getState().setForcedTool('workspace');
              _onToast('Forge Search armed. Ask what to find across memory, channels, and the Knowledge Core.');
            }}
            className="p-2 rounded-lg transition-colors hover:bg-wash text-ink-3 hover:text-accent"
            title="Forge Search"
          >
            <Search className="w-5 h-5" />
          </button>
          {ramStats && ramStats.available_mb < (hwProfile?.hud_show_mb ?? 2000) && (
            <div className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
              ramStats.available_mb < (hwProfile?.hud_warn_mb ?? 1200) ? 'bg-danger-soft text-danger' :
              'bg-warning-soft text-warning'
            }`} title={`${(ramStats.available_mb / 1024).toFixed(1)}GB free of ${(ramStats.total_mb / 1024).toFixed(0)}GB`}>
              {(ramStats.available_mb / 1024).toFixed(1)}GB
            </div>
          )}
          {/* Knowledge base — only meaningful in a 1:1 DM with a single agent */}
          {!isChannel && (
            <button
              onClick={() => {
                if (memmoPanelTab === 'inbox') useMemoryStore.getState().setMemmoPanelTab('library');
                useMemoryStore.getState().setShowMemmoPanel(v => !v);
              }}
              className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${showMemmoPanel && memmoPanelTab !== 'inbox' ? 'bg-accent-soft text-accent-soft-ink' : 'hover:bg-wash text-ink-3'}`}
              title="Knowledge Base"
            >
              <BookOpen className="w-5 h-5" />
              {activeAgentPinnedMessageObjects.length > 0 && (
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-warning-soft text-warning text-[9px] font-black">
                  {activeAgentPinnedMessageObjects.length}
                </span>
              )}
            </button>
          )}
          <div className="w-px h-6 bg-edge mx-1" />
          {/* Chat-specific settings — configure the active assistant. Global/system settings live on the Home hero. */}
          <button
            onClick={() => {
              if (activeAssistant) useAgentStore.getState().setEditingAssistant({ ...activeAssistant });
              useAgentStore.getState().setShowAssistantSettings(true);
            }}
            className="p-2 hover:bg-wash rounded-lg text-ink-3"
            title="Assistant settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>
    </>
  );
}
