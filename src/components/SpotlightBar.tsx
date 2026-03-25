import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Search, Zap, BookOpen, Brain, Save, AlertCircle } from 'lucide-react';
import { generateTextResponse } from '../services/llm';
import { db } from '../services/database';

type Status = 'idle' | 'reading' | 'thinking' | 'saving' | 'done' | 'error';

const STATUS_LABELS: Record<Status, string> = {
  idle: 'Ask anything about this page...',
  reading: 'Reading active tab...',
  thinking: 'Thinking...',
  saving: 'Saving to research...',
  done: 'Saved! Closing...',
  error: 'Something went wrong.',
};

const STATUS_ICONS: Record<Status, React.ReactNode> = {
  idle: <Search className="w-4 h-4 text-indigo-400" />,
  reading: <BookOpen className="w-4 h-4 text-sky-400 animate-pulse" />,
  thinking: <Brain className="w-4 h-4 text-violet-400 animate-pulse" />,
  saving: <Save className="w-4 h-4 text-emerald-400 animate-pulse" />,
  done: <Zap className="w-4 h-4 text-emerald-400" />,
  error: <AlertCircle className="w-4 h-4 text-red-400" />,
};

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export default function SpotlightBar() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount and whenever the window gains focus
  useEffect(() => {
    inputRef.current?.focus();
    const win = getCurrentWindow();

    const unlistenFocus = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        inputRef.current?.focus();
      } else if (status === 'idle') {
        // Hide window when it loses focus (only when idle — don't interrupt processing)
        win.hide();
      }
    });

    return () => { unlistenFocus.then(f => f()); };
  }, [status]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      getCurrentWindow().hide();
      resetState();
    }
    if (e.key === 'Enter' && input.trim() && status === 'idle') {
      executeCommand(input.trim());
    }
  };

  const resetState = () => {
    setInput('');
    setStatus('idle');
    setErrorMsg('');
  };

  const executeCommand = async (command: string) => {
    const win = getCurrentWindow();
    try {
      // Step 1: Read active Chrome tab
      setStatus('reading');
      const tab = await invoke<{ title: string; url: string; text: string; error?: string }>('get_active_tab');

      if (tab.error && !tab.text) {
        throw new Error(`Could not read Chrome tab: ${tab.error}`);
      }

      // Step 2: Load settings
      await db.init();
      const models: any[] = await db.get('models', []);
      const settings: any = await db.get('settings', {});
      const selectedModelId: string = settings.selectedModelId ?? '';

      // Get AgentForge path (init_knowledge_core is idempotent)
      const kc = await invoke<{ initialized: boolean; path: string }>('init_knowledge_core');
      const researchPath = `${kc.path}/memory/research`;

      const modelConfig = models.find((m: any) => m.id === selectedModelId) ?? models[0];
      if (!modelConfig) throw new Error('No LLM model configured. Open Agent Forge settings first.');

      // Step 3: Call LLM
      setStatus('thinking');
      const pageContext = tab.text
        ? `Page: ${tab.title || 'Unknown'}\nURL: ${tab.url || 'Unknown'}\n\n${tab.text}`
        : `No page content available. URL: ${tab.url || 'Unknown'}`;

      const systemPrompt =
        'You are a research assistant embedded in a command bar. ' +
        'The user provides a command and web page content. ' +
        'Extract exactly what was requested — be concise, well-structured, and use Markdown headings. ' +
        'Include the source URL as a footer link.';

      const userMessage = `${pageContext}\n\n---\nCommand: ${command}`;

      const result = await generateTextResponse({
        messages: [{ id: 'spotlight-1', role: 'user', content: userMessage }],
        modelConfig,
        profile: '',
        attachedDocs: [],
        agent: { prompt: systemPrompt, tools: {}, trainingDocs: [] },
        tasks: [],
        mode: 'text',
        canvasContent: null,
        isDeepThinking: false,
        agentPinnedMessages: [],
        onChunk: null,
        signal: null,
        appSettings: {},
        integrations: {},
        models,
      });

      // Step 4: Build markdown file content
      setStatus('saving');
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const slug = slugify(tab.title || command);
      const filename = `${dateStr}-${slug}-${now.getTime()}.md`;
      const fullPath = `${researchPath}/${filename}`;

      const frontmatter = `---\ntitle: "${(tab.title || command).replace(/"/g, "'")}"\nsource: "${tab.url || ''}"\ncommand: "${command.replace(/"/g, "'")}"\ndate: "${now.toISOString()}"\n---\n\n`;
      const fileContent = frontmatter + result;

      await invoke('write_memory', {
        path: fullPath,
        content: fileContent,
        commit_message: `spotlight: ${command.slice(0, 60)}`,
        agent_id: null,
        context_tokens: null,
        ram_state: null,
      });

      // Step 5: Notify and close
      setStatus('done');
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification('Forge Spotlight', {
            body: `Saved: ${tab.title || command}`,
          });
        }
      }

      setTimeout(() => {
        resetState();
        win.hide();
      }, 800);

    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err?.message ?? 'Unknown error');
      setTimeout(() => resetState(), 3000);
    }
  };

  const isProcessing = status !== 'idle' && status !== 'error';

  return (
    <div className="w-screen h-screen flex items-start justify-center pt-0 bg-transparent select-none">
      <div
        className="w-full mx-0 rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(15, 18, 30, 0.88)',
          backdropFilter: 'blur(32px) saturate(180%)',
          WebkitBackdropFilter: 'blur(32px) saturate(180%)',
          border: '1.5px solid rgba(99, 102, 241, 0.35)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset',
        }}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="shrink-0">{STATUS_ICONS[status]}</div>
          <input
            ref={inputRef}
            value={isProcessing ? '' : input}
            onChange={e => { if (!isProcessing) setInput(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder={status === 'error' ? errorMsg : STATUS_LABELS[status]}
            disabled={isProcessing}
            className="flex-1 bg-transparent outline-none text-sm font-medium text-white placeholder-slate-500 caret-indigo-400"
            spellCheck={false}
            autoComplete="off"
          />
          {!isProcessing && input.trim() && (
            <kbd className="shrink-0 text-[10px] font-bold text-indigo-400 bg-indigo-900/40 px-1.5 py-0.5 rounded border border-indigo-700/50">
              ↵
            </kbd>
          )}
        </div>

        {/* Processing bar */}
        {isProcessing && (
          <div className="h-0.5 bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 rounded-full animate-pulse"
              style={{ width: status === 'done' ? '100%' : status === 'saving' ? '85%' : status === 'thinking' ? '60%' : '30%', transition: 'width 0.8s ease' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
