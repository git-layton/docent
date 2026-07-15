import React, { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useUIStore } from '../../store/useUIStore';
import { useChatStore } from '../../store/useChatStore';
import { useAgentStore } from '../../store/useAgentStore';
import { useBrowserStore } from '../../store/useBrowserStore';

interface SpotlightListenerProps {
  anyGeneratingRef: React.MutableRefObject<boolean>;
  pendingOverlayHydrateRef: React.MutableRefObject<boolean>;
}

export function SpotlightListener({ anyGeneratingRef, pendingOverlayHydrateRef }: SpotlightListenerProps) {
  const overlayHydrateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unlistens: (() => void)[] = [];
    
    listen<{ level: string; msg: string }>('spotlight-log', ({ payload }) => {
      useUIStore.getState().addLog(payload.level, payload.msg);
    }).then(u => unlistens.push(u));
    
    listen<void>('spotlight-chat-updated', () => {
      if (anyGeneratingRef.current) { 
        pendingOverlayHydrateRef.current = true; 
        return; 
      }
      if (overlayHydrateTimerRef.current) clearTimeout(overlayHydrateTimerRef.current);
      overlayHydrateTimerRef.current = setTimeout(() => {
        overlayHydrateTimerRef.current = null;
        void useChatStore.getState().hydrate();
      }, 250);
    }).then(u => unlistens.push(u));
    
    listen<{ agentId: string; chatId?: string; tab: { title: string; url: string } | null }>('spotlight-open-chat', ({ payload }) => {
      if (payload.agentId) useAgentStore.getState().setActiveFolderId(payload.agentId);
      useChatStore.getState().setActiveChatId(payload.chatId ?? null);
    }).then(u => unlistens.push(u));
    
    listen<{ url: string; title: string; content: string }>('browser:page-changed', ({ payload }) => {
      useBrowserStore.getState().setActiveTab({
        url: payload.url,
        title: payload.title,
        content: payload.content,
        lastCapturedAt: Date.now(),
      });
    }).then(u => unlistens.push(u));
    
    listen<{ content: string; url: string }>('browser:send-to-chat', ({ payload }) => {
      useUIStore.getState().setInput(`[From browser: ${payload.url}]\n\n${payload.content}`);
    }).then(u => unlistens.push(u));
    
    return () => {
      unlistens.forEach(u => u());
      if (overlayHydrateTimerRef.current) clearTimeout(overlayHydrateTimerRef.current);
    };
  }, [anyGeneratingRef, pendingOverlayHydrateRef]);

  return null;
}
