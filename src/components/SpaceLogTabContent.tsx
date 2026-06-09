import React from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { PlannerPanel } from './PlannerPanel';
import { useTaskStore } from '../store/useTaskStore';
import { db } from '../services/database';

interface SpaceLogTabContentProps {
  // MessageList props
  activeMessages: any[];
  isGenerating: boolean;
  activeAssistant: any;
  forgettingIndex: number;
  onConfirmEdit: (msgId: string) => void;
  onBookmark: (msg: any) => Promise<void>;
  onToggleSpeak: (msgId: string, text: string) => void;
  onAddTask: (title: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onRenderMessage: (msg: any) => React.ReactNode;
  onToast: (msg: string, action?: { label: string; onClick: () => void }) => void;
  // ChatHeader props
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  llamaPaused: boolean;
  llamaCoolingDown: boolean;
  systemPromptLen: number;
  hasErrorLogs: boolean;
  errorLogsCount: number;
  onRunDreamCycle: () => void;
  // PlannerPanel props
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetId?: string | null) => void;
  isDragging: boolean;
  // Agent intro card
  showAgentIntro: boolean;
  onDismissAgentIntro: () => void;
}

export function SpaceLogTabContent(props: SpaceLogTabContentProps): React.ReactElement {
  const {
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
    dropdownRef,
    llamaPaused,
    llamaCoolingDown,
    systemPromptLen,
    hasErrorLogs,
    errorLogsCount,
    onRunDreamCycle,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    isDragging,
    showAgentIntro,
    onDismissAgentIntro,
  } = props;

  const showPlanner = useTaskStore(s => s.showPlanner);

  const handleDismiss = () => {
    onDismissAgentIntro();
    db.set('agentIntroSeen', true);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900">
      {/* Header */}
      <ChatHeader
        dropdownRef={dropdownRef}
        llamaPaused={llamaPaused}
        llamaCoolingDown={llamaCoolingDown}
        activeMessages={activeMessages}
        systemPromptLen={systemPromptLen}
        hasErrorLogs={hasErrorLogs}
        errorLogsCount={errorLogsCount}
        onRunDreamCycle={onRunDreamCycle}
        onToast={onToast}
      />

      {/* Views */}
      {showPlanner ? (
        <PlannerPanel
          onDragStart={onDragStart ?? ((e, id) => { void e; void id; })}
          onDragOver={onDragOver}
          onDrop={onDrop}
        />
      ) : (
        <div
          className={clsx(
            'flex-1 flex flex-col relative overflow-hidden transition-colors',
            isDragging && 'bg-[#9EADC8]/10'
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {/* First-time agent intro card */}
          {showAgentIntro && (
            <div className="absolute top-4 right-4 z-50 w-80 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-xl p-4 animate-in slide-in-from-top-4 duration-300">
              <div className="flex items-start justify-between mb-2">
                <p className="text-sm font-black text-neutral-800 dark:text-neutral-200">Take your agents with you</p>
                <button
                  onClick={handleDismiss}
                  className="text-neutral-400 hover:text-neutral-600 ml-2 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3 leading-relaxed">
                Press <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-bold text-neutral-700 dark:text-neutral-300">⌘⇧F</kbd> from any Chrome or Safari tab to open your agent with that page&apos;s context automatically attached.
              </p>
              <div className="space-y-2 text-xs text-neutral-500 dark:text-neutral-400 border-t border-neutral-100 dark:border-neutral-800 pt-3">
                <div>
                  <span className="font-bold text-neutral-700 dark:text-neutral-300">Chrome:</span>
                  {' '}View → Developer → <span className="font-semibold text-neutral-800 dark:text-neutral-200">Allow JavaScript from Apple Events</span>
                </div>
                <div className="space-y-0.5">
                  <div>
                    <span className="font-bold text-neutral-700 dark:text-neutral-300">Safari step 1:</span>
                    {' '}Settings → Advanced → <span className="font-semibold text-neutral-800 dark:text-neutral-200">Show features for web developers</span>
                  </div>
                  <div>
                    <span className="font-bold text-neutral-700 dark:text-neutral-300">Safari step 2:</span>
                    {' '}Develop → <span className="font-semibold text-neutral-800 dark:text-neutral-200">Allow Remote Automation</span>
                  </div>
                </div>
              </div>
              <button
                onClick={handleDismiss}
                className="mt-3 w-full py-2 bg-[#4A5D75] hover:bg-[#3D4D61] text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all"
              >
                Got it
              </button>
            </div>
          )}

          <MessageList
            activeMessages={activeMessages}
            isGenerating={isGenerating}
            activeAssistant={activeAssistant}
            forgettingIndex={forgettingIndex}
            onConfirmEdit={onConfirmEdit}
            onBookmark={onBookmark}
            onToggleSpeak={onToggleSpeak}
            onAddTask={onAddTask}
            messagesEndRef={messagesEndRef}
            onRenderMessage={onRenderMessage}
            onToast={onToast}
          />
        </div>
      )}
    </div>
  );
}
