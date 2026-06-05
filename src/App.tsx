import './index.css';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, Bot, Code,
  FileText,
  Clock, ListTodo,
  AlignLeft, MapPin, Workflow,
  AlertTriangle, Loader2, Activity, UserPlus, Bookmark, CalendarDays,
  MessageSquare, Mail, Layers, Send, CheckCircle2, CalendarClock,
} from 'lucide-react';

import { db } from './services/database';
import { extractTextFromPDF } from './services/pdfParser';
import { useChatStore } from './store/useChatStore';
import { useAgentStore, DEFAULT_ASSISTANT } from './store/useAgentStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useMemoryStore } from './store/useMemoryStore';
import { useTaskStore } from './store/useTaskStore';
import { useUIStore } from './store/useUIStore';

import { getContextLimit, validateModel, buildSystemPrompt, generateTextResponse, fetchWithRetry } from './services/llm';
import { refreshGoogleAccessToken, runIntegrationTools } from './services/integrations';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { NukeShieldModal } from './components/NukeShieldModal';
import { MemmoPanel } from './components/MemmoPanel';
import { MemoComposeModal } from './components/MemoComposeModal';
import { SourcesTray } from './components/SourcesTray';
import type { SlashCommand } from './components/SlashCommandPalette';
import { MorningBriefingBanner } from './components/MorningBriefingBanner';
import { DreamDigestModal } from './components/DreamDigestModal';
import type { DreamLog, DreamItem } from './components/DreamDigestModal';
import { buildDreamerSystemPrompt, buildDreamerUserMessage, parseDreamerResponse } from './services/dreamer';
import { AGENT_FORGE_GUIDE, AGENT_FORGE_GUIDE_RELATIVE_PATH } from './data/agentForgeUserDocs';
import { AssistantSettingsModal } from './components/AssistantSettingsModal';
import { ProfileSettingsModal } from './components/ProfileSettingsModal';
import { ModelWizardModal } from './components/ModelWizardModal';
import { AppSidebar } from './components/AppSidebar';
import { CanvasPanel } from './components/CanvasPanel';
import { ChatHeader } from './components/ChatHeader';
import { PlannerPanel } from './components/PlannerPanel';
import { MessageList } from './components/MessageList';
import { ChatInputBar } from './components/ChatInputBar';
import { TypingIndicator } from './components/ui/TypingIndicator';
import { ThoughtProcess } from './components/ui/ThoughtProcess';
import { FormattedText } from './components/ui/FormattedText';
import { CollapsibleBubble } from './components/ui/CollapsibleBubble';
import { buildChannelContext, normalizeChatRecord, routeAgentsForChannel } from './services/channels';
import { buildGroundedMarkdown } from './services/grounding';
import { assessMemoryGatekeeper } from './services/memoryGatekeeper';
import { routeToolForMessage } from './services/toolRouter';
import { buildSemanticMemoryNotes, hasSemanticHits, type SemanticLayerResult } from './services/semantic';
import {
  buildSourceNotes,
  dedupeSources,
  extractSearchQuery,
  extractUrls,
  hasResearchIntent,
  slugify as researchSlugify,
  type ResearchSource,
} from './services/research';

// ─── Constants & Configurations ───────────────────────────────────────────────

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB text/PDF limit
const MAX_IMAGE_FILE_SIZE = 12 * 1024 * 1024; // Images are resized before sending to the model.
const MAX_IMAGE_EDGE = 1600;
const IMAGE_JPEG_QUALITY = 0.86;

// ─── Utility Helpers ──────────────────────────────────────────────────────────

const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
  reader.readAsDataURL(file);
});

const readFileAsText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
  reader.readAsText(file);
});

const resizeImageForVision = async (file: File): Promise<{ content: string; type: string; resized: boolean }> => {
  const dataUrl = await readFileAsDataUrl(file);
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
    return { content: dataUrl, type: file.type || 'image/png', resized: false };
  }

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const longestEdge = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
      if (!longestEdge || (longestEdge <= MAX_IMAGE_EDGE && file.size <= MAX_FILE_SIZE)) {
        resolve({ content: dataUrl, type: file.type, resized: false });
        return;
      }

      const scale = Math.min(1, MAX_IMAGE_EDGE / longestEdge);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ content: dataUrl, type: file.type, resized: false });
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const outputType = file.type === 'image/png' && file.size <= MAX_FILE_SIZE ? 'image/png' : 'image/jpeg';
      resolve({ content: canvas.toDataURL(outputType, IMAGE_JPEG_QUALITY), type: outputType, resized: true });
    };
    img.onerror = () => resolve({ content: dataUrl, type: file.type || 'image/png', resized: false });
    img.src = dataUrl;
  });
};

const getGoogleActionAccount = (integrations: any, scope: 'gmail' | 'drive' | 'calendar', preferredLabel?: string | null) => {
  const accounts: any[] = integrations?.googleWorkspaces ?? [];
  const configured = accounts.filter((account: any) =>
    account.connected !== false &&
    account.scopes?.[scope] &&
    account.clientId &&
    account.clientSecret &&
    account.refreshToken
  );
  if (preferredLabel) {
    const preferred = configured.find((account: any) =>
      account.label === preferredLabel || account.id === preferredLabel
    );
    if (preferred) return preferred;
  }
  return configured[0] ?? null;
};

const base64UrlEncode = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};


