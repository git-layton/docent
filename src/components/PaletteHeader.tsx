import { Search, Command, Activity } from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import { useJobStore } from '../store/useJobStore';

export function PaletteHeader() {
  const chatSearchQuery = useChatStore(s => s.chatSearchQuery);

  const openGlobalSearch = () =>
    window.dispatchEvent(new CustomEvent('forge:open-cmdk', { detail: { query: chatSearchQuery } }));

  // The Alexis toggle is often wired to toggle the copilot sidebar.
  // We can just flip useUIStore.getState().setCopilotOpen(!copilotOpen) 
  // but since we dispatch 'forge:toggle-copilot' in places, we'll do that or just read state.
  const toggleCopilot = () => {
     window.dispatchEvent(new CustomEvent('forge:toggle-copilot'));
  };

  return (
    <div className="h-16 px-4 flex items-center justify-between border-b border-edge shrink-0 z-50 bg-panel/80 backdrop-blur-[40px]">
      
      {/* 1. Left placeholder (empty since spaces moved) */}
      <div className="w-[140px] shrink-0" />

      {/* 2. Omnibar (Center) */}
      <div className="flex-1 max-w-xl px-4 relative flex items-center">
        <div className="relative w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
          <input
            className="w-full bg-inset border border-edge rounded-full pl-10 pr-12 py-2 text-sm font-medium outline-none focus:ring-1 ring-accent text-ink placeholder:text-ink-3 transition-shadow shadow-sm"
            placeholder="Ask, search, or chat..."
            value={chatSearchQuery}
            onChange={e => useChatStore.getState().setChatSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); openGlobalSearch(); } }}
            onClick={() => {
              if (!chatSearchQuery) openGlobalSearch();
            }}
          />
          <button
            onClick={openGlobalSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded flex items-center gap-0.5 text-ink-3 hover:text-ink transition-colors"
            title="Command Palette"
          >
            <Command className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold tracking-wide">K</span>
          </button>
        </div>
      </div>

      {/* 3. Actions & Alexis Toggle (Right) */}
      <div className="flex items-center gap-2">
        {/* Activity Center toggle */}
        <button
          onClick={() => useJobStore.getState().toggleActivityCenter()}
          className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-wash transition-colors mr-2"
          title="Activity Center"
        >
          <Activity className="w-4 h-4" />
        </button>



        {/* Alexis Toggle */}
        <button 
          onClick={toggleCopilot}
          className="flex items-center hover:bg-wash px-3 py-1.5 rounded-full transition-colors border border-edge bg-inset min-w-[90px] justify-center"
        >
          <span className="text-sm font-semibold text-ink">Alexis</span>
        </button>
      </div>
      
    </div>
  );
}
