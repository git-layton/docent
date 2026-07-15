import { useState } from 'react';
import { Bot, ChevronDown, Plus, Search, Wifi, Settings } from 'lucide-react';
import { useUIStore } from '../store/useUIStore';
import { useSpaceStore } from '../store/useSpaceStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useChatStore } from '../store/useChatStore';

export function NewShellSidebar() {
  const isSidebarOpen = useUIStore(s => s.isSidebarOpen);
  const canvasContent = useUIStore(s => s.canvasContent);
  const spaces = useSpaceStore(s => s.spaces);
  const activeSpaceId = useSpaceStore(s => s.activeSpaceId);
  const activeSpace = spaces.find(s => s.id === activeSpaceId);

  const appSettings = useSettingsStore(s => s.appSettings);
  const userName = useSettingsStore(s => s.userName);
  const userProfile = useSettingsStore(s => s.userProfile);
  const userAvatar = useSettingsStore(s => s.userAvatar);
  
  const [showSpaceMenu, setShowSpaceMenu] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);

  const displayName = (() => {
    if (userName?.trim()) return userName.trim();
    const first = userProfile?.split('\n')[0]?.trim().replace(/^[#\s]+/, '').trim();
    return first || 'You';
  })();

  const chatSearchQuery = useChatStore(s => s.chatSearchQuery);

  const openGlobalSearch = () =>
    window.dispatchEvent(new CustomEvent('forge:open-cmdk', { detail: { query: chatSearchQuery } }));

  return (
    <div className={`shrink-0 transition-all duration-300 border-r border-edge z-[60] bg-base overflow-hidden flex flex-col ${isSidebarOpen && !canvasContent?.isStandalone ? 'w-72' : 'w-0'}`}>
      <div className="w-72 h-full flex flex-col">
        {/* Space Switcher (Top of Window) */}
        <div className="px-4 py-3 border-b border-edge relative">
          <button 
            onClick={() => setShowSpaceMenu(!showSpaceMenu)}
            className="w-full flex items-center justify-between hover:bg-wash p-2 rounded-xl transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 bg-accent rounded-lg shrink-0">
                <Bot className="w-3.5 h-3.5 text-on-accent" />
              </div>
              <div className="flex flex-col items-start min-w-0">
                <span className="text-xs font-semibold text-ink tracking-tight truncate">{activeSpace?.name || 'Agent Forge'}</span>
                <span className="text-[10px] text-ink-3">Space</span>
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-ink-3 shrink-0" />
          </button>
          
          {showSpaceMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSpaceMenu(false)} />
              <div className="absolute top-full left-4 right-4 mt-2 z-50 overflow-hidden rounded-2xl border border-edge-2 bg-panel py-1.5 shadow-xl">
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-ink-3 tracking-widest uppercase">Switch Space</div>
                {spaces.filter(s => s.kind === 'space').map(space => (
                  <button
                    key={space.id}
                    onClick={() => { useSpaceStore.getState().setActiveSpaceId(space.id); setShowSpaceMenu(false); }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${activeSpaceId === space.id ? 'bg-wash text-ink' : 'text-ink-2 hover:bg-wash'}`}
                  >
                    <span className="text-xs font-semibold truncate">{space.name}</span>
                    {activeSpaceId === space.id && <div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                  </button>
                ))}
                <div className="border-t border-edge my-1" />
                <button
                  onClick={() => { useUIStore.getState().openSpaceWizard(); setShowSpaceMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors text-ink-2 hover:bg-wash"
                >
                  <Plus className="w-3.5 h-3.5 text-ink-3" />
                  <span className="text-xs font-semibold">Create new space</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Scrollable nav (Tabs/Work) */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4 no-scrollbar">
          {/* Global Search */}
          <div className="px-1 relative">
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

          <div className="space-y-1">
            <div className="px-1 text-[10px] font-bold text-ink-3 tracking-widest uppercase">Current Space</div>
            {/* The space-log is the conversation. Other tabs like notes/browsers appear in the OmniTabBar */}
            <button
              onClick={() => {
                const omniTabs = useSpaceStore.getState().omniTabs;
                const logTab = omniTabs.find(t => t.spaceId === activeSpaceId && t.type === 'space-log');
                if (logTab) useSpaceStore.getState().setActiveTab(logTab.id);
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-wash transition-all text-left"
            >
              <div className="p-1.5 rounded-lg bg-accent-soft shrink-0">
                <Bot className="w-3.5 h-3.5 text-accent-soft-ink" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs truncate text-ink font-bold">Conversation</p>
                <p className="text-[9px] text-ink-3">Alexis & Workers</p>
              </div>
            </button>
          </div>
          
          <div className="space-y-1 pt-2 border-t border-edge">
             <div className="px-1 flex items-center justify-between">
                <span className="text-[10px] font-bold text-ink-3 tracking-widest uppercase">You</span>
                <button
                  onClick={async () => {
                    // Quick minimal toggle
                    const instanceId = appSettings.forgeInstanceId || 'agent-forge-local';
                    try {
                      await import('@tauri-apps/api/core').then(m => m.invoke('set_network_active', { active: true, name: displayName, instanceId }));
                      // This is a minimal stub to avoid losing the feature completely before getting user feedback
                    } catch (e) { console.warn('[Network]', e); }
                  }}
                  className="p-1 rounded-lg text-ink-3 hover:text-ink-2 hover:bg-wash transition-colors"
                  title="Network Active Toggle (Stub)"
                >
                  <Wifi className="w-3.5 h-3.5" />
                </button>
             </div>
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
                  <p className="text-[9px] text-ink-3">Settings</p>
                </div>
                <Settings className="w-3 h-3 text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
          </div>
        </div>

        {/* Footer — New button relocated */}
        <div className="p-4 border-t border-edge shrink-0 relative">
          {showNewMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowNewMenu(false)} />
              <div className="absolute bottom-full left-4 right-4 mb-2 z-50 overflow-hidden rounded-2xl border border-edge-2 bg-panel py-1.5 shadow-xl">
                {[
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
          <p className="mt-1.5 text-center text-[9px] text-ink-3">Space · Canvas</p>
        </div>
      </div>
    </div>
  );
}
