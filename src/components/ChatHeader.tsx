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
import { OmniSearch } from './OmniSearch';
import type { SearchDoc } from '../services/universalSearch';

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
  /** Send a message to the active Space's agent — wired from App's handleSendPrompt. */
  onSendPrompt: (text: string) => void;
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
  onSendPrompt,
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
  const spaces = useSpaceStore(s => s.spaces);
  const headerActiveSpaceId = useSpaceStore(s => s.activeSpaceId);

  const [showContextPeek, setShowContextPeek] = useState(false);
  const contextPeekRef = useRef<HTMLDivElement>(null);

  // Space-scoped search dropdown (the same omni-bar as Home, reaching only this Space).
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showSearch) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSearch(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSearch]);

  // Open a hit within this Space: focus the matching tab, or jump to the conversation log.
  const runSpaceDoc = (doc: SearchDoc) => {
    const st = useSpaceStore.getState();
    if (doc.id.startsWith('tab-')) st.setActiveTab(doc.id.slice(4));
    else if (doc.id.startsWith('chat-')) {
      const log = st.omniTabs.find(t => t.type === 'space-log' && t.spaceId === headerActiveSpaceId);
      if (log) st.setActiveTab(log.id);
    }
  };

  const activeAssistant = useMemo(() => assistants.find(a => a.id === activeFolderId) ?? assistants[0], [assistants, activeFolderId]);
  const activeAgentPinnedMessageObjects = useMemo(() => globalPins.filter(p => p.agentId === activeAssistant?.id), [globalPins, activeAssistant?.id]);
  const activeChat = useMemo(() => chats.find((c: any) => c.id === activeChatId) ?? null, [chats, activeChatId]);
  const normalizedChat = useMemo(() => activeChat ? normalizeChatRecord(activeChat, activeFolderId) : null, [activeChat, activeFolderId]);
  const isChannel = normalizedChat?.kind === 'channel';
  const participantCount = normalizedChat?.participantAgentIds?.length ?? 0;
  const pinnedCount = activeAgentPinnedMessageObjects.length;
  const activeSpaceGoal = useMemo(
    () => spaces.find(s => s.id === headerActiveSpaceId)?.agentGoals?.[activeAssistant?.id ?? ''] ?? '',
    [spaces, headerActiveSpaceId, activeAssistant?.id],
  );
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

  // The channel's "Members" pill opens the shared Space wizard in edit mode — same
  // surface used by "+ Space", so goal + invites live in one reliable place.
  const editSpace = () => {
    const sp = useSpaceStore.getState().spaces.find(s => s.chatId === activeChatId)
      ?? useSpaceStore.getState().spaces.find(s => s.id === useSpaceStore.getState().activeSpaceId);
    if (sp) useUIStore.getState().openSpaceWizard(sp.id);
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
              {!showPlanner && !isChannel && activeAssistant?.role && (
                <span className="hidden sm:inline-flex items-center text-[9px] font-bold uppercase tracking-wider bg-accent-soft text-accent-soft-ink px-1.5 py-0.5 rounded-full" title="Agent role">{activeAssistant.role}</span>
              )}
              {!showPlanner && !isChannel && activeAssistant && (
                <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-medium text-ink-3">
                  <span className="w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
                  is here
                </span>
              )}
              {isChannel && !showPlanner && (
                <button
                  onClick={e => { e.stopPropagation(); editSpace(); }}
                  className="flex items-center gap-1 text-[9px] font-medium bg-accent-soft text-accent-soft-ink hover:bg-accent-soft/80 px-2 py-0.5 rounded-full transition-colors"
                  title="Edit space — goal & members"
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

                {/* Goal in this space (spec §6) — per-agent standing goal, editable inline. */}
                <div className="mb-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1.5">Goal in this space</div>
                  <input
                    key={`${headerActiveSpaceId}-${activeAssistant?.id}`}
                    defaultValue={activeSpaceGoal}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (headerActiveSpaceId && activeAssistant && v !== activeSpaceGoal) {
                        useSpaceStore.getState().setAgentGoal(headerActiveSpaceId, activeAssistant.id, v);
                      }
                    }}
                    placeholder="What should this agent keep driving toward here?"
                    className="w-full bg-inset border border-edge rounded-lg px-2.5 py-1.5 text-[11px] text-ink outline-none focus:border-accent placeholder:text-ink-3"
                  />
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
        </div>

        <div className="flex items-center gap-1">
          {/* Search this Space — the same omni-bar as Home, scoped to this Space's tabs + conversation */}
          {headerActiveSpaceId && (
            <div className="relative" ref={searchRef}>
              <button
                onClick={() => setShowSearch(v => !v)}
                className={`p-2 rounded-lg transition-colors ${showSearch ? 'bg-accent-soft text-accent-soft-ink' : 'hover:bg-wash text-ink-3 hover:text-accent'}`}
                title="Search this space"
              >
                <Search className="w-5 h-5" />
              </button>
              {showSearch && (
                <div className="absolute right-0 top-full mt-2 w-[22rem] z-50">
                  <OmniSearch
                    scope={{ kind: 'space', spaceId: headerActiveSpaceId }}
                    agentName={activeAssistant?.name}
                    autoFocus
                    placeholder={activeAssistant?.name ? `Search this space, or ask ${activeAssistant.name}…` : 'Search this space…'}
                    onAsk={(t) => { onSendPrompt(t); setShowSearch(false); }}
                    onRun={(doc) => { runSpaceDoc(doc); setShowSearch(false); }}
                  />
                </div>
              )}
            </div>
          )}
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
