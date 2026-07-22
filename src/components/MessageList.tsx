import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Paperclip, Bookmark, Edit3, Copy, Volume2, VolumeX, ListTodo,
  ArrowDown, ArrowUp
} from 'lucide-react';
import { AgentIcon } from './ui/AgentIcon';
import { TypingIndicator } from './ui/TypingIndicator';
import { ActionBubble } from './ui/ActionBubble';
import { ActivityTrail } from './ui/ActivityTrail';
import { useAgentActivityStore } from '../store/useAgentActivityStore';
import { useChatStore } from '../store/useChatStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useTaskStore } from '../store/useTaskStore';
import { useUIStore } from '../store/useUIStore';
import { useGroundedSuggestions } from '../lib/useGroundedSuggestions';

interface MessageListProps {
  activeMessages: any[];
  isGenerating: boolean;
  activeAssistant: any;
  forgettingIndex: number;
  onConfirmEdit: (msgId: string) => void;
  onBookmark: (msg: any) => Promise<void>;
  onToggleSpeak: (msgId: string, text: string, agentId?: string) => void;
  onAddTask: (title: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onRenderMessage: (msg: any) => React.ReactNode;
  onToast: (msg: string) => void;
  /** Send a prompt as the user — enables grounded quick-action chips under the opening reply. */
  onSendPrompt?: (text: string) => void;
  hideEmptyState?: boolean;
}

export function MessageList({
  activeMessages,
  isGenerating,
  activeAssistant,
  forgettingIndex,
  onConfirmEdit,
  onBookmark,
  onToggleSpeak,
  onAddTask,
  messagesEndRef,
  onRenderMessage,
  onToast,
  onSendPrompt,
  hideEmptyState,
}: MessageListProps) {
  // Chips appear only at the very start of a conversation (greeting + reply),
  // once the agent has finished its opening message.
  const groundedChips = useGroundedSuggestions().chips;
  const lastMsg = activeMessages[activeMessages.length - 1];
  const showOpeningChips =
    !!onSendPrompt &&
    groundedChips.length > 0 &&
    !isGenerating &&
    activeMessages.length > 0 &&
    activeMessages.length <= 2 &&
    lastMsg?.role === 'bot' &&
    !lastMsg?.isStreaming;
  // Subscribed rather than read once: steps arrive mid-turn, after this bubble is already mounted.
  const hasActionSteps = useAgentActivityStore(s => s.steps.length > 0);
  const editingMessageId = useChatStore(s => s.editingMessageId);
  const editingMessageContent = useChatStore(s => s.editingMessageContent);
  const activeChatId = useChatStore(s => s.activeChatId);
  const speakingId = useChatStore(s => s.speakingId);
  const { setEditingMessageId, setEditingMessageContent } = useChatStore.getState();

  const globalPins = useMemoryStore(s => s.globalPins);

  const { setShowPlanner } = useTaskStore.getState();

  const isDragging = useUIStore(s => s.isDragging);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom < 120;
    setIsNearBottom(nearBottom);
    useUIStore.getState().setIsChatNearBottom(nearBottom);
    setShowScrollTop(el.scrollTop > 300);
  }, []);

  // Scroll to bottom when chat switches or on initial load
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) { el.scrollTop = el.scrollHeight; setIsNearBottom(true); }
  }, [activeChatId]);

  // Smart scroll: only follow bottom if user is already near it
  useEffect(() => {
    if (!isNearBottom) return;
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeMessages, isNearBottom]);

  const scrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (el) { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); setIsNearBottom(true); }
  };

  const scrollToTop = () => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex-1 flex flex-col relative min-h-0 overflow-hidden">
      {/* Drag and Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-accent-soft border-4 border-accent/40 border-dashed rounded-[2rem] m-4 flex items-center justify-center pointer-events-none transition-all">
            <div className="bg-panel-2 px-6 py-4 rounded-2xl shadow-xl flex items-center gap-3 text-accent font-black tracking-widest uppercase">
                <Paperclip className="animate-bounce" /> Drop file to attach
            </div>
        </div>
      )}

      {/* Scroll buttons */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="absolute top-4 right-4 z-20 p-2 bg-panel-2 border border-edge rounded-full shadow-md text-ink-3 hover:text-accent transition-all hover:scale-110"
          title="Scroll to top"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      )}
      {!isNearBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-6 right-4 z-20 p-2 bg-accent hover:bg-accent-strong text-on-accent rounded-full shadow-lg transition-all hover:scale-110 animate-in fade-in zoom-in duration-200"
          title="Scroll to bottom"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      <div ref={scrollContainerRef} onScroll={checkScroll} className="flex-1 overflow-y-auto p-3 lg:p-4 no-scrollbar scroll-smooth">
        {activeChatId && activeMessages.length > 0 ? (
          <div className="max-w-3xl mx-auto space-y-3 pb-36">
            {activeMessages.flatMap((msg, idx) => {
              const divider = idx === forgettingIndex ? (
                <div key="forgetting-line" className="flex items-center gap-2 py-0.5 px-1 select-none" title={`${activeAssistant?.name ?? 'Agent'} only sees messages from here forward`}>
                  <div className="flex-1 h-px bg-edge" />
                  <span className="text-[8px] font-black uppercase tracking-[0.15em] text-ink-3 whitespace-nowrap">context</span>
                  <div className="flex-1 h-px bg-edge" />
                </div>
              ) : null;
              const bubble = (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'bot' && <div className="shrink-0 mr-2 mt-0.5 hidden sm:block"><AgentIcon agent={activeAssistant} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm" /></div>}

                  <div className={`group relative flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} ${editingMessageId === msg.id ? 'w-full' : ''}`}>
                     {msg.role === 'bot' && msg.agentName && <div className="text-[11px] font-bold text-ink-3 mb-0.5 ml-1">{msg.agentName}</div>}
                     <div className={`p-3 max-w-[92%] shadow-sm backdrop-blur-xl ${msg.role === 'user' ? 'bg-accent-soft text-accent-soft-ink rounded-2xl rounded-br-sm' : 'glass-sky border border-edge/50 text-ink rounded-2xl rounded-bl-sm'} ${editingMessageId === msg.id ? 'w-full' : ''}`}>

                       {editingMessageId === msg.id ? (
                          <div className="flex flex-col gap-3 w-full animate-in fade-in">
                             <textarea value={editingMessageContent} onChange={e => setEditingMessageContent(e.target.value)} className="w-full bg-inset text-ink border border-edge-2 rounded-xl p-3 text-sm outline-none resize-none font-medium custom-scrollbar" rows={3} autoFocus />
                             <div className="flex justify-end gap-2">
                                <button onClick={() => setEditingMessageId(null)} className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest opacity-70 hover:opacity-100 transition-opacity">Cancel</button>
                                <button onClick={() => onConfirmEdit(msg.id)} disabled={!editingMessageContent.trim()} className="px-4 py-1.5 bg-accent text-on-accent rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-accent-strong transition-colors shadow-sm disabled:opacity-50">Resend</button>
                             </div>
                          </div>
                       ) : (
                          <div className="leading-relaxed">{onRenderMessage(msg)}</div>
                       )}
                     </div>

                     {/* What this reply actually did — receipts, pinned in place, with undo. */}
                     {msg.role === 'bot' && Array.isArray(msg.receiptIds) && msg.receiptIds.length > 0 && (
                       <ActivityTrail receiptIds={msg.receiptIds} />
                     )}

                     {/* Actions Bar - Positioned Below Bubble */}
                     {!editingMessageId && (
                       <div className={`flex items-center gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} px-1`}>
                          {msg.role === 'user' && !isGenerating && <button onClick={() => { setEditingMessageId(msg.id); setEditingMessageContent(msg.content); }} className="p-1.5 text-ink-3 hover:text-accent hover:bg-wash rounded-md transition-all" title="Edit & Resend"><Edit3 className="w-3.5 h-3.5" /></button>}
                          <button onClick={() => { navigator.clipboard.writeText(msg.content); onToast("Copied to clipboard!"); }} className="p-1.5 text-ink-3 hover:text-accent hover:bg-wash rounded-md transition-all" title="Copy Content"><Copy className="w-3.5 h-3.5" /></button>
                          {msg.role === 'bot' && !isGenerating && <button onClick={() => onToggleSpeak(msg.id, msg.content, msg.agentId)} className={`p-1.5 rounded-md transition-all ${speakingId === msg.id ? 'text-danger bg-danger-soft' : 'text-ink-3 hover:text-accent hover:bg-wash'}`} title={speakingId === msg.id ? "Stop Reading" : "Read Aloud"}>{speakingId === msg.id ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}</button>}
                          <button onClick={() => { onAddTask(msg.content.slice(0, 100)); setShowPlanner(true); }} className="p-1.5 text-ink-3 hover:text-accent hover:bg-wash rounded-md transition-all" title="Turn into task"><ListTodo className="w-3.5 h-3.5" /></button>
                          <button onClick={() => onBookmark(msg)} className={`p-1.5 rounded-md transition-all ${globalPins.some(p => p.msgId === msg.id) ? 'text-warning bg-warning-soft' : 'text-ink-3 hover:text-warning hover:bg-warning-soft'}`} title={globalPins.some(p => p.msgId === msg.id) ? 'Saved to Library' : 'Save to Library'}><Bookmark className="w-3.5 h-3.5" /></button>
                          <span className="text-[9px] font-bold text-ink-3/60 tracking-wider mx-1.5">
                            {new Date(msg.timestamp || msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase()}
                          </span>
                       </div>
                     )}
                  </div>
                </div>
              );
              return [divider, bubble].filter(Boolean);
            })}
            {isGenerating && !activeMessages[activeMessages.length - 1]?.isStreaming && (
              <div className="flex justify-start">
                <div className="shrink-0 mr-2 mt-0.5 hidden sm:block">
                  <AgentIcon agent={activeAssistant} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm" />
                </div>
                <div className="group relative flex flex-col items-start">
                  <div className="text-[11px] font-bold text-ink-3 mb-0.5 ml-1">{activeAssistant?.name || 'Agent'}</div>
                  {/* Once there are real steps to show, the action bubble replaces the dots outright
                      rather than sitting beside them — two "we're busy" indicators at once is noise.
                      The dots remain for the genuinely unknowable stretch before the first token,
                      where any label would be invented. */}
                  {hasActionSteps ? (
                    <ActionBubble />
                  ) : (
                    <div className="p-3 max-w-[92%] shadow-sm glass-sky border border-edge/50 text-ink rounded-2xl rounded-bl-sm">
                      <TypingIndicator inline />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Grounded quick actions under the agent's opening reply */}
            {showOpeningChips && (
              <div className="flex flex-wrap gap-2 pl-0 sm:pl-9 animate-in fade-in">
                {groundedChips.map((chip) => {
                  const ChipIcon = chip.icon;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => onSendPrompt?.(chip.prompt)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-panel px-3.5 py-1.5 text-[12px] font-medium text-accent transition-all hover:border-accent hover:bg-accent-soft active:scale-95"
                    >
                      {ChipIcon && <ChipIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            )}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        ) : hideEmptyState ? (
          <div ref={messagesEndRef} className="h-4" />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-80 pointer-events-none pb-20">
            {/* Was opacity-20 + grayscale, which ghosted this to the point of being unreadable — the
                heading measured 20% effective opacity and the mark disappeared entirely. It's the
                first thing you see in an empty chat, so it should be legible, not a watermark. Held
                slightly back (not full strength) so it still reads as an empty state. */}
            <AgentIcon agent={activeAssistant} sizeClass="w-16 h-16" containerClass="p-4 rounded-3xl mb-4" />
            <h2 className="text-2xl font-black italic tracking-tighter uppercase text-ink">Start Session</h2>
            {activeAssistant?.description && <p className="text-sm font-medium mt-2 max-w-xs text-ink-2">{activeAssistant.description}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
