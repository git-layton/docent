import React from 'react';
import { X, Bot, FileText, Code, Globe, Lock, PanelRightClose } from 'lucide-react';
import clsx from 'clsx';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { PlannerPanel } from './PlannerPanel';
import { ChatInputBar } from './ChatInputBar';
import { useTaskStore } from '../store/useTaskStore';
import { useSpaceStore } from '../store/useSpaceStore';
import { db } from '../services/database';
import type { SlashCommand } from './SlashCommandPalette';

// ---------------------------------------------------------------------------
// Prop bags (mirror what App.tsx already assembles)
// ---------------------------------------------------------------------------
export interface SpaceLogProps {
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
  onToast: (msg: string, action?: { label: string; onClick: () => void }) => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  llamaPaused: boolean;
  llamaCoolingDown: boolean;
  systemPromptLen: number;
  hasErrorLogs: boolean;
  errorLogsCount: number;
  onRunDreamCycle: () => void;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetId?: string | null) => void;
  isDragging: boolean;
  showAgentIntro: boolean;
  onDismissAgentIntro: () => void;
  hideEmptyState?: boolean;
}

export interface ChatInputBarProps {
  isGenerating: boolean;
  isEnhancing: boolean;
  selectedModel: any;
  modelDropdownRef: React.RefObject<HTMLDivElement | null>;
  onSend: () => void;
  onStop: () => void;
  onChatFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onEnhancePrompt: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  activeAssistant: any;
  channelParticipants?: Array<{ id: string; name: string }>;
  llamaServerPid: number | null;
  llamaPaused: boolean;
  setLlamaPaused: (v: boolean) => void;
  llamaCoolingDown: boolean;
  isListening: boolean;
  onToggleListening: () => void;
  onSlashCommand: (cmd: SlashCommand) => void;
  // OPTIONAL composer-state override — a second ChatInputBar (the Code Team rail) runs its own
  // input/attachment buffer instead of the global UI store. See ChatInputBar.tsx + docs pt 9.
  inputValue?: string;
  onInputChange?: (v: string) => void;
  attachedDocsOverride?: any[];
  onAttachedDocsChange?: (fn: (prev: any[]) => any[]) => void;
}

interface ChatPanelProps {
  mode: 'inline' | 'docked';
  spaceLogProps: SpaceLogProps;
  chatInputBarProps: ChatInputBarProps;
  onSendPrompt: (text: string) => void;
  onCollapse?: () => void;
  /** Suppress the global ChatHeader — used by the Code Team rail, which has its own slim header and
   *  must NOT render the global-active-chat-coupled ChatHeader (that header reads the global active
   *  chat/agent = Codey, which would be wrong for the rail's separate Team conversation). pt 9. */
  hideHeader?: boolean;
}

