import { useState, useEffect } from 'react';
import { Bot, Search, Edit2, User, Plus, Wifi, WifiOff, Settings, CheckSquare, Calendar, Star, Globe, FileText, Code, Layers } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useChatStore } from '../store/useChatStore';
import { useAgentStore } from '../store/useAgentStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useUIStore } from '../store/useUIStore';
import { useSpaceStore } from '../store/useSpaceStore';
import { AgentIcon } from './ui/AgentIcon';
import { normalizeChatRecord } from '../services/channels';

const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

interface AppSidebarProps {
  // onDeleteSavedApp and onCreateBlankArtifact removed — Unit 7 (App.tsx migration) handles call site cleanup
}

export function AppSidebar(_: AppSidebarProps) {
  const [networkActive, setNetworkActive] = useState(false);
  const [networkPeers, setNetworkPeers] = useState<Array<{ id: string; name: string; ip: string }>>([]);

  // Store reads
  const isSidebarOpen = useUIStore(s => s.isSidebarOpen);
  const canvasContent = useUIStore(s => s.canvasContent);

  const chats = useChatStore(s => s.chats);
  const activeChatId = useChatStore(s => s.activeChatId);
  const chatSearchQuery = useChatStore(s => s.chatSearchQuery);

  const activeFolderId = useAgentStore(s => s.activeFolderId);
  const assistants = useAgentStore(s => s.assistants);
  const appSettings = useSettingsStore(s => s.appSettings);
  const userProfile = useSettingsStore(s => s.userProfile);
  const userName = useSettingsStore(s => s.userName);
  const userAvatar = useSettingsStore(s => s.userAvatar);
  const showPlanner = useTaskStore(s => s.showPlanner);

  const spaces = useSpaceStore(s => s.spaces);
  const activeSpaceId = useSpaceStore(s => s.activeSpaceId);
  const omniTabs = useSpaceStore(s => s.omniTabs);
  const activeOmniTabId = useSpaceStore(s => s.activeOmniTabId);
  const favorites = omniTabs.filter(t => t.isFavorite);

  const displayName = (() => {
    if (userName?.trim()) return userName.trim();
    const first = userProfile?.split('\n')[0]?.trim().replace(/^[#\s]+/, '').trim();
    return first || 'You';
  })();

  const toggleNetwork = async () => {
    const newActive = !networkActive;
    const instanceId = appSettings.forgeInstanceId || 'agent-forge-local';
    try {
      await invoke('set_network_active', { active: newActive, name: displayName, instanceId });
      setNetworkActive(newActive);
      if (!newActive) setNetworkPeers([]);
    } catch (e) {
      console.warn('[Network] toggle failed:', e);
    }
  };

  useEffect(() => {
    if (!networkActive) return;
    const poll = async () => {
      try {
        const peers = await invoke<Array<{ id: string; name: string; ip: string }>>('get_network_peers');
        setNetworkPeers(peers);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, [networkActive]);

  const openDirect = (agent: any) => {
    const allDms = chats
      .map((chat: any) => normalizeChatRecord(chat, agent.id))
      .filter((chat: any) => chat.kind === 'dm' && (chat.primaryAgentId === agent.id || chat.folderId === agent.id));
    // Pick most recently updated to avoid landing on blank duplicates
    const existingDirect = allDms.sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;
    if (existingDirect) {
      useAgentStore.getState().setActiveFolderId(agent.id);
      useChatStore.getState().setActiveChatId(existingDirect.id);
      if (agent.defaultModelId) useSettingsStore.getState().setSelectedModelId(agent.defaultModelId);
      useTaskStore.getState().setShowPlanner(false);
      useUIStore.getState().setCanvasContent(null);
      useUIStore.getState().setViewMode('chat');
      return;
    }
    const id = generateId('c');
    const chat = normalizeChatRecord({
      id,
      folderId: agent.id,
      primaryAgentId: agent.id,
      participantAgentIds: [agent.id],
      kind: 'dm',
      name: `${agent?.name ?? 'Agent'} Direct`,
      goal: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, agent.id);
    useAgentStore.getState().setActiveFolderId(agent.id);
    useChatStore.getState().setChats((prev: any[]) => [chat, ...prev]);
    useChatStore.getState().setActiveChatId(id);
    useChatStore.getState().setMessages((prev: any) => ({ ...prev, [id]: [] }));
    if (agent.defaultModelId) useSettingsStore.getState().setSelectedModelId(agent.defaultModelId);
    useTaskStore.getState().setShowPlanner(false);
    useUIStore.getState().setCanvasContent(null);
    useUIStore.getState().setViewMode('chat');
  };

  const createAgent = () => {
    useAgentStore.getState().setEditingAssistant({
      id: 'new',
      name: 'New Specialist',
      description: '',
      prompt: 'You are a focused specialist agent. Learn from grounded memory, cite sources when needed, and collaborate in channels when invited.',
      avatar: { type: 'color', color: 'sage' },
      trainingDocs: [],
      systemAccess: false,
      tools: {},
      awareOfProfile: true,
      defaultModelId: '',
      defaultMode: 'text',
    });
    useAgentStore.getState().setAssistantSettingsTab('config');
    useAgentStore.getState().setShowAssistantSettings(true);
  };

  const query = chatSearchQuery.toLowerCase();
  const visibleAgents = assistants
    .filter((agent: any) => agent.id !== 'forge-guide' && agent.id !== 'f-default')
    .filter((agent: any) => `${agent.name} ${agent.description ?? ''}`.toLowerCase().includes(query));

  return (
    <div className={`shrink-0 transition-all duration-300 border-r border-[rgba(255,255,255,0.05)] z-[60] bg-[#0a0b0e] overflow-hidden flex flex-col ${isSidebarOpen && !canvasContent?.isStandalone ? 'w-72' : 'w-0'}`}>
      <div className="w-72 h-full flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.05)] flex items-center gap-2.5 bg-[#2C3E50]">
          <div className="p-1.5 bg-[#9EADC8]/30 rounded-lg shrink-0"><Bot className="w-3.5 h-3.5 text-[#9EADC8]" /></div>
          <span className="text-xs font-semibold text-white/80 tracking-tight">Agent Forge</span>
        </div>

        {/* Scrollable nav */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2 no-scrollbar">
          <div className="space-y-3">
            {/* Search bar */}
            <div className="px-1 mb-2 relative mt-2">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400" />
              <input
                className="w-full bg-[rgba(255,255,255,0.06)] rounded-lg pl-8 pr-4 py-2.5 text-[10px] font-bold outline-none focus:ring-1 ring-[#6A829E]/30 text-neutral-200 placeholder:text-neutral-500"
                placeholder="Search people, agents, spaces..."
                value={chatSearchQuery}
                onChange={e => useChatStore.getState().setChatSearchQuery(e.target.value)}
              />
            </div>

            {/* PEOPLE section */}
            <div className="space-y-1">
              <div className="px-1 flex items-center justify-between">
                <span className="text-[10px] font-bold text-neutral-400 tracking-widest uppercase">People</span>
                <button
                  onClick={toggleNetwork}
                  className={`p-1 rounded-lg transition-colors ${networkActive ? 'text-emerald-500 bg-emerald-500/10' : 'text-neutral-400 hover:text-[#4A5D75] hover:bg-[rgba(255,255,255,0.04)]'}`}
                  title={networkActive ? 'Active on network — click to go offline' : 'Go active on your network'}
                >
                  {networkActive ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* You — always visible */}
              <button
                onClick={() => useSettingsStore.getState().setShowProfileSettings(true)}
                className="group w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-[rgba(255,255,255,0.04)] transition-all"
              >
                <div className="shrink-0">
                  {userAvatar ? (
                    <img src={userAvatar} alt="You" className="w-6 h-6 rounded-lg object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-lg bg-[#9EADC8] flex items-center justify-center">
                      <span className="text-[10px] font-bold text-white uppercase">{displayName.charAt(0)}</span>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-xs truncate text-neutral-200">{displayName}</p>
                  <p className="text-[9px] text-neutral-500">you</p>
                </div>
                <Settings className="w-3 h-3 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>

              {/* Local people from settings */}
              {(appSettings.people ?? []).filter((p: any) => `${p.label} ${p.role ?? ''}`.toLowerCase().includes(query)).map((person: any) => (
                <div key={person.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-neutral-500">
                  <div className="p-1.5 rounded-lg bg-[rgba(255,255,255,0.06)] shrink-0">
                    <User className="w-3.5 h-3.5 text-neutral-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs truncate text-neutral-200">{person.label}</p>
                    {person.role && <p className="text-[9px] truncate text-neutral-500">{person.role}</p>}
                  </div>
                </div>
              ))}

              {/* Network peers (when active) */}
              {networkActive && networkPeers.map(peer => (
                <div key={peer.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-neutral-500">
                  <div className="p-1.5 rounded-lg bg-[#2C3E35]/30 shrink-0">
                    <User className="w-3.5 h-3.5 text-[#7A9E8D]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs truncate text-neutral-200">{peer.name}</p>
                    <p className="text-[9px] truncate text-neutral-500">{peer.ip}</p>
                  </div>
                </div>
              ))}
              {networkActive && networkPeers.length === 0 && (
                <p className="text-[10px] text-neutral-500 text-center px-3 py-1.5">No one else on network yet.</p>
              )}
            </div>

            {/* AGENTS section */}
            <div className="space-y-1 pt-3">
              <div className="px-1 text-[10px] font-bold text-neutral-400 tracking-widest uppercase">Agents</div>
              {visibleAgents.map((agent: any) => {
                const direct = chats
                  .map((chat: any) => normalizeChatRecord(chat, agent.id))
                  .filter((chat: any) => chat.kind === 'dm' && (chat.primaryAgentId === agent.id || chat.folderId === agent.id))
                  .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;
                const isActive = activeChatId === direct?.id || (!activeChatId && activeFolderId === agent.id);
                return (
                  <div
                    key={agent.id}
                    onClick={() => openDirect(agent)}
                    className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${isActive && !showPlanner ? 'bg-[rgba(255,255,255,0.07)] border-l-2 border-[#4A5D75] font-bold' : 'hover:bg-[rgba(255,255,255,0.04)] text-neutral-400'}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <AgentIcon agent={agent} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs truncate text-neutral-200">{agent.name}</p>
                        <p className="text-[9px] truncate text-neutral-500">{agent.description || 'Persistent direct memory'}</p>
                      </div>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        useAgentStore.getState().setEditingAssistant({ ...agent });
                        useAgentStore.getState().setAssistantSettingsTab('config');
                        useAgentStore.getState().setShowAssistantSettings(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-[#6A829E] transition-all p-1"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
              {visibleAgents.length === 0 && <div className="text-center text-xs text-neutral-500 font-bold mt-4">No agents match this search.</div>}
            </div>

            {/* TOOLS section — permanent built-in apps (global, never go away) */}
            <div className="space-y-1 pt-3">
              <div className="px-1 text-[10px] font-bold text-neutral-400 tracking-widest uppercase">Tools</div>
              <div
                onClick={() => useSpaceStore.getState().openTab({ type: 'tool', toolId: 'planner', label: 'To-Do' })}
                className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm text-neutral-400 hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-200 transition-colors"
              >
                <CheckSquare className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs">To-Do</span>
              </div>
              <div
                onClick={() => useSpaceStore.getState().openTab({ type: 'tool', toolId: 'calendar', label: 'Calendar' })}
                className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm text-neutral-400 hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-200 transition-colors"
              >
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs">Calendar</span>
              </div>
            </div>

            {/* FAVORITES section — user-starred tabs (star a tab to pin it here) */}
            <div className="space-y-1 pt-3">
              <div className="px-1 text-[10px] font-bold text-neutral-400 tracking-widest uppercase">Favorites</div>
              {favorites.map(tab => {
                const FavIcon = tab.type === 'web' ? Globe : tab.type === 'doc' ? FileText : tab.type === 'code-canvas' ? Code : Layers;
                return (
                  <div
                    key={tab.id}
                    onClick={() => useSpaceStore.getState().setActiveTab(tab.id)}
                    className={`group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${activeOmniTabId === tab.id ? 'bg-[rgba(255,255,255,0.07)] text-neutral-200' : 'text-neutral-400 hover:bg-[rgba(255,255,255,0.04)] hover:text-neutral-200'}`}
                  >
                    <FavIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs truncate flex-1">{tab.label}</span>
                    <button
                      onClick={e => { e.stopPropagation(); useSpaceStore.getState().toggleFavorite(tab.id); }}
                      className="opacity-0 group-hover:opacity-100 text-[#C9A227] hover:text-[#E0B530] transition-all shrink-0"
                      title="Remove from favorites"
                    >
                      <Star className="w-3 h-3 fill-current" />
                    </button>
                  </div>
                );
              })}
              {favorites.length === 0 && (
                <div className="px-3 py-1.5 text-[10px] text-neutral-600 leading-relaxed">Star a tab to pin it here for quick access.</div>
              )}
            </div>

            {/* SPACES section — each Space is a context container with its own tabs */}
            <div className="space-y-1 pt-3">
              <div className="px-1 flex items-center justify-between">
                <span className="text-[10px] font-bold text-neutral-400 tracking-widest uppercase">Spaces</span>
                <button
                  onClick={() => {
                    const space = useSpaceStore.getState().createSpace('New Space', []);
                    useSpaceStore.getState().setActiveSpaceId(space.id);
                  }}
                  className="p-1 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                  title="Create new space"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              {spaces.map(space => (
                <div
                  key={space.id}
                  onClick={() => useSpaceStore.getState().setActiveSpaceId(space.id)}
                  className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${activeSpaceId === space.id ? 'bg-[rgba(255,255,255,0.07)] border-l-2 border-[#4A5D75]' : 'hover:bg-[rgba(255,255,255,0.04)] text-neutral-400'}`}
                >
                  <span className="text-xs truncate text-neutral-200">{space.name}</span>
                  <span className="ml-2 shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-neutral-400">
                    {space.agentIds.length > 0 ? `${space.agentIds.length} agent${space.agentIds.length !== 1 ? 's' : ''}` : 'no agents'}
                  </span>
                </div>
              ))}
              {spaces.length === 0 && (
                <div className="text-center text-xs text-neutral-500 font-bold mt-3">No spaces yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="p-4 border-t border-[rgba(255,255,255,0.05)] shrink-0">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={createAgent}
              className="flex items-center justify-center gap-1.5 bg-[#9EADC8] hover:bg-[#899AB5] text-[#2C3E50] font-semibold text-[11px] rounded-xl px-2 py-3 shadow-sm transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" /> Agent
            </button>
            <button
              onClick={() => {
                const space = useSpaceStore.getState().createSpace('New Space', []);
                useSpaceStore.getState().setActiveSpaceId(space.id);
              }}
              className="flex items-center justify-center gap-1.5 bg-[#4A5D75] hover:bg-[#3D4D61] text-white font-semibold text-[11px] rounded-xl px-2 py-3 shadow-sm transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" /> Space
            </button>
            <button
              onClick={() => useSpaceStore.getState().openTab({ type: 'code-canvas', label: 'Untitled Canvas' })}
              className="flex items-center justify-center gap-1.5 bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] text-neutral-300 font-semibold text-[11px] rounded-xl px-2 py-3 shadow-sm transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" /> Canvas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
