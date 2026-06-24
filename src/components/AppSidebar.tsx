import { useState, useEffect } from 'react';
import { Bot, Search, Edit2, User, Plus, Wifi, WifiOff, Settings } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useChatStore } from '../store/useChatStore';
import { useAgentStore } from '../store/useAgentStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useUIStore } from '../store/useUIStore';
import { useSpaceStore } from '../store/useSpaceStore';
import { AgentIcon } from './ui/AgentIcon';


interface AppSidebarProps {
  // onDeleteSavedApp and onCreateBlankArtifact removed — Unit 7 (App.tsx migration) handles call site cleanup
}

export function AppSidebar(_: AppSidebarProps) {
  const [networkActive, setNetworkActive] = useState(false);
  const [networkPeers, setNetworkPeers] = useState<Array<{ id: string; name: string; ip: string }>>([]);
  const [showNewMenu, setShowNewMenu] = useState(false);

  // Store reads
  const isSidebarOpen = useUIStore(s => s.isSidebarOpen);
  const canvasContent = useUIStore(s => s.canvasContent);

  const chatSearchQuery = useChatStore(s => s.chatSearchQuery);

  const assistants = useAgentStore(s => s.assistants);
  const appSettings = useSettingsStore(s => s.appSettings);
  const userProfile = useSettingsStore(s => s.userProfile);
  const userName = useSettingsStore(s => s.userName);
  const userAvatar = useSettingsStore(s => s.userAvatar);
  const showPlanner = useTaskStore(s => s.showPlanner);

  const spaces = useSpaceStore(s => s.spaces);
  const activeSpaceId = useSpaceStore(s => s.activeSpaceId);

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
    // A DM is a container scoped to one agent — open (or create) it; the store
    // wires the active container, its tab, its own thread, and the active agent.
    useSpaceStore.getState().openAgentDm({ id: agent.id, name: agent.name });
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

  // The top box filters this sidebar as you type; pressing ↵ (or the ⌘K pill) hands the
  // same text to the global command palette, which searches across every space, tab & agent.
  const openGlobalSearch = () =>
    window.dispatchEvent(new CustomEvent('forge:open-cmdk', { detail: { query: chatSearchQuery } }));
  // Codey ('forge-dev') is the CODE-ONLY copilot — he drives the Code surface, not a general agent,
  // so he's hidden from the People roster (he still exists in `assistants` for the Code space / advisor
  // flow). 'forge-guide' and the hidden 'f-default' fallback are likewise kept out of the roster.
  const visibleAgents = assistants
    .filter((agent: any) => agent.id !== 'forge-guide' && agent.id !== 'f-default' && agent.id !== 'forge-dev')
    .filter((agent: any) => `${agent.name} ${agent.description ?? ''}`.toLowerCase().includes(query));

  return (
    <div className={`shrink-0 transition-all duration-300 border-r border-edge z-[60] bg-base overflow-hidden flex flex-col ${isSidebarOpen && !canvasContent?.isStandalone ? 'w-72' : 'w-0'}`}>
      <div className="w-72 h-full flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-edge flex items-center gap-2.5">
          <div className="p-1.5 bg-accent rounded-lg shrink-0"><Bot className="w-3.5 h-3.5 text-on-accent" /></div>
          <span className="text-xs font-semibold text-ink tracking-tight">Agent Forge</span>
        </div>

        {/* Scrollable nav */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2 no-scrollbar">
          <div className="space-y-3">
            {/* Search bar — filters the sidebar as you type; ↵ or the ⌘K pill searches everything */}
            <div className="px-1 mb-2 relative mt-2">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-3" />
              <input
                className="w-full bg-inset border border-edge rounded-full pl-8 pr-12 py-2.5 text-[10px] font-bold outline-none focus:ring-1 ring-accent text-ink placeholder:text-ink-3"
                placeholder="Search everything..."
                value={chatSearchQuery}
                onChange={e => useChatStore.getState().setChatSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); openGlobalSearch(); } }}
              />
              <button
                onClick={openGlobalSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md bg-wash text-ink-3 hover:text-ink hover:bg-inset transition-colors text-[9px] font-bold tracking-wide"
                title="Search everything"
              >
                ⌘K
              </button>
            </div>

            {/* PEOPLE section */}
            <div className="space-y-1">
              <div className="px-1 flex items-center justify-between">
                <span className="text-[10px] font-bold text-ink-3 tracking-widest uppercase">People</span>
                <button
                  onClick={toggleNetwork}
                  className={`p-1 rounded-lg transition-colors ${networkActive ? 'text-success bg-success-soft' : 'text-ink-3 hover:text-ink-2 hover:bg-wash'}`}
                  title={networkActive ? 'Active on network — click to go offline' : 'Go active on your network'}
                >
                  {networkActive ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* You — always visible */}
              <button
                onClick={() => useSettingsStore.getState().setShowProfileSettings(true)}
                className="group w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-wash transition-all"
              >
                <div className="shrink-0">
                  {userAvatar ? (
                    <img src={userAvatar} alt="You" className="w-6 h-6 rounded-lg object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-lg bg-accent-soft flex items-center justify-center">
                      <span className="text-[10px] font-bold text-accent-soft-ink uppercase">{displayName.charAt(0)}</span>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-xs truncate text-ink">{displayName}</p>
                  <p className="text-[9px] text-ink-3">you</p>
                </div>
                <Settings className="w-3 h-3 text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>

              {/* Local people from settings */}
              {(appSettings.people ?? []).filter((p: any) => `${p.label} ${p.role ?? ''}`.toLowerCase().includes(query)).map((person: any) => (
                <div key={person.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl">
                  <div className="p-1.5 rounded-lg bg-wash shrink-0">
                    <User className="w-3.5 h-3.5 text-ink-3" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs truncate text-ink">{person.label}</p>
                    {person.role && <p className="text-[9px] truncate text-ink-3">{person.role}</p>}
                  </div>
                </div>
              ))}

              {/* Network peers (when active) */}
              {networkActive && networkPeers.map(peer => (
                <div key={peer.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl">
                  <div className="p-1.5 rounded-lg bg-success-soft shrink-0">
                    <User className="w-3.5 h-3.5 text-success" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs truncate text-ink">{peer.name}</p>
                    <p className="text-[9px] truncate text-ink-3">{peer.ip}</p>
                  </div>
                </div>
              ))}
              {networkActive && networkPeers.length === 0 && (
                <p className="text-[10px] text-ink-3 text-center px-3 py-1.5">No one else on network yet.</p>
              )}
            </div>

            {/* AGENTS section */}
            <div className="space-y-1 pt-3">
              <div className="px-1 text-[10px] font-bold text-ink-3 tracking-widest uppercase">Agents</div>
              {visibleAgents.map((agent: any) => {
                // A DM container has the stable id `dm-<agentId>`.
                const isActive = activeSpaceId === `dm-${agent.id}`;
                return (
                  <div
                    key={agent.id}
                    onClick={() => openDirect(agent)}
                    className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${isActive && !showPlanner ? 'bg-panel border border-edge shadow-sm font-bold' : 'border border-transparent hover:bg-wash'}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="relative shrink-0">
                        <AgentIcon agent={agent} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm shrink-0" />
                        {isActive && !showPlanner && (
                          <span className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full bg-accent border-2 border-panel" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs truncate text-ink">{agent.name}</p>
                        <p className={`text-[9px] truncate ${isActive && !showPlanner ? 'text-accent' : 'text-ink-3'}`}>
                          {isActive && !showPlanner ? 'Active now' : (agent.description || 'Persistent direct memory')}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        useAgentStore.getState().setEditingAssistant({ ...agent });
                        useAgentStore.getState().setAssistantSettingsTab('config');
                        useAgentStore.getState().setShowAssistantSettings(true);
                      }}
                      className="opacity-60 group-hover:opacity-100 text-ink-3 hover:text-accent transition-all p-1"
                      title="Assistant settings"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
              {visibleAgents.length === 0 && <div className="text-center text-xs text-ink-3 font-bold mt-4">No agents match this search.</div>}
            </div>

            {/* Tools & Favorites now live on the Home start page (opened via the
                new-tab "+" button) — the sidebar stays focused on who/where:
                People, Agents, and Spaces. */}

            {/* SPACES section — each Space is a context container with its own tabs */}
            <div className="space-y-1 pt-3">
              <div className="px-1 flex items-center justify-between">
                <span className="text-[10px] font-bold text-ink-3 tracking-widest uppercase">Spaces</span>
                <button
                  onClick={() => useUIStore.getState().openSpaceWizard()}
                  className="p-1 rounded-lg text-ink-3 hover:text-ink hover:bg-wash transition-colors"
                  title="Create new space"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              {spaces.filter(s => s.kind === 'space').map(space => (
                <div
                  key={space.id}
                  onClick={() => useSpaceStore.getState().setActiveSpaceId(space.id)}
                  className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${activeSpaceId === space.id ? 'bg-panel border border-edge shadow-sm' : 'border border-transparent hover:bg-wash'}`}
                >
                  <span className="text-xs truncate text-ink">{space.name}</span>
                  <span className={`ml-2 shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${space.agentIds.length > 0 ? 'bg-accent-soft text-accent-soft-ink' : 'bg-wash text-ink-3'}`}>
                    {space.agentIds.length > 0 ? `${space.agentIds.length} agent${space.agentIds.length !== 1 ? 's' : ''}` : 'no agents'}
                  </span>
                </div>
              ))}
              {spaces.filter(s => s.kind === 'space').length === 0 && (
                <div className="text-center text-xs text-ink-3 font-bold mt-3">No spaces yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer — single New button with Agent / Space / Canvas menu */}
        <div className="p-4 border-t border-edge shrink-0 relative">
          {showNewMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowNewMenu(false)} />
              <div className="absolute bottom-full left-4 right-4 mb-2 z-50 overflow-hidden rounded-2xl border border-edge-2 bg-panel py-1.5 shadow-xl">
                {[
                  { id: 'agent', label: 'Agent', sub: 'Create a new specialist', run: () => { setShowNewMenu(false); createAgent(); } },
                  { id: 'space', label: 'Space', sub: 'A shared context with its own tabs', run: () => { setShowNewMenu(false); useUIStore.getState().openSpaceWizard(); } },
                  { id: 'canvas', label: 'Canvas', sub: 'Build or prototype something', run: () => { setShowNewMenu(false); useSpaceStore.getState().openTab({ type: 'code-canvas', label: 'Untitled Canvas' }); } },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={item.run}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-wash"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft">
                      <Plus className="w-3.5 h-3.5 text-accent-soft-ink" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-ink">{item.label}</span>
                      <span className="block truncate text-[10px] text-ink-3">{item.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            onClick={() => setShowNewMenu(v => !v)}
            className="flex w-full items-center justify-center gap-1.5 bg-accent hover:bg-accent-strong text-on-accent font-semibold text-[12px] rounded-full px-2 py-3 shadow-sm transition-all active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
          <p className="mt-1.5 text-center text-[9px] text-ink-3">Agent · Space · Canvas</p>
        </div>
      </div>
    </div>
  );
}
