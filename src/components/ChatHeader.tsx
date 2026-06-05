import React, { useMemo, useState } from 'react';
import {
  Menu, Settings, CalendarDays,
  AlertTriangle, Activity, BookOpen, Search,
  Hash, Users, Inbox
} from 'lucide-react';
import { AgentIcon } from './ui/AgentIcon';
import { ContextMeter } from './ui/ContextMeter';
import { useChatStore } from '../store/useChatStore';
import { useAgentStore } from '../store/useAgentStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useTaskStore } from '../store/useTaskStore';
import { useUIStore } from '../store/useUIStore';
import { normalizeChatRecord, promoteChatToChannel } from '../services/channels';

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
  activeMessages,
  systemPromptLen,
  hasErrorLogs,
  errorLogsCount,
  onRunDreamCycle: _onRunDreamCycle,
  onToast: _onToast,
}: ChatHeaderProps) {
  // Store reads
  const showPlanner = useTaskStore(s => s.showPlanner);
  const tasks = useTaskStore(s => s.tasks);

  const assistants = useAgentStore(s => s.assistants);
  const activeFolderId = useAgentStore(s => s.activeFolderId);

  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);

  const chats = useChatStore(s => s.chats);
  const activeChatId = useChatStore(s => s.activeChatId);
  const globalPins = useMemoryStore(s => s.globalPins);
  const showMemmoPanel = useMemoryStore(s => s.showMemmoPanel);
  const memmoPanelTab = useMemoryStore(s => s.memmoPanelTab);

  const ramStats = useUIStore(s => s.ramStats);
  const hwProfile = useUIStore(s => s.hwProfile);
  const showConsole = useUIStore(s => s.showConsole);
  const isAgentDropdownOpen = useUIStore(s => s.isAgentDropdownOpen);

  const [agentSearch, setAgentSearch] = useState('');
  const activeAssistant = useMemo(() => assistants.find(a => a.id === activeFolderId) ?? assistants[0], [assistants, activeFolderId]);
  const selectedModel = useMemo(() => models.find(m => m.id === selectedModelId) ?? models[0] ?? null, [models, selectedModelId]);
  const activeAgentPinnedMessageObjects = useMemo(() => globalPins.filter(p => p.agentId === activeAssistant?.id), [globalPins, activeAssistant?.id]);
  const activeChat = useMemo(() => chats.find((c: any) => c.id === activeChatId) ?? null, [chats, activeChatId]);
  const normalizedChat = useMemo(() => activeChat ? normalizeChatRecord(activeChat, activeFolderId) : null, [activeChat, activeFolderId]);
  const isChannel = normalizedChat?.kind === 'channel';
  const participantCount = normalizedChat?.participantAgentIds?.length ?? 0;

  const updateActiveChat = (patch: any) => {
    if (!activeChatId) return;
    useChatStore.getState().setChats((prev: any[]) => prev.map((chat: any) =>
      chat.id === activeChatId ? normalizeChatRecord({ ...chat, ...patch, updatedAt: Date.now() }, activeFolderId) : chat
    ));
  };

  const toggleChannelAgent = (agentId: string) => {
    if (!normalizedChat || normalizedChat.kind !== 'channel') return;
    const ids = normalizedChat.participantAgentIds ?? [];
    const next = ids.includes(agentId)
      ? ids.filter(id => id !== agentId)
      : [...ids, agentId];
    const safeNext = next.length === 0 ? [normalizedChat.primaryAgentId ?? activeFolderId] : next;
    updateActiveChat({ participantAgentIds: safeNext });
  };

  const promoteActiveChatToChannel = () => {
    if (!activeChatId || !activeChat || !normalizedChat || normalizedChat.kind === 'channel') return;
    const nextName = normalizedChat.name === 'New Chat' || normalizedChat.name.endsWith(' Direct')
      ? `${activeAssistant?.name ?? 'Agent'} Channel`
      : normalizedChat.name;
    const promoted = promoteChatToChannel(activeChat, activeFolderId, { name: nextName });
    useChatStore.getState().setChats((prev: any[]) => prev.map((chat: any) => chat.id === activeChatId ? promoted : chat));
    useUIStore.getState().setIsAgentDropdownOpen(true);
    _onToast('Direct promoted to a channel. Use Invite to add specialists.');
  };

  return (
    <>
      <header className="h-16 shrink-0 flex items-center justify-between px-4 lg:px-6 border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-3 relative" ref={dropdownRef}>
          <button onClick={() => useUIStore.getState().setIsSidebarOpen(v => !v)} className="p-2 -ml-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 transition-colors"><Menu className="w-5 h-5" /></button>
          <div className="flex items-center gap-2 p-2 rounded-xl">
            {!showPlanner && activeAssistant && <AgentIcon agent={activeAssistant} sizeClass="w-4 h-4" containerClass="p-1 rounded-md shadow-sm" />}
            {isChannel && <Hash className="w-4 h-4 text-[#6A829E]" />}
            <span className="text-sm font-black tracking-tight">{showPlanner ? 'My Planner' : isChannel ? normalizedChat?.name : activeAssistant?.name ?? 'Assistant'}</span>
            {isChannel && <span className="text-[9px] font-black text-neutral-400 uppercase tracking-widest flex items-center gap-1"><Users className="w-3 h-3" />{participantCount}</span>}
          </div>
          {isChannel && !showPlanner && (
            <button
              onClick={() => { useUIStore.getState().setIsAgentDropdownOpen(v => !v); setAgentSearch(''); }}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-[#4A5D75] hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <Users className="w-3.5 h-3.5" />
              Invite
            </button>
          )}

          {isChannel && isAgentDropdownOpen && !showPlanner && (
            <div className="absolute top-full left-10 mt-1 w-72 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in fade-in zoom-in duration-150">
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-2 px-3 py-2 bg-neutral-100 dark:bg-neutral-800 rounded-xl">
                  <Search className="w-3 h-3 text-neutral-400 shrink-0" />
                  <input autoFocus value={agentSearch} onChange={e => setAgentSearch(e.target.value)} placeholder="Search agents..." className="flex-1 bg-transparent text-xs outline-none text-neutral-700 dark:text-neutral-200 placeholder-neutral-400" />
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto p-1.5 custom-scrollbar space-y-1">
                <div className="px-2 py-2 mb-1 rounded-xl bg-[#F0F4F8] dark:bg-[#1E2B38]/30 border border-[#D6E0EA] dark:border-[#4A5D75]/30">
                  <div className="flex items-center gap-2 mb-2 text-[10px] font-black uppercase tracking-widest text-[#4A5D75] dark:text-[#9EADC8]">
                    <Hash className="w-3.5 h-3.5" /> Channel Members
                  </div>
                  <input
                    value={normalizedChat?.goal ?? ''}
                    onChange={e => updateActiveChat({ goal: e.target.value })}
                    placeholder="Channel goal..."
                    className="w-full mb-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2.5 py-1.5 text-[10px] font-bold outline-none focus:border-[#6A829E]"
                  />
                </div>
                {assistants.filter(a => a.id !== 'forge-guide' && a.name.toLowerCase().includes(agentSearch.toLowerCase())).map(agent => (
                  <div key={agent.id} onClick={() => toggleChannelAgent(agent.id)} className="group flex items-center justify-between px-2 py-2 rounded-xl cursor-pointer transition-all hover:bg-neutral-50 dark:hover:bg-neutral-800">
                    <div className="flex items-center gap-3 truncate flex-1">
                      <AgentIcon agent={agent} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm" />
                      <div className="flex flex-col truncate"><span className="text-xs font-bold truncate dark:text-white">{agent.name}</span>{agent.description && <span className="text-[9px] text-neutral-400 truncate">{agent.description}</span>}</div>
                    </div>
                    <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase ${normalizedChat?.participantAgentIds?.includes(agent.id) ? 'bg-[#7A9E8D] text-white' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-500'}`}>{normalizedChat?.participantAgentIds?.includes(agent.id) ? 'Invited' : 'Invite'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {!showPlanner && (
            <button
              onClick={() => {
                useUIStore.getState().setForcedTool('workspace');
                _onToast('Forge Search armed. Ask what to find across memory, channels, and the Knowledge Core.');
              }}
              className="p-2 rounded-lg transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 hover:text-[#4A5D75]"
              title="Forge Search"
            >
              <Search className="w-5 h-5" />
            </button>
          )}
          {!showPlanner && normalizedChat && !isChannel && (
            <button
              onClick={promoteActiveChatToChannel}
              className="p-2 rounded-lg transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 hover:text-[#4A5D75]"
              title="Promote this direct to a channel"
            >
              <Hash className="w-5 h-5" />
            </button>
          )}
          {ramStats && ramStats.available_mb < (hwProfile?.hud_show_mb ?? 2000) && (
            <div className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
              ramStats.available_mb < (hwProfile?.hud_warn_mb ?? 1200) ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
              'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
            }`} title={`${(ramStats.available_mb / 1024).toFixed(1)}GB free of ${(ramStats.total_mb / 1024).toFixed(0)}GB`}>
              {(ramStats.available_mb / 1024).toFixed(1)}GB
            </div>
          )}
          <button onClick={() => useUIStore.getState().setShowConsole(v => !v)} className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${showConsole ? 'bg-[#D6E0EA] dark:bg-[#1E2B38]/50 text-[#4A5D75]' : hasErrorLogs ? 'text-[#C98A8A] hover:bg-[#F7EBEB] dark:hover:bg-[#4A2E2E]/30' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400'}`} title="Open App Console">
            {hasErrorLogs ? (
              <div className="relative">
                <AlertTriangle className="w-5 h-5 animate-pulse text-[#C98A8A]" />
                <span className="absolute -top-1.5 -right-1.5 bg-[#C98A8A] text-white text-[9px] font-black w-4 h-4 flex items-center justify-center rounded-full shadow-sm">{errorLogsCount}</span>
              </div>
            ) : <Activity className="w-5 h-5" />}
          </button>
          <button onClick={() => useTaskStore.getState().setShowPlanner(v => !v)} className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${showPlanner ? 'bg-[#D6E0EA] dark:bg-[#1E2B38]/50 text-[#4A5D75]' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400'}`}>
            <CalendarDays className="w-5 h-5" />
            {tasks.filter(t => !t.completed).length > 0 && <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#6A829E] text-white text-[9px] font-black">{tasks.filter(t => !t.completed).length}</span>}
          </button>
          <button
            onClick={() => {
              useMemoryStore.getState().setMemmoPanelTab('inbox');
              useMemoryStore.getState().setShowMemmoPanel(true);
            }}
            className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${showMemmoPanel && memmoPanelTab === 'inbox' ? 'bg-[#D6E0EA] dark:bg-[#1E2B38]/50 text-[#4A5D75]' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400'}`}
            title="Forge Inbox"
          >
            <Inbox className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              if (memmoPanelTab === 'inbox') useMemoryStore.getState().setMemmoPanelTab('library');
              useMemoryStore.getState().setShowMemmoPanel(v => !v);
            }}
            className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${showMemmoPanel && memmoPanelTab !== 'inbox' ? 'bg-[#D6E0EA] dark:bg-[#1E2B38]/50 text-[#4A5D75]' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400'}`}
            title="Memos & Memory (⌘⇧M)"
          >
            <BookOpen className="w-5 h-5" />
            {activeAgentPinnedMessageObjects.length > 0 && (
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#D4AA7D] text-white text-[9px] font-black">
                {activeAgentPinnedMessageObjects.length}
              </span>
            )}
          </button>
          <div className="w-px h-6 bg-neutral-200 dark:bg-neutral-800 mx-1" />
          <button onClick={() => useSettingsStore.getState().setShowProfileSettings(true)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-neutral-400"><Settings className="w-5 h-5" /></button>
        </div>
      </header>

      {/* Context Progress Bar */}
      {!showPlanner && selectedModel && activeMessages.length > 0 && (
        <ContextMeter messages={activeMessages} systemPromptLen={systemPromptLen} limit={selectedModel?.contextLimit ?? 32000} />
      )}
    </>
  );
}
