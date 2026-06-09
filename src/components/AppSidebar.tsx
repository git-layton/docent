import { useState, useEffect, useCallback } from 'react';
import { Bot, Search, Edit2, Trash2, TerminalSquare, FileEdit, Code, FileText, ImageIcon, Hash, User, Plus, Wifi, WifiOff, GitBranch, Globe, Settings } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useChatStore } from '../store/useChatStore';
import { useAgentStore } from '../store/useAgentStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useUIStore } from '../store/useUIStore';
import { normalizeChatRecord } from '../services/channels';
import { AgentIcon } from './ui/AgentIcon';

const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

interface AppSidebarProps {
  onDeleteSavedApp: (id: string) => void;
  onCreateBlankArtifact: (type: string) => void;
}

export function AppSidebar({ onDeleteSavedApp, onCreateBlankArtifact }: AppSidebarProps) {
  const [networkActive, setNetworkActive] = useState(false);
  const [networkPeers, setNetworkPeers] = useState<Array<{ id: string; name: string; ip: string }>>([]);

  // Store reads
  const isSidebarOpen = useUIStore(s => s.isSidebarOpen);
  const viewMode = useUIStore(s => s.viewMode);
  const canvasContent = useUIStore(s => s.canvasContent);
  const savedApps = useUIStore(s => s.savedApps);
  const archiveSearchQuery = useUIStore(s => s.archiveSearchQuery);
  const archiveSubView = useUIStore(s => s.archiveSubView);

  const chats = useChatStore(s => s.chats);
  const activeChatId = useChatStore(s => s.activeChatId);
  const chatSearchQuery = useChatStore(s => s.chatSearchQuery);
  const editingChatId = useChatStore(s => s.editingChatId);
  const editingChatName = useChatStore(s => s.editingChatName);

  const activeFolderId = useAgentStore(s => s.activeFolderId);
  const assistants = useAgentStore(s => s.assistants);
  const appSettings = useSettingsStore(s => s.appSettings);
  const userProfile = useSettingsStore(s => s.userProfile);
  const userName = useSettingsStore(s => s.userName);
  const userAvatar = useSettingsStore(s => s.userAvatar);
  const showPlanner = useTaskStore(s => s.showPlanner);

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

  const createChannel = () => {
    const id = generateId('c');
    const chat = normalizeChatRecord({
      id,
      folderId: activeFolderId,
      primaryAgentId: activeFolderId,
      participantAgentIds: [activeFolderId],
      kind: 'channel',
      name: 'New Channel',
      goal: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, activeFolderId);
    useChatStore.getState().setChats((prev: any[]) => [chat, ...prev]);
    useChatStore.getState().setActiveChatId(id);
    useChatStore.getState().setMessages((prev: any) => ({ ...prev, [id]: [] }));
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

  const renameChat = (chatId: string, name: string) => {
    useChatStore.getState().setChats((prev: any[]) => prev.map((c: any) => c.id === chatId ? { ...c, name: name || 'Unnamed' } : c));
  };

  const deleteChannel = (chatId: string, name: string) => {
    if (!window.confirm(`Delete "${name}" and its messages?`)) return;
    const { chats: currentChats, activeChatId: currentActiveChatId } = useChatStore.getState();
    const nextChats = currentChats.filter((chat: any) => chat.id !== chatId);
    useChatStore.getState().setChats(nextChats);
    useChatStore.getState().setMessages((prev: Record<string, any[]>) => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
    if (currentActiveChatId === chatId) {
      useChatStore.getState().setActiveChatId(nextChats[0]?.id ?? null);
    }
  };


  const openBrowserWindow = useCallback(async () => {
    try {
      const existing = await WebviewWindow.getByLabel('browser');
      if (existing) {
        await existing.show();
        await existing.setFocus();
        return;
      }
    } catch (_) {}
    new WebviewWindow('browser', {
      url: 'index.html?window=browser',
      title: 'Agent Forge — Browser',
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 600,
    });
  }, []);

  const query = chatSearchQuery.toLowerCase();
  const visibleAgents = assistants
    .filter((agent: any) => agent.id !== 'forge-guide' && agent.id !== 'f-default')
    .filter((agent: any) => `${agent.name} ${agent.description ?? ''}`.toLowerCase().includes(query));
  const visibleChannels = chats
    .map((chat: any) => normalizeChatRecord(chat, activeFolderId))
    .filter((chat: any) => chat.kind === 'channel')
    .filter((chat: any) => `${chat.name} ${chat.goal ?? ''}`.toLowerCase().includes(query));

  return (
    <div className={`shrink-0 transition-all duration-300 border-r border-neutral-200 dark:border-neutral-800 z-[60] bg-white dark:bg-neutral-950 overflow-hidden flex flex-col ${isSidebarOpen && !canvasContent?.isStandalone ? 'w-72' : 'w-0'}`}>
      <div className="w-72 h-full flex flex-col">
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2.5 bg-[#2C3E50]">
          <div className="p-1.5 bg-[#9EADC8]/30 rounded-lg shrink-0"><Bot className="w-3.5 h-3.5 text-[#9EADC8]" /></div>
          <span className="text-xs font-semibold text-white/80 tracking-tight">Agent Forge</span>
        </div>

        <div className="flex p-1 gap-1 mx-4 mt-3 bg-neutral-100 dark:bg-neutral-800 rounded-xl shrink-0">
          {['chat', 'canvas'].map(v => <button key={v} onClick={() => useUIStore.getState().setViewMode(v)} className={`flex-1 text-[10px] font-medium py-1.5 rounded-lg transition-all capitalize ${viewMode === v ? 'bg-white dark:bg-neutral-700 shadow-sm text-[#4A5D75]' : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'}`}>{v}</button>)}
          <button
            onClick={openBrowserWindow}
            title="Browser"
            className="flex items-center justify-center px-2 py-1.5 rounded-lg transition-all text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => useUIStore.getState().setViewMode('knowledge-graph')}
            title="Knowledge Graph"
            className={`flex items-center justify-center px-2 py-1.5 rounded-lg transition-all ${viewMode === 'knowledge-graph' ? 'bg-white dark:bg-neutral-700 shadow-sm text-[#4A5D75]' : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'}`}
          >
            <GitBranch className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2 no-scrollbar">
          {viewMode === 'chat' ? (
            <div className="space-y-3">
              <div className="px-1 mb-2 relative mt-2"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400" /><input className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-lg pl-8 pr-4 py-2.5 text-[10px] font-bold outline-none focus:ring-1 ring-[#6A829E]/30" placeholder="Search people, agents, channels..." value={chatSearchQuery} onChange={e => useChatStore.getState().setChatSearchQuery(e.target.value)} /></div>
              <div className="space-y-1">
                <div className="px-1 flex items-center justify-between">
                  <span className="text-[9px] font-medium uppercase tracking-wider text-neutral-400">People</span>
                  <button
                    onClick={toggleNetwork}
                    className={`p-1 rounded-lg transition-colors ${networkActive ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'text-neutral-400 hover:text-[#4A5D75] hover:bg-neutral-50 dark:hover:bg-neutral-900/50'}`}
                    title={networkActive ? 'Active on network — click to go offline' : 'Go active on your network'}
                  >
                    {networkActive ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* You — always visible */}
                <button
                  onClick={() => useSettingsStore.getState().setShowProfileSettings(true)}
                  className="group w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-all"
                >
                  <div className="shrink-0">
                    {userAvatar ? (
                      <img src={userAvatar} alt="You" className="w-6 h-6 rounded-lg object-cover" />
                    ) : (
                      <div className="w-6 h-6 rounded-lg bg-[#9EADC8] flex items-center justify-center">
                        {(appSettings as any).penguinMode
                          ? <span className="text-[10px]">🐧</span>
                          : <span className="text-[10px] font-bold text-white uppercase">{displayName.charAt(0)}</span>
                        }
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-xs truncate text-neutral-800 dark:text-neutral-200">{displayName}</p>
                    <p className="text-[9px] text-neutral-400">you</p>
                  </div>
                  <Settings className="w-3 h-3 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>

                {/* Local people from settings */}
                {(appSettings.people ?? []).filter((p: any) => `${p.label} ${p.role ?? ''}`.toLowerCase().includes(query)).map((person: any) => (
                  <div key={person.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-neutral-500">
                    <div className="p-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 shrink-0">
                      <User className="w-3.5 h-3.5 text-neutral-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs truncate text-neutral-800 dark:text-neutral-200">{person.label}</p>
                      {person.role && <p className="text-[9px] truncate text-neutral-400">{person.role}</p>}
                    </div>
                  </div>
                ))}

                {/* Network peers (when active) */}
                {networkActive && networkPeers.map(peer => (
                  <div key={peer.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-neutral-500">
                    <div className="p-1.5 rounded-lg bg-[#EEF3F0] dark:bg-[#2C3E35]/30 shrink-0">
                      <User className="w-3.5 h-3.5 text-[#7A9E8D]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs truncate text-neutral-800 dark:text-neutral-200">{peer.name}</p>
                      <p className="text-[9px] truncate text-neutral-400">{peer.ip}</p>
                    </div>
                  </div>
                ))}
                {networkActive && networkPeers.length === 0 && (
                  <p className="text-[10px] text-neutral-400 text-center px-3 py-1.5">No one else on network yet.</p>
                )}
              </div>

              <div className="space-y-1 pt-3">
                <div className="px-1 text-[9px] font-medium uppercase tracking-wider text-neutral-400">Agents</div>
                {visibleAgents.map((agent: any) => {
                  const direct = chats
                    .map((chat: any) => normalizeChatRecord(chat, agent.id))
                    .filter((chat: any) => chat.kind === 'dm' && (chat.primaryAgentId === agent.id || chat.folderId === agent.id))
                    .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;
                  const isActive = activeChatId === direct?.id || (!activeChatId && activeFolderId === agent.id);
                  return (
                    <div key={agent.id} onClick={() => openDirect(agent)} className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${isActive && !showPlanner ? 'bg-neutral-100 dark:bg-neutral-800 font-bold border-l-2 border-[#4A5D75]' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900/50 text-neutral-500'}`}>
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <AgentIcon agent={agent} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs truncate text-neutral-800 dark:text-neutral-200">{agent.name}</p>
                          <p className="text-[9px] truncate text-neutral-400">{agent.description || 'Persistent direct memory'}</p>
                        </div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); useAgentStore.getState().setEditingAssistant({ ...agent }); useAgentStore.getState().setAssistantSettingsTab('config'); useAgentStore.getState().setShowAssistantSettings(true); }} className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-[#6A829E] transition-all p-1">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
                {visibleAgents.length === 0 && <div className="text-center text-xs text-neutral-400 font-bold mt-4">No agents match this search.</div>}
              </div>

              <div className="space-y-1 pt-3">
                <div className="px-1 text-[9px] font-medium uppercase tracking-wider text-neutral-400">Channels</div>
                {visibleChannels.map((chat: any) => (
                  <div key={chat.id} onClick={() => { useAgentStore.getState().setActiveFolderId(chat.primaryAgentId ?? activeFolderId); useChatStore.getState().setActiveChatId(chat.id); useUIStore.getState().setCanvasContent(null); useTaskStore.getState().setShowPlanner(false); }} className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${activeChatId === chat.id && !showPlanner ? 'bg-neutral-100 dark:bg-neutral-800 font-bold border-l-2 border-[#4A5D75]' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900/50 text-neutral-500'}`}>
                    {editingChatId === chat.id ? (
                      <input autoFocus value={editingChatName} onChange={e => useChatStore.getState().setEditingChatName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { renameChat(chat.id, editingChatName); useChatStore.getState().setEditingChatId(null); } else if (e.key === 'Escape') useChatStore.getState().setEditingChatId(null); }} onBlur={() => { renameChat(chat.id, editingChatName); useChatStore.getState().setEditingChatId(null); }} className="w-full bg-white dark:bg-neutral-900 text-sm font-bold px-3 py-2 rounded-xl outline-none border border-neutral-200 dark:border-neutral-700 focus:border-secondary-light transition-colors" />
                    ) : (
                      <>
                        <div className="flex items-center gap-2 truncate flex-1">
                          <Hash className="w-3 h-3 text-[#6A829E] shrink-0" />
                          <span className="text-xs truncate flex-1">{chat.name}</span>
                        </div>
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); useChatStore.getState().setEditingChatId(chat.id); useChatStore.getState().setEditingChatName(chat.name); }} className="text-neutral-400 hover:text-[#6A829E]"><Edit2 className="w-3 h-3" /></button>
                          <button onClick={e => { e.stopPropagation(); deleteChannel(chat.id, chat.name); }} className="text-neutral-400 hover:text-[#C98A8A]"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {visibleChannels.length === 0 && <div className="text-center text-xs text-neutral-400 font-bold mt-3">No channels yet.</div>}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2 px-1 mb-4"><button onClick={() => onCreateBlankArtifact('code')} className="flex-1 flex justify-center items-center gap-1.5 py-3.5 rounded-xl border border-[#D6E0EA] dark:border-[#4A5D75]/50 bg-[#F0F4F8] dark:bg-[#4A5D75]/20 text-[9px] font-black uppercase text-[#4A5D75] dark:text-[#899AB5] hover:bg-[#D6E0EA] dark:hover:bg-[#4A5D75]/40 transition-all"><TerminalSquare className="w-3.5 h-3.5" /> Blank App</button><button onClick={() => onCreateBlankArtifact('doc')} className="flex-1 flex justify-center items-center gap-1.5 py-3.5 rounded-xl border border-[#DCE7E1] dark:border-[#2C3E35]/50 bg-[#EEF3F0] dark:bg-[#2C3E35]/20 text-[9px] font-black uppercase text-[#7A9E8D] dark:text-[#B5CDBF] hover:bg-[#DCE7E1] dark:hover:bg-[#2C3E35]/40 transition-all"><FileEdit className="w-3.5 h-3.5" /> Blank Doc</button></div>
              <div className="px-1 mb-2 relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400" /><input className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-lg pl-8 pr-4 py-2.5 text-[10px] font-bold outline-none focus:ring-1 ring-[#6A829E]/30" placeholder="Search saved items..." value={archiveSearchQuery} onChange={e => useUIStore.getState().setArchiveSearchQuery(e.target.value)} /></div>
              <div className="flex gap-1 border-b border-neutral-100 dark:border-neutral-800 mb-2 px-1">{['code', 'doc', 'image'].map(v => <button key={v} onClick={() => useUIStore.getState().setArchiveSubView(v)} className={`flex-1 pb-2 text-[9px] font-black uppercase tracking-tighter transition-all ${archiveSubView === v ? (v === 'code' ? 'text-[#4A5D75] border-b-2 border-[#4A5D75]' : v === 'doc' ? 'text-[#7A9E8D] border-b-2 border-[#7A9E8D]' : 'text-[#D4AA7D] border-b-2 border-[#D4AA7D]') : 'text-neutral-400'}`}>{v === 'code' ? 'Code' : v === 'doc' ? 'Docs' : 'Images'}</button>)}</div>

              <div className="space-y-2 px-1">
                {savedApps.filter((a: any) => a.type === archiveSubView && a.title.toLowerCase().includes(archiveSearchQuery.toLowerCase())).map((app: any) => (
                  <div key={app.id} onClick={() => { const appToLoad = { ...app, isStandalone: true }; if (!appToLoad.history && app.type !== 'image') { appToLoad.history = [{ timestamp: appToLoad.updatedAt || Date.now(), content: appToLoad.content }]; appToLoad.historyIndex = 0; } useUIStore.getState().setCanvasContent(appToLoad); useUIStore.getState().setCanvasTab('preview'); useTaskStore.getState().setShowPlanner(false); }} className="group px-3 py-3 rounded-xl cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-3 border border-transparent hover:border-neutral-200 dark:hover:border-neutral-700 transition-all">
                    <div className={`p-2 rounded-lg shrink-0 ${archiveSubView === 'code' ? 'bg-[#F0F4F8] dark:bg-[#1E2B38]/20' : archiveSubView === 'doc' ? 'bg-[#EEF3F0] dark:bg-[#2C3E35]/20' : 'bg-[#FFF9F2] dark:bg-[#5C452E]/20'}`}>{archiveSubView === 'code' ? <Code className="w-4 h-4 text-[#6A829E]" /> : archiveSubView === 'doc' ? <FileText className="w-4 h-4 text-[#9FBBAF]" /> : <ImageIcon className="w-4 h-4 text-[#D4AA7D]" />}</div>
                    <span className="text-xs truncate font-bold text-neutral-800 dark:text-neutral-200 flex-1">{app.title}</span>
                    <button onClick={(e) => { e.stopPropagation(); onDeleteSavedApp(app.id); }} className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-[#C98A8A] transition-all p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                {savedApps.filter((a: any) => a.type === archiveSubView).length === 0 && (
                    <div className="text-center text-xs text-neutral-400 font-bold mt-4">No saved items found.</div>
                )}
              </div>
            </div>
          )}
        </div>


        <div className="p-4 border-t border-neutral-200 dark:border-neutral-800 shrink-0">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={createAgent} className="flex items-center justify-center gap-2 bg-[#9EADC8] hover:bg-[#899AB5] text-[#2C3E50] font-semibold text-[11px] rounded-xl px-3 py-3 shadow-sm transition-all active:scale-95"><Plus className="w-3.5 h-3.5" /> Agent</button>
            <button onClick={createChannel} className="flex items-center justify-center gap-2 bg-[#4A5D75] hover:bg-[#3D4D61] text-white font-semibold text-[11px] rounded-xl px-3 py-3 shadow-sm transition-all active:scale-95"><Hash className="w-3.5 h-3.5" /> Channel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
