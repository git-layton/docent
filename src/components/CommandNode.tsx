// Stub — full implementation in Unit 3 PR
import React from 'react';
import { ChatInputBar } from './ChatInputBar';
import type { ComponentProps } from 'react';
type ChatInputBarProps = ComponentProps<typeof ChatInputBar>;
interface CommandNodeProps { chatInputBarProps: ChatInputBarProps; }
export function CommandNode({ chatInputBarProps }: CommandNodeProps): React.JSX.Element {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(720px,calc(100%-2rem))]">
      <div className="bg-[#0a0b0e]/90 backdrop-blur-xl rounded-2xl border border-[rgba(255,255,255,0.07)] shadow-[0_10px_50px_rgba(0,0,0,0.5)] p-1">
        <ChatInputBar {...chatInputBarProps} />
      </div>
    </div>
  );
}
