import { useState } from 'react';
import { Bot, Search, Edit2, Trash2, TerminalSquare, FileEdit, Code, FileText, ImageIcon, Plus, Hash } from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import type { Channel } from '../store/useChatStore';
import { useAgentStore } from '../store/useAgentStore';
import { useTaskStore } from '../store/useTaskStore';
import { useUIStore } from '../store/useUIStore';
import { ChannelModal } from './ui/ChannelModal';

const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

interface AppSidebarProps {
  onDeleteSavedApp: (id: string) => void;
  onCreateBlankArtifact: (type: string) => void;
}

export function AppSidebar({ onDeleteSavedApp, onCreateBlankArtifact }: AppSidebarProps) {
  const isSidebarOpen = useUIStore(s => s.isSidebarOpen);
  const viewMode = useUIStore(s => s.viewMode);
  const canvasContent = useUIStore(s => s.canvasContent);
  const savedApps = useUIStore(s => s.savedApps);
  const archiveSearchQuery = useUIStore(s => s.archiveSearchQuery);
  const archiveSubView = useUIStore(s => s.archiveSubView);

  const chats = useChatStore(s => s.chats);
  const channels = useChatStore(s => s.channels);
  const activeChatId = useChatStore(s => s.activeChatId);
  const chatSearchQuery = useChatStore(s => s.chatSearchQuery);
  const editingChatId = useChatStore(s => s.editingChatId);
  const editingChatName = useChatStore(s => s.editingChatName);

  const activeFolderId = useAgentStore(s => s.activeFolderId);
  const showPlanner = useTaskStore(s => s.showPlanner);

  const [channelModal, setChannelModal] = useState<{ mode: 'create' | 'edit'; channel?: Channel } | null>(null);

  function openChannel(channel: Channel) {
    const primaryAgentId = channel.enrolledAgentIds[0];
    if (primaryAgentId) useAgentStore.getState().setActiveFolderId(primaryAgentId);
    useChatStore.getState().setActiveChatId(channel.id);
    useUIStore.getState().setCanvasContent(null);
    useTaskStore.getState().setShowPlanner(false);
  }

  function saveChannel(data: Partial<Channel>) {
    if (channelModal?.mode === 'create') {
      const newChannel: Channel = {
        id: generateId('ch'),
        name: data.name ?? 'new-channel',
        enrolledAgentIds: data.enrolledAgentIds ?? [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      useChatStore.getState().setChannels(prev => [newChannel, ...prev]);
      useChatStore.getState().setMessages(prev => ({ ...prev, [newChannel.id]: [] }));
      openChannel(newChannel);
    } else if (channelModal?.channel) {
      const id = channelModal.channel.id;
      useChatStore.getState().setChannels(prev =>
        prev.map(ch => ch.id === id ? { ...ch, ...data, updatedAt: Date.now() } : ch)
      );
    }
    setChannelModal(null);
    useChatStore.getState().persist();
  }

  function deleteChannel(id: string) {
    useChatStore.getState().setChannels(prev => prev.filter(ch => ch.id !== id));
    if (activeChatId === id) useChatStore.getState().setActiveChatId(null);
    setChannelModal(null);
    useChatStore.getState().persist();
  }

  const visibleChannels = channels.filter(ch =>
    ch.name.toLowerCase().includes(chatSearchQuery.toLowerCase())
  );

  return (
    <>
      <div className={`shrink-0 transition-all duration-300 border-r border-neutral-200 dark:border-neutral-800 z-[60] bg-white dark:bg-neutral-950 overflow-hidden flex flex-col ${isSidebarOpen && !canvasContent?.isStandalone ? 'w-72' : 'w-0'}`}>
        <div className="w-72 h-full flex flex-col">
          <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-3 bg-[#2C3E50]">
            <div className="p-2 bg-[#9EADC8] rounded-xl shadow-md shrink-0"><Bot className="w-5 h-5 text-[#2C3E50]" /></div>
            <div><span className="text-sm font-black tracking-tighter uppercase text-white block">Agent Forge</span><span className="text-[9px] font-bold uppercase tracking-widest text-[#9EADC8]">Your AI Studio</span></div>
          </div>

          <div className="flex p-1 gap-1 mx-4 mt-4 bg-neutral-100 dark:bg-neutral-800 rounded-xl shrink-0">
            {['chat', 'canvas'].map(v => <button key={v} onClick={() => useUIStore.getState().setViewMode(v)} className={`flex-1 text-[10px] uppercase font-black py-2 rounded-lg transition-all ${viewMode === v ? 'bg-white dark:bg-neutral-700 shadow-sm text-[#4A5D75]' : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200'}`}>{v}</button>)}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2 no-scrollbar">
            {viewMode === 'chat' ? (
              <div className="space-y-3">
                <div className="px-1 mb-2 relative mt-2">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400" />
                  <input
                    className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-lg pl-8 pr-4 py-2.5 text-[10px] font-bold outline-none focus:ring-1 ring-[#6A829E]/30"
                    placeholder="Search chats and channels..."
                    value={chatSearchQuery}
                    onChange={e => useChatStore.getState().setChatSearchQuery(e.target.value)}
                  />
                </div>

                {/* Chats scoped to active agent */}
                {chats.filter(c => c.folderId === activeFolderId && c.name.toLowerCase().includes(chatSearchQuery.toLowerCase())).map(chat => (
                  <div key={chat.id} onClick={() => { useChatStore.getState().setActiveChatId(chat.id); useUIStore.getState().setCanvasContent(null); useTaskStore.getState().setShowPlanner(false); }} className={`group flex items-center justify-between px-3 py-3 rounded-xl cursor-pointer transition-all ${activeChatId === chat.id && !showPlanner ? 'bg-neutral-100 dark:bg-neutral-800 font-bold border-l-2 border-[#4A5D75]' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900/50 text-neutral-500'}`}>
                    {editingChatId === chat.id
                      ? <input autoFocus value={editingChatName} onChange={e => useChatStore.getState().setEditingChatName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { useChatStore.getState().setChats((prev: any[]) => prev.map((c: any) => c.id === chat.id ? { ...c, name: editingChatName || 'Unnamed' } : c)); useChatStore.getState().setEditingChatId(null); } else if (e.key === 'Escape') useChatStore.getState().setEditingChatId(null); }} onBlur={() => { useChatStore.getState().setChats((prev: any[]) => prev.map((c: any) => c.id === chat.id ? { ...c, name: editingChatName || 'Unnamed' } : c)); useChatStore.getState().setEditingChatId(null); }} className="w-full bg-white dark:bg-neutral-950 text-xs font-bold px-2 py-1 rounded outline-none border border-[#6A829E]" />
                      : <><span className="text-xs truncate flex-1">{chat.name}</span><div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={(e) => { e.stopPropagation(); useChatStore.getState().setEditingChatId(chat.id); useChatStore.getState().setEditingChatName(chat.name); }} className="text-neutral-400 hover:text-[#6A829E]"><Edit2 className="w-3 h-3" /></button><button onClick={e => { e.stopPropagation(); useChatStore.getState().setChats((prev: any[]) => prev.filter((c: any) => c.id !== chat.id)); if (activeChatId === chat.id) useChatStore.getState().setActiveChatId(null); }} className="text-neutral-400 hover:text-[#C98A8A]"><Trash2 className="w-3.5 h-3.5" /></button></div></>
                    }
                  </div>
                ))}
                {chats.filter(c => c.folderId === activeFolderId).length === 0 && (
                  <div className="text-center text-xs text-neutral-400 font-bold mt-4">No chats yet.</div>
                )}

                {/* Channels section */}
                <div className="mt-4 space-y-1">
                  <div className="flex items-center justify-between px-1 mb-1">
                    <span className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Channels</span>
                    <button
                      onClick={() => setChannelModal({ mode: 'create' })}
                      className="text-neutral-400 hover:text-[#4A5D75] transition-colors"
                      title="New channel"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  {visibleChannels.map(ch => (
                    <div
                      key={ch.id}
                      onClick={() => openChannel(ch)}
                      className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${activeChatId === ch.id && !showPlanner ? 'bg-neutral-100 dark:bg-neutral-800 font-bold border-l-2 border-[#4A5D75]' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900/50 text-neutral-500'}`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Hash className="w-3 h-3 shrink-0 text-neutral-400" />
                        <span className="text-xs truncate">{ch.name}</span>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); setChannelModal({ mode: 'edit', channel: ch }); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-neutral-400 hover:text-[#4A5D75] p-1"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {visibleChannels.length === 0 && (
                    <div className="text-center text-xs text-neutral-400 mt-2">No channels yet.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2 px-1 mb-4"><button onClick={() => onCreateBlankArtifact('code')} className="flex-1 flex justify-center items-center gap-1.5 py-3 rounded-xl border border-[#D6E0EA] dark:border-[#4A5D75]/50 bg-[#F0F4F8] dark:bg-[#4A5D75]/20 text-[9px] font-black uppercase text-[#4A5D75] dark:text-[#899AB5] hover:bg-[#D6E0EA] dark:hover:bg-[#4A5D75]/40 transition-all"><TerminalSquare className="w-3.5 h-3.5" /> Blank App</button><button onClick={() => onCreateBlankArtifact('doc')} className="flex-1 flex justify-center items-center gap-1.5 py-3 rounded-xl border border-[#DCE7E1] dark:border-[#2C3E35]/50 bg-[#EEF3F0] dark:bg-[#2C3E35]/20 text-[9px] font-black uppercase text-[#7A9E8D] dark:text-[#B5CDBF] hover:bg-[#DCE7E1] dark:hover:bg-[#2C3E35]/40 transition-all"><FileEdit className="w-3.5 h-3.5" /> Blank Doc</button></div>
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

          <div className="p-4 border-t border-neutral-200 dark:border-neutral-800 shrink-0 flex gap-2">
            <button
              onClick={() => { const id = generateId('c'); useChatStore.getState().setChats((prev: any[]) => [{ id, folderId: activeFolderId, name: 'New Session', updatedAt: Date.now() }, ...prev]); useChatStore.getState().setActiveChatId(id); useChatStore.getState().setMessages((prev: any) => ({ ...prev, [id]: [] })); useTaskStore.getState().setShowPlanner(false); useUIStore.getState().setViewMode('chat'); }}
              className="flex-1 flex items-center justify-center gap-2 bg-[#9EADC8] hover:bg-[#899AB5] text-[#2C3E50] font-black text-[10px] uppercase tracking-widest rounded-xl px-3 py-3.5 shadow-lg transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" /> Chat
            </button>
            <button
              onClick={() => setChannelModal({ mode: 'create' })}
              className="flex-1 flex items-center justify-center gap-2 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 font-black text-[10px] uppercase tracking-widest rounded-xl px-3 py-3.5 transition-all active:scale-95"
            >
              <Hash className="w-4 h-4" /> Channel
            </button>
          </div>
        </div>
      </div>

      {channelModal && (
        <ChannelModal
          mode={channelModal.mode}
          channel={channelModal.channel}
          onClose={() => setChannelModal(null)}
          onSave={saveChannel}
          onDelete={channelModal.channel ? () => deleteChannel(channelModal.channel!.id) : undefined}
        />
      )}
    </>
  );
}
