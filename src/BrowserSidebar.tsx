import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Bot, ChevronRight, Send, ExternalLink, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { emit } from '@tauri-apps/api/event';
import { useSettingsStore } from './store/useSettingsStore';
import { useAgentStore } from './store/useAgentStore';
import { generateTextResponse } from './services/llm';

interface SidebarMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface BrowserSidebarProps {
  url: string;
  pageTitle: string;
  pageContent: string;
}

function BrowserSidebar({ url, pageTitle, pageContent }: BrowserSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<SidebarMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);
  const activeFolderId = useAgentStore(s => s.activeFolderId);
  const assistants = useAgentStore(s => s.assistants);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Abort any in-flight request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const getHostname = (rawUrl: string): string => {
    try {
      return new URL(rawUrl).hostname;
    } catch {
      return rawUrl;
    }
  };

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    const userContent = input.trim();
    setInput('');

    const userMsg: SidebarMessage = { role: 'user', content: userContent };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    // Resolve model config
    const modelConfig =
      models.find(m => m.id === selectedModelId) ?? models[0] ?? null;

    // Resolve active agent's system prompt (if any)
    const activeAgent = assistants.find(a => a.id === activeFolderId);
    const agentSystemPrompt = activeAgent?.prompt ?? '';

    // Build a minimal browser-scoped system prompt
    const systemPrompt = [
      agentSystemPrompt
        ? `${agentSystemPrompt}\n\n---`
        : '',
      'You are a browser co-pilot. Answer questions about the page the user is viewing.',
      `Page: ${pageTitle || getHostname(url)}`,
      `URL: ${url}`,
      pageContent ? `\nContent:\n${pageContent.slice(0, 4000)}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    // generateTextResponse expects role 'bot' for assistant messages internally;
    // it handles the system prompt via buildSystemPrompt when given an agent object.
    // We bypass that by using a synthetic agent whose prompt IS our full system prompt,
    // and pass messages in the internal format (role: 'bot' for assistant).
    const internalMessages = [
      ...messages.map(m => ({
        id: `sidebar-${Date.now()}-${Math.random()}`,
        role: m.role === 'assistant' ? 'bot' : 'user',
        content: m.content,
      })),
      {
        id: `sidebar-${Date.now()}-user`,
        role: 'user',
        content: userContent,
      },
    ];

    // Synthetic minimal agent — no tools, no drive, no trainingDocs
    const syntheticAgent = {
      prompt: systemPrompt,
      drive: '',
      driveEnabled: false,
      tools: {},
      awareOfProfile: false,
      trainingDocs: [],
    };

    // Append a placeholder assistant message to stream into
    let assistantContent = '';
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      await generateTextResponse({
        messages: internalMessages,
        modelConfig,
        agent: syntheticAgent,
        profile: '',
        userName: '',
        attachedDocs: [],
        tasks: [],
        mode: 'text',
        canvasContent: null,
        isDeepThinking: false,
        agentPinnedMessages: [],
        appSettings: { allowProfileUpdates: false, imageProvider: 'none', imageModelId: '', imageEndpoint: '' },
        integrations: {},
        models,
        runIntegrationTools: null,
        browserContext: null,
        onChunk: (chunk: string) => {
          assistantContent += chunk;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: 'assistant',
              content: assistantContent,
            };
            return updated;
          });
        },
        signal: abort.signal,
      });
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: 'Sorry, something went wrong.',
          };
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, messages, url, pageTitle, pageContent, models, selectedModelId, activeFolderId, assistants]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div
      className={clsx(
        'flex flex-col h-full border-l border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 transition-all duration-200',
        isOpen ? 'w-72' : 'w-10',
      )}
    >
      {/* Toggle button — always visible */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className="p-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 shrink-0"
        title={isOpen ? 'Collapse sidebar' : 'Open AI assistant'}
      >
        {isOpen ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <Bot className="w-4 h-4" />
        )}
      </button>

      {isOpen && (
        <>
          {/* 1. Page context strip */}
          <div className="px-3 py-2 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <ExternalLink className="w-3 h-3 shrink-0 text-neutral-400" />
              <span className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">
                {pageTitle || getHostname(url)}
              </span>
            </div>
            <p className="text-[9px] text-neutral-400 truncate mt-0.5">{url}</p>
          </div>

          {/* 2. Conversation area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <p className="text-[11px] text-neutral-400 text-center mt-4">
                Ask me anything about this page.
              </p>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={clsx(
                  'flex',
                  msg.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                <div
                  className={clsx(
                    'max-w-[85%] px-3 py-2 rounded-xl text-[11px] leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-[#4A5D75] text-white rounded-br-sm'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 rounded-bl-sm',
                  )}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.role === 'assistant' && msg.content && (
                    <button
                      onClick={() =>
                        emit('browser:send-to-chat', {
                          content: msg.content,
                          url,
                        }).catch(() => {})
                      }
                      className="mt-1.5 text-[9px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 flex items-center gap-1"
                    >
                      <ExternalLink className="w-2.5 h-2.5" /> Send to chat
                    </button>
                  )}
                </div>
              </div>
            ))}
            {isStreaming && messages[messages.length - 1]?.content === '' && (
              <div className="flex justify-start">
                <div className="bg-neutral-100 dark:bg-neutral-800 px-3 py-2 rounded-xl">
                  <Loader2 className="w-3 h-3 animate-spin text-neutral-400" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 3. Input area */}
          <div className="p-2 border-t border-neutral-100 dark:border-neutral-800 shrink-0">
            <div className="flex items-end gap-1.5">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                placeholder="Ask about this page..."
                rows={1}
                className="flex-1 resize-none text-[11px] bg-neutral-100 dark:bg-neutral-800 rounded-lg px-2.5 py-2 outline-none focus:ring-1 ring-[#6A829E]/30 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 disabled:opacity-50"
                style={{ maxHeight: '80px', overflowY: 'auto' }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                className="p-2 rounded-lg bg-[#4A5D75] hover:bg-[#3D4D61] text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export { BrowserSidebar };
export default BrowserSidebar;
