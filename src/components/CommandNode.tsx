import React from 'react';
import { Bot, FileText, Code, Globe, Lock } from 'lucide-react';
import { ChatInputBar } from './ChatInputBar';
import type { SlashCommand } from './SlashCommandPalette';
import { useSpaceStore } from '../store/useSpaceStore';

interface ChatInputBarProps {
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
  llamaServerPid: number | null;
  llamaPaused: boolean;
  setLlamaPaused: (v: boolean) => void;
  llamaCoolingDown: boolean;
  isListening: boolean;
  onToggleListening: () => void;
  onSlashCommand: (cmd: SlashCommand) => void;
  channelParticipants?: Array<{ id: string; name: string }>;
}

interface CommandNodeProps {
  chatInputBarProps: ChatInputBarProps;
}

export function CommandNode({ chatInputBarProps }: CommandNodeProps): React.JSX.Element {
  const activeTab = useSpaceStore(
    s => s.omniTabs.find(t => t.id === s.activeOmniTabId) ?? null
  );

  let showPill = false;
  let PillIcon: React.ElementType = Globe;
  let pillLabel = '';

  if (activeTab && activeTab.type !== 'tool') {
    showPill = true;

    if (activeTab.type === 'web') {
      const url = activeTab.url ?? '';
      PillIcon = url.startsWith('https://') ? Lock : Globe;
      try {
        pillLabel = new URL(url).hostname;
      } catch {
        pillLabel = url;
      }
    } else if (activeTab.type === 'space-log') {
      PillIcon = Bot;
      pillLabel = activeTab.label;
    } else if (activeTab.type === 'doc') {
      PillIcon = FileText;
      pillLabel = activeTab.label;
    } else if (activeTab.type === 'code-canvas') {
      PillIcon = Code;
      pillLabel = activeTab.label;
    }
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(720px,calc(100%-2rem))]">
      {showPill && (
        <div className="text-[10px] text-[rgba(255,255,255,0.5)] bg-[#12141a] border border-[rgba(255,255,255,0.06)] rounded px-2 py-0.5 flex items-center gap-1 w-fit mb-1.5 ml-2">
          <PillIcon className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[200px]">{pillLabel}</span>
        </div>
      )}
      <div className="bg-[#0a0b0e]/90 backdrop-blur-xl rounded-2xl border border-[rgba(255,255,255,0.07)] shadow-[0_10px_50px_rgba(0,0,0,0.5)] p-1">
        <ChatInputBar {...chatInputBarProps} />
      </div>
    </div>
  );
}