// ─── UI Sub-components moved to src/components/ui/ ────────────────────────────
// AgentIcon, BOT_COLORS, TypingIndicator, ThoughtProcess, FormattedText,
// INLINE_FORMAT_REGEX, WysiwygEditor, ContextMeter are imported above.

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  // ── Store subscriptions (reactive reads) ────────────────────────────────────
  const messages = useChatStore(s => s.messages);
  const activeChatId = useChatStore(s => s.activeChatId);

  const assistants = useAgentStore(s => s.assistants);
  const activeFolderId = useAgentStore(s => s.activeFolderId);
  const editingAssistant = useAgentStore(s => s.editingAssistant);
  const showAssistantSettings = useAgentStore(s => s.showAssistantSettings);

  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);
  const appSettings = useSettingsStore(s => s.appSettings);
  const userProfile = useSettingsStore(s => s.userProfile);
  const showProfileSettings = useSettingsStore(s => s.showProfileSettings);
  const showModelWizard = useSettingsStore(s => s.showModelWizard);

  const globalPins = useMemoryStore(s => s.globalPins);
  const dreamLog = useMemoryStore(s => s.dreamLog);
  const showDreamBanner = useMemoryStore(s => s.showDreamBanner);
  const showDreamDigest = useMemoryStore(s => s.showDreamDigest);
  const agentForgePath = useMemoryStore(s => s.agentForgePath);
  const showMemmoPanel = useMemoryStore(s => s.showMemmoPanel);
  const memmoPanelTab = useMemoryStore(s => s.memmoPanelTab);
  const showMemoCompose = useMemoryStore(s => s.showMemoCompose);

  const tasks = useTaskStore(s => s.tasks);
  const showPlanner = useTaskStore(s => s.showPlanner);

  const isSidebarOpen = useUIStore(s => s.isSidebarOpen);
  const generationMode = useUIStore(s => s.generationMode);
  const isDeepThinking = useUIStore(s => s.isDeepThinking);
  const speakingId = useChatStore(s => s.speakingId);
  const showConsole = useUIStore(s => s.showConsole);
  const logs = useUIStore(s => s.logs);
  const toastMessage = useUIStore(s => s.toastMessage);
  const toastAction = useUIStore(s => s.toastAction);
  const isDragging = useUIStore(s => s.isDragging);
  const canvasContent = useUIStore(s => s.canvasContent);
  const showSaveModal = useUIStore(s => s.showSaveModal);
  const saveAppData = useUIStore(s => s.saveAppData);
  const isDbLoaded = useUIStore(s => s.isDbLoaded);

  // ── Local state (must stay in App.tsx) ──────────────────────────────────────
  const [llamaServerPid, setLlamaServerPid] = useState<number | null>(null);
  const [llamaPaused, setLlamaPaused] = useState(false);
  const [llamaCoolingDown, setLlamaCoolingDown] = useState(false);
  const [nukeShieldPending, setNukeShieldPending] = useState<{ path: string; content: string; deletions: number; existingLines: number; diffStat: string } | null>(null);

  const [showAgentIntro, setShowAgentIntro] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // Store action shorthands (imperative, for use in callbacks/effects)
  const showToast = useUIStore.getState().showToast;
  const saveGlobalPins = useMemoryStore.getState().saveGlobalPins;
  const setMessages = useChatStore.getState().setMessages;
  const setShowSaveModal = useUIStore.getState().setShowSaveModal;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const avatarUploadRef = useRef<HTMLInputElement>(null);
  const trainingDocUploadRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<any>(null);
  const isDreamRunningRef = useRef(false);
  const dreamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeAssistantRef = useRef<any>(null);
  const selectedModelRef = useRef<any>(null);

  const codeRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Console log capture → store
  useEffect(() => {
    const originalLog = console.log, originalError = console.error, originalWarn = console.warn;
    const { addLog } = useUIStore.getState();
    const capture = (level: string) => (...args: any[]) => {
      const msg = args.map(a => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      addLog(level, msg);
    };
    console.log = (...args) => { capture('info')(...args); originalLog(...args); };
    console.error = (...args) => { capture('error')(...args); originalError(...args); };
    console.warn = (...args) => { capture('warn')(...args); originalWarn(...args); };
    return () => { console.log = originalLog; console.error = originalError; console.warn = originalWarn; };
  }, []);

  // Spotlight window events
  useEffect(() => {
    const unlistens: (() => void)[] = [];
    listen<{ level: string; msg: string }>('spotlight-log', ({ payload }) => {
      useUIStore.getState().addLog(payload.level, payload.msg);
    }).then(u => unlistens.push(u));
    listen<void>('spotlight-chat-updated', () => {
      useChatStore.getState().hydrate();
    }).then(u => unlistens.push(u));
    listen<{ agentId: string; chatId?: string; tab: { title: string; url: string } | null }>('spotlight-open-chat', ({ payload }) => {
      if (payload.agentId) useAgentStore.getState().setActiveFolderId(payload.agentId);
      useChatStore.getState().setActiveChatId(payload.chatId ?? null);
    }).then(u => unlistens.push(u));
    return () => unlistens.forEach(u => u());
  }, []);

  useEffect(() => {
    const boot = async () => {
      try {
        await db.init();
        await useChatStore.getState().hydrate();
        await useAgentStore.getState().hydrate();
        await useSettingsStore.getState().hydrate();
        await useMemoryStore.getState().hydrate();
        await useTaskStore.getState().hydrate();
        await useUIStore.getState().hydrateSavedApps();

      // Init Knowledge Core (creates ~/AgentForge/ on first run)
      try {
        const kc = await invoke<{ initialized: boolean; path: string }>('init_knowledge_core');
        if (kc.initialized) useUIStore.getState().showToast(`📚 Knowledge Core initialized at ${kc.path}`);
        if (kc.path) {
          useMemoryStore.getState().setAgentForgePath(kc.path);
          const guideInstalled = await db.get('userDocsInstalled', false);
          if (!guideInstalled) {
            try {
              await invoke('write_memory', {
                path: `${kc.path}/${AGENT_FORGE_GUIDE_RELATIVE_PATH}`,
                content: AGENT_FORGE_GUIDE,
                commitMessage: 'Add Agent Forge user guide',
                agentId: null,
                contextTokens: null,
                ramState: null,
              });
              await db.set('userDocsInstalled', true);
            } catch (e) {
              console.warn('[AgentForge] Could not install user guide:', e);
            }
          }
        }
      } catch (e) { console.warn('[AgentForge] Knowledge Core init skipped:', e); }

      // First-time agent intro card
      const introSeen = await db.get('agentIntroSeen', false);
      if (!introSeen) setShowAgentIntro(true);

      // Check for undismissed Dream Cycle log from a previous cycle
      try {
        const logResult = await invoke<{ exists: boolean; log?: DreamLog }>('read_dream_log');
        if (logResult.exists && logResult.log && !logResult.log.dismissed) {
          useMemoryStore.getState().setDreamLog(logResult.log!);
          useMemoryStore.getState().setShowDreamBanner(true);
        }
      } catch (e) { console.warn('[AgentForge] Dream log check skipped:', e); }

      // Dream Cycle remains manual for the release build so the user can review
      // memory consolidation changes before trusting the automation.

      // Hardware profile — scale thresholds to total installed RAM
      invoke<{ critical_mb: number; cooldown_mb: number; recovery_mb: number; hud_show_mb: number; hud_warn_mb: number; rag_results: number; rag_snippet_chars: number }>('get_hardware_profile')
        .then(profile => useUIStore.getState().setHwProfile(profile))
        .catch(() => {});

      // Start background file watcher for Knowledge Core indexing
      invoke('init_file_watcher').catch(() => {});
      invoke('sync_semantic_layer').catch(() => {});

      } catch (err) { console.error('[AgentForge] Boot error:', err); } finally { useUIStore.getState().setIsDbLoaded(true); }
    };
    boot();

    // RAM polling — every 2s (reaper only fires if a llama-server was actually spawned)
    const ramInterval = setInterval(async () => {
      try {
        const stats = await invoke<{ total_mb: number; used_mb: number; available_mb: number }>('get_ram_stats');
        useUIStore.getState().setRamStats(stats);

        // All reaper logic is gated on llamaServerPid being set
        setLlamaServerPid(pid => {
          if (pid === null) return pid;

          const hw = useUIStore.getState().hwProfile ?? { cooldown_mb: 1500, critical_mb: 800, recovery_mb: 2500 };

          setLlamaCoolingDown(prev => {
            if (stats.available_mb < hw.cooldown_mb && stats.available_mb >= hw.critical_mb && !prev && !llamaPaused) {
              useUIStore.getState().showToast('⚠️ RAM pressure — LLaMA will pause after this response');
              return true;
            }
            return prev;
          });

          setLlamaPaused(prev => {
            if (stats.available_mb < hw.critical_mb && !prev) {
              abortControllerRef.current?.abort();
              setIsGenerating(false);
              setLlamaCoolingDown(false);
              invoke('sigstop_llama_server').catch(() => {});
              useUIStore.getState().showToast('🚨 LLaMA force-hibernated — RAM critical');
              return true;
            }
            if (stats.available_mb > hw.recovery_mb && prev) {
              invoke('sigcont_llama_server').catch(() => {});
              useUIStore.getState().showToast('✅ LLaMA resumed — RAM recovered');
              return false;
            }
            return prev;
          });

          return pid;
        });
      } catch (e) { /* Tauri not available in browser dev */ }
    }, 2000);

    return () => {
      clearInterval(ramInterval);
      if (dreamTimerRef.current) clearInterval(dreamTimerRef.current);
    };
  }, []);

  // Soft-reaper: when cooling down and generation finishes naturally → apply SIGSTOP
  useEffect(() => {
    if (llamaServerPid !== null && llamaCoolingDown && !isGenerating && !llamaPaused) {
      setLlamaCoolingDown(false);
      setLlamaPaused(true);
      invoke('sigstop_llama_server').catch(() => {});
      useUIStore.getState().showToast('🛑 LLaMA hibernated — RAM low');
    }
  }, [llamaServerPid, llamaCoolingDown, isGenerating, llamaPaused]);

  const persistState = useCallback(() => {
    if (!useUIStore.getState().isDbLoaded) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await useChatStore.getState().persist();
        await useAgentStore.getState().persist();
        await useSettingsStore.getState().persist();
        await useTaskStore.getState().persist();
        await useUIStore.getState().persistSavedApps();
      } catch (err) { console.error('[AgentForge] Save error:', err); }
    }, 1500);
  }, []); // no deps needed — reads from store at call time

  useEffect(() => {
    const unsub1 = useChatStore.subscribe(() => persistState());
    const unsub2 = useAgentStore.subscribe(() => persistState());
    const unsub3 = useSettingsStore.subscribe(() => persistState());
    const unsub4 = useTaskStore.subscribe(() => persistState());
    const unsub5 = useUIStore.subscribe((s, prev) => {
      if (s.savedApps !== prev.savedApps) useUIStore.getState().persistSavedApps();
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); };
  }, [persistState]);
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  const activeAssistant = useMemo(() => assistants.find(a => a.id === activeFolderId) ?? assistants[0], [assistants, activeFolderId]);
  const activeMessages = useMemo(() => activeChatId ? (messages[activeChatId] ?? []) : [], [messages, activeChatId]);
  const selectedModel = useMemo(() => models.find(m => m.id === selectedModelId) ?? models[0] ?? null, [models, selectedModelId]);

  // Keep dream cycle refs in sync (avoids stale closures in 24h timer)
  useEffect(() => { activeAssistantRef.current = activeAssistant; }, [activeAssistant]);
  useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);

  // Extract pinned messages explicitly scoped to the active assistant — derived from globalPins (persistent)
  const activeAgentPinnedMessageObjects = useMemo(() =>
    globalPins.filter(p => p.agentId === activeAssistant.id),
    [globalPins, activeAssistant.id]
  );
  const agentPinnedMessagesForPrompt = useMemo(() => activeAgentPinnedMessageObjects.map(p => p.content), [activeAgentPinnedMessageObjects]);

  const systemPromptLen = useMemo(() => buildSystemPrompt({ agent: activeAssistant ?? DEFAULT_ASSISTANT, profile: userProfile, tasks, canvasContent, mode: generationMode, isDeepThinking, agentPinnedMessages: agentPinnedMessagesForPrompt, appSettings }).length, [activeAssistant, userProfile, tasks, canvasContent, generationMode, isDeepThinking, agentPinnedMessagesForPrompt, appSettings]);

  // Sync mode when switching agents
  useEffect(() => {
    if (activeAssistant) {
      useUIStore.getState().setGenerationMode(activeAssistant.defaultMode === 'image' ? 'text' : (activeAssistant.defaultMode || 'text'));
    }
  }, [activeFolderId, activeAssistant]);

  useEffect(() => { if (canvasContent && isSidebarOpen) useUIStore.getState().setIsSidebarOpen(false); }, [canvasContent]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) useUIStore.getState().setIsAgentDropdownOpen(false);
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) useUIStore.getState().setIsModelDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+Shift+M — Omni-Capture (opens Memo Compose from anywhere)
      if (e.metaKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        useMemoryStore.getState().setShowMemoCompose(true);
        return;
      }
      // Cmd+Shift+K — Force Knowledge Search for next message
      if (e.metaKey && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        useUIStore.getState().setForcedTool('workspace');
        return;
      }
      if (e.key === 'Escape') {
        const mem = useMemoryStore.getState();
        const ag = useAgentStore.getState();
        const ss = useSettingsStore.getState();
        const ui = useUIStore.getState();
        const tk = useTaskStore.getState();
        if (mem.showMemoCompose) mem.setShowMemoCompose(false);
        else if (mem.showMemmoPanel) mem.setShowMemmoPanel(false);
        else if (ag.showAssistantSettings) ag.setShowAssistantSettings(false);
        else if (ss.showProfileSettings) ss.setShowProfileSettings(false);
        else if (ss.showModelWizard) ss.setShowModelWizard(false);
        else if (ui.showSaveModal) ui.setShowSaveModal(false);
        else if (tk.taskToDiscuss) tk.setTaskToDiscuss(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const viewImageInCanvas = useCallback((src: string) => {
      useUIStore.getState().setCanvasContent({
          id: generateId('art'),
          title: `Image Preview`,
          type: 'image',
          language: 'image',
          content: src,
          isStandalone: false,
          history: [{ timestamp: Date.now(), content: src }],
          historyIndex: 0
      });
      useUIStore.getState().setCanvasTab('preview');
      useTaskStore.getState().setShowPlanner(false);
  }, []);

  const toggleSpeak = (msgId: string, text: string) => {
    if (speakingId === msgId) {
      window.speechSynthesis.cancel();
      useChatStore.getState().setSpeakingId(null);
    } else {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/[*#`_]/g, '').replace(/<think>[\s\S]*?<\/think>/gi, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.onend = () => useChatStore.getState().setSpeakingId(null);
      utterance.onerror = () => useChatStore.getState().setSpeakingId(null);
      useChatStore.getState().setSpeakingId(msgId);
      window.speechSynthesis.speak(utterance);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      useUIStore.getState().showToast("Speech recognition is not supported in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
       const transcript = event.results[0][0].transcript;
       const prev = useUIStore.getState().input;
       useUIStore.getState().setInput(prev + (prev ? ' ' : '') + transcript);
    };
    recognition.onerror = (e: any) => {
       console.error("Speech recognition error", e);
       setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleHistoryNavigate = useCallback((direction: number) => {
    useUIStore.getState().setCanvasContent((prev: any) => {
      if (!prev || !prev.history) return prev;
      const newIndex = (prev.historyIndex ?? 0) + direction;
      if (newIndex >= 0 && newIndex < prev.history.length) return { ...prev, historyIndex: newIndex, content: prev.history[newIndex].content };
      return prev;
    });
  }, []);

  const addTask = useCallback((title: string, dueDate: string | null = null, details = '', location = '') => {
    if (!title.trim()) return;
    useTaskStore.getState().addTask(title, dueDate || useTaskStore.getState().newTaskDate || null, details, location);
  }, []);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    useTaskStore.getState().setDraggedTaskId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Main UI Drag and Drop validation flow
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    useUIStore.getState().setIsDragging(true);
  };

  const handleDragLeave = () => {
    useUIStore.getState().setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent, targetId: string | null = null) => {
    e.preventDefault();
    useUIStore.getState().setIsDragging(false);

    // If it's a task reorder drop
    const currentDraggedTaskId = useTaskStore.getState().draggedTaskId;
    if (currentDraggedTaskId) {
      if (currentDraggedTaskId === targetId) return;
      useTaskStore.getState().setTasks((prevTasks: any[]) => {
        const newTasks = [...prevTasks];
        const draggedIdx = newTasks.findIndex(t => t.id === currentDraggedTaskId);
        const targetIdx = newTasks.findIndex(t => t.id === targetId);
        if (draggedIdx === -1 || targetIdx === -1) return prevTasks;
        const [draggedItem] = newTasks.splice(draggedIdx, 1);
        newTasks.splice(targetIdx, 0, draggedItem);
        return newTasks;
      });
      useTaskStore.getState().setDraggedTaskId(null);
      return;
    }

    // If it's a file upload drop
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) {
      const fakeEvent = { target: { files, value: '' } } as any;
      await handleChatFileUpload(fakeEvent);
    }
  };

  const handleChatFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const ui = useUIStore.getState();
    ui.setUploadError('');

    const attachments: any[] = [];
    const failures: string[] = [];

    for (const file of files) {
      try {
        if (file.type.startsWith('image/')) {
          if (file.size > MAX_IMAGE_FILE_SIZE) {
            failures.push(`${file.name} is larger than 12MB.`);
            continue;
          }

          if (file.type === 'image/svg+xml') {
            const content = await readFileAsText(file);
            attachments.push({ name: file.name, content, type: 'text/plain', isImage: false });
            continue;
          }

          const image = await resizeImageForVision(file);
          attachments.push({
            name: file.name,
            content: image.content,
            type: image.type,
            isImage: true,
            originalSize: file.size,
            resized: image.resized,
          });
          continue;
        }

        if (file.size > MAX_FILE_SIZE) {
          failures.push(`${file.name} is larger than 5MB.`);
          continue;
        }

        if (file.type === 'application/pdf') {
          ui.showToast(`Parsing ${file.name} locally...`);
          const text = await extractTextFromPDF(file);
          attachments.push({ name: file.name, content: text, type: 'text/plain', isImage: false });
          continue;
        }

        const text = await readFileAsText(file);
        attachments.push({ name: file.name, content: text, type: file.type || 'text/plain', isImage: false });
      } catch (err) {
        console.error('[AgentForge] Failed to attach file:', file.name, err);
        failures.push(`${file.name} could not be read.`);
      }
    }

    if (attachments.length > 0) {
      ui.setAttachedDocs((prev: any[]) => [...prev, ...attachments]);
      const imageCount = attachments.filter(doc => doc.isImage).length;
      ui.showToast(`${attachments.length} attachment${attachments.length === 1 ? '' : 's'} added${imageCount ? ` (${imageCount} vision input${imageCount === 1 ? '' : 's'})` : ''}.`);
    }

    if (failures.length > 0) {
      ui.setUploadError(failures.join(' '));
      ui.showToast(failures[0]);
    }

    e.target.value = '';
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(file); })
      .then(val => useAgentStore.getState().setEditingAssistant((prev: any) => ({ ...prev, avatar: { type: 'image', value: val } }))); e.target.value = '';
  };

  const handleTrainingDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;

    if (file.type.startsWith('image/')) {
        useUIStore.getState().showToast("Images cannot be added to the Knowledge Base. Use chat attachments instead.");
        e.target.value = '';
        return;
    }

    if (file.type === 'application/pdf') {
        useUIStore.getState().showToast("Parsing PDF locally... this might take a moment.");
        try {
           const text = await extractTextFromPDF(file);
           if (!text || text.trim().length < 3) {
             useUIStore.getState().showToast("This PDF appears to be scanned images (no selectable text). Please run it through an OCR tool first, or use a text-based PDF.");
             e.target.value = '';
             return;
           }
           const MAX_ALWAYS_ON_CHARS = 25_000;
           if (text.length > MAX_ALWAYS_ON_CHARS) {
             useUIStore.getState().showToast(`File too large for Always-On Context (${text.length.toLocaleString()} chars). Drop massive files in the Memmo Panel Library (RAG) instead.`);
             e.target.value = '';
             return;
           }
           useAgentStore.getState().setEditingAssistant((prev: any) => ({ ...prev, trainingDocs: [...(prev.trainingDocs ?? []), { id: generateId('doc'), name: file.name, content: text, type: 'text/plain' }] }));
           useUIStore.getState().showToast(`PDF added! (${text.length.toLocaleString()} chars)`);
        } catch (err) {
           useUIStore.getState().showToast("Failed to parse PDF.");
           console.error(err);
        }
        e.target.value = '';
        return;
    }

    new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsText(file); })
      .then(content => useAgentStore.getState().setEditingAssistant((prev: any) => ({ ...prev, trainingDocs: [...(prev.trainingDocs ?? []), { id: generateId('doc'), name: file.name, content, type: file.type }] }))); e.target.value = '';
  };

  const saveAssistantConfig = () => {
    const ag = useAgentStore.getState();
    const ea = ag.editingAssistant;
    if (ea.id === 'new') {
      const bot = { ...ea, id: generateId('bot') };
      ag.setAssistants((prev: any[]) => [...prev, bot]);
      ag.setActiveFolderId(bot.id);
      useChatStore.getState().setActiveChatId(null);
    } else {
      ag.setAssistants((prev: any[]) => prev.map((a: any) => a.id === ea.id ? ea : a));
    }
    ag.setShowAssistantSettings(false);
  };

  const createBlankArtifact = (type: string) => {
    const initialContent = type === 'code' ? '\n' : '<h1>New Document</h1><p>Start writing here...</p>';
    const ui = useUIStore.getState();
    ui.setCanvasContent({ id: generateId('art'), title: `Untitled ${type === 'code' ? 'App' : 'Document'}`, content: initialContent, language: 'html', type, isStandalone: false, history: [{ timestamp: Date.now(), content: initialContent }], historyIndex: 0 });
    ui.setGenerationMode(type); ui.setCanvasTab(type === 'code' ? 'code' : 'preview'); useTaskStore.getState().setShowPlanner(false);
  };

  const saveToLibrary = (asNew = false) => {
    const ui = useUIStore.getState();
    const _canvasContent = ui.canvasContent;
    const _savedApps = ui.savedApps;
    const _saveAppData = ui.saveAppData;
    const id = (asNew || !_canvasContent.id) ? generateId('art') : _canvasContent.id;
    let finalCanvas = { ..._canvasContent };
    const curHist = finalCanvas.history || [{ timestamp: Date.now(), content: finalCanvas.content }];
    const curIdx = finalCanvas.historyIndex ?? 0;
    if (curHist[curIdx]?.content !== finalCanvas.content) {
        const newHist = curHist.slice(0, curIdx + 1); newHist.push({ timestamp: Date.now(), content: finalCanvas.content });
        finalCanvas.history = newHist; finalCanvas.historyIndex = newHist.length - 1;
    }
    const item = { ...finalCanvas, id, title: _saveAppData.title || finalCanvas.title || 'Untitled', updatedAt: Date.now() };
    const exists = _savedApps.some((a: any) => a.id === id);
    ui.setSavedApps((prev: any[]) => exists && !asNew ? prev.map((a: any) => a.id === id ? item : a) : [item, ...prev]);
    ui.setCanvasContent(item); ui.setShowSaveModal(false); ui.showToast('Saved to Archives!');
  };
  const deleteSavedApp = (id: string) => {
    const ui = useUIStore.getState();
    ui.setSavedApps((prev: any[]) => prev.filter((app: any) => app.id !== id));
    if (ui.canvasContent?.id === id) ui.setCanvasContent(null);
  };

  const saveImageToLibrary = useCallback((src: string) => {
     const item = { id: generateId('art'), title: 'Generated Image', type: 'image', content: src, updatedAt: Date.now() };
     useUIStore.getState().setSavedApps((prev: any[]) => [item, ...prev]);
  }, []);

  const handleBookmark = useCallback(async (msg: any) => {
    const { activeChatId: _cid } = useChatStore.getState();
    const { globalPins: _pins, agentForgePath: _afp, saveGlobalPins: _save } = useMemoryStore.getState();
    const { setMessages: _setMsgs } = useChatStore.getState();
    const isPinned = _pins.some((p: any) => p.msgId === msg.id);

    if (!isPinned && _afp) {
      // Auto-extract first sentence as title
      const firstLine = msg.content.replace(/^#+\s*/m, '').split(/[.!?\n]/)[0].trim().slice(0, 60) || 'Saved Note';
      const slug = firstLine.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) + '_' + Date.now();
      try {
        const fileContent = buildGroundedMarkdown(
          {
            title: firstLine,
            type: 'bookmarked-chat',
            scope: 'library',
            agentId: activeAssistant?.id,
            agentName: activeAssistant?.name,
            sourceKind: 'chat_bookmark',
            sourceLabel: 'User bookmarked chat response',
            derivedFrom: [_cid ? `chat:${_cid}` : 'chat'],
            evidenceState: 'mixed',
            verification: 'needs_verification',
            confidence: 'medium',
            processor: 'bookmark',
            tags: ['bookmark', 'library'],
          },
          `## Saved Response
${msg.content}`
        );
        await invoke('write_memory', {
          path: `${_afp}/library/${slug}.md`,
          content: fileContent,
          commitMessage: `library: ${firstLine}`,
          agentId: activeAssistant?.id ?? null,
          contextTokens: null,
          ramState: null,
        });
      } catch (e) {
        console.warn('[Bookmark] Could not write library file:', e);
      }
    }

    const newPins = isPinned
      ? _pins.filter((p: any) => p.msgId !== msg.id)
      : [..._pins, { id: msg.id, chatId: _cid as string, msgId: msg.id, agentId: activeAssistant?.id, content: msg.content, savedAt: Date.now() }];

    await _save(newPins);
    if (_cid) {
      _setMsgs((prev: Record<string, any[]>) => ({
        ...prev,
        [_cid]: (prev[_cid] ?? []).map((m: any) => m.id === msg.id ? { ...m, isPinned: !isPinned } : m),
      }));
    }
    showToast(isPinned ? 'Unpinned' : '🔖 Saved to Library & Pinned');
  }, [activeAssistant, showToast]);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const ss = useSettingsStore.getState();
    const provider = e.target.value; let endpoint = '';
    if (provider === 'lmstudio') endpoint = 'http://127.0.0.1:1234/v1';
    if (provider === 'huggingface') endpoint = 'https://api-inference.huggingface.co/v1';
    const existingKey = ss.models.find((m: any) => m.provider === provider && m.apiKey)?.apiKey || '';
    ss.setEditingModel({ name: provider === 'lmstudio' ? 'LM Studio Engine' : 'Custom Model', provider, modelId: '', endpoint, apiKey: existingKey, contextLimit: 32000 });
    ss.setFetchedModels([]); ss.setPendingModelSelections([]); ss.setFetchModelsError(null); ss.setModelSearchQuery('');
  };

  const handleFetchModels = async () => {
    const ss = useSettingsStore.getState();
    const _editingModel = ss.editingModel;
    if (!_editingModel.apiKey && !['custom', 'lmstudio'].includes(_editingModel.provider)) { ss.setFetchModelsError('Please enter your API Key first.'); return; }
    ss.setIsFetchingModels(true); ss.setFetchModelsError(null); ss.setFetchedModels([]); ss.setModelSearchQuery('');
    try {
      let url = '', hdrs: any = {};
      const { provider, endpoint, apiKey } = _editingModel;

      if (provider === 'google') {
        url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      } else if (provider === 'anthropic') {
        url = endpoint ? `${endpoint.replace(/\/messages$/, '')}/models` : 'https://api.anthropic.com/v1/models';
        hdrs['x-api-key'] = apiKey;
        hdrs['anthropic-version'] = '2023-06-01';
        hdrs['anthropic-dangerous-direct-browser-access'] = 'true';
      } else if (provider === 'huggingface') {
        url = `https://api-inference.huggingface.co/v1/models`;
        if (apiKey) hdrs['Authorization'] = `Bearer ${apiKey}`;
      } else {
        const defaultEndpoint = provider === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : 'https://api.openai.com/v1';
        url = `${(endpoint || defaultEndpoint).replace(/\/chat\/completions$/, '')}/models`;
        if (apiKey) hdrs['Authorization'] = `Bearer ${apiKey}`;
      }

      const data = await fetchWithRetry(url, { method: 'GET', headers: hdrs }, 1);
      let list: any[] = [];
      if (provider === 'google') {
          list = (data.models ?? [])
                 .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
                 .map((m: any) => m.name.replace('models/', ''));
      } else {
          list = (data.data ?? data.models ?? []).map((m: any) => m.id ?? m.name);
      }
      if (list.length === 0) throw new Error('No models returned. API Key might be invalid.');
      ss.setFetchedModels(list.map((id: string) => ({ id, context: getContextLimit(id) })));
    } catch (e: any) {
      ss.setFetchModelsError(e.message.includes('CORS') ? e.message : `Fetch failed: ${e.message}`);
    } finally { ss.setIsFetchingModels(false); }
  };

  const toggleModelSelection = (m: any) => {
    const ss = useSettingsStore.getState();
    ss.setPendingModelSelections((prev: any[]) => prev.some((p: any) => p.id === m.id) ? prev.filter((p: any) => p.id !== m.id) : [...prev, m]);
  };

  const handleBulkAdd = () => {
    const ss = useSettingsStore.getState();
    const _editingModel = ss.editingModel;
    const _pendingModelSelections = ss.pendingModelSelections;
    const newModels = _pendingModelSelections.map((m: any) => ({ id: generateId('m'), name: m.id, provider: _editingModel.provider, modelId: m.id, endpoint: _editingModel.endpoint, apiKey: _editingModel.apiKey, contextLimit: m.context, canImage: false }));
    ss.setModels((prev: any[]) => [...prev, ...newModels]);
    if (!ss.selectedModelId && newModels.length > 0) ss.setSelectedModelId(newModels[0].id);
    ss.setPendingModelSelections([]); ss.setFetchedModels([]); ss.setShowModelWizard(false); ss.setWizardStep(3);
    newModels.forEach(async (mdl: any) => {
        ss.setModelValidation((prev: Record<string, string>) => ({ ...prev, [mdl.id]: 'pending' }));
        const ok = await validateModel(mdl);
        ss.setModelValidation((prev: Record<string, string>) => ({ ...prev, [mdl.id]: ok ? 'ok' : 'fail' }));
    });
  };

  const executeAddLLM = async (cfg: any) => {
    const ss = useSettingsStore.getState();
    const id = generateId('m');
    const mdl = { id, name: String(cfg.name || 'Custom Model').trim(), provider: cfg.provider, modelId: String(cfg.modelId || 'custom').trim(), endpoint: String(cfg.endpoint || '').trim(), apiKey: String(cfg.apiKey || '').trim(), contextLimit: parseInt(cfg.contextLimit, 10) || 32000, canImage: false };
    ss.setModels((prev: any[]) => [...prev, mdl]); ss.setSelectedModelId(id); ss.setShowModelWizard(false); ss.setWizardStep(3); ss.setEditingModel({ name: '', provider: 'openai', modelId: '', endpoint: '', apiKey: '', contextLimit: 128000 });
    ss.setModelValidation((prev: Record<string, string>) => ({ ...prev, [id]: 'pending' }));
    const ok = await validateModel(mdl);
    ss.setModelValidation((prev: Record<string, string>) => ({ ...prev, [id]: ok ? 'ok' : 'fail' }));
  };

  const enhance = async (text: string, systemInstruction: string, onResult: (res: string) => void) => {
    const { models: _models, appSettings: _appSettings, integrations: _integrations, selectedModelId: _selectedModelId } = useSettingsStore.getState();
    const _selectedModel = _models.find((m: any) => m.id === _selectedModelId) ?? _models[0] ?? null;
    const _agentPinnedMessagesForPrompt = useMemoryStore.getState().globalPins.filter((p: any) => p.agentId === (useAgentStore.getState().assistants.find((a: any) => a.id === useAgentStore.getState().activeFolderId) ?? useAgentStore.getState().assistants[0])?.id).map((p: any) => p.content);
    const agent = { prompt: systemInstruction, tools: {}, awareOfProfile: false, trainingDocs: [] };
    const result = await generateTextResponse({ messages: [{ id: generateId('msg'), role: 'user', content: text }], modelConfig: _selectedModel, profile: '', attachedDocs: [], agent, tasks: [], mode: 'text', canvasContent: null, isDeepThinking: false, agentPinnedMessages: _agentPinnedMessagesForPrompt, onChunk: null, signal: null, appSettings: _appSettings, integrations: _integrations, models: _models, runIntegrationTools });
    onResult(result.replace(/```[a-zA-Z]*\n/g, '').replace(/```/g, '').trim());
  };

  // ─── Dream Cycle ─────────────────────────────────────────────────────────────

  const runDreamCycle = useCallback(async (agent?: any, model?: any) => {
    const { assistants: _assistants, activeFolderId: _activeFolderId } = useAgentStore.getState();
    const _activeAssistant = _assistants.find((a: any) => a.id === _activeFolderId) ?? _assistants[0];
    const { models: _models, selectedModelId: _selectedModelId, appSettings: _appSettings, integrations: _integrations } = useSettingsStore.getState();
    const _selectedModel = _models.find((m: any) => m.id === _selectedModelId) ?? _models[0] ?? null;
    const _agentForgePath = useMemoryStore.getState().agentForgePath;
    const activeAgent = agent ?? _activeAssistant;
    const activeModel = model ?? _selectedModel;
    const _activeChatId = useChatStore.getState().activeChatId;
    const _activeChat = useChatStore.getState().chats.find((c: any) => c.id === _activeChatId);
    const _activeChannel = _activeChat ? normalizeChatRecord(_activeChat, activeAgent?.id ?? 'f-default') : null;
    const dreamScope = _activeChannel?.kind === 'channel'
      ? { type: 'channel', id: _activeChannel.id, label: _activeChannel.name, prefix: `memory/channels/${_activeChannel.id}/` }
      : { type: 'agent', id: activeAgent?.id, label: activeAgent?.name, prefix: `memory/${activeAgent?.id}/` };
    if (isDreamRunningRef.current || !_agentForgePath || !activeAgent || !activeModel) return;
    isDreamRunningRef.current = true;
    useMemoryStore.getState().setIsDreamRunning(true);
    useUIStore.getState().showToast('🌙 Dream Cycle starting...');

    try {
      // Read all memory files for the active agent or active channel
      const memoryFiles: { path: string; name: string; content: string }[] = [];

      const listed = dreamScope.type === 'channel'
        ? await invoke<{ files: Array<{ path: string; name: string }> }>('list_channel_memory_files', { channelId: dreamScope.id })
        : await invoke<{ files: Array<{ path: string; name: string }> }>('list_agent_memory_files', { agentId: activeAgent.id });
      for (const file of listed.files ?? []) {
        const read = await invoke<{ ok: boolean; content: string }>('read_knowledge_file', { path: file.path }).catch(() => ({ ok: false, content: '' }));
        if (read.ok && read.content.trim()) memoryFiles.push({ path: file.path, name: file.name, content: read.content });
      }

      if (memoryFiles.length < 2) {
        useUIStore.getState().showToast('🌙 Dream Cycle: Not enough files to consolidate yet.');
        return;
      }

      // Token guard — cap context to 75% of model limit
      const modelLimit = activeModel.contextLimit ?? 32000;
      const maxChars = Math.floor(modelLimit * 0.75) * 4;

      // Call the Dreamer LLM
      const systemPrompt = buildDreamerSystemPrompt(dreamScope.prefix);
      const userMessage = buildDreamerUserMessage(memoryFiles, dreamScope.label || activeAgent.name, maxChars);

      const rawResponse = await generateTextResponse({
        messages: [{ id: 'dream-1', role: 'user', content: userMessage }],
        modelConfig: activeModel,
        agent: { prompt: systemPrompt, tools: {}, trainingDocs: [] },
        profile: '',
        tasks: [],
        attachedDocs: [],
        agentPinnedMessages: [],
        mode: 'text',
        canvasContent: null,
        isDeepThinking: false,
        onChunk: null,
        signal: null,
        appSettings: _appSettings,
        integrations: _integrations,
        models: _models,
        runIntegrationTools,
      });

      const plan = parseDreamerResponse(rawResponse);
      if (!plan || plan.operations.length === 0) {
        useUIStore.getState().showToast('🌙 Dream Cycle: Nothing to consolidate right now.');
        return;
      }

      // Validate paths — only operate on files we actually read
      const knownPaths = new Set(memoryFiles.map(f => f.path));

      const dreamItems: DreamItem[] = [];
      let totalTokensSaved = 0;

      for (const op of plan.operations) {
        const id = `dream-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        try {
          if (op.type === 'merge') {
            // Validate all source paths exist
            const validSources = op.source_paths.filter((p: string) => knownPaths.has(p));
            if (validSources.length < 2) continue;
            if (op.target_path.startsWith('/') || op.target_path.includes('..') || !op.target_path.startsWith(dreamScope.prefix)) continue;

            // Write merged content
            const targetFullPath = `${_agentForgePath}/${op.target_path}`;
            const writeResult = await invoke<{ blocked: boolean; commit: string | null }>('write_memory', {
              path: targetFullPath,
              content: op.merged_content,
              commit_message: `dream: merge — ${op.description}`,
              agent_id: activeAgent.id,
              context_tokens: null,
              ram_state: null,
            });
            const gitCommits: string[] = [];
            if (writeResult.blocked) continue;
            if (writeResult.commit) gitCommits.push(writeResult.commit);

            // Archive source files
            const archivePaths: string[] = [];
            const originalPaths: string[] = [...validSources];
            for (const srcPath of validSources) {
              const ar = await invoke<{ ok: boolean; archive_path: string; commit: string }>('archive_memory_file', { path: srcPath });
              if (ar.ok) {
                archivePaths.push(ar.archive_path);
                if (ar.commit) gitCommits.push(ar.commit);
                const f = memoryFiles.find(m => m.path === srcPath);
                totalTokensSaved += Math.round((f?.content.length ?? 0) / 4);
              }
            }
            // Subtract tokens for merged file
            totalTokensSaved = Math.max(0, totalTokensSaved - Math.round(op.merged_content.length / 4));

            dreamItems.push({ id, type: 'merged', description: op.description, archive_paths: archivePaths, original_paths: originalPaths, target_file: targetFullPath, git_commits: gitCommits, undone: false });

          } else if (op.type === 'prune') {
            if (!knownPaths.has(op.source_path)) continue;
            const ar = await invoke<{ ok: boolean; archive_path: string; commit: string }>('archive_memory_file', { path: op.source_path });
            if (ar.ok) {
              const f = memoryFiles.find(m => m.path === op.source_path);
              totalTokensSaved += Math.round((f?.content.length ?? 0) / 4);
              dreamItems.push({ id, type: 'pruned', description: op.description, archive_paths: [ar.archive_path], original_paths: [op.source_path], git_commits: ar.commit ? [ar.commit] : [], undone: false });
            }

          } else if (op.type === 'update') {
            if (!knownPaths.has(op.target_path)) continue;
            const f = memoryFiles.find(m => m.path === op.target_path);
            const oldLen = f?.content.length ?? 0;
            const newLen = op.updated_content.length;
            // Skip if more than 50% smaller (risky update)
            if (newLen < oldLen * 0.5) continue;
            const writeResult = await invoke<{ blocked: boolean; commit: string | null }>('write_memory', {
              path: op.target_path,
              content: op.updated_content,
              commit_message: `dream: update — ${op.description}`,
              agent_id: activeAgent.id,
              context_tokens: null,
              ram_state: null,
            });
            if (writeResult.blocked) continue;
            dreamItems.push({ id, type: 'updated', description: op.description, archive_paths: [], original_paths: [], target_file: op.target_path, git_commits: writeResult.commit ? [writeResult.commit] : [], undone: false });
          }
        } catch (opErr) {
          console.warn('[DreamCycle] Operation failed:', opErr);
        }
      }

      // Save dream log and show banner
      const log: DreamLog = {
        timestamp: new Date().toISOString(),
        dismissed: false,
        tokens_saved: totalTokensSaved,
        items_count: dreamItems.length,
        items: dreamItems,
      };
      await invoke('write_dream_log', { log });
      useMemoryStore.getState().setDreamLog(log);
      useMemoryStore.getState().setShowDreamBanner(true);
      useUIStore.getState().showToast(`🌙 Dream Cycle complete — ${dreamItems.length} change${dreamItems.length !== 1 ? 's' : ''} made`);

    } catch (e: any) {
      console.error('[DreamCycle] Error:', e);
      useUIStore.getState().showToast(`Dream Cycle failed: ${e?.message ?? String(e)}`);
    } finally {
      useMemoryStore.getState().setIsDreamRunning(false);
      isDreamRunningRef.current = false;
    }
  }, []); // reads all state from stores at call time

  const dismissDreamBanner = useCallback(async () => {
    const mem = useMemoryStore.getState();
    if (!mem.dreamLog) return;
    const updated = { ...mem.dreamLog, dismissed: true };
    mem.setDreamLog(updated);
    mem.setShowDreamBanner(false);
    await invoke('write_dream_log', { log: updated }).catch(() => {});
  }, []);

  const undoDreamItem = useCallback(async (itemId: string) => {
    const mem = useMemoryStore.getState();
    if (!mem.dreamLog) return;
    const item = mem.dreamLog.items.find((i: any) => i.id === itemId);
    if (!item || item.undone) return;
    try {
      for (let i = 0; i < item.archive_paths.length; i++) {
        const archivePath = item.archive_paths[i];
        const originalPath = item.original_paths[i] ?? '';
        await invoke('restore_archived_file', { archive_path: archivePath, original_path: originalPath });
      }
      // For merges: delete the merged target file
      if (item.type === 'merged' && item.target_file) {
        await invoke('delete_memory_file', { path: item.target_file }).catch(() => {});
      }
      const updatedItems = mem.dreamLog.items.map((i: any) => i.id === itemId ? { ...i, undone: true } : i);
      const updatedLog = { ...mem.dreamLog, items: updatedItems };
      mem.setDreamLog(updatedLog);
      await invoke('write_dream_log', { log: updatedLog }).catch(() => {});
      useUIStore.getState().showToast('Undo applied — file restored.');
    } catch (e: any) {
      useUIStore.getState().showToast(`Undo failed: ${e?.message ?? String(e)}`);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────

  const handleEnhancePrompt = async () => {
    const { input: _input } = useUIStore.getState();
    const { models: _models, selectedModelId: _selId } = useSettingsStore.getState();
    const _selectedModel = _models.find((m: any) => m.id === _selId) ?? _models[0] ?? null;
    if (!_input.trim() || isEnhancing || !_selectedModel) return;
    setIsEnhancing(true);
    try { await enhance(_input, 'Enhance this user prompt to be more detailed, precise, and effective for an AI. Return ONLY the improved prompt.', (v) => useUIStore.getState().setInput(v)); }
    catch { } finally { setIsEnhancing(false); }
  };
  const handleEnhanceSystemPrompt = async () => {
    const { editingAssistant: _ea } = useAgentStore.getState();
    const { models: _models, selectedModelId: _selId } = useSettingsStore.getState();
    const _selectedModel = _models.find((m: any) => m.id === _selId) ?? _models[0] ?? null;
    if (!_ea?.prompt || isEnhancingPrompt || !_selectedModel) return;
    setIsEnhancingPrompt(true);
    try { await enhance(_ea.prompt, 'Rewrite this AI system instruction to be professional and precise. Return ONLY the improved prompt.', val => useAgentStore.getState().setEditingAssistant((prev: any) => ({ ...prev, prompt: val }))); }
    catch { } finally { setIsEnhancingPrompt(false); }
  };

  const collectResearchSources = useCallback(async (input: string, integrations: any): Promise<ResearchSource[]> => {
    const query = extractSearchQuery(input);
    const sources: ResearchSource[] = [];
    const directUrls = extractUrls(input);
    const wantsCurrentPage = /\b(this page|current page|browser tab|article|site|url|webpage)\b/i.test(input);

    for (const url of directUrls) {
      const read = await invoke<{ ok: boolean; text: string; error?: string }>('read_url_text', { url }).catch(() => ({ ok: false, text: '', error: 'URL text unavailable' }));
      sources.push({
        title: url,
        url,
        snippet: read.ok ? read.text.slice(0, 500) : read.error ?? 'URL text unavailable',
        text: read.ok ? read.text : '',
      });
    }

    if (wantsCurrentPage) {
      const tab = await invoke<{ title: string; url: string; text: string; error?: string }>('get_active_tab', { preferred: 'auto' }).catch(() => null);
      if (tab?.url) {
        sources.push({
          title: tab.title || tab.url,
          url: tab.url,
          snippet: tab.text?.slice(0, 500) || 'Active tab text unavailable',
          text: tab.text || '',
        });
      }
    }

    if (integrations.tavily?.enabled && integrations.tavily?.apiKey) {
      try {
        const tvData = await fetchWithRetry(
          'https://api.tavily.com/search',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: integrations.tavily.apiKey,
              query,
              max_results: 5,
              search_depth: 'advanced',
              include_answer: true,
            }),
          },
          1
        );
        for (const result of tvData.results ?? []) {
          const read = result.url
            ? await invoke<{ ok: boolean; text: string; error?: string }>('read_url_text', { url: result.url }).catch(() => ({ ok: false, text: '', error: 'URL text unavailable' }))
            : { ok: false, text: '', error: 'URL text unavailable' };
          sources.push({
            title: result.title || result.url || 'Web result',
            url: result.url,
            snippet: result.content || read.text.slice(0, 500),
            text: read.ok ? read.text : result.content || '',
          });
        }
      } catch (tvErr: any) {
        const msg = tvErr?.message ?? String(tvErr);
        const isAuth = msg.includes('401') || msg.toLowerCase().includes('unauthorized');
        useUIStore.getState().showToast(
          isAuth ? 'Tavily key rejected. Check Settings > Integrations.' : `Tavily search failed: ${msg}`
        );
      }
    } else if (integrations.tavily?.enabled && !integrations.tavily?.apiKey) {
      useUIStore.getState().showToast('Tavily is enabled but missing an API key.');
    }

    if (integrations.brave?.enabled && integrations.brave?.apiKey) {
      try {
        const braveData = await fetchWithRetry(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&text_decorations=false`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'X-Subscription-Token': integrations.brave.apiKey,
            },
          },
          1
        );
        for (const result of braveData?.web?.results ?? []) {
          const read = result.url
            ? await invoke<{ ok: boolean; text: string; error?: string }>('read_url_text', { url: result.url }).catch(() => ({ ok: false, text: '', error: 'URL text unavailable' }))
            : { ok: false, text: '', error: 'URL text unavailable' };
          sources.push({
            title: result.title || result.url || 'Brave result',
            url: result.url,
            snippet: result.description || read.text.slice(0, 500),
            text: read.ok ? read.text : result.description || '',
          });
        }
      } catch (braveErr: any) {
        const msg = braveErr?.message ?? String(braveErr);
        const isAuth = msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('unauthorized');
        useUIStore.getState().showToast(
          isAuth ? 'Brave key rejected. Check Settings > Integrations.' : `Brave search failed: ${msg}`
        );
      }
    } else if (integrations.brave?.enabled && !integrations.brave?.apiKey) {
      useUIStore.getState().showToast('Brave Search is enabled but missing an API key.');
    }

    if (
      hasResearchIntent(input)
      && !integrations.tavily?.enabled
      && !integrations.brave?.enabled
      && directUrls.length === 0
      && !wantsCurrentPage
    ) {
      useUIStore.getState().showToast('Search providers are off. Using browser, URLs, and Wikipedia fallback.');
    }

    const wikiQuery = query.split(' ').slice(0, 6).join(' ').trim();
    if (wikiQuery) {
      try {
        const wikiData = await fetchWithRetry(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(wikiQuery)}&utf8=&format=json&origin=*`,
          { method: 'GET' },
          1
        );
        for (const s of (wikiData?.query?.search ?? []).slice(0, 2)) {
          const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`;
          sources.push({
            title: `Wikipedia: ${s.title}`,
            url,
            snippet: String(s.snippet ?? '').replace(/<[^>]*>?/gm, ''),
          });
        }
      } catch (wikiErr) {
        console.warn('Wikipedia search failed:', wikiErr);
      }
    }

    return dedupeSources(sources).slice(0, 8);
  }, []);

  const autosaveResearchNote = useCallback(async ({
    chat,
    agent,
    question,
    answer,
    sources,
  }: { chat: any; agent: any; question: string; answer: string; sources: ResearchSource[] }) => {
    const _agentForgePath = useMemoryStore.getState().agentForgePath;
    if (!_agentForgePath || sources.length === 0 || !agent?.id) return null;

    const normalized = normalizeChatRecord(chat, agent.id);
    const assessment = assessMemoryGatekeeper({
      sourceKind: 'research',
      text: question,
      answer,
      chatKind: normalized.kind,
      agentTools: agent?.tools ?? {},
      urls: sources.map(source => source.url).filter(Boolean) as string[],
      sourcePaths: sources.map(source => source.path).filter(Boolean) as string[],
    });
    if (!assessment.shouldSave) return null;

    const title = question.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Research note';
    const slug = researchSlugify(title, 'research');
    const basePath = assessment.destination === 'channel_memory'
      ? `${_agentForgePath}/memory/channels/${normalized.id}/research`
      : `${_agentForgePath}/memory/${agent.id}/research`;
    const path = `${basePath}/${new Date().toISOString().slice(0, 10)}-${slug}-${Date.now()}.md`;
    const sourceLines = sources.map((source, i) => `${i + 1}. [${source.title}](${source.url ?? source.path ?? ''})`).join('\n');
    const content = buildGroundedMarkdown(
      {
        title,
        type: 'research-note',
        scope: assessment.destination === 'channel_memory' ? 'channel' : 'agent',
        agentId: agent.id,
        agentName: agent.name ?? agent.id,
        channelId: assessment.destination === 'channel_memory' ? normalized.id : undefined,
        channelName: assessment.destination === 'channel_memory' ? normalized.name : undefined,
        sourceKind: 'web_research',
        sourceLabel: 'Source-required research answer',
        sourceUrls: sources.map(source => source.url).filter(Boolean) as string[],
        sourcePaths: sources.map(source => source.path).filter(Boolean) as string[],
        derivedFrom: [`chat:${normalized.id}`],
        evidenceState: assessment.evidenceState,
        verification: assessment.verification,
        confidence: assessment.confidence,
        processor: 'memory-gatekeeper',
        sourceCount: sources.length,
        tags: assessment.tags,
      },
      `## Memory Gatekeeper
- Level: ${assessment.level}
- Destination: ${assessment.destination}
- Memory type: ${assessment.memoryType}
- Evidence: ${assessment.evidenceState}
- Verification: ${assessment.verification}
- Confidence: ${assessment.confidence}
- Tool route: ${assessment.toolRoute}
- Reason: ${assessment.reason}
- Score: ${assessment.score}

## Question
${question}

## Answer
${answer}

## Sources
${sourceLines}

## Source Excerpts
${buildSourceNotes(sources, 900)}`
    );

    const result = await invoke<{ blocked: boolean; commit: string | null; error?: string }>('write_memory', {
      path,
      content,
      commitMessage: `research: ${title}`,
      agentId: agent.id,
      contextTokens: null,
      ramState: null,
    }).catch((e: any) => ({ blocked: true, commit: null, error: e?.message ?? String(e) }));

    if (result.blocked) {
      console.warn('[Research] Autosave blocked:', result.error ?? result);
      return null;
    }
    return { path, commit: result.commit };
  }, []);

  const autosaveConversationNote = useCallback(async ({
    chat,
    agent,
    question,
    answer,
    contributions,
    attachments,
  }: { chat: any; agent: any; question: string; answer: string; contributions: string[]; attachments?: any[] }) => {
    const _agentForgePath = useMemoryStore.getState().agentForgePath;
    if (!_agentForgePath || !agent?.id) return null;

    const normalized = normalizeChatRecord(chat, agent.id);
    const assessment = assessMemoryGatekeeper({
      sourceKind: 'conversation',
      text: question,
      answer,
      agentTools: agent?.tools ?? {},
      contributions,
      attachments: attachments ?? [],
      chatKind: normalized.kind,
    });
    if (!assessment.shouldSave || assessment.destination === 'task' || assessment.destination === 'inbox_only') return null;

    const title = question.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Conversation note';
    const slug = researchSlugify(title, 'conversation');
    const basePath = assessment.destination === 'channel_memory'
      ? `${_agentForgePath}/memory/channels/${normalized.id}/memos`
      : assessment.destination === 'library'
        ? `${_agentForgePath}/library/conversations`
      : `${_agentForgePath}/memory/${agent.id}/memos`;
    const path = `${basePath}/${new Date().toISOString().slice(0, 10)}-${slug}-${Date.now()}.md`;
    const contributionBlock = contributions.length > 0
      ? `\n\n## Invited Agent Notes\n${contributions.join('\n\n---\n\n')}`
      : '';
    const attachmentBlock = (attachments ?? []).length > 0
      ? `\n\n## Attached Inputs\n${(attachments ?? []).map((file: any) => `- ${file.name ?? 'Attachment'} (${file.isImage ? 'image/vision input' : file.type || 'file'})`).join('\n')}`
      : '';
    const content = buildGroundedMarkdown(
      {
        title,
        type: 'autosaved-conversation',
        scope: assessment.destination === 'channel_memory' ? 'channel' : assessment.destination === 'library' ? 'library' : 'agent',
        agentId: agent.id,
        agentName: agent.name ?? agent.id,
        channelId: assessment.destination === 'channel_memory' ? normalized.id : undefined,
        channelName: assessment.destination === 'channel_memory' ? normalized.name : undefined,
        sourceKind: 'conversation',
        sourceLabel: 'User conversation and assistant response',
        derivedFrom: [`chat:${normalized.id}`],
        evidenceState: assessment.evidenceState,
        verification: assessment.verification,
        confidence: assessment.confidence,
        processor: 'memory-gatekeeper',
        tags: assessment.tags,
      },
      `## Memory Gatekeeper
- Level: ${assessment.level}
- Destination: ${assessment.destination}
- Memory type: ${assessment.memoryType}
- Evidence: ${assessment.evidenceState}
- Verification: ${assessment.verification}
- Confidence: ${assessment.confidence}
- Tool route: ${assessment.toolRoute}
- Reason: ${assessment.reason}
- Score: ${assessment.score}

## User
${question}

## Response
${answer}
${contributionBlock}
${attachmentBlock}

## Interpretation Boundary
The user message is first-party context. The assistant response and invited-agent notes are work product unless separately backed by research sources or raw captures.`
    );

    const result = await invoke<{ blocked: boolean; commit: string | null; error?: string }>('write_memory', {
      path,
      content,
      commitMessage: `memory: ${title}`,
      agentId: agent.id,
      contextTokens: null,
      ramState: null,
    }).catch((e: any) => ({ blocked: true, commit: null, error: e?.message ?? String(e) }));

    if (result.blocked) {
      console.warn('[Memory] Autosave blocked:', result.error ?? result);
      return null;
    }
    return { path, commit: result.commit, assessment };
  }, []);

  const processChatRequest = async (chatId: string, userMsg: any, historyToPass: any[]) => {
    // Read store state at call time (avoids stale closure issues)
    const { assistants: _assistants, activeFolderId: _activeFolderId } = useAgentStore.getState();
    const _activeAssistant = _assistants.find((a: any) => a.id === _activeFolderId) ?? _assistants[0];
    const _chatRecord = useChatStore.getState().chats.find((c: any) => c.id === chatId);
    const _normalizedChat = normalizeChatRecord(_chatRecord ?? { id: chatId, folderId: _activeFolderId, primaryAgentId: _activeFolderId, participantAgentIds: [_activeFolderId], kind: 'dm', name: `${_activeAssistant?.name ?? 'Agent'} Direct` }, _activeFolderId);
    const _primaryAssistant = _assistants.find((a: any) => a.id === (_normalizedChat.primaryAgentId ?? _activeFolderId)) ?? _activeAssistant;
    const _channelContext = buildChannelContext(_normalizedChat, _assistants);
    const { models: _models, selectedModelId: _selectedModelId, appSettings: _appSettings, integrations: _integrations } = useSettingsStore.getState();
    const _selectedModel = _models.find((m: any) => m.id === _selectedModelId) ?? _models[0] ?? null;
    const _hwProfile = useUIStore.getState().hwProfile;
    const _forcedTool = useUIStore.getState().forcedTool;
    const _globalPins = useMemoryStore.getState().globalPins;
    const _agentPinnedMessagesForPrompt = _globalPins.filter((p: any) => p.agentId === _primaryAssistant?.id).map((p: any) => p.content);
    const _generationMode = useUIStore.getState().generationMode;
    const _isDeepThinking = useUIStore.getState().isDeepThinking;
    const _canvasContent = useUIStore.getState().canvasContent;
    const _tasks = useTaskStore.getState().tasks;
    const _userProfile = useSettingsStore.getState().userProfile;

    setIsGenerating(true);
    try {
      const history = [...historyToPass, userMsg];
      const toolDecision = routeToolForMessage({
        message: userMsg.content,
        agentTools: _primaryAssistant?.tools ?? {},
        forcedTool: _forcedTool,
      });
      let toolUsed = toolDecision.tool;
      let toolData = "";
      let foundSources: any[] = [];
      const supportBubbles: any[] = [];

      if (_forcedTool) useUIStore.getState().setForcedTool(null);

      let messagesForLLM = [...history];

      if (toolUsed) {
        const toolMsgId = generateId('tool');
        useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), { id: toolMsgId, role: 'bot', content: `[ ⚡ Interfacing with ${toolUsed}... ]`, isToolCall: true, isPinned: false, timestamp: Date.now() }] }));

        if (toolUsed === 'Knowledge Search') {
             try {
                 let ragData = "No relevant documents found in Knowledge Core.";
                 let semanticData = "No semantic memory map matches.";
                 if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
                     const cleanQuery = userMsg.content.replace(/^\[PLANNING MODE[^\]]*\]\n+/i, '').trim();
                     const kcResult = await invoke<{ results: Array<{ path: string; title: string; snippet: string; score: number }> }>(
                         'search_knowledge_semantic', {
                           query: cleanQuery,
                           agentId: _primaryAssistant?.id ?? null,
                           channelId: _normalizedChat.kind === 'channel' ? _normalizedChat.id : null,
                           maxResults: _hwProfile?.rag_results ?? 5,
                           snippetChars: _hwProfile?.rag_snippet_chars ?? 400
                         }
                     );
                     const hits = kcResult.results ?? [];
                     if (hits.length > 0) {
                         ragData = hits.map((h: any, i: number) => `[${i + 1}] ${h.title}\n${h.snippet}`).join('\n\n---\n\n');
                         hits.forEach((h: any) => foundSources.push({ title: h.title, path: h.path, snippet: h.snippet }));
                     }
                     const semanticResult = await invoke<SemanticLayerResult>(
                       'search_semantic_layer', {
                         query: cleanQuery,
                         agentId: _primaryAssistant?.id ?? null,
                         channelId: _normalizedChat.kind === 'channel' ? _normalizedChat.id : null,
                         maxResults: 8,
                       }
                     ).catch(() => null);
                     if (semanticResult && hasSemanticHits(semanticResult)) {
                       semanticData = buildSemanticMemoryNotes(semanticResult);
                       for (const hit of semanticResult.facts ?? []) {
                         foundSources.push({ title: hit.title, path: hit.path, snippet: hit.fact });
                       }
                       for (const hit of semanticResult.relations ?? []) {
                         foundSources.push({ title: hit.title, path: hit.path, snippet: `${hit.source} --${hit.relation}--> ${hit.target}` });
                       }
                     }
                 }
                 toolData += `\n\n[SYSTEM NOTE: KNOWLEDGE SEARCH RESULTS]\n${ragData}\n\n[SYSTEM NOTE: SEMANTIC MEMORY MAP]\n${semanticData}\n\n[LOCAL MEMORY RULE]\nUse semantic facts/relations to understand what the user has given Agent Forge over time. Prefer user-provided, source-backed, and capture-backed facts over agent-inferred notes. Cite local facts as [[Title]]. If memory is low-confidence, stale, inferred, or conflicting, say so and avoid overstating it.\n[END SEARCH]`;
             } catch (e: any) {
                 console.error('Local RAG failed:', e);
                 toolData += `\n\n[SYSTEM NOTE: LOCAL RAG FAILED]\nError: ${e.message}\n[END SEARCH]`;
             }
        } else if (toolUsed === 'Web Search') {
            try {
                const researchSources = await collectResearchSources(userMsg.content, _integrations);
                foundSources = researchSources;
                if (researchSources.length > 0) {
                    toolData += `\n\n[SYSTEM NOTE: VERIFIED WEB/RESEARCH SOURCES]\n${buildSourceNotes(researchSources)}\n\n[SOURCE RULE]\nAnswer the user's actual question directly and concisely. Cite every factual web/current claim using [Source: Title](URL). Do not write a long dossier unless the user explicitly asks for a report. If the sources are weak or conflict, say so.\n[END SEARCH]`;
                } else {
                    toolData += `\n\n[SYSTEM NOTE: WEB SEARCH RESULTS]\nNo verified sources were found. Do not answer factual/current claims as verified. Tell the user you could not verify the answer with sources and ask for a URL, a source, or search-provider setup if needed.\n[END SEARCH]`;
                }
            } catch (e: any) {
                console.error('Web search failed:', e);
                useUIStore.getState().showToast("Web search failed. Check console logs.");
                toolData += `\n\n[SYSTEM NOTE: WEB SEARCH FAILED]\nThe web search encountered an error: ${e.message}\n[END SEARCH]`;
            }
        } else if (toolUsed === 'Calendar') {
            try {
                const taskText = userMsg.content.replace(/^(schedule|remind me to|add|calendar|set reminder for)\s*/i, '').trim();
                await invoke('append_task', { text: taskText });
                toolData += `\n\n[CALENDAR]\nAdded to local planner: "${taskText}"\nSaved to ~/AgentForge/memory/tasks.md`;
                useUIStore.getState().showToast(`Added to planner: ${taskText.slice(0, 60)}${taskText.length > 60 ? '…' : ''}`);
            } catch (e: any) {
                toolData += `\n\n[CALENDAR ERROR]\n${e?.message ?? e}`;
            }
        }

        await new Promise(r => setTimeout(r, 800));
        useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: prev[chatId].filter((m: any) => m.id !== toolMsgId) }));
        
        if (toolData) {
            // Only inject toolData into the LLM payload — never into stored messages (avoids SYSTEM NOTE bleed in chat bubbles)
            messagesForLLM = history.map(m => m.id === userMsg.id ? { ...m, content: m.content + toolData } : m);
        }
      }

      const routedAgents = routeAgentsForChannel(userMsg.content, _normalizedChat, _assistants, _primaryAssistant?.id ?? _activeFolderId);
      const contributorAgents = _normalizedChat.kind === 'channel'
        ? routedAgents.filter((agent: any) => agent.id !== _primaryAssistant?.id).slice(0, 2)
        : [];
      const contributionNotes: string[] = [];

      for (const agent of contributorAgents) {
        try {
          const contribution = await generateTextResponse({
            messages: [{
              id: generateId('msg'),
              role: 'user',
              content: `${userMsg.content}${toolData}\n\n[CHANNEL REQUEST]\nYou are contributing inside "${_normalizedChat.name}". Channel goal: ${_normalizedChat.goal || 'not set'}.\nGive concise specialist notes for the primary agent. Do not write the final answer. If sources are present, cite only those sources.`,
            }],
            modelConfig: _selectedModel,
            profile: _userProfile,
            attachedDocs: userMsg.attachedFiles,
            agent: {
              ...agent,
              prompt: `${agent.prompt ?? ''}\n\n[CHANNEL CONTRIBUTION MODE]\nYou are one invited specialist in a multi-agent Agent Forge channel. Contribute only from your role. Be brief, specific, and useful to the final synthesizer.`,
            },
            tasks: _tasks,
            mode: 'text',
            canvasContent: _canvasContent,
            isDeepThinking: false,
            agentPinnedMessages: _globalPins.filter((p: any) => p.agentId === agent.id).map((p: any) => p.content),
            onChunk: null,
            signal: abortControllerRef.current?.signal,
            appSettings: _appSettings,
            integrations: _integrations,
            models: _models,
            channelContext: _channelContext,
            runIntegrationTools,
          });
          const clipped = contribution.trim();
          if (clipped) {
            contributionNotes.push(`[${agent.name}]\n${clipped}`);
            supportBubbles.push({
              id: generateId('bubble'),
              role: 'bot',
              content: clipped,
              agentId: agent.id,
              agentName: agent.name,
              bubbleType: 'thinking',
              bubbleTitle: `${agent.name} contribution`,
              bubbleSubtitle: agent.description || 'Invited channel specialist',
              isPinned: false,
              timestamp: Date.now(),
            });
          }
        } catch (e) {
          console.warn('[Channel] Agent contribution failed:', agent?.name, e);
        }
      }

      if (contributionNotes.length > 0) {
        const contributionData = `\n\n[SYSTEM NOTE: INVITED AGENT CONTRIBUTIONS]\n${contributionNotes.join('\n\n---\n\n')}\n[END CONTRIBUTIONS]`;
        messagesForLLM = messagesForLLM.map(m => m.id === userMsg.id ? { ...m, content: m.content + contributionData } : m);
      }
      
      const botId = generateId('msg');
      useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), { id: botId, role: 'bot', content: '', sources: foundSources, agentId: _primaryAssistant?.id, agentName: _primaryAssistant?.name, isPinned: false, isStreaming: true, timestamp: Date.now() }] }));

      let currentText = '';
      let lastCanvasSync = Date.now();

      const handleChunk = (chunk: string) => {
          currentText += chunk;
          useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: (prev[chatId] ?? []).map((m: any) => m.id === botId ? { ...m, content: currentText } : m) }));

          const now = Date.now();
          if ((_generationMode === 'code' || _generationMode === 'doc') && now - lastCanvasSync > 300) {
              const contentWithoutThink = currentText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
              const match = contentWithoutThink.match(/```([a-zA-Z]*)\n([\s\S]*?)($|```)/);
              if (match) {
                  const lang = (match[1] || '').toLowerCase();
                  const code = match[2];
                  if (!['task', 'todo', 'profile', 'save', 'event', 'slack_post', 'gmail_draft', 'gus_create', 'gcal_event'].includes(lang)) {
                      useUIStore.getState().setCanvasContent((prev: any) => {
                          if (!prev) return { id: generateId('art'), title: `Generated ${_generationMode === 'code' ? 'App' : 'Document'}`, type: _generationMode, language: lang || 'html', content: code, isStandalone: false, history: [{ timestamp: Date.now(), content: code }], historyIndex: 0 };
                          return { ...prev, content: code };
                      });
                      useUIStore.getState().setCanvasTab('preview'); lastCanvasSync = now;
                  }
              }
          }
      };

      const effectiveGenerationMode = _generationMode === 'image' ? 'text' : _generationMode;

      const response = await generateTextResponse({
          messages: messagesForLLM,
          modelConfig: _selectedModel,
          profile: _userProfile,
          attachedDocs: userMsg.attachedFiles,
          agent: _primaryAssistant,
          tasks: _tasks,
          mode: effectiveGenerationMode,
          canvasContent: _canvasContent,
          isDeepThinking: _isDeepThinking,
          agentPinnedMessages: _agentPinnedMessagesForPrompt,
          onChunk: handleChunk,
          signal: abortControllerRef.current?.signal,
          appSettings: _appSettings,
          integrations: _integrations,
          models: _models,
          channelContext: _channelContext,
          runIntegrationTools,
      });

      const rawModelText = String(response || currentText || '');
      const visibleModelText = rawModelText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
      let finalResponse = rawModelText.trim()
        ? rawModelText
        : 'I did not receive a text response from the selected model. Try again, or switch to another connected model.';
      if (rawModelText.trim() && !visibleModelText && /<think>/i.test(rawModelText)) {
        const closedThink = rawModelText.includes('</think>') ? rawModelText : `${rawModelText}\n</think>`;
        finalResponse = `${closedThink}\n\nI finished thinking, but the model did not return a visible answer. Try again, or switch to another connected model.`;
      }
      const hasVisibleModelAnswer = Boolean(rawModelText.trim() && (visibleModelText || !/<think>/i.test(rawModelText)));

      useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: (prev[chatId] ?? []).map((m: any) => m.id === botId ? { ...m, content: finalResponse, isStreaming: false } : m) }));

      const appendSupportBubbles = (bubbles: any[]) => {
        if (bubbles.length === 0) return;
        useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({
          ...prev,
          [chatId]: [
            ...(prev[chatId] ?? []),
            ...bubbles.filter((bubble: any) => !(prev[chatId] ?? []).some((m: any) => m.id === bubble.id)),
          ],
        }));
      };

      appendSupportBubbles([...supportBubbles]);

      if (hasVisibleModelAnswer) {
        void (async () => {
          try {
            if (toolUsed === 'Web Search' && foundSources.length > 0) {
              const saved = await autosaveResearchNote({
                chat: _normalizedChat,
                agent: _primaryAssistant,
                question: userMsg.content,
                answer: finalResponse,
                sources: foundSources,
              });
              if (saved) {
                useUIStore.getState().showToast("Research saved to Knowledge Core.");
              }
            } else {
              const saved = await autosaveConversationNote({
                chat: _normalizedChat,
                agent: _primaryAssistant,
                question: userMsg.content,
                answer: finalResponse,
                contributions: contributionNotes,
                attachments: userMsg.attachedFiles ?? [],
              });
              if (saved) {
                if (saved.assessment.notification === 'toast') {
                  useUIStore.getState().showToast(
                    saved.assessment.level === 'explicit' ? "Memory updated." : "Notable memory saved."
                  );
                }
              }
            }
          } catch (e) {
            console.warn('[Memory] Autosave failed without blocking response:', e);
          }
        })();
      }

      if (_generationMode === 'code' || _generationMode === 'doc') {
         const contentWithoutThink = finalResponse.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
         const finalMatch = contentWithoutThink.match(/```([a-zA-Z]*)\n([\s\S]*?)```/);
         if (finalMatch) {
             const lang = (finalMatch[1] || '').toLowerCase();
             const code = finalMatch[2];
             if (!['task', 'todo', 'profile', 'save', 'event', 'slack_post', 'gmail_draft', 'gus_create', 'gcal_event'].includes(lang)) {
                 useUIStore.getState().setCanvasContent((prev: any) => {
                     if (!prev) return prev;
                     const curHist = prev.history || [{ timestamp: Date.now(), content: prev.content }];
                     const curIdx = prev.historyIndex ?? 0;
                     if (curHist[curIdx]?.content !== code) {
                         const newHist = curHist.slice(0, curIdx + 1); newHist.push({ timestamp: Date.now(), content: code });
                         const capped = newHist.slice(-50);
                         return { ...prev, content: code, history: capped, historyIndex: capped.length - 1 };
                     }
                     return prev;
                 });
             }
         }
      }

    } catch (err: any) {
      if (err.name === 'AbortError') { setIsGenerating(false); return; }
      useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), { id: generateId('err'), role: 'bot', content: `### ⚠️ Generation Failed\n${err.message ?? 'An unexpected error occurred.'}`, isPinned: false, timestamp: Date.now() }] }));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendMessage = async () => {
    const { models: _models, selectedModelId: _selectedModelId, appSettings: _appSettings, integrations: _integrations } = useSettingsStore.getState();
    const _selectedModel = _models.find((m: any) => m.id === _selectedModelId) ?? _models[0] ?? null;
    const _input = useUIStore.getState().input;
    const _attachedDocs = useUIStore.getState().attachedDocs;
    const _canvasContent = useUIStore.getState().canvasContent;
    const _generationMode = useUIStore.getState().generationMode;
    const _isPlanMode = useUIStore.getState().isPlanMode;
    const { activeChatId: _activeChatId, messages: _messages, chats: _chats } = useChatStore.getState();
    const { activeFolderId: _activeFolderId, assistants: _assistants } = useAgentStore.getState();
    const _activeAssistantForDirect = _assistants.find((a: any) => a.id === _activeFolderId) ?? _assistants[0];
    if (isGenerating) return;
    if (!_input.trim() && _attachedDocs.length === 0) return;

    if (!_selectedModel) {
      let chatId = _activeChatId;
      if (!chatId) {
        const existingDirect = _chats
          .map((chat: any) => normalizeChatRecord(chat, _activeFolderId))
          .find((chat: any) => chat.kind === 'dm' && (chat.primaryAgentId === _activeFolderId || chat.folderId === _activeFolderId));
        if (existingDirect) {
          chatId = existingDirect.id;
          useChatStore.getState().setActiveChatId(chatId);
        }
      }
      if (!chatId) {
        chatId = generateId('c');
        useChatStore.getState().setChats((prev: any[]) => [normalizeChatRecord({
          id: chatId,
          folderId: _activeFolderId,
          primaryAgentId: _activeFolderId,
          participantAgentIds: [_activeFolderId],
          kind: 'dm',
          name: `${_activeAssistantForDirect?.name ?? 'Agent'} Direct`,
          goal: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }, _activeFolderId), ...prev]);
        useChatStore.getState().setActiveChatId(chatId);
      }
      const userMsg = { id: generateId('msg'), role: 'user', content: _input, attachedFiles: [..._attachedDocs], isPinned: false, timestamp: Date.now() };
      const setupMsg = {
        id: generateId('msg'),
        role: 'bot',
        content: `I need you to connect me to an LLM before I can answer with real intelligence.\n\nOpen **Settings > Models** and connect LM Studio for local chat, or add a cloud model. Once a model is connected, I get my powers and this Direct keeps going.`,
        agentId: _activeAssistantForDirect?.id,
        agentName: _activeAssistantForDirect?.name,
        isPinned: false,
        timestamp: Date.now() + 1,
      };
      useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId!]: [...(prev[chatId!] ?? []), userMsg, setupMsg] }));
      useChatStore.getState().setChats((prev: any[]) => prev.map((c: any) => c.id === chatId ? { ...c, updatedAt: Date.now() } : c));
      useUIStore.getState().setInput('');
      useUIStore.getState().setAttachedDocs([]);
      useSettingsStore.getState().setProfileSettingsTab('models');
      useSettingsStore.getState().setShowProfileSettings(true);
      useUIStore.getState().showToast('Connect an LLM to give Lexi a brain.', {
        label: 'Models',
        onClick: () => {
          useSettingsStore.getState().setProfileSettingsTab('models');
          useSettingsStore.getState().setShowProfileSettings(true);
        },
      });
      return;
    }

    if (_canvasContent && (_generationMode === 'code' || _generationMode === 'doc')) {
      useUIStore.getState().setCanvasContent((prev: any) => {
          if (!prev) return prev;
          const curHist = prev.history || [{ timestamp: Date.now(), content: prev.content }];
          const curIdx = prev.historyIndex ?? 0;
          if (curHist[curIdx]?.content !== prev.content) {
              const newHist = curHist.slice(0, curIdx + 1);
              newHist.push({ timestamp: Date.now(), content: prev.content });
              const capped = newHist.slice(-50);
              return { ...prev, history: capped, historyIndex: capped.length - 1 };
          }
          return prev;
      });
    }

    abortControllerRef.current?.abort(); abortControllerRef.current = new AbortController();
    let chatId = _activeChatId;
    if (!chatId) {
      const existingDirect = _chats
        .map((chat: any) => normalizeChatRecord(chat, _activeFolderId))
        .find((chat: any) => chat.kind === 'dm' && (chat.primaryAgentId === _activeFolderId || chat.folderId === _activeFolderId));
      if (existingDirect) {
        chatId = existingDirect.id;
        useChatStore.getState().setActiveChatId(chatId);
      }
    }
    if (!chatId) {
      chatId = generateId('c');
      useChatStore.getState().setChats((prev: any[]) => [normalizeChatRecord({
        id: chatId,
        folderId: _activeFolderId,
        primaryAgentId: _activeFolderId,
        participantAgentIds: [_activeFolderId],
        kind: 'dm',
        name: `${_activeAssistantForDirect?.name ?? 'Agent'} Direct`,
        goal: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, _activeFolderId), ...prev]);
      useChatStore.getState().setActiveChatId(chatId);
    }
    const userMsg = { id: generateId('msg'), role: 'user', content: _input, attachedFiles: [..._attachedDocs], isPinned: false, timestamp: Date.now() };
    if(chatId) {
        useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), userMsg] }));
        useChatStore.getState().setChats((prev: any[]) => prev.map((c: any) => c.id === chatId ? { ...c, updatedAt: Date.now() } : c));

        const currentHistory = (_messages[chatId] ?? []).filter((m: any) => !m.bubbleType && !m.isToolCall);
        useUIStore.getState().setInput('');
        useUIStore.getState().setAttachedDocs([]);

        let msgForProcessing = userMsg;
        if (_isPlanMode) {
          msgForProcessing = { ...userMsg, content: `[PLANNING MODE — Respond with a detailed structured plan, broken into clear phases/steps with headings]\n\n${userMsg.content}` };
          useUIStore.getState().setIsPlanMode(false);
        }

        await processChatRequest(chatId, msgForProcessing, currentHistory);
    }
  };
  
  const confirmEditMessage = async (msgId: string) => {
     const { editingMessageContent: _emc, activeChatId: _activeChatId, messages: _messages } = useChatStore.getState();
     if (!_emc.trim() || !_activeChatId) return;
     const chatMsgs = _messages[_activeChatId];
     const msgIdx = chatMsgs.findIndex((m: any) => m.id === msgId);
     if (msgIdx === -1) return;

     const targetMsg = chatMsgs[msgIdx];
     const historyToKeep = chatMsgs.slice(0, msgIdx).filter((m: any) => !m.bubbleType && !m.isToolCall);
     const newMsg = { ...targetMsg, id: generateId('msg'), content: _emc, timestamp: Date.now() };

     useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({...prev, [_activeChatId]: [...historyToKeep, newMsg]}));
     useChatStore.getState().setEditingMessageId(null);

     abortControllerRef.current?.abort(); abortControllerRef.current = new AbortController();
     await processChatRequest(_activeChatId, newMsg, historyToKeep);
  };

  const handleStop = () => { abortControllerRef.current?.abort(); };

  const handleCodeScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  const renderMessageWithWidgets = useCallback((msg: any) => {
    const { content: rawText, isStreaming, isToolCall, attachedFiles, sources } = msg;
    if (isToolCall) return <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-neutral-500 animate-pulse"><Workflow className="w-3.5 h-3.5" /> {rawText}</div>;
    if (isStreaming && !rawText) return <TypingIndicator />;
    
    const elements = [];
    if (attachedFiles?.length > 0) elements.push(<div key="files" className="flex flex-wrap gap-2 mb-3">{attachedFiles.map((f: any, i: number) => f.isImage ? <img key={i} src={f.content} alt={f.name} className="h-32 object-cover rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-700" /> : <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-white/20 rounded-xl border border-white/30 text-[10px] font-bold text-white shadow-sm"><FileText className="w-3.5 h-3.5" />{f.name}</div>)}</div>);
    if (typeof rawText !== 'string') return elements;
    const openFileInPanel = (path?: string) => { useMemoryStore.getState().setShowMemmoPanel(true); useMemoryStore.getState().setMemmoPanelTab(path?.includes('/library/') ? 'library' : path ? 'notes' : 'pins'); };
    if (rawText.startsWith('### ⚠️')) return <div className="text-[#C98A8A] font-medium"><FormattedText text={rawText} sources={sources} onViewImage={viewImageInCanvas} onOpenFile={openFileInPanel} /></div>;

    if (msg.bubbleType) {
      return (
        <CollapsibleBubble
          title={msg.bubbleTitle ?? msg.agentName ?? 'Agent work'}
          subtitle={msg.bubbleSubtitle}
          type={msg.bubbleType}
          defaultOpen={false}
        >
          <FormattedText text={rawText} sources={sources} onSaveImage={saveImageToLibrary} onViewImage={viewImageInCanvas} onOpenFile={openFileInPanel} />
          {sources && sources.length > 0 && <SourcesTray sources={sources} onOpenFile={openFileInPanel} />}
        </CollapsibleBubble>
      );
    }

    // --- Deep Thinking Parser ---
    let displayContent = rawText;
    let thinkingContent = null;
    let isThinkingActive = false;
    const thinkMatch = rawText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
    if (thinkMatch) {
       thinkingContent = thinkMatch[1].trim();
       displayContent = rawText.replace(/<think>[\s\S]*?(?:<\/think>|$)/i, '').trim();
       isThinkingActive = isStreaming && !rawText.includes('</think>');
    }

    if (thinkingContent) {
      elements.push(
        <ThoughtProcess key={`think-${msg.id}`} content={thinkingContent} isStreaming={isThinkingActive} />
      );
    }

    const regex = /```(\w+)?\n([\s\S]*?)```/g;
    let lastIndex = 0, match;
    while ((match = regex.exec(displayContent)) !== null) {
      if (match.index > lastIndex) elements.push(<FormattedText key={`t-${match.index}`} text={displayContent.slice(lastIndex, match.index)} sources={sources} onSaveImage={saveImageToLibrary} onViewImage={viewImageInCanvas} onOpenFile={openFileInPanel} />);
      const lang = (match[1] ?? 'text').toLowerCase(), code = match[2].trim();
      
      if (lang === 'task' || lang === 'todo') {
        try {
          const td = JSON.parse(code);
          elements.push(
            <div key={`task-${match.index}`} className="my-3 p-4 rounded-xl border-2 border-[#D6E0EA] dark:border-[#2C3E50]/50 bg-[#F0F4F8] dark:bg-[#4A5D75]/20 flex flex-col gap-3 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3"><div className="p-2 bg-[#4A5D75] rounded-lg shrink-0"><ListTodo className="w-5 h-5 text-white" /></div><div className="flex flex-col"><span className="text-xs font-black text-[#1E2B38] dark:text-[#D6E0EA] uppercase tracking-widest">Proposed Action</span><span className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{td.title}</span><div className="flex items-center gap-3 mt-1 flex-wrap">{td.dueDate && <span className="text-[10px] text-neutral-600 dark:text-[#899AB5] flex items-center gap-1 font-bold"><Clock className="w-3 h-3 text-[#6A829E]" /> Due: {td.dueDate}</span>}{td.location && <span className="text-[10px] text-neutral-600 dark:text-[#899AB5] flex items-center gap-1 font-bold"><MapPin className="w-3 h-3 text-[#9FBBAF]" /> {td.location}</span>}</div></div></div>
                <button onClick={() => { addTask(td.title, td.dueDate, td.details, td.location); useTaskStore.getState().setShowPlanner(true); }} className="px-3 py-2 bg-[#4A5D75] text-white rounded-lg text-xs font-bold hover:bg-[#3D4D61] shadow-md transition-all active:scale-95 shrink-0">Add to Planner</button>
              </div>
              {td.details && <div className="text-xs bg-white dark:bg-[#1E2B38] p-2 rounded-lg border border-[#D6E0EA] dark:border-[#4A5D75]/50 text-neutral-600 dark:text-[#C5D3E0]"><span className="font-bold flex items-center gap-1 mb-1"><AlignLeft className="w-3 h-3" /> Details</span>{td.details}</div>}
            </div>
          );
        } catch { elements.push(<div key={`err-${match.index}`} className="p-2 text-xs text-[#C98A8A]">Failed to parse task.</div>); }
      } else if (lang === 'profile') {
        try {
          const pData = JSON.parse(code);
          const _currentProfile = useSettingsStore.getState().userProfile;
          const isApproved = _currentProfile.includes(pData.fact);
          elements.push(
             <div key={`prof-${match.index}`} className="my-3 p-4 rounded-xl border border-[#9EADC8] dark:border-[#6A829E]/50 bg-[#F0F4F8] dark:bg-[#1E2B38]/30 flex flex-col gap-2">
               <div className="flex items-center gap-2 text-[#4A5D75] dark:text-[#9EADC8] font-bold text-xs uppercase tracking-widest"><UserPlus className="w-4 h-4"/> Profile Knowledge Update</div>
               <p className="text-sm text-neutral-700 dark:text-neutral-300">"{pData.fact}"</p>
               <button disabled={isApproved} onClick={() => useSettingsStore.getState().setUserProfile(useSettingsStore.getState().userProfile + (useSettingsStore.getState().userProfile ? '\n' : '') + pData.fact)} className={`mt-2 py-2 rounded-lg text-xs font-bold transition-all ${isApproved ? 'bg-[#9FBBAF] text-white opacity-50 cursor-default' : 'bg-[#6A829E] hover:bg-[#4A5D75] text-white active:scale-95'}`}>
                 {isApproved ? 'Saved to Profile' : 'Approve & Save'}
               </button>
             </div>
          );
        } catch { elements.push(<div key={`err-p-${match.index}`} className="p-2 text-xs text-[#C98A8A]">Failed to parse profile update.</div>); }
      } else if (lang === 'save') {
        try {
          const sd = JSON.parse(code);
          const saveTitle = sd.title || 'Saved Note';
          const saveContent = sd.content || code;
          elements.push(
            <div key={`save-${match.index}`} className="my-3 p-4 rounded-xl border border-[#D4AA7D]/50 dark:border-[#D4AA7D]/30 bg-[#FFF9F2] dark:bg-[#5C452E]/10 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[#9C7A3C] dark:text-[#D4AA7D] font-bold text-xs uppercase tracking-widest"><Bookmark className="w-4 h-4" /> Save to Library</div>
              <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200">"{saveTitle}"</p>
              <button onClick={async () => {
                const { agentForgePath: _afp } = useMemoryStore.getState();
                if (!_afp) { showToast('Knowledge Core not ready.'); return; }
                const slug = saveTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) + '_' + Date.now();
                try {
                  await invoke('write_memory', {
                    path: `${_afp}/library/${slug}.md`,
                    content: `# ${saveTitle}\n\nSaved by Agent · ${new Date().toLocaleDateString()}\n\n---\n\n${saveContent}`,
                    commitMessage: `library: ${saveTitle}`,
                    agentId: activeAssistant?.id ?? null,
                    contextTokens: null,
                    ramState: null,
                  });
                  showToast('🔖 Saved to Library');
                } catch (e: any) { showToast(`Save failed: ${e?.message ?? e}`); }
              }} className="mt-1 py-2 rounded-lg text-xs font-bold bg-[#D4AA7D] hover:bg-[#c09060] text-white active:scale-95 transition-all">
                Save to Library
              </button>
            </div>
          );
        } catch { elements.push(<div key={`err-save-${match.index}`} className="p-2 text-xs text-[#C98A8A]">Failed to parse save block.</div>); }
      } else if (lang === 'event') {
        try {
          const ev = JSON.parse(code);
          const isRecurring = ev.type !== 'date';
          const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const displayDate = isRecurring
            ? `${MONTH_NAMES[(ev.month ?? 1) - 1]} ${ev.day}${ev.year ? `, ${ev.year}` : ''}`
            : ev.dueDate;
          const typeEmoji: Record<string, string> = { birthday: '🎂', anniversary: '💍', custom: '📅', date: '📅' };
          const typeLabel: Record<string, string> = { birthday: 'Birthday', anniversary: 'Anniversary', custom: 'Event', date: 'Appointment' };
          elements.push(
            <div key={`ev-${match.index}`} className="my-3 p-4 rounded-xl border-2 border-[#D6E0EA] dark:border-[#2C3E50]/50 bg-[#F0F4F8] dark:bg-[#4A5D75]/20 flex flex-col gap-3 shadow-sm">
              <div className="flex items-center gap-2 text-[#4A5D75] dark:text-[#9EADC8] font-bold text-xs uppercase tracking-widest"><CalendarDays className="w-4 h-4" /> Add to Calendar</div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-neutral-800 dark:text-neutral-100">{isRecurring ? ev.name : ev.title}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{typeEmoji[ev.type] ?? '📅'} {typeLabel[ev.type] ?? 'Event'} · {displayDate}</p>
                </div>
                <button onClick={() => {
                  if (isRecurring) {
                    useTaskStore.getState().addRecurringEvent({ type: ev.type, name: ev.name, month: ev.month, day: ev.day, year: ev.year });
                  } else {
                    addTask(ev.title, ev.dueDate, ev.details ?? '');
                  }
                  useTaskStore.getState().setShowPlanner(true);
                }} className="px-3 py-2 bg-[#4A5D75] text-white rounded-lg text-xs font-bold hover:bg-[#3D4D61] shadow-md transition-all active:scale-95 shrink-0">Add Event</button>
              </div>
            </div>
          );
        } catch { elements.push(<div key={`err-ev-${match.index}`} className="p-2 text-xs text-[#C98A8A]">Failed to parse event block.</div>); }
      } else if (lang === 'slack_post') {
        try {
          const sd = JSON.parse(code);
          elements.push(
            <div key={`slack-${match.index}`} className="my-3 p-4 rounded-xl border-2 border-[#6A829E]/30 dark:border-[#6A829E]/20 bg-[#F0F4F8] dark:bg-[#1E2B38]/30 flex flex-col gap-3 shadow-sm">
              <div className="flex items-center gap-2 text-[#4A5D75] dark:text-[#9EADC8] font-bold text-xs uppercase tracking-widest"><MessageSquare className="w-4 h-4" /> Post to Slack</div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Channel</span>
                <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200">#{sd.channel}</span>
              </div>
              <div className="text-xs bg-white dark:bg-neutral-900 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">{sd.text}</div>
              <button onClick={async () => {
                const _integrations = useSettingsStore.getState().integrations;
                const token = _integrations.slack?.botToken;
                if (!_integrations.slack?.enabled || !token) { showToast('Slack is not configured.'); return; }
                try {
                  const res = await fetchWithRetry('https://slack.com/api/chat.postMessage', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel: sd.channel, text: sd.text }),
                  }, 1);
                  showToast(res.ok ? 'Posted to Slack.' : `Slack error: ${res.error ?? 'post failed'}`);
                } catch (e: any) { showToast(`Slack error: ${e.message}`); }
              }} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-[#4A5D75] hover:bg-[#3D4D61] text-white active:scale-95 transition-all">
                <Send className="w-3.5 h-3.5" /> Post Message
              </button>
            </div>
          );
        } catch { elements.push(<div key={`err-sl-${match.index}`} className="p-2 text-xs text-[#C98A8A]">Failed to parse Slack post.</div>); }
      } else if (lang === 'gmail_draft') {
        try {
          const gd = JSON.parse(code);
          elements.push(
            <div key={`gmail-${match.index}`} className="my-3 p-4 rounded-xl border-2 border-[#C98A8A]/30 dark:border-[#C98A8A]/20 bg-[#FFF8F8] dark:bg-[#3E2929]/20 flex flex-col gap-3 shadow-sm">
              <div className="flex items-center gap-2 text-[#C98A8A] font-bold text-xs uppercase tracking-widest"><Mail className="w-4 h-4" /> Send Gmail</div>
              <div className="grid grid-cols-1 gap-1.5 text-xs">
                <div><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px]">To</span> <span className="text-neutral-800 dark:text-neutral-200 font-bold ml-1">{gd.to}</span></div>
                {gd.cc && <div><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px]">CC</span> <span className="text-neutral-800 dark:text-neutral-200 font-bold ml-1">{gd.cc}</span></div>}
                <div><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px]">Subject</span> <span className="text-neutral-800 dark:text-neutral-200 font-bold ml-1">{gd.subject}</span></div>
                {gd.accountLabel && <div><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px]">Account</span> <span className="text-neutral-800 dark:text-neutral-200 font-bold ml-1">{gd.accountLabel}</span></div>}
              </div>
              <div className="text-xs bg-white dark:bg-neutral-900 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">{gd.body}</div>
              <button onClick={async () => {
                const _integrations = useSettingsStore.getState().integrations;
                const account = getGoogleActionAccount(_integrations, 'gmail', gd.accountLabel);
                if (!account) { showToast('No Gmail account is configured.'); return; }
                try {
                  const accessToken = await refreshGoogleAccessToken(account.clientId, account.clientSecret, account.refreshToken);
                  const raw = [`To: ${gd.to}`, gd.cc ? `Cc: ${gd.cc}` : null, `Subject: ${gd.subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', gd.body].filter(Boolean).join('\r\n');
                  const res = await fetchWithRetry('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ raw: base64UrlEncode(raw) }),
                  }, 1);
                  showToast(res.id ? 'Email sent.' : 'Gmail send failed.');
                } catch (e: any) { showToast(`Gmail error: ${e.message}`); }
              }} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-[#C98A8A] hover:bg-[#b57070] text-white active:scale-95 transition-all">
                <Send className="w-3.5 h-3.5" /> Send Email
              </button>
            </div>
          );
        } catch { elements.push(<div key={`err-gm-${match.index}`} className="p-2 text-xs text-[#C98A8A]">Failed to parse Gmail draft.</div>); }
      } else if (lang === 'gus_create') {
        try {
          const gc = JSON.parse(code);
          elements.push(
            <div key={`gus-${match.index}`} className="my-3 p-4 rounded-xl border-2 border-[#6A829E]/30 dark:border-[#6A829E]/20 bg-[#F0F4F8] dark:bg-[#1E2B38]/30 flex flex-col gap-3 shadow-sm">
              <div className="flex items-center gap-2 text-[#4A5D75] dark:text-[#9EADC8] font-bold text-xs uppercase tracking-widest"><Layers className="w-4 h-4" /> Create GUS Work Item</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px] block">Subject</span><span className="text-neutral-800 dark:text-neutral-200 font-bold">{gc.subject}</span></div>
                <div><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px] block">Type</span><span className="text-neutral-800 dark:text-neutral-200 font-bold">{gc.type ?? 'Story'}</span></div>
                {gc.priority && <div><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px] block">Priority</span><span className="text-neutral-800 dark:text-neutral-200 font-bold">{gc.priority}</span></div>}
                {gc.assignee && <div><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px] block">Assignee</span><span className="text-neutral-800 dark:text-neutral-200 font-bold">{gc.assignee}</span></div>}
              </div>
              {gc.details && <div className="text-xs bg-white dark:bg-neutral-900 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">{gc.details}</div>}
              <button onClick={async () => {
                const _integrations = useSettingsStore.getState().integrations;
                const { instanceUrl, accessToken, enabled } = _integrations.gus ?? {};
                if (!enabled || !instanceUrl || !accessToken) { showToast('GUS is not configured.'); return; }
                try {
                  const body: any = { Subject__c: gc.subject, Type__c: gc.type ?? 'Story' };
                  if (gc.priority) body.Priority__c = gc.priority;
                  if (gc.details) body.Details__c = gc.details;
                  const res = await fetchWithRetry(`${instanceUrl.replace(/\/$/, '')}/services/data/v59.0/sobjects/ADM_Work__c`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                  }, 1);
                  showToast(res.id ? `Created GUS item ${res.id}.` : 'GUS create failed.');
                } catch (e: any) { showToast(`GUS error: ${e.message}`); }
              }} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-[#4A5D75] hover:bg-[#3D4D61] text-white active:scale-95 transition-all">
                <CheckCircle2 className="w-3.5 h-3.5" /> Create Work Item
              </button>
            </div>
          );
        } catch { elements.push(<div key={`err-gus-${match.index}`} className="p-2 text-xs text-[#C98A8A]">Failed to parse GUS work item.</div>); }
      } else if (lang === 'gcal_event') {
        try {
          const ge = JSON.parse(code);
          elements.push(
            <div key={`gcal-${match.index}`} className="my-3 p-4 rounded-xl border-2 border-[#6A829E]/30 dark:border-[#6A829E]/20 bg-[#F0F4F8] dark:bg-[#1E2B38]/30 flex flex-col gap-3 shadow-sm">
              <div className="flex items-center gap-2 text-[#4A5D75] dark:text-[#9EADC8] font-bold text-xs uppercase tracking-widest"><CalendarClock className="w-4 h-4" /> Create Google Calendar Event</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="col-span-2"><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px] block">Title</span><span className="text-neutral-800 dark:text-neutral-200 font-bold">{ge.title}</span></div>
                <div><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px] block">Start</span><span className="text-neutral-800 dark:text-neutral-200 font-bold">{ge.start}</span></div>
                <div><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px] block">End</span><span className="text-neutral-800 dark:text-neutral-200 font-bold">{ge.end}</span></div>
                {ge.location && <div className="col-span-2"><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px] block">Location</span><span className="text-neutral-800 dark:text-neutral-200 font-bold">{ge.location}</span></div>}
                {ge.accountLabel && <div className="col-span-2"><span className="font-black text-neutral-500 uppercase tracking-widest text-[10px] block">Account</span><span className="text-neutral-800 dark:text-neutral-200 font-bold">{ge.accountLabel}</span></div>}
              </div>
              {ge.description && <div className="text-xs bg-white dark:bg-neutral-900 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">{ge.description}</div>}
              <button onClick={async () => {
                const _integrations = useSettingsStore.getState().integrations;
                const account = getGoogleActionAccount(_integrations, 'calendar', ge.accountLabel);
                if (!account) { showToast('No Google Calendar account is configured.'); return; }
                try {
                  const accessToken = await refreshGoogleAccessToken(account.clientId, account.clientSecret, account.refreshToken);
                  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                  const event: any = { summary: ge.title, start: { dateTime: ge.start, timeZone }, end: { dateTime: ge.end, timeZone } };
                  if (ge.description) event.description = ge.description;
                  if (ge.location) event.location = ge.location;
                  const res = await fetchWithRetry('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(event),
                  }, 1);
                  showToast(res.id ? 'Event created in Google Calendar.' : 'Calendar create failed.');
                } catch (e: any) { showToast(`Calendar error: ${e.message}`); }
              }} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-[#4A5D75] hover:bg-[#3D4D61] text-white active:scale-95 transition-all">
                <CalendarClock className="w-3.5 h-3.5" /> Create Event
              </button>
            </div>
          );
        } catch { elements.push(<div key={`err-gcal-${match.index}`} className="p-2 text-xs text-[#C98A8A]">Failed to parse calendar event.</div>); }
      } else if (code.length > 5 && !['task', 'todo', 'profile', 'save', 'event', 'slack_post', 'gmail_draft', 'gus_create', 'gcal_event'].includes(lang)) {
        const codePreview = code.split('\n').slice(0, 4).join('\n') + (code.split('\n').length > 4 ? '\n...' : '');
        elements.push(
          <div key={`art-${match.index}`} className="my-4 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 overflow-hidden flex flex-col group/art shadow-sm transition-all hover:border-[#899AB5]">
            <div className="flex items-center justify-between p-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800/50">
              <div className="flex items-center gap-2"><Code className="w-4 h-4 text-[#6A829E]" /><span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{(lang || 'CODE').toUpperCase()} Snippet</span></div>
              <button onClick={() => { useUIStore.getState().setCanvasContent({ id: generateId('art'), language: lang, content: code, title: 'Extracted Artifact', type: 'code', isStandalone: false, history: [{ timestamp: Date.now(), content: code }], historyIndex: 0 }); useUIStore.getState().setGenerationMode('code'); useUIStore.getState().setCanvasTab('code'); useTaskStore.getState().setShowPlanner(false); }} className="px-3 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-[10px] font-black uppercase tracking-widest text-[#4A5D75] hover:bg-[#F0F4F8] transition-all shadow-sm">Open in Canvas</button>
            </div>
            <div className="p-4 bg-neutral-900 text-neutral-300 text-xs font-mono overflow-hidden"><pre><code>{codePreview}</code></pre></div>
          </div>
        );
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < displayContent.length) elements.push(<FormattedText key="t-end" text={displayContent.slice(lastIndex)} sources={sources} onSaveImage={saveImageToLibrary} onViewImage={viewImageInCanvas} onOpenFile={openFileInPanel} />);
    
    // --- Render Sources Shelf ---
    if (sources && sources.length > 0 && msg.role === 'bot') {
       elements.push(<SourcesTray key={`sources-${msg.id}`} sources={sources} onOpenFile={openFileInPanel} />);
    }

    return elements;
  }, [addTask, saveImageToLibrary, viewImageInCanvas]);

  const errorLogsCount = useMemo(() => logs.filter(l => l.level === 'error').length, [logs]);
  const hasErrorLogs = errorLogsCount > 0;

  if (!isDbLoaded) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-white font-sans animate-in fade-in duration-500">
        <div className="p-4 bg-[#4A5D75] rounded-2xl shadow-2xl mb-6 shadow-[#6A829E]/20"><Bot className="w-8 h-8 text-white animate-pulse" /></div>
        <h1 className="text-2xl font-black uppercase tracking-tighter mb-2">Agent Forge</h1>
        <div className="flex items-center gap-2 text-neutral-500 font-bold text-xs uppercase tracking-widest"><Loader2 className="w-4 h-4 animate-spin" /> Secure Storage Linking...</div>
      </div>
    );
  }

  // ── Slash command handler ──────────────────────────────────────────────────
  function handleSlashCommand(cmd: SlashCommand) {
    const ui = useUIStore.getState();
    const mem = useMemoryStore.getState();
    const { activeChatId: _activeChatId } = useChatStore.getState();
    switch (cmd.cmd) {
      case 'think':
        ui.setIsDeepThinking(true);
        ui.setInput('');
        break;
      case 'search':
        ui.setForcedTool('search');
        ui.setInput('');
        break;
      case 'knowledge':
        ui.setForcedTool('workspace');
        ui.setInput('');
        break;
      case 'plan':
        ui.setIsPlanMode(true);
        ui.setInput('');
        break;
      case 'memo':
        mem.setShowMemoCompose(true);
        ui.setInput('');
        break;
      case 'clear':
        if (_activeChatId) useChatStore.getState().setMessages((prev: any) => ({ ...prev, [_activeChatId]: [] }));
        ui.setInput('');
        break;
    }
    ui.setSlashHighlight(0);
  }

  return (
    <div className="flex h-screen overflow-hidden w-full font-sans transition-colors duration-300 bg-transparent text-neutral-900 dark:text-neutral-100">

      {nukeShieldPending && (
        <NukeShieldModal
          path={nukeShieldPending.path}
          deletions={nukeShieldPending.deletions}
          existingLines={nukeShieldPending.existingLines}
          diffStat={nukeShieldPending.diffStat}
          onApprove={() => setNukeShieldPending(null)}
          onRollback={() => {
            invoke('rollback_file', { path: nukeShieldPending.path }).catch(() => {});
            setNukeShieldPending(null);
          }}
        />
      )}

      {showDreamBanner && dreamLog && (
        <MorningBriefingBanner
          log={dreamLog}
          onViewDigest={() => { useMemoryStore.getState().setShowDreamDigest(true); dismissDreamBanner(); }}
          onDismiss={dismissDreamBanner}
        />
      )}

      {showDreamDigest && dreamLog && (
        <DreamDigestModal
          log={dreamLog}
          onClose={() => useMemoryStore.getState().setShowDreamDigest(false)}
          onUndo={undoDreamItem}
        />
      )}

      <MemmoPanel
        isOpen={showMemmoPanel}
        onClose={() => useMemoryStore.getState().setShowMemmoPanel(false)}
        pinnedMessages={activeAgentPinnedMessageObjects}
        agentId={activeAssistant?.id ?? 'default'}
        onUnpin={async (chatId, msgId) => {
          await useMemoryStore.getState().saveGlobalPins(useMemoryStore.getState().globalPins.filter((p: any) => p.msgId !== msgId));
          useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({
            ...prev,
            [chatId]: (prev[chatId] ?? []).map((m: any) =>
              m.id === msgId ? { ...m, isPinned: false } : m
            ),
          }));
        }}
        onCompose={() => { useMemoryStore.getState().setShowMemmoPanel(false); useMemoryStore.getState().setShowMemoCompose(true); }}
        agentForgePath={agentForgePath}
        onToast={showToast}
        initialTab={memmoPanelTab}
        pinnedTokenEstimate={Math.round(agentPinnedMessagesForPrompt.join('').length / 4)}
        onDeleteFile={async (path) => {
          const result = await invoke<{ ok: boolean; error?: string }>('delete_memory_file', { path });
          if (!result.ok) {
            showToast(`Delete failed: ${result.error}`);
            throw new Error(result.error);
          }
        }}
        onRestoreArchive={async (archivePath) => {
          const result = await invoke<{ ok: boolean; error?: string }>('restore_archived_file', {
            archive_path: archivePath,
            original_path: '',
          });
          if (!result.ok) throw new Error(result.error ?? 'Restore failed');
        }}
      />

      {showMemoCompose && (
        <MemoComposeModal
          agentForgePath={agentForgePath}
          agentId={activeAssistant?.id ?? 'default'}
          onSave={({ commitHash, category }) => {
            useMemoryStore.getState().setShowMemoCompose(false);
            showToast(`Memmo saved to ${category}.`, {
              label: 'Undo',
              onClick: () => {
                if (commitHash) invoke('revert_memory_commit', { commitHash }).catch(() => {});
              },
            });
          }}
          onClose={() => useMemoryStore.getState().setShowMemoCompose(false)}
        />
      )}

      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[300] bg-[#2C3E50] text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300 font-bold text-xs uppercase tracking-widest">
           <AlertTriangle className="w-4 h-4 text-[#D4AA7D]" />
           {toastMessage}
           {toastAction && (
             <button
               onClick={() => { toastAction.onClick(); useUIStore.getState().clearToast(); }}
               className="ml-1 underline underline-offset-2 text-[#D4AA7D] hover:text-white transition-colors"
             >
               {toastAction.label}
             </button>
           )}
        </div>
      )}

      {showConsole && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-neutral-900 w-full max-w-2xl h-[60vh] rounded-2xl flex flex-col shadow-2xl border border-neutral-700 font-mono text-xs overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-neutral-800 bg-neutral-950 shrink-0"><span className="text-neutral-400 font-bold flex items-center gap-2"><Activity className="w-4 h-4"/> App Console Log</span><div className="flex gap-4"><button onClick={() => useUIStore.getState().clearLogs()} className="text-neutral-500 hover:text-white font-bold tracking-widest uppercase">Clear</button><button onClick={() => useUIStore.getState().setShowConsole(false)} className="text-neutral-500 hover:text-white"><X className="w-4 h-4"/></button></div></div>
            <div className="flex-1 overflow-auto p-4 space-y-2 custom-scrollbar select-text">{logs.length === 0 ? <span className="text-neutral-600 italic">No logs yet...</span> : logs.map((l, i) => (<div key={i} className={`flex gap-3 ${l.level === 'error' ? 'text-[#C98A8A]' : l.level === 'warn' ? 'text-[#D4AA7D]' : 'text-neutral-300'}`}><span className="text-neutral-600 shrink-0 select-none">[{l.time}]</span><span className="break-all whitespace-pre-wrap">{l.msg}</span></div>))}</div>
          </div>
        </div>
      )}

      {/* ── Sidebar ── */}
      <AppSidebar
        onDeleteSavedApp={deleteSavedApp}
        onCreateBlankArtifact={createBlankArtifact}
      />

      {/* ── Main Panel ── */}
      <div className="flex-1 flex flex-row overflow-hidden relative">
        {!canvasContent?.isStandalone && (
          <div className={`flex flex-col h-full bg-white dark:bg-neutral-900 transition-all duration-300 flex-shrink-0 relative ${canvasContent ? 'w-1/2 border-r border-neutral-200 dark:border-neutral-800' : 'w-full'}`}>
            
            {/* Header */}
            <ChatHeader
              dropdownRef={dropdownRef}
              llamaPaused={llamaPaused}
              llamaCoolingDown={llamaCoolingDown}
              activeMessages={activeMessages}
              systemPromptLen={systemPromptLen}
              hasErrorLogs={hasErrorLogs}
              errorLogsCount={errorLogsCount}
              onRunDreamCycle={runDreamCycle}
              onToast={showToast}
            />

            {/* Views */}
            {showPlanner ? (
              <PlannerPanel
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              />
            ) : (
              <div
                className={`flex-1 flex flex-col relative overflow-hidden transition-colors ${isDragging ? 'bg-[#9EADC8]/10' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {/* ── First-time agent intro card ── */}
                {showAgentIntro && (
                  <div className="absolute top-4 right-4 z-50 w-80 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-xl p-4 animate-in slide-in-from-top-4 duration-300">
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-black text-neutral-800 dark:text-neutral-200">Take your agents with you</p>
                      <button onClick={() => { setShowAgentIntro(false); db.set('agentIntroSeen', true); }}
                        className="text-neutral-400 hover:text-neutral-600 ml-2 shrink-0"><X className="w-4 h-4"/></button>
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3 leading-relaxed">
                      Press <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded text-[10px] font-bold text-neutral-700 dark:text-neutral-300">⌘⇧F</kbd> from any Chrome or Safari tab to open your agent with that page's context automatically attached.
                    </p>
                    <div className="space-y-2 text-xs text-neutral-500 dark:text-neutral-400 border-t border-neutral-100 dark:border-neutral-800 pt-3">
                      <div>
                        <span className="font-bold text-neutral-700 dark:text-neutral-300">Chrome:</span>
                        {' '}View → Developer → <span className="font-semibold text-neutral-800 dark:text-neutral-200">Allow JavaScript from Apple Events</span>
                      </div>
                      <div className="space-y-0.5">
                        <div><span className="font-bold text-neutral-700 dark:text-neutral-300">Safari step 1:</span>{' '}Settings → Advanced → <span className="font-semibold text-neutral-800 dark:text-neutral-200">Show features for web developers</span></div>
                        <div><span className="font-bold text-neutral-700 dark:text-neutral-300">Safari step 2:</span>{' '}Develop → <span className="font-semibold text-neutral-800 dark:text-neutral-200">Allow Remote Automation</span></div>
                      </div>
                    </div>
                    <button onClick={() => { setShowAgentIntro(false); db.set('agentIntroSeen', true); }}
                      className="mt-3 w-full py-2 bg-[#4A5D75] hover:bg-[#3D4D61] text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all">
                      Got it
                    </button>
                  </div>
                )}

                <MessageList
                  activeMessages={activeMessages}
                  isGenerating={isGenerating}
                  activeAssistant={activeAssistant}
                  onConfirmEdit={confirmEditMessage}
                  onBookmark={handleBookmark}
                  onToggleSpeak={toggleSpeak}
                  onAddTask={addTask}
                  messagesEndRef={messagesEndRef}
                  onRenderMessage={renderMessageWithWidgets}
                  onToast={showToast}
                />

                {/* Input Bar */}
                <ChatInputBar
                  isGenerating={isGenerating}
                  isEnhancing={isEnhancing}
                  selectedModel={selectedModel}
                  modelDropdownRef={modelDropdownRef}
                  onSend={handleSendMessage}
                  onStop={handleStop}
                  onChatFileUpload={handleChatFileUpload}
                  onEnhancePrompt={handleEnhancePrompt}
                  fileInputRef={fileInputRef}
                  activeAssistant={activeAssistant}
                  llamaServerPid={llamaServerPid}
                  llamaPaused={llamaPaused}
                  setLlamaPaused={setLlamaPaused}
                  llamaCoolingDown={llamaCoolingDown}
                  isListening={isListening}
                  onToggleListening={toggleListening}
                  onSlashCommand={handleSlashCommand}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Canvas Panel ── */}
        {canvasContent && (
          <CanvasPanel
            isGenerating={isGenerating}
            onHistoryNavigate={handleHistoryNavigate}
            onSaveToLibrary={saveToLibrary}
            codeRef={codeRef}
            lineNumbersRef={lineNumbersRef}
            onCodeScroll={handleCodeScroll}
            onSendMessage={handleSendMessage}
          />
        )}
      </div>

      {/* ── Modals ── */}

      {/* Assistant Settings */}
      {showAssistantSettings && editingAssistant && (
        <AssistantSettingsModal
          onSave={saveAssistantConfig}
          trainingDocUploadRef={trainingDocUploadRef}
          avatarUploadRef={avatarUploadRef}
          onTrainingDocUpload={handleTrainingDocUpload}
          onAvatarUpload={handleAvatarUpload}
          onUnpin={async (chatId, msgId) => {
            await saveGlobalPins(globalPins.filter(p => p.msgId !== msgId));
            setMessages(prev => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map(m =>
                m.id === msgId ? { ...m, isPinned: false } : m
              ),
            }));
          }}
          handleEnhanceSystemPrompt={handleEnhanceSystemPrompt}
          isEnhancingPrompt={isEnhancingPrompt}
          onRunDreamCycle={runDreamCycle}
        />
      )}

      {/* Global Profile/System Settings */}
      {showProfileSettings && (
        <ProfileSettingsModal />
      )}

      {/* Save Artifact Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-white dark:bg-neutral-900 w-full max-w-sm rounded-[2rem] shadow-2xl p-6 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-white">
            <h3 className="text-lg font-black mb-4 tracking-tight">Save to Archives</h3>
            <div className="space-y-4">
               <div>
                  <label className="text-[10px] font-black uppercase opacity-40 block mb-1">Project Name</label>
                  <input type="text" value={saveAppData.title} onChange={e => useUIStore.getState().setSaveAppData({ ...useUIStore.getState().saveAppData, title: e.target.value })} className="w-full bg-neutral-100 dark:bg-neutral-800 border-none rounded-xl px-4 py-3 text-sm dark:text-neutral-100 outline-none font-bold" />
               </div>
            </div>
            <div className="flex gap-2 mt-8">
              <button onClick={() => setShowSaveModal(false)} className="flex-1 py-3 text-xs font-black uppercase text-neutral-400 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-800">Cancel</button>
              <button onClick={() => saveToLibrary(true)} className="flex-1 py-3 text-xs font-black uppercase bg-[#4A5D75] text-white rounded-xl hover:bg-[#3D4D61]">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Model Onboarding / Engine Wizard */}
      {showModelWizard && (
        <ModelWizardModal
          onToggleModelSelection={toggleModelSelection}
          onBulkAdd={handleBulkAdd}
          onFetchModels={handleFetchModels}
          onProviderChange={handleProviderChange}
          onAddSingleLLM={executeAddLLM}
        />
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(100,100,100,0.2); border-radius: 10px; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        @keyframes typingBounce { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-4px);opacity:1} }
        .wysiwyg-editor { outline:none; line-height:1.6; }
        .wysiwyg-editor h1 { font-size:2.25rem;font-weight:900;margin:1em 0 0.5em;letter-spacing:-0.02em; }
        .wysiwyg-editor h2 { font-size:1.5rem;font-weight:800;margin:1.5em 0 0.5em; }
        .wysiwyg-editor p  { margin-bottom:1em; }
        .wysiwyg-editor ul { list-style-type:disc;padding-left:1.5em;margin-bottom:1em; }
        .wysiwyg-editor li { margin-bottom:0.25em; }
        .wysiwyg-editor strong { font-weight:800; }
      `}</style>
    </div>
  );
}