// ---------------------------------------------------------------------------
// Context pill (docked only) — names the web/doc/canvas the AI rides alongside
// ---------------------------------------------------------------------------
function ContextPill(): React.ReactElement | null {
  const activeTab = useSpaceStore(s => s.omniTabs.find(t => t.id === s.activeOmniTabId) ?? null);
  if (!activeTab || activeTab.type === 'tool') return null;

  let Icon: React.ElementType = Globe;
  let label = activeTab.label;
  if (activeTab.type === 'web') {
    const url = activeTab.url ?? '';
    Icon = url.startsWith('https://') ? Lock : Globe;
    try { label = new URL(url).hostname; } catch { label = url; }
  } else if (activeTab.type === 'space-log') {
    Icon = Bot;
  } else if (activeTab.type === 'doc') {
    Icon = FileText;
  } else if (activeTab.type === 'code-canvas') {
    Icon = Code;
  }

  return (
    <div className="text-[10px] text-ink-3 bg-panel border border-edge rounded px-2 py-0.5 flex items-center gap-1 w-fit mb-1.5">
      <Icon className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-[220px]">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatPanel — the conversation column. Renders inline (center) or docked
// (right rail footer). Absorbs the old SpaceLogTabContent body plus the chat
// input that used to float in CommandNode.
// ---------------------------------------------------------------------------
export function ChatPanel({
  mode,
  spaceLogProps: p,
  chatInputBarProps,
  onSendPrompt,
  onCollapse,
  hideHeader,
}: ChatPanelProps): React.ReactElement {
  const showPlanner = useTaskStore(s => s.showPlanner);
  const docked = mode === 'docked';

  const handleDismissIntro = () => {
    p.onDismissAgentIntro();
    db.set('agentIntroSeen', true);
  };

  return (
    // Sky-adaptive tint, and NO backdrop-blur: the chat is clear glass, so you see the
    // wallpaper through it undistorted rather than frosted. data-ambient opts its ink into
    // the sky ramp too, since it floats on the wallpaper exactly like the tiles do.
    // The rail that wraps this paints no glass of its own — one layer only, or the two
    // tints compound and the whole thing goes milky.
    <div data-ambient="true" className="flex flex-col h-full glass-sky min-h-0">
      {/* Header (suppressed for the Team rail — it brings its own slim header) */}
      {!hideHeader && (
        <div className="flex items-center">
          {docked && onCollapse && (
            <button
              onClick={onCollapse}
              className="shrink-0 px-2 h-full text-ink-3 hover:text-ink transition-colors"
              title="Collapse chat"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <ChatHeader
              dropdownRef={p.dropdownRef}
              llamaPaused={p.llamaPaused}
              llamaCoolingDown={p.llamaCoolingDown}
              activeMessages={p.activeMessages}
              systemPromptLen={p.systemPromptLen}
              hasErrorLogs={p.hasErrorLogs}
              errorLogsCount={p.errorLogsCount}
              onRunDreamCycle={p.onRunDreamCycle}
              onToast={p.onToast}
            />
          </div>
        </div>
      )}

      {/* Body */}
      {showPlanner ? (
        <PlannerPanel
          onDragStart={p.onDragStart ?? ((e, id) => { void e; void id; })}
          onDragOver={p.onDragOver}
          onDrop={p.onDrop}
        />
      ) : (
        <div
          className={clsx(
            'flex-1 flex flex-col relative overflow-hidden min-h-0 transition-colors',
            p.isDragging && 'bg-accent-soft'
          )}
          onDragOver={p.onDragOver}
          onDragLeave={p.onDragLeave}
          onDrop={p.onDrop}
        >
          {/* First-time agent intro card */}
          {p.showAgentIntro && (
            <div className="absolute top-4 right-4 z-50 w-80 rounded-2xl border border-edge-2 bg-panel shadow-xl p-4 animate-in slide-in-from-top-4 duration-300">
              <div className="flex items-start justify-between mb-2">
                <p className="text-sm font-black text-ink">Take your agents with you</p>
                <button onClick={handleDismissIntro} className="text-ink-3 hover:text-ink ml-2 shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-ink-2 mb-3 leading-relaxed">
                Press <kbd className="px-1.5 py-0.5 bg-inset border border-edge rounded text-[10px] font-bold text-ink-2">⌘⇧F</kbd> from any Chrome or Safari tab to open your agent with that page&apos;s context automatically attached.
              </p>
              <button
                onClick={handleDismissIntro}
                className="mt-1 w-full py-2 bg-accent hover:bg-accent-strong text-on-accent text-xs font-black uppercase tracking-widest rounded-xl transition-all"
              >
                Got it
              </button>
            </div>
          )}

          {/* The conversation. An empty thread just shows the composer — the
              Home tab is the app's landing surface, so chat has no separate hero. */}
          <MessageList
            activeMessages={p.activeMessages}
            isGenerating={p.isGenerating}
            activeAssistant={p.activeAssistant}
            forgettingIndex={p.forgettingIndex}
            onConfirmEdit={p.onConfirmEdit}
            onBookmark={p.onBookmark}
            onToggleSpeak={p.onToggleSpeak}
            onAddTask={p.onAddTask}
            messagesEndRef={p.messagesEndRef}
            onRenderMessage={p.onRenderMessage}
            onToast={p.onToast}
            hideEmptyState={p.hideEmptyState}
            onSendPrompt={onSendPrompt}
          />
        </div>
      )}

      {/* Chat input footer */}
      {docked ? (
        <div className="shrink-0 p-2 border-t border-edge flex flex-col items-center">
          <ContextPill />
          <ChatInputBar {...chatInputBarProps} />
          <div className="mt-1 pb-1 text-center text-[10px] text-ink-3 opacity-80">
            Docent is an experimental AI and may not always have accurate details. Please double check.
          </div>
        </div>
      ) : (
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 flex flex-col items-center z-20 pointer-events-none">
          {/* Frosted, like the input bar it wraps — a control surface, not part of the clear
              conversation glass. Dialled back from blur-3xl (64px), which was the most frosted
              thing in the app. */}
          <div className="w-[min(720px,calc(100%-1rem))] bg-white/10 dark:bg-black/10 backdrop-blur-xl rounded-3xl border border-edge-2 shadow-xl p-1 pointer-events-auto">
            <ChatInputBar {...chatInputBarProps} />
          </div>
          <div className="mt-2 text-center text-[10px] text-ink-3 opacity-80 drop-shadow-sm">
            Docent is an experimental AI and may not always have accurate details. Please double check.
          </div>
        </div>
      )}
    </div>
  );
}
