import './index.css';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, Bot, Code,
  FileText,
  Clock, ListTodo,
  AlignLeft, MapPin, Workflow,
  AlertTriangle, Loader2, Activity, UserPlus, Bookmark,
  MessageSquare, Mail, Layers, Send, CheckCircle2,
} from 'lucide-react';

import { db } from './services/database';
import { extractTextFromPDF } from './services/pdfParser';
import { useChatStore } from './store/useChatStore';
import { useAgentStore, DEFAULT_ASSISTANT } from './store/useAgentStore';
import { useSettingsStore, isLocalProvider } from './store/useSettingsStore';
import { useMemoryStore } from './store/useMemoryStore';
import { useTaskStore } from './store/useTaskStore';
import { useUIStore } from './store/useUIStore';
import { useBrowserStore } from './store/useBrowserStore';

import { getContextLimit, validateModel, buildSystemPrompt, generateTextResponse, fetchWithRetry } from './services/llm';
import { buildAmbientContext } from './services/context/ambient';
import { useToolContextStore } from './store/useToolContextStore';
import { parseAgentActions, actionNeedsApproval, executeAgentAction, describeAction, stripActionBlocks, type AgentAction } from './services/agentActions';
import { loadMemorySummary, retrieveRelevantMemory, invalidateMemorySummary } from './services/memoryContext';
import { searchWebHistory, renderWebRecall } from './services/webHistory';
import { normalizeChatRecord, scopeAgentsForChat, buildChannelPromptAddendum, getParticipantAgents, extractMentionedAgentIds } from './services/channels';
import { runIntegrationTools } from './services/integrations';
import { buildGatekeeperMemoryWrite, evaluateMemoryGate, selectPrimaryToolRoute, shouldPersistGatekeeperDecision } from './services/memoryGatekeeper';
import { capabilityForRoute, type CapabilityContext } from './services/capabilities';
import { evaluateDroppedMessages } from './services/contextEvaluator';
import { computePinProfile } from './services/pinPersonalization';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { NukeShieldModal } from './components/NukeShieldModal';
import { FileActionCard } from './components/FileActionCard';
import { CommandActionCard } from './components/CommandActionCard';
import { MemmoPanel } from './components/MemmoPanel';
import { InboxPanel } from './components/InboxPanel';
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
import { NewSpaceModal } from './components/NewSpaceModal';
import { ModelWizardModal } from './components/ModelWizardModal';
import { OnboardingWizard } from './components/OnboardingWizard';
import { AppSidebar } from './components/AppSidebar';
import { ArtifactStartModal } from './components/ArtifactStartModal';
import { CanvasPanel } from './components/CanvasPanel';
import { PlannerPanel } from './components/PlannerPanel';
import { KnowledgeGraphPanel } from './components/KnowledgeGraphPanel';
import { ActivityPanel } from './components/ActivityMonitor';
import { TypingIndicator } from './components/ui/TypingIndicator';
import { ThoughtProcess } from './components/ui/ThoughtProcess';
import { FormattedText } from './components/ui/FormattedText';
import { OmniTabBar } from './components/OmniTabBar';
import { StartPage } from './components/StartPage';
import { ChatPanel } from './components/ChatPanel';
import { BrowserTabContent } from './components/BrowserTabContent';
import { MailInboxPanel } from './components/MailInboxPanel';
import { MessagesPanel } from './components/MessagesPanel';
import { NotesPanel } from './components/NotesPanel';
import { CalendarPanel } from './components/CalendarPanel';
import { EventCard, GcalEventCard, EventUpdateCard, EventDeleteCard, GcalUpdateCard, GcalDeleteCard } from './components/EventCards';
import { CmdKPalette } from './components/CmdKPalette';
import { MarginaliaLayer } from './components/MarginaliaLayer';
import { AgentVisionToggle } from './components/AgentVisionToggle';
import { useSpaceStore } from './store/useSpaceStore';
import { useMarginaliaStore } from './store/useMarginaliaStore';
import { speak, cancelSpeech, resolveVoicePrefs } from './lib/voice';

// ─── Constants & Configurations ───────────────────────────────────────────────

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB Limit

// ─── Utility Helpers ──────────────────────────────────────────────────────────

const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;


// ─── UI Sub-components moved to src/components/ui/ ────────────────────────────
// AgentIcon, BOT_COLORS, TypingIndicator, ThoughtProcess, FormattedText,
// INLINE_FORMAT_REGEX, WysiwygEditor, ContextMeter are imported above.

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  // ── Store subscriptions (reactive reads) ────────────────────────────────────
  const messages = useChatStore(s => s.messages);
  const chats = useChatStore(s => s.chats);
  const activeChatId = useChatStore(s => s.activeChatId);

  const assistants = useAgentStore(s => s.assistants);
  const activeFolderId = useAgentStore(s => s.activeFolderId);
  const editingAssistant = useAgentStore(s => s.editingAssistant);
  const showAssistantSettings = useAgentStore(s => s.showAssistantSettings);

  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);
  const appSettings = useSettingsStore(s => s.appSettings);
  const userProfile = useSettingsStore(s => s.userProfile);
  const userName = useSettingsStore(s => s.userName);
  const showProfileSettings = useSettingsStore(s => s.showProfileSettings);
  const showNewSpace = useUIStore(s => s.showNewSpace);
  const showModelWizard = useSettingsStore(s => s.showModelWizard);
  const showOnboarding = useSettingsStore(s => s.showOnboarding);
  const onboardingInitialStep = useSettingsStore(s => s.onboardingInitialStep);

  const globalPins = useMemoryStore(s => s.globalPins);
  const dreamLog = useMemoryStore(s => s.dreamLog);
  const showDreamBanner = useMemoryStore(s => s.showDreamBanner);
  const showDreamDigest = useMemoryStore(s => s.showDreamDigest);
  const agentForgePath = useMemoryStore(s => s.agentForgePath);
  const showMemmoPanel = useMemoryStore(s => s.showMemmoPanel);
  const memmoPanelTab = useMemoryStore(s => s.memmoPanelTab);
  const showMemoCompose = useMemoryStore(s => s.showMemoCompose);

  const tasks = useTaskStore(s => s.tasks);

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

  const activeOmniTab = useSpaceStore(s => s.omniTabs.find(t => t.id === s.activeOmniTabId) ?? null);
  const allOmniTabs = useSpaceStore(s => s.omniTabs);
  const activeSpaceId = useSpaceStore(s => s.activeSpaceId);

  // ── Split view: every tab is full-screen by default; optionally show a second
  //    tab beside it with a draggable divider (e.g. chat next to a doc).
  const splitTabId = useUIStore(s => s.splitTabId);
  const splitRatio = useUIStore(s => s.splitRatio);
  const splitTab = splitTabId
    ? allOmniTabs.find(t => t.id === splitTabId && t.spaceId === activeSpaceId && t.id !== activeOmniTab?.id) ?? null
    : null;
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Ghost UI / marginalia (doc + code-canvas tabs only)
  const agentVisionOn = useMarginaliaStore(s => s.agentVisionOn);
  const setAgentVisionOn = useMarginaliaStore(s => s.setAgentVisionOn);
  const annotations = useMarginaliaStore(s => s.annotations);

  // ── Local state (must stay in App.tsx) ──────────────────────────────────────
  const [llamaServerPid, setLlamaServerPid] = useState<number | null>(null);
  const [llamaPaused, setLlamaPaused] = useState(false);
  const [llamaCoolingDown, setLlamaCoolingDown] = useState(false);
  const [nukeShieldPending, setNukeShieldPending] = useState<{ path: string; content: string; deletions: number; existingLines: number; diffStat: string } | null>(null);

  const [showAgentIntro, setShowAgentIntro] = useState(false);
  const [pendingArtifactType, setPendingArtifactType] = useState<'code' | 'doc' | null>(null);
  // Co-pilot rail: the active agent docked beside a tool/web/canvas tab. Collapsible (the "mute"/dismiss).
  const [copilotOpen, setCopilotOpen] = useState(true);
  // Agent tool-actions awaiting approval (sends/deletes). Local writes auto-apply and never land here.
  const [pendingActions, setPendingActions] = useState<AgentAction[]>([]);
  // Persist the co-pilot's open/closed state so "dismiss" sticks across reloads (a real mute).
  useEffect(() => { db.get('copilotOpen', true).then((v: any) => setCopilotOpen(v !== false)).catch(() => {}); }, []);
  const toggleCopilot = (v: boolean) => { setCopilotOpen(v); void db.set('copilotOpen', v); };
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // Store action shorthands (imperative, for use in callbacks/effects)
  const showToast = useUIStore.getState().showToast;

  // After an agent reply, run any forge:action blocks it emitted: auto-apply local writes (note/task/
  // calendar create), queue sends/deletes for approval, and strip the raw blocks from the message.
  const handleAgentActions = async (text: string, chatId: string, botId: string) => {
    const actions = parseAgentActions(text);
    if (actions.length === 0) return;
    const cleaned = stripActionBlocks(text);
    if (cleaned && cleaned !== text) {
      useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({
        ...prev,
        [chatId]: (prev[chatId] ?? []).map((m: any) => (m.id === botId ? { ...m, content: cleaned } : m)),
      }));
    }
    for (const a of actions.filter(x => !actionNeedsApproval(x))) {
      try { showToast(`✓ ${await executeAgentAction(a)}`); }
      catch (e) { showToast(`Couldn't ${describeAction(a)}: ${String(e)}`); }
    }
    const needApproval = actions.filter(actionNeedsApproval);
    if (needApproval.length) setPendingActions(prev => [...prev, ...needApproval]);
  };
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
  const evaluatedContextRef = useRef<{ chatId: string; ids: Set<string> }>({ chatId: '', ids: new Set() });
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
    return () => unlistens.forEach(u => u());
  }, []);

  useEffect(() => {
    const boot = async () => {
      try {
        await db.init();
        await useChatStore.getState().hydrate();
        await useAgentStore.getState().hydrate();
        const restoredActiveChatId = useChatStore.getState().activeChatId;
        const restoredActiveChat = useChatStore.getState().chats.find((chat: any) => chat.id === restoredActiveChatId);
        if (restoredActiveChat) {
          const normalized = normalizeChatRecord(restoredActiveChat, useAgentStore.getState().activeFolderId);
          const agentId = normalized.primaryAgentId ?? normalized.folderId;
          if (agentId && useAgentStore.getState().assistants.some((agent: any) => agent.id === agentId)) {
            useAgentStore.getState().setActiveFolderId(agentId);
          }
        }
        await useSettingsStore.getState().hydrate();
        await useMemoryStore.getState().hydrate();
        await useTaskStore.getState().hydrate();
        await useUIStore.getState().hydrateSavedApps();
        await useBrowserStore.getState().hydrate();
        useSpaceStore.getState().hydrate().catch(() => {});
        useMarginaliaStore.getState().hydrate().catch(() => {});

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

      // Silent local model auto-detection — check LM Studio and Ollama before onboarding check
      try {
        const ss = useSettingsStore.getState();
        const existingModels = ss.models;
        const autoAdded: any[] = [];
        const mkSignal = (ms: number) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };

        // LM Studio — localhost:1234
        try {
          const r = await fetch('http://localhost:1234/v1/models', { signal: mkSignal(1500) });
          if (r.ok) {
            const { data } = await r.json();
            (data ?? []).forEach((m: any) => {
              if (!existingModels.some((e: any) => e.modelId === m.id && e.endpoint === 'http://localhost:1234/v1')) {
                autoAdded.push({ id: generateId('m'), name: m.id, provider: 'lmstudio', modelId: m.id, endpoint: 'http://localhost:1234/v1', apiKey: '', contextLimit: 32768, canImage: false, isLocal: true });
              }
            });
          }
        } catch (_) {}

        // Ollama — localhost:11434
        try {
          const r = await fetch('http://localhost:11434/api/tags', { signal: mkSignal(1500) });
          if (r.ok) {
            const { models: om } = await r.json();
            (om ?? []).forEach((m: any) => {
              if (!existingModels.some((e: any) => e.modelId === m.name && e.endpoint === 'http://localhost:11434/v1')) {
                autoAdded.push({ id: generateId('m'), name: m.name, provider: 'ollama', modelId: m.name, endpoint: 'http://localhost:11434/v1', apiKey: '', contextLimit: 32768, canImage: false, isLocal: true });
              }
            });
          }
        } catch (_) {}

        if (autoAdded.length > 0) {
          ss.setModels((prev: any[]) => [...prev, ...autoAdded]);
          if (!ss.selectedModelId) ss.setSelectedModelId(autoAdded[0].id);
          autoAdded.forEach(mdl => ss.setModelValidation((prev: Record<string, string>) => ({ ...prev, [mdl.id]: 'ok' })));
          const label = autoAdded.length === 1 ? autoAdded[0].name : `${autoAdded.length} local models`;
          useUIStore.getState().showToast(`✅ ${label} auto-configured`);
        }
      } catch (e) { console.warn('[AgentForge] Auto-detect skipped:', e); }

      // Onboarding wizard
      // • First launch (onboardingComplete = false) with nothing set up → full wizard from step 1
      // • First launch but already has models/chats (migrated user) → silently mark done
      // • Any launch with no models configured → jump to model step (step 3)
      const onboardingDone = await db.get('onboardingComplete', false);
      const hasModels = useSettingsStore.getState().models.length > 0;
      const hasChats = useChatStore.getState().chats.length > 0;
      if (!onboardingDone) {
        if (hasModels || hasChats) {
          await db.set('onboardingComplete', true);
          useSettingsStore.getState().setOnboardingComplete(true);
        } else {
          useSettingsStore.getState().setShowOnboarding(true);
        }
      } else if (!hasModels) {
        // Completed onboarding before but has no models — go straight to model step
        useSettingsStore.getState().setOnboardingInitialStep(3);
        useSettingsStore.getState().setShowOnboarding(true);
      }

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

      // Hardware profile — scale thresholds to total installed RAM
      invoke<{ critical_mb: number; cooldown_mb: number; recovery_mb: number; hud_show_mb: number; hud_warn_mb: number; rag_results: number; rag_snippet_chars: number }>('get_hardware_profile')
        .then(profile => useUIStore.getState().setHwProfile(profile))
        .catch(() => {});

      // Start background file watcher for Knowledge Core indexing
      invoke('init_file_watcher').catch(() => {});

      } catch (err) { console.error('[AgentForge] Boot error:', err); } finally { useUIStore.getState().setIsDbLoaded(true); }
    };
    boot();

    // Auto-schedule Dream Cycle — 30min warm-up, then every 24h.
    // Declared here (not inside boot) so the cleanup return can reach warmupTimeout.
    const DREAM_WARMUP_MS = 30 * 60 * 1000;
    const DREAM_INTERVAL_MS = 24 * 60 * 60 * 1000;
    const scheduleDream = () => {
      dreamTimerRef.current = setInterval(() => {
        const { appSettings: s } = useSettingsStore.getState();
        if (s.dreamAutoEnabled === false) return;
        runDreamCycle(activeAssistantRef.current ?? undefined, selectedModelRef.current ?? undefined);
      }, DREAM_INTERVAL_MS);
    };
    const warmupTimeout = setTimeout(() => {
      const { appSettings: s } = useSettingsStore.getState();
      if (s.dreamAutoEnabled !== false) {
        runDreamCycle(activeAssistantRef.current ?? undefined, selectedModelRef.current ?? undefined);
      }
      scheduleDream();
    }, DREAM_WARMUP_MS);

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
      clearTimeout(warmupTimeout);
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

  const flushState = useCallback(async () => {
    if (!useUIStore.getState().isDbLoaded) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    try {
      await useChatStore.getState().persist();
      await useAgentStore.getState().persist();
      await useSettingsStore.getState().persist();
      await useTaskStore.getState().persist();
      await useUIStore.getState().persistSavedApps();
    } catch (err) { console.error('[AgentForge] Save error:', err); }
  }, []); // no deps needed — reads from store at call time

  const persistState = useCallback(() => {
    if (!useUIStore.getState().isDbLoaded) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void flushState(); }, 1500);
  }, [flushState]);

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
  useEffect(() => {
    const flushSoon = () => { void flushState(); };
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushSoon();
    };
    window.addEventListener('pagehide', flushSoon);
    window.addEventListener('beforeunload', flushSoon);
    document.addEventListener('visibilitychange', flushWhenHidden);

    let unlistenClose: (() => void) | null = null;
    if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
      getCurrentWindow().onCloseRequested(async () => {
        await flushState();
      }).then(unlisten => { unlistenClose = unlisten; }).catch(() => {});
    }

    return () => {
      window.removeEventListener('pagehide', flushSoon);
      window.removeEventListener('beforeunload', flushSoon);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      if (unlistenClose) unlistenClose();
      flushSoon();
    };
  }, [flushState]);

  const activeAssistant = useMemo(() => assistants.find(a => a.id === activeFolderId) ?? assistants[0], [assistants, activeFolderId]);
  const activeMessages = useMemo(() => activeChatId ? (messages[activeChatId] ?? []) : [], [messages, activeChatId]);
  const activeChat = useMemo(() => {
    if (!activeChatId) return null;
    const c = chats.find(c => c.id === activeChatId);
    return c ? normalizeChatRecord(c, activeFolderId) : null;
  }, [chats, activeChatId, activeFolderId]);
  // Agents available to @-mention in the composer — the active container's participants. Populated
  // for DMs and Spaces alike so the @-picker (and Cmd+Shift+@) works everywhere, not just channels.
  const channelParticipants = useMemo(() => {
    if (!activeChat) return [];
    return getParticipantAgents(activeChat, assistants).map((a: any) => ({ id: a.id, name: a.name }));
  }, [activeChat, assistants]);
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

  const browserActiveTab = useBrowserStore(s => s.activeTab);
  const browserContext = browserActiveTab?.content
    ? { pageContent: browserActiveTab.content, url: browserActiveTab.url, title: browserActiveTab.title }
    : undefined;
  // Trust-tagged snapshot of the tabs open in the active Space/DM — for the context-window gauge.
  const ambientContext = useMemo(
    () => buildAmbientContext(
      allOmniTabs.filter(t => t.spaceId === activeSpaceId),
      activeOmniTab?.id ?? null,
      (id: string) => assistants.find(a => a.id === id)?.name,
    ),
    [allOmniTabs, activeSpaceId, activeOmniTab?.id, assistants],
  );

  const systemPromptLen = useMemo(() => buildSystemPrompt({ agent: activeAssistant ?? DEFAULT_ASSISTANT, profile: userProfile, userName, tasks, canvasContent, mode: generationMode, isDeepThinking, agentPinnedMessages: agentPinnedMessagesForPrompt, appSettings, browserContext, ambientContext }).length, [activeAssistant, userProfile, userName, tasks, canvasContent, generationMode, isDeepThinking, agentPinnedMessagesForPrompt, appSettings, browserContext, ambientContext]);

  // Recency-weighted fingerprint of what this agent's user actually saves
  const pinProfile = useMemo(
    () => computePinProfile(globalPins.filter((p: any) => p.agentId === activeAssistant?.id)),
    [globalPins, activeAssistant?.id]
  );

  // Index in activeMessages where the agent's context window begins (messages before = forgotten)
  const forgettingIndex = useMemo(() => {
    if (!activeMessages.length || !selectedModel) return -1;
    const contextLimit = selectedModel.contextLimit ?? 32000;
    const pinned = activeMessages.filter((m: any) => m.isPinned);
    const unpinned = activeMessages.filter((m: any) => !m.isPinned && !m.isToolCall);
    const pinnedLen = pinned.reduce((acc: number, m: any) => acc + String(m.content ?? '').length, 0);
    let budget = Math.max(1000, contextLimit - systemPromptLen) - pinnedLen;
    const kept: any[] = [];
    for (let i = unpinned.length - 1; i >= 0; i--) {
      const len = String(unpinned[i].content ?? '').length;
      if (budget - len < 0 && kept.length > 0) break;
      budget -= len;
      kept.unshift(unpinned[i]);
    }
    if (kept.length === unpinned.length) return -1;
    const firstKeptId = kept[0]?.id;
    if (!firstKeptId) return -1;
    return activeMessages.findIndex((m: any) => m.id === firstKeptId);
  }, [activeMessages, systemPromptLen, selectedModel]);

  // Reset evaluated IDs when switching chats
  useEffect(() => {
    evaluatedContextRef.current = { chatId: activeChatId ?? '', ids: new Set() };
  }, [activeChatId]);

  // Evaluate messages that fall out of context — save knowledge, log threads, skip noise
  useEffect(() => {
    if (forgettingIndex <= 0 || !activeAssistant) return;
    const fallen = activeMessages.slice(0, forgettingIndex);
    const newlyFallen = fallen.filter((m: any) =>
      !m.isToolCall &&
      !evaluatedContextRef.current.ids.has(m.id) &&
      String(m.content ?? '').trim().length > 20
    );
    if (!newlyFallen.length) return;
    newlyFallen.forEach((m: any) => evaluatedContextRef.current.ids.add(m.id));
    const { models: _m, selectedModelId: _sid, appSettings: _as, integrations: _int } = useSettingsStore.getState();
    const _model = _m.find((m: any) => m.id === _sid) ?? _m[0] ?? null;
    const _afp = useMemoryStore.getState().agentForgePath;
    const _pins = useMemoryStore.getState().globalPins.filter((p: any) => p.agentId === activeAssistant.id);
    if (!_model || !_afp) return;
    evaluateDroppedMessages(newlyFallen, activeAssistant, _afp, _model, _as, _int, _m, pinProfile, _pins).catch(() => {});
  }, [forgettingIndex, activeMessages, activeAssistant, pinProfile]);

  // Sync mode when switching agents
  useEffect(() => {
    if (activeAssistant) {
      if (activeAssistant.defaultMode === 'image' && appSettings?.imageProvider === 'none') {
         useUIStore.getState().setGenerationMode('text');
      } else {
         useUIStore.getState().setGenerationMode(activeAssistant.defaultMode || 'text');
      }
      useUIStore.getState().setIsDeepThinking(!!activeAssistant.defaultDeepThinking);
    }
  }, [activeFolderId, activeAssistant, appSettings?.imageProvider]);

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
        if (pendingArtifactType) { setPendingArtifactType(null); return; }
        const mem = useMemoryStore.getState();
        const ag = useAgentStore.getState();
        const ss = useSettingsStore.getState();
        const ui = useUIStore.getState();
        const tk = useTaskStore.getState();
        if (mem.showMemoCompose) mem.setShowMemoCompose(false);
        else if (mem.showMemmoPanel) mem.setShowMemmoPanel(false);
        else if (ag.showAssistantSettings) ag.setShowAssistantSettings(false);
        else if (ss.showProfileSettings) {
            ss.setShowProfileSettings(false);
            ss.setImageTestState({ loading: false, error: null, successUrl: null });
        }
        else if (ss.showModelWizard) ss.setShowModelWizard(false);
        else if (ui.showSaveModal) ui.setShowSaveModal(false);
        else if (tk.taskToDiscuss) tk.setTaskToDiscuss(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const fetchImageModels = async () => {
     const { setIsFetchingImageModels, setImageTestState, setImageEngineModels, setAppSettings } = useSettingsStore.getState();
     const { appSettings: _appSettings } = useSettingsStore.getState();
     const _activeImageKey = _appSettings.imageProvider === 'openai' ? (useSettingsStore.getState().integrations.openai?.apiKey || useSettingsStore.getState().models.find((m: any) => m.provider === 'openai' && m.apiKey)?.apiKey) :
                            _appSettings.imageProvider === 'google' ? (useSettingsStore.getState().integrations.google?.apiKey || useSettingsStore.getState().models.find((m: any) => m.provider === 'google' && m.apiKey)?.apiKey) :
                            useSettingsStore.getState().integrations.customImage?.apiKey || '';
     setIsFetchingImageModels(true);
     setImageTestState({ loading: false, error: null, successUrl: null });
     try {
         let url, headers: any = {};
         let provider = _appSettings.imageProvider;
         let key = _activeImageKey;

         if (!key && provider !== 'custom') throw new Error("API Key required to fetch models.");

         if (provider === 'google') {
             url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
         } else {
             let base = _appSettings.imageEndpoint || 'https://api.openai.com/v1';
             url = `${base.replace(/\/$/, '')}/models`;
             if (key) headers['Authorization'] = `Bearer ${key}`;
         }

         const res = await fetchWithRetry(url, { method: 'GET', headers }, 1);
         let list: any[] = [];
         if (provider === 'google') {
             list = (res.models || []).map((m: any) => m.name.replace('models/', ''));
         } else {
             list = (res.data || res.models || []).map((m: any) => m.id || m.name);
         }

         setImageEngineModels(list);
         if (list.length > 0 && !_appSettings.imageModelId) {
             setAppSettings((prev: any) => ({...prev, imageModelId: list.find((id: string) => id.includes('dall-e') || id.includes('imagen')) || list[0]}));
         }
         useUIStore.getState().showToast("Models fetched successfully.");
     } catch (err: any) {
         useUIStore.getState().showToast("Failed to fetch models: " + err.message);
     } finally {
         setIsFetchingImageModels(false);
     }
  };

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

  const testImageEngine = async () => {
      const { appSettings: _appSettings, integrations: _integrations, models: _models } = useSettingsStore.getState();
      const _activeImageKey = _appSettings.imageProvider === 'openai' ? (_integrations.openai?.apiKey || _models.find((m: any) => m.provider === 'openai' && m.apiKey)?.apiKey) :
                             _appSettings.imageProvider === 'google' ? (_integrations.google?.apiKey || _models.find((m: any) => m.provider === 'google' && m.apiKey)?.apiKey) :
                             _integrations.customImage?.apiKey || '';
      useSettingsStore.getState().setImageTestState({ loading: true, error: null, successUrl: null });
      try {
          let imageUrl = '';
          const promptText = "A cute cat wearing a yellow banana costume, high quality photorealistic.";
          let provider = _appSettings.imageProvider;
          let modelId = _appSettings.imageModelId || (provider === 'google' ? 'imagen-3.0-generate-001' : 'dall-e-3');
          let key = _activeImageKey;

          if (provider === 'google') {
              if (!key) throw new Error("Missing Google API Key.");
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predict?key=${key}`;
              const body = { instances: { prompt: promptText }, parameters: { sampleCount: 1 } };
              const headers = { 'Content-Type': 'application/json' };
              const res = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, 0);
              if (res.predictions && res.predictions[0]) {
                  imageUrl = `data:image/png;base64,${res.predictions[0].bytesBase64Encoded}`;
              } else {
                  throw new Error(res.error?.message || "Google Image generation failed or returned empty payload.");
              }
          } else if (provider === 'openai' || provider === 'custom') {
              if (!key && provider === 'openai') throw new Error("Missing OpenAI API Key.");
              const baseEndpoint = (_appSettings.imageEndpoint || 'https://api.openai.com/v1').replace(/\/$/, '');
              const url = `${baseEndpoint}/images/generations`;
              const body = { model: modelId, prompt: promptText, n: 1, size: '1024x1024' };
              const headers: any = { 'Content-Type': 'application/json' };
              if (key) headers['Authorization'] = `Bearer ${key}`;

              const data = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, 0);
              if (data.data && data.data[0] && data.data[0].url) {
                  imageUrl = data.data[0].url;
              } else {
                  throw new Error(data.error?.message || "Generation failed.");
              }
          }
          useSettingsStore.getState().setImageTestState({ loading: false, error: null, successUrl: imageUrl });
      } catch (err: any) {
          useSettingsStore.getState().setImageTestState({ loading: false, error: err.message || "Failed to generate image. Check your API key or network.", successUrl: null });
      }
  };

  const toggleSpeak = (msgId: string, text: string, agentId?: string) => {
    if (speakingId === msgId) {
      cancelSpeech();
      useChatStore.getState().setSpeakingId(null);
      return;
    }
    // Read aloud in the message's agent's voice, falling back to the app default.
    const agent = useAgentStore.getState().assistants.find((a: any) => a.id === agentId) ?? activeAssistant;
    const { appSettings: s } = useSettingsStore.getState();
    const prefs = resolveVoicePrefs(agent, { voiceURI: s.ttsVoiceURI, rate: s.ttsRate, pitch: s.ttsPitch });
    useChatStore.getState().setSpeakingId(msgId);
    speak(text, prefs, {
      onEnd: () => useChatStore.getState().setSpeakingId(null),
      onError: () => useChatStore.getState().setSpeakingId(null),
    });
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
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const fakeEvent = { target: { files: [file], value: '' } } as any;
      await handleChatFileUpload(fakeEvent);
    }
  };

  const handleChatFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const ui = useUIStore.getState();
    ui.setUploadError('');
    if (file.size > MAX_FILE_SIZE) {
      ui.setUploadError(`File is too large. Max 5MB allowed.`);
      ui.showToast("File is too large.");
      e.target.value = '';
      return;
    }

    if (file.type === 'application/pdf') {
        ui.showToast("Parsing PDF locally... this might take a moment.");
        try {
           const text = await extractTextFromPDF(file);
           ui.setAttachedDocs((prev: any[]) => [...prev, { name: file.name, content: text, type: 'text/plain', isImage: false }]);
           ui.showToast("PDF parsed successfully!");
        } catch (err) {
           ui.showToast("Failed to parse PDF.");
           console.error(err);
        }
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    if (file.type.startsWith('image/')) {
      reader.onloadend = () => ui.setAttachedDocs((prev: any[]) => [...prev, { name: file.name, content: reader.result, type: file.type, isImage: true }]);
      reader.readAsDataURL(file);
    } else {
      reader.onloadend = () => ui.setAttachedDocs((prev: any[]) => [...prev, { name: file.name, content: reader.result, type: file.type, isImage: false }]);
      reader.readAsText(file);
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

  const confirmArtifactCreate = (agentId: string, type: 'code' | 'doc') => {
    useAgentStore.getState().setActiveFolderId(agentId);
    const { chats } = useChatStore.getState();
    const existing = chats.find((c: any) => {
      const norm = normalizeChatRecord(c, agentId);
      return norm.kind === 'dm' && (norm.primaryAgentId === agentId || c.folderId === agentId);
    });
    if (existing) {
      useChatStore.getState().setActiveChatId(existing.id);
    } else {
      const chatId = generateId('c');
      const agent = useAgentStore.getState().assistants.find((a: any) => a.id === agentId);
      const chat = normalizeChatRecord({ id: chatId, folderId: agentId, primaryAgentId: agentId, participantAgentIds: [agentId], kind: 'dm', name: `${agent?.name ?? 'Agent'} Direct`, goal: '', createdAt: Date.now(), updatedAt: Date.now() }, agentId);
      useChatStore.getState().setChats((prev: any[]) => [chat, ...prev]);
      useChatStore.getState().setActiveChatId(chatId);
      useChatStore.getState().setMessages((prev: any) => ({ ...prev, [chatId]: [] }));
    }
    const initialContent = type === 'code' ? '\n' : '<h1>New Document</h1><p>Start writing here...</p>';
    const ui = useUIStore.getState();
    ui.setCanvasContent({ id: generateId('art'), title: `Untitled ${type === 'code' ? 'App' : 'Document'}`, content: initialContent, language: 'html', type, isStandalone: false, history: [{ timestamp: Date.now(), content: initialContent }], historyIndex: 0 });
    ui.setGenerationMode(type); ui.setCanvasTab(type === 'code' ? 'code' : 'preview');
    useTaskStore.getState().setShowPlanner(false);
    setPendingArtifactType(null);
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
  const saveImageToLibrary = useCallback((src: string) => {
     const item = { id: generateId('art'), title: 'Generated Image', type: 'image', content: src, updatedAt: Date.now() };
     useUIStore.getState().setSavedApps((prev: any[]) => [item, ...prev]);
  }, []);

  const persistGatekeeperMemory = useCallback(async (chatId: string, userMsg: any, decision: ReturnType<typeof evaluateMemoryGate>, agent: any) => {
    if (!shouldPersistGatekeeperDecision(decision, userMsg.content)) return;
    const rootPath = useMemoryStore.getState().agentForgePath;
    if (!rootPath || !((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) return;

    const write = buildGatekeeperMemoryWrite({
      rootPath,
      agentId: agent?.id ?? 'default',
      chatId,
      channelId: decision.destination === 'channel_memory' ? chatId : null,
      text: userMsg.content,
      decision,
    });

    try {
      const result = await invoke<{ blocked?: boolean; error?: string }>('write_memory', {
        path: write.path,
        content: write.content,
        commitMessage: `memory: ${write.title}`,
        agentId: agent?.id ?? null,
        contextTokens: null,
        ramState: null,
      });
      if (result.blocked) {
        console.warn('[MemoryGatekeeper] Memory write blocked:', result.error);
        return;
      }
      showToast(decision.destination === 'library' ? 'Saved to Library.' : 'Saved to agent memory.');
    } catch (e) {
      console.warn('[MemoryGatekeeper] Could not persist memory:', e);
    }
  }, [showToast]);

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
        const fileContent = `# ${firstLine}\n\nSaved from chat · ${new Date().toLocaleDateString()}\n\n---\n\n${msg.content}`;
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
    if (provider === 'ollama') endpoint = 'http://127.0.0.1:11434/v1';
    if (provider === 'lmstudio') endpoint = 'http://127.0.0.1:1234/v1';
    if (provider === 'native') endpoint = 'http://127.0.0.1:8080/v1';
    if (provider === 'huggingface') endpoint = 'https://api-inference.huggingface.co/v1';
    const existingKey = ss.models.find((m: any) => m.provider === provider && m.apiKey)?.apiKey || '';
    ss.setEditingModel({ name: provider === 'native' ? 'Agent Forge Engine' : provider === 'ollama' ? 'Local Ollama' : provider === 'lmstudio' ? 'LM Studio Engine' : 'Custom Model', provider, modelId: '', endpoint, apiKey: existingKey, contextLimit: 32000 });
    ss.setFetchedModels([]); ss.setPendingModelSelections([]); ss.setFetchModelsError(null); ss.setModelSearchQuery('');
  };

  const handleFetchModels = async () => {
    const ss = useSettingsStore.getState();
    const _editingModel = ss.editingModel;
    if (!_editingModel.apiKey && !['custom', 'ollama', 'lmstudio', 'native'].includes(_editingModel.provider)) { ss.setFetchModelsError('Please enter your API Key first.'); return; }
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
        const defaultEndpoint = provider === 'ollama' ? 'http://127.0.0.1:11434/v1' : provider === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : provider === 'native' ? 'http://127.0.0.1:8080/v1' : 'https://api.openai.com/v1';
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
    const existingModels = ss.models;
    const newModels = _pendingModelSelections
      .filter((m: any) => !existingModels.some((e: any) => e.modelId === m.id && e.endpoint === _editingModel.endpoint))
      .map((m: any) => ({ id: generateId('m'), name: m.id, provider: _editingModel.provider, modelId: m.id, endpoint: _editingModel.endpoint, apiKey: _editingModel.apiKey, contextLimit: m.context, canImage: false, isLocal: isLocalProvider(_editingModel.provider, _editingModel.endpoint) }));
    if (newModels.length === 0) { useUIStore.getState().showToast('All selected models are already added.'); ss.setPendingModelSelections([]); ss.setShowModelWizard(false); ss.setWizardStep(3); return; }
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
    const mdl = { id, name: String(cfg.name || 'Custom Model').trim(), provider: cfg.provider, modelId: String(cfg.modelId || 'custom').trim(), endpoint: String(cfg.endpoint || '').trim(), apiKey: String(cfg.apiKey || '').trim(), contextLimit: parseInt(cfg.contextLimit, 10) || 32000, canImage: false, isLocal: isLocalProvider(cfg.provider, cfg.endpoint) };
    const duplicate = ss.models.find((e: any) => e.modelId === mdl.modelId && e.endpoint === mdl.endpoint);
    if (duplicate) { ss.setSelectedModelId(duplicate.id); ss.setShowModelWizard(false); ss.setWizardStep(3); useUIStore.getState().showToast('Model already added — switched to it.'); return; }
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
    const result = await generateTextResponse({ messages: [{ id: generateId('msg'), role: 'user', content: text }], modelConfig: _selectedModel, profile: '', attachedDocs: [], agent, tasks: [], mode: 'text', canvasContent: null, isDeepThinking: false, agentPinnedMessages: _agentPinnedMessagesForPrompt, onChunk: null, signal: null, appSettings: _appSettings, integrations: _integrations, models: _models });
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
    if (isDreamRunningRef.current || !_agentForgePath || !activeAgent || !activeModel) return;
    isDreamRunningRef.current = true;
    useMemoryStore.getState().setIsDreamRunning(true);
    useUIStore.getState().showToast('🌙 Dream Cycle starting...');

    try {
      // Read all memory files for the active agent
      const memoryFiles: { path: string; name: string; content: string }[] = [];

      const listed = await invoke<{ files: Array<{ path: string; name: string }> }>('list_agent_memory_files', {
        agentId: activeAgent.id,
      });
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
      const systemPrompt = buildDreamerSystemPrompt();
      const userMessage = buildDreamerUserMessage(memoryFiles, activeAgent.name, activeAgent.id, maxChars, { currentDate: new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) });

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
            if (op.target_path.startsWith('/') || op.target_path.includes('..') || !op.target_path.startsWith(`memory/${activeAgent.id}/`)) continue;

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

          } else if (op.type === 'notice') {
            if (!op.title?.trim() || !op.body?.trim()) continue;
            dreamItems.push({
              id,
              type: 'noticed',
              description: op.description,
              notice_title: op.title,
              notice_body: op.body,
              notice_agent_id: op.agentId,
              archive_paths: [],
              original_paths: [],
              git_commits: [],
              undone: false,
            });
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
      invalidateMemorySummary(); // memory files were just consolidated — refresh the Tier-1 digest
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
    try { await enhance(_input, 'Fix spelling and grammar in the following message. If it is unclear, also improve clarity. Keep the same meaning, length, and casual tone. Return ONLY the corrected text, nothing else.', (v) => useUIStore.getState().setInput(v)); }
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

  const processChatRequest = async (chatId: string, userMsg: any, historyToPass: any[]) => {
    // Read store state at call time (avoids stale closure issues)
    const { assistants: _assistants, activeFolderId: _activeFolderId } = useAgentStore.getState();
    const _activeAssistant = _assistants.find((a: any) => a.id === _activeFolderId) ?? _assistants[0];
    const { models: _models, selectedModelId: _selectedModelId, appSettings: _appSettings, integrations: _integrations } = useSettingsStore.getState();
    const _selectedModel = _models.find((m: any) => m.id === _selectedModelId) ?? _models[0] ?? null;
    const _hwProfile = useUIStore.getState().hwProfile;
    const _forcedTool = useUIStore.getState().forcedTool;
    const _globalPins = useMemoryStore.getState().globalPins;
    const _agentPinnedMessagesForPrompt = _globalPins.filter((p: any) => p.agentId === _activeAssistant?.id).map((p: any) => p.content);
    const _generationMode = useUIStore.getState().generationMode;
    const _isDeepThinking = useUIStore.getState().isDeepThinking;
    const _canvasContent = useUIStore.getState().canvasContent;
    const _tasks = useTaskStore.getState().tasks;
    const _recurringEvents = useTaskStore.getState().recurringEvents;
    const _userProfile = useSettingsStore.getState().userProfile;
    const _userName = useSettingsStore.getState().userName;

    setIsGenerating(true);
    try {
      const history = [...historyToPass, userMsg];
      const inputLower = userMsg.content.toLowerCase();
      let toolUsed = null;
      let toolData = "";
      let foundSources: any[] = [];
      const gatekeeperDecision = evaluateMemoryGate({
        text: userMsg.content,
        agentId: _activeAssistant?.id ?? null,
        agentName: _activeAssistant?.name ?? null,
        chatId,
        forcedTool: _forcedTool,
        enabledTools: _activeAssistant?.tools ?? {},
        attachedFiles: userMsg.attachedFiles ?? [],
      });

      await persistGatekeeperMemory(chatId, userMsg, gatekeeperDecision, _activeAssistant);

      const primaryToolRoute = selectPrimaryToolRoute(gatekeeperDecision);
      if (_forcedTool) useUIStore.getState().setForcedTool(null);

      // Resolve the gatekeeper's chosen route to a registered capability, scoped to what's open in
      // the active Space/DM (design §4). Phase 1: the four built-ins are surface-'*', so this is
      // behavior-identical to the former if-chain — the scoping machinery is exercised by future
      // capabilities. The capability bodies live in services/capabilities/builtins/*.
      const { spaces: _spaces, activeSpaceId: _activeSpaceId, omniTabs: _omniTabs } = useSpaceStore.getState();
      const _activeSpace = _spaces.find((s: any) => s.id === _activeSpaceId) ?? null;
      const _openTabs = _activeSpace ? _omniTabs.filter((t: any) => _activeSpace.tabIds.includes(t.id)) : _omniTabs;
      // Ambient sight: trust-tagged snapshot of the tabs open in this Space/DM, shown to every agent.
      const _ambientContext = buildAmbientContext(
        _openTabs,
        useSpaceStore.getState().activeOmniTabId,
        (id: string) => _assistants.find((a: any) => a.id === id)?.name,
      );
      // The tool the user is actively looking at (Inbox/Notes/…) — its on-screen contents, so the
      // docked agent can read it, not just know it's open.
      const _toolContext = useToolContextStore.getState().content ?? undefined;
      // Layered memory: Tier 1 = always-on consolidated digest; Tier 2 = relevance-gated retrieval
      // for this message. Both reuse existing memory files + search_knowledge_semantic.
      const _memorySummary = await loadMemorySummary(_activeAssistant?.id);
      const _relevantMemory = await retrieveRelevantMemory(userMsg.content, _activeAssistant?.id);
      // Browsing-history recall — "remember that article I saw?" (privacy-filtered, dwell-gated).
      // Scoped to the Spaces this agent belongs to: it must not recall pages read in Spaces it was
      // never part of. Visits with no spaceId (legacy/outside a Space) are excluded by the scope.
      const _agentSpaceIds = _spaces.filter((s: any) => (s.agentIds ?? []).includes(_activeAssistant?.id)).map((s: any) => s.id);
      const _webRecall = renderWebRecall(searchWebHistory(userMsg.content, 5, { spaceIds: _agentSpaceIds }));

      const toolMsgId = generateId('tool');
      const capabilityCtx: CapabilityContext = {
        userMsg,
        chatId,
        agentId: _activeAssistant?.id ?? null,
        assistant: _activeAssistant,
        hwProfile: _hwProfile,
        integrations: _integrations,
        model: _selectedModel,
        signal: abortControllerRef.current?.signal,
        openTabs: _openTabs,
        setStatus: (label: string) => {
          useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: (prev[chatId] ?? []).map((m: any) => m.id === toolMsgId ? { ...m, content: `[ ${label} ] ` } : m) }));
        },
      };
      const capability = capabilityForRoute(primaryToolRoute, capabilityCtx);
      toolUsed = capability?.title ?? null;

      let messagesForLLM = [...history];

      if (capability) {
        useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), { id: toolMsgId, role: 'bot', content: `[ ⚡ Interfacing with ${toolUsed}... ]`, isToolCall: true, isPinned: false, timestamp: Date.now() }] }));

        const result = await capability.execute(capabilityCtx);
        toolData = result.toolData;
        foundSources = result.sources;

        if (result.status.type === 'replace') {
          const finalContent = result.status.content;
          useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: prev[chatId].map((m: any) => m.id === toolMsgId ? { ...m, content: `[ ${finalContent} ]` } : m) }));
        } else {
          await new Promise(r => setTimeout(r, 800));
          useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: prev[chatId].filter((m: any) => m.id !== toolMsgId) }));
        }

        if (toolData) {
            // Only inject toolData into the LLM payload — never into stored messages (avoids SYSTEM NOTE bleed in chat bubbles)
            messagesForLLM = history.map(m => m.id === userMsg.id ? { ...m, content: m.content + toolData } : m);
        }
      }

      const isImageRequest = _generationMode === 'image' || /^(generate|create|draw|make|show me) (an image|a picture|a photo|a drawing|art)/i.test(inputLower);

      const currentChatRecord = useChatStore.getState().chats.find((c: any) => c.id === chatId);
      const normalizedCurrentChat = normalizeChatRecord(currentChatRecord || {}, _activeFolderId);
      const isChannelChat = normalizedCurrentChat.kind === 'channel';

      if (isChannelChat) {
        // Scoped/sticky routing (spec §5): a tagged agent stays the sole responder across follow-ups
        // until the user @s someone else. No tag + active scope → still just the scoped agent(s).
        const _stickyScopeIds = (currentChatRecord as any)?.scopedAgentIds ?? null;
        const { agents: routedAgents, scopeIds: _newScopeIds } = scopeAgentsForChat(userMsg.content, normalizedCurrentChat, _assistants, _activeFolderId, _stickyScopeIds);
        const _isScoped = !!(_newScopeIds && _newScopeIds.length > 0);
        useChatStore.getState().setChats((prev: any[]) => prev.map((c: any) => c.id === chatId ? { ...c, scopedAgentIds: _newScopeIds } : c));
        const allParticipants = getParticipantAgents(normalizedCurrentChat, _assistants);
        const mentionedIds = extractMentionedAgentIds(userMsg.content, allParticipants);
        const previousResponses: Array<{ agentName: string; content: string }> = [];

        for (const agent of routedAgents) {
          const agentBotId = generateId('msg');
          useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), { id: agentBotId, role: 'bot', content: '', sources: foundSources, agentId: agent.id, agentName: agent.name, isPinned: false, isStreaming: true, timestamp: Date.now() }] }));

          let agentText = '';
          const agentChunk = (chunk: string) => {
            agentText += chunk;
            useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: (prev[chatId] ?? []).map((m: any) => m.id === agentBotId ? { ...m, content: agentText } : m) }));
          };

          // Channel context PREPENDED so it frames the persona, not buried after it
          const channelAddendum = buildChannelPromptAddendum(normalizedCurrentChat, allParticipants, previousResponses, agent, mentionedIds.has(agent.id) || _isScoped);
          const agentWithChannelContext = {
            ...agent,
            prompt: channelAddendum + '\n\n---\n\n' + (agent.prompt || ''),
          };
          const agentPins = _globalPins.filter((p: any) => p.agentId === agent.id).map((p: any) => p.content);

          // Inject channel context directly into the user message — message-level context wins over
          // system-prompt context when strong character personas are in play.
          // Always inject the group header (even for the first agent), plus prior responses if any.
          const channelMsgHeader = `[GROUP CHANNEL: "${normalizedCurrentChat.name}" | ${allParticipants.map((a: any) => a.name).join(', ')}]`;
          const priorResponsesNote = previousResponses.length > 0
            ? `\n\n[Other agents have already responded this turn]\n${previousResponses.map((r: any) => `${r.agentName}: ${r.content}`).join('\n\n')}`
            : '';
          const agentMessages = messagesForLLM.map((m: any) =>
            m.id === userMsg.id
              ? { ...m, content: channelMsgHeader + '\n' + m.content + priorResponsesNote }
              : m
          );

          const agentResponse = await generateTextResponse({
            messages: agentMessages,
            modelConfig: _selectedModel,
            profile: _userProfile,
            userName: _userName,
            attachedDocs: userMsg.attachedFiles,
            agent: agentWithChannelContext,
            tasks: _tasks,
            recurringEvents: _recurringEvents,
            mode: isImageRequest ? 'image' : _generationMode,
            canvasContent: _canvasContent,
            isDeepThinking: _isDeepThinking,
            agentPinnedMessages: agentPins,
            onChunk: agentChunk,
            signal: abortControllerRef.current?.signal,
            appSettings: _appSettings,
            integrations: _integrations,
            models: _models,
            runIntegrationTools,
            ambientContext: _ambientContext, toolContext: _toolContext, memorySummary: _memorySummary, relevantMemory: _relevantMemory, webRecall: _webRecall,
            goal: _activeSpace?.agentGoals?.[agent.id],
          });

          const isPass = agentResponse.trim().toUpperCase() === '[PASS]';
          if (isPass) {
            useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).filter((m: any) => m.id !== agentBotId),
            }));
            continue;
          }

          useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: (prev[chatId] ?? []).map((m: any) => m.id === agentBotId ? { ...m, content: agentResponse, isStreaming: false } : m) }));
          previousResponses.push({ agentName: agent.name, content: agentResponse });
        }

        if (previousResponses.length === 0) {
          const primaryAgent = allParticipants.find((a: any) => a.id === normalizedCurrentChat.primaryAgentId) ?? allParticipants[0];
          if (primaryAgent) {
            const fallbackBotId = generateId('msg');
            useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({
              ...prev,
              [chatId]: [...(prev[chatId] ?? []), { id: fallbackBotId, role: 'bot', content: '', sources: foundSources, agentId: primaryAgent.id, agentName: primaryAgent.name, isPinned: false, isStreaming: true, timestamp: Date.now() }],
            }));
            let fallbackText = '';
            const fallbackChunk = (chunk: string) => {
              fallbackText += chunk;
              useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({
                ...prev,
                [chatId]: (prev[chatId] ?? []).map((m: any) => m.id === fallbackBotId ? { ...m, content: fallbackText } : m),
              }));
            };
            const agentPins = _globalPins.filter((p: any) => p.agentId === primaryAgent.id).map((p: any) => p.content);
            const fallbackWithContext = {
              ...primaryAgent,
              prompt: buildChannelPromptAddendum(normalizedCurrentChat, allParticipants, [], primaryAgent, true) + '\n\n---\n\n' + (primaryAgent.prompt || ''),
            };
            const fallbackResponse = await generateTextResponse({
              messages: messagesForLLM,
              modelConfig: _selectedModel,
              profile: _userProfile,
              userName: _userName,
              attachedDocs: userMsg.attachedFiles,
              agent: fallbackWithContext,
              tasks: _tasks,
              recurringEvents: _recurringEvents,
              mode: isImageRequest ? 'image' : _generationMode,
              canvasContent: _canvasContent,
              isDeepThinking: _isDeepThinking,
              agentPinnedMessages: agentPins,
              onChunk: fallbackChunk,
              signal: abortControllerRef.current?.signal,
              appSettings: _appSettings,
              integrations: _integrations,
              models: _models,
              runIntegrationTools,
              ambientContext: _ambientContext, toolContext: _toolContext, memorySummary: _memorySummary, relevantMemory: _relevantMemory, webRecall: _webRecall,
              goal: _activeSpace?.agentGoals?.[primaryAgent.id],
            });
            useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({
              ...prev,
              [chatId]: (prev[chatId] ?? []).map((m: any) => m.id === fallbackBotId ? { ...m, content: fallbackResponse, isStreaming: false } : m),
            }));
          }
        }
      } else {
        const botId = generateId('msg');
        useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), { id: botId, role: 'bot', content: '', sources: foundSources, isPinned: false, isStreaming: true, timestamp: Date.now() }] }));

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
                    if (lang !== 'task' && lang !== 'todo' && lang !== 'profile' && lang !== 'save' && lang !== 'slack_post' && lang !== 'gmail_draft' && lang !== 'gus_create' && lang !== 'gcal_event') {
                        useUIStore.getState().setCanvasContent((prev: any) => {
                            if (!prev) return { id: generateId('art'), title: `Generated ${_generationMode === 'code' ? 'App' : 'Document'}`, type: _generationMode, language: lang || 'html', content: code, isStandalone: false, history: [{ timestamp: Date.now(), content: code }], historyIndex: 0 };
                            return { ...prev, content: code };
                        });
                        useUIStore.getState().setCanvasTab('preview'); lastCanvasSync = now;
                    }
                }
            }
        };

        const _browserActiveTab = useBrowserStore.getState().activeTab;
        const _browserContext = _browserActiveTab?.content
          ? { pageContent: _browserActiveTab.content, url: _browserActiveTab.url, title: _browserActiveTab.title }
          : undefined;

        const response = await generateTextResponse({
            messages: messagesForLLM,
            modelConfig: _selectedModel,
            profile: _userProfile,
            userName: _userName,
            attachedDocs: userMsg.attachedFiles,
            agent: _activeAssistant,
            tasks: _tasks,
            recurringEvents: _recurringEvents,
            mode: isImageRequest ? 'image' : _generationMode,
            canvasContent: _canvasContent,
            isDeepThinking: _isDeepThinking,
            agentPinnedMessages: _agentPinnedMessagesForPrompt,
            onChunk: handleChunk,
            signal: abortControllerRef.current?.signal,
            appSettings: _appSettings,
            integrations: _integrations,
            models: _models,
            runIntegrationTools,
            browserContext: _browserContext,
            ambientContext: _ambientContext, toolContext: _toolContext, memorySummary: _memorySummary, relevantMemory: _relevantMemory, webRecall: _webRecall,
            goal: _activeSpace?.agentGoals?.[_activeAssistant?.id],
        });

        useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: (prev[chatId] ?? []).map((m: any) => m.id === botId ? { ...m, content: response, isStreaming: false } : m) }));
        void handleAgentActions(response, chatId, botId);

        if (_generationMode === 'code' || _generationMode === 'doc') {
           const contentWithoutThink = response.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
           const finalMatch = contentWithoutThink.match(/```([a-zA-Z]*)\n([\s\S]*?)```/);
           if (finalMatch) {
               const lang = (finalMatch[1] || '').toLowerCase();
               const code = finalMatch[2];
               if (lang !== 'task' && lang !== 'todo' && lang !== 'profile' && lang !== 'slack_post' && lang !== 'gmail_draft' && lang !== 'gus_create' && lang !== 'gcal_event') {
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
      }

    } catch (err: any) {
      if (err.name === 'AbortError') { setIsGenerating(false); return; }
      const errMsg = err?.message || (typeof err === 'string' ? err : null) || 'An unexpected error occurred.';
      useChatStore.getState().setMessages((prev: Record<string, any[]>) => {
        const msgs = prev[chatId] ?? [];
        let streamingIdx = -1;
        for (let i = msgs.length - 1; i >= 0; i--) { if ((msgs[i] as any).isStreaming) { streamingIdx = i; break; } }
        if (streamingIdx !== -1) {
          const updated = [...msgs];
          updated[streamingIdx] = { ...updated[streamingIdx], isStreaming: false, content: `### ⚠️ Generation Failed\n${errMsg}` };
          return { ...prev, [chatId]: updated };
        }
        return { ...prev, [chatId]: [...msgs, { id: generateId('err'), role: 'bot', content: `### ⚠️ Generation Failed\n${errMsg}`, isPinned: false, timestamp: Date.now() }] };
      });
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
    const { activeChatId: _activeChatId, messages: _messages } = useChatStore.getState();
    const { activeFolderId: _activeFolderId } = useAgentStore.getState();
    const _agentPinnedMessagesForPrompt = useMemoryStore.getState().globalPins
      .filter((p: any) => p.agentId === (useAgentStore.getState().assistants.find((a: any) => a.id === _activeFolderId) ?? useAgentStore.getState().assistants[0])?.id)
      .map((p: any) => p.content);

    if (isGenerating || !_selectedModel) return;
    if (!_input.trim() && _attachedDocs.length === 0) return;

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
    let chatId = _activeChatId; let isNewChat = !chatId;
    if (!chatId) {
      // Recover existing DM before creating a blank duplicate
      const existingDm = useChatStore.getState().chats
        .map((c: any) => normalizeChatRecord(c, _activeFolderId))
        .filter((c: any) => c.kind === 'dm' && (c.primaryAgentId === _activeFolderId || c.folderId === _activeFolderId))
        .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;
      if (existingDm) {
        chatId = existingDm.id;
        isNewChat = false;
        useChatStore.getState().setActiveChatId(chatId);
      } else {
        chatId = generateId('c');
        isNewChat = true;
        useChatStore.getState().setChats((prev: any[]) => [{ id: chatId, folderId: _activeFolderId, primaryAgentId: _activeFolderId, participantAgentIds: [_activeFolderId], kind: 'dm', name: _input.slice(0, 30) || 'New Session', createdAt: Date.now(), updatedAt: Date.now() }, ...prev]);
        useChatStore.getState().setActiveChatId(chatId);
      }
    }
    const userMsg = { id: generateId('msg'), role: 'user', content: _input, attachedFiles: [..._attachedDocs], isPinned: false, timestamp: Date.now() };
    if(chatId) {
        useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), userMsg] }));
        useChatStore.getState().setChats((prev: any[]) => prev.map((c: any) => c.id === chatId ? { ...c, updatedAt: Date.now() } : c));

        if (isNewChat && _input.trim() && !_selectedModel.modelId.includes('dall-e') && !_selectedModel.modelId.includes('image')) {
          generateTextResponse({ messages: [{ role: 'user', content: `Generate a very short, 2 to 4 word title for a conversation starting with this prompt: "${_input.slice(0, 100)}". Return ONLY the title, no quotes, no extra text.` }], modelConfig: _selectedModel, profile: '', attachedDocs: [], agent: { tools: {} }, tasks: [], mode: 'text', canvasContent: null, isDeepThinking: false, agentPinnedMessages: _agentPinnedMessagesForPrompt, signal: null, appSettings: _appSettings, integrations: _integrations, models: _models })
          .then(title => useChatStore.getState().setChats((prev: any[]) => prev.map((c: any) => c.id === chatId ? { ...c, name: title.replace(/["']/g, '').trim().slice(0, 40) } : c))).catch(() => {});
        }

        const currentHistory = _messages[chatId] ?? [];
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

  // Send a prompt programmatically (Home hero chips / suggestions). handleSendMessage
  // reads input from the UI store, so set it then send on the next microtask.
  const handleSendPrompt = (text: string) => {
    if (!text.trim()) return;
    useUIStore.getState().setInput(text);
    queueMicrotask(() => { void handleSendMessage(); });
  };

  const confirmEditMessage = async (msgId: string) => {
     const { editingMessageContent: _emc, activeChatId: _activeChatId, messages: _messages } = useChatStore.getState();
     if (!_emc.trim() || !_activeChatId) return;
     const chatMsgs = _messages[_activeChatId];
     const msgIdx = chatMsgs.findIndex((m: any) => m.id === msgId);
     if (msgIdx === -1) return;

     const targetMsg = chatMsgs[msgIdx];
     const historyToKeep = chatMsgs.slice(0, msgIdx);
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
    if (isToolCall) return <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-ink-3 animate-pulse"><Workflow className="w-3.5 h-3.5" /> {rawText}</div>;
    if (isStreaming && !rawText) return <TypingIndicator />;
    
    const elements = [];
    if (attachedFiles?.length > 0) elements.push(<div key="files" className="flex flex-wrap gap-2 mb-3">{attachedFiles.map((f: any, i: number) => f.isImage ? <img key={i} src={f.content} alt={f.name} className="h-32 object-cover rounded-xl shadow-sm border border-edge" /> : <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-on-accent/15 rounded-xl border border-on-accent/30 text-[10px] font-bold text-on-accent shadow-sm"><FileText className="w-3.5 h-3.5" />{f.name}</div>)}</div>);
    if (typeof rawText !== 'string') return elements;
    const openFileInPanel = (path?: string) => { useMemoryStore.getState().setShowMemmoPanel(true); useMemoryStore.getState().setMemmoPanelTab(path?.includes('/library/') ? 'library' : path ? 'notes' : 'pins'); };
    if (rawText.startsWith('### ⚠️')) return <div className="text-danger font-medium"><FormattedText text={rawText} sources={sources} onViewImage={viewImageInCanvas} onOpenFile={openFileInPanel} /></div>;

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

    // Pre-scan for all profile facts so we can offer "Approve All"
    const allProfileFacts: string[] = [];
    { const pr = /```profile\n([\s\S]*?)```/g; let pm; while ((pm = pr.exec(displayContent)) !== null) { try { const d = JSON.parse(pm[1].trim()); if (d.fact) allProfileFacts.push(d.fact); } catch {} } }
    const pendingProfileFacts = allProfileFacts.filter(f => !useSettingsStore.getState().userProfile.includes(f));
    let profileBlockIdx = 0;

    const regex = /```(\w+)?\n([\s\S]*?)```/g;
    let lastIndex = 0, match;
    while ((match = regex.exec(displayContent)) !== null) {
      if (match.index > lastIndex) elements.push(<FormattedText key={`t-${match.index}`} text={displayContent.slice(lastIndex, match.index)} sources={sources} onSaveImage={saveImageToLibrary} onViewImage={viewImageInCanvas} onOpenFile={openFileInPanel} />);
      const lang = (match[1] ?? 'text').toLowerCase(), code = match[2].trim();
      
      if (lang === 'task' || lang === 'todo') {
        try {
          const td = JSON.parse(code);
          elements.push(
            <div key={`task-${match.index}`} className="my-3 p-4 rounded-xl border-2 border-accent/25 bg-accent-soft/30 flex flex-col gap-3 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3"><div className="p-2 bg-accent rounded-lg shrink-0"><ListTodo className="w-5 h-5 text-on-accent" /></div><div className="flex flex-col"><span className="text-xs font-black text-accent-soft-ink uppercase tracking-widest">Proposed Action</span><span className="text-sm font-bold text-ink">{td.title}</span><div className="flex items-center gap-3 mt-1 flex-wrap">{td.dueDate && <span className="text-[10px] text-ink-2 flex items-center gap-1 font-bold"><Clock className="w-3 h-3 text-accent" /> Due: {td.dueDate}</span>}{td.location && <span className="text-[10px] text-ink-2 flex items-center gap-1 font-bold"><MapPin className="w-3 h-3 text-success" /> {td.location}</span>}</div></div></div>
                <button onClick={() => { addTask(td.title, td.dueDate, td.details, td.location); useTaskStore.getState().setShowPlanner(true); }} className="px-3 py-2 bg-accent text-on-accent rounded-lg text-xs font-bold hover:bg-accent-strong shadow-md transition-all active:scale-95 shrink-0">Add to Planner</button>
              </div>
              {td.details && <div className="text-xs bg-panel p-2 rounded-lg border border-accent/25 text-ink-2"><span className="font-bold flex items-center gap-1 mb-1"><AlignLeft className="w-3 h-3" /> Details</span>{td.details}</div>}
            </div>
          );
        } catch { elements.push(<div key={`err-${match.index}`} className="p-2 text-xs text-danger">Failed to parse task.</div>); }
      } else if (lang === 'profile') {
        try {
          const pData = JSON.parse(code);
          const _currentProfile = useSettingsStore.getState().userProfile;
          const isApproved = _currentProfile.includes(pData.fact);
          const thisBlockIdx = profileBlockIdx++;
          const isLastPendingBlock = pendingProfileFacts.length > 1 && thisBlockIdx === allProfileFacts.length - 1;
          const approveAll = () => {
            const base = useSettingsStore.getState().userProfile;
            const toAdd = pendingProfileFacts.filter(f => !useSettingsStore.getState().userProfile.includes(f));
            if (toAdd.length) useSettingsStore.getState().setUserProfile(base + (base ? '\n' : '') + toAdd.join('\n'));
          };
          elements.push(
             <div key={`prof-${match.index}`} className="my-3 p-4 rounded-xl border border-accent/40 bg-accent-soft/30 flex flex-col gap-2">
               <div className="flex items-center gap-2 text-accent font-bold text-xs uppercase tracking-widest"><UserPlus className="w-4 h-4"/> Profile Knowledge Update</div>
               <p className="text-sm text-ink-2">"{pData.fact}"</p>
               <div className="flex gap-2 mt-2">
                 <button disabled={isApproved} onClick={() => useSettingsStore.getState().setUserProfile(useSettingsStore.getState().userProfile + (useSettingsStore.getState().userProfile ? '\n' : '') + pData.fact)} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${isApproved ? 'bg-success text-success-soft opacity-50 cursor-default' : 'bg-accent hover:bg-accent-strong text-on-accent active:scale-95'}`}>
                   {isApproved ? 'Saved to Profile' : 'Approve'}
                 </button>
                 {isLastPendingBlock && <button onClick={approveAll} className="flex-1 py-2 rounded-lg text-xs font-bold bg-accent hover:bg-accent-strong text-on-accent active:scale-95 transition-all">Approve All ({pendingProfileFacts.length})</button>}
               </div>
             </div>
          );
        } catch { elements.push(<div key={`err-p-${match.index}`} className="p-2 text-xs text-danger">Failed to parse profile update.</div>); }
      } else if (lang === 'file_op') {
        try {
          const fop = JSON.parse(code);
          const opKey = `${msg.id}:${match.index}`;
          elements.push(
            fop.action === 'command'
              ? <CommandActionCard key={`fop-${match.index}`} op={fop} opKey={opKey} streaming={!!isStreaming} onToast={showToast} />
              : <FileActionCard key={`fop-${match.index}`} op={fop} opKey={opKey} streaming={!!isStreaming} onToast={showToast} />
          );
        } catch {
          // Incomplete while streaming — render nothing until the block closes and parses.
          if (!isStreaming) elements.push(<div key={`err-fop-${match.index}`} className="p-2 text-xs text-danger">Failed to parse file operation.</div>);
        }
      } else if (lang === 'save') {
        try {
          const sd = JSON.parse(code);
          const saveTitle = sd.title || 'Saved Note';
          const saveContent = sd.content || code;
          elements.push(
            <div key={`save-${match.index}`} className="my-3 p-4 rounded-xl border border-warning/40 bg-warning-soft/40 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-warning font-bold text-xs uppercase tracking-widest"><Bookmark className="w-4 h-4" /> Save to Library</div>
              <p className="text-sm font-bold text-ink">"{saveTitle}"</p>
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
              }} className="mt-1 py-2 rounded-lg text-xs font-bold bg-warning hover:opacity-90 text-warning-soft active:scale-95 transition-all">
                Save to Library
              </button>
            </div>
          );
        } catch { elements.push(<div key={`err-save-${match.index}`} className="p-2 text-xs text-danger">Failed to parse save block.</div>); }
      } else if (lang === 'event') {
        try {
          const ev = JSON.parse(code);
          elements.push(<EventCard key={`ev-${match.index}`} data={ev} onToast={showToast} />);
        } catch { elements.push(<div key={`err-ev-${match.index}`} className="p-2 text-xs text-danger">Failed to parse event block.</div>); }
      } else if (lang === 'event_update') {
        try {
          const ev = JSON.parse(code);
          elements.push(<EventUpdateCard key={`evu-${match.index}`} data={ev} onToast={showToast} />);
        } catch { elements.push(<div key={`err-evu-${match.index}`} className="p-2 text-xs text-danger">Failed to parse event update.</div>); }
      } else if (lang === 'event_delete') {
        try {
          const ev = JSON.parse(code);
          elements.push(<EventDeleteCard key={`evd-${match.index}`} data={ev} onToast={showToast} />);
        } catch { elements.push(<div key={`err-evd-${match.index}`} className="p-2 text-xs text-danger">Failed to parse event delete.</div>); }
      } else if (lang === 'slack_post') {
        try {
          const sd = JSON.parse(code);
          const _integrations = useSettingsStore.getState().integrations;
          elements.push(
            <div key={`slack-${match.index}`} className="my-3 p-4 rounded-xl border-2 border-accent/25 bg-accent-soft/30 flex flex-col gap-3 shadow-sm">
              <div className="flex items-center gap-2 text-accent font-bold text-xs uppercase tracking-widest"><MessageSquare className="w-4 h-4" /> Post to Slack</div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-ink-3">Channel</span>
                <span className="text-sm font-bold text-ink">#{sd.channel}</span>
              </div>
              <div className="text-xs bg-panel p-3 rounded-lg border border-edge text-ink-2 whitespace-pre-wrap">{sd.text}</div>
              <button onClick={async () => {
                const token = _integrations.slack?.botToken;
                if (!token) { showToast('Slack not configured.'); return; }
                try {
                  const { fetchWithRetry: fw } = await import('./services/llm');
                  const res = await fw('https://slack.com/api/chat.postMessage', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel: sd.channel, text: sd.text }),
                  }, 1);
                  if (res.ok) { showToast('✅ Posted to Slack'); } else { showToast(`Slack error: ${res.error}`); }
                } catch (e: any) { showToast(`Slack error: ${e.message}`); }
              }} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-accent hover:bg-accent-strong text-on-accent active:scale-95 transition-all">
                <Send className="w-3.5 h-3.5" /> Post Message
              </button>
            </div>
          );
        } catch { elements.push(<div key={`err-sl-${match.index}`} className="p-2 text-xs text-danger">Failed to parse Slack post.</div>); }
      } else if (lang === 'gmail_draft') {
        try {
          const gd = JSON.parse(code);
          const _integrations = useSettingsStore.getState().integrations;
          elements.push(
            <div key={`gmail-${match.index}`} className="my-3 p-4 rounded-xl border-2 border-danger/30 bg-danger-soft/40 flex flex-col gap-3 shadow-sm">
              <div className="flex items-center gap-2 text-danger font-bold text-xs uppercase tracking-widest"><Mail className="w-4 h-4" /> Send Gmail Draft</div>
              <div className="grid grid-cols-1 gap-1.5 text-xs">
                <div><span className="font-black text-ink-3 uppercase tracking-widest text-[10px]">To</span> <span className="text-ink font-bold ml-1">{gd.to}</span></div>
                {gd.cc && <div><span className="font-black text-ink-3 uppercase tracking-widest text-[10px]">CC</span> <span className="text-ink font-bold ml-1">{gd.cc}</span></div>}
                <div><span className="font-black text-ink-3 uppercase tracking-widest text-[10px]">Subject</span> <span className="text-ink font-bold ml-1">{gd.subject}</span></div>
              </div>
              <div className="text-xs bg-panel p-3 rounded-lg border border-edge text-ink-2 whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">{gd.body}</div>
              <button onClick={async () => {
                const gw = _integrations.googleWorkspace;
                if (!gw?.connected || !gw.clientId || !gw.clientSecret || !gw.refreshToken) { showToast('Google Workspace not configured.'); return; }
                try {
                  const { fetchWithRetry: fw } = await import('./services/llm');
                  const tokenRes = await fw('https://oauth2.googleapis.com/token', {
                    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ client_id: gw.clientId, client_secret: gw.clientSecret, refresh_token: gw.refreshToken, grant_type: 'refresh_token' }).toString(),
                  }, 1);
                  if (!tokenRes.access_token) throw new Error('Token refresh failed');
                  const raw = [`To: ${gd.to}`, gd.cc ? `Cc: ${gd.cc}` : null, `Subject: ${gd.subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', gd.body].filter(Boolean).join('\r\n');
                  const encoded = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                  const res = await fw('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                    method: 'POST', headers: { Authorization: `Bearer ${tokenRes.access_token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ raw: encoded }),
                  }, 1);
                  if (res.id) { showToast('✅ Email sent'); } else { showToast('Gmail send failed'); }
                } catch (e: any) { showToast(`Gmail error: ${e.message}`); }
              }} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-danger hover:opacity-90 text-danger-soft active:scale-95 transition-all">
                <Send className="w-3.5 h-3.5" /> Send Email
              </button>
            </div>
          );
        } catch { elements.push(<div key={`err-gm-${match.index}`} className="p-2 text-xs text-danger">Failed to parse Gmail draft.</div>); }
      } else if (lang === 'gus_create') {
        try {
          const gc = JSON.parse(code);
          const _integrations = useSettingsStore.getState().integrations;
          elements.push(
            <div key={`gus-${match.index}`} className="my-3 p-4 rounded-xl border-2 border-accent/25 bg-accent-soft/30 flex flex-col gap-3 shadow-sm">
              <div className="flex items-center gap-2 text-accent font-bold text-xs uppercase tracking-widest"><Layers className="w-4 h-4" /> Create GUS Work Item</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="font-black text-ink-3 uppercase tracking-widest text-[10px] block">Subject</span><span className="text-ink font-bold">{gc.subject}</span></div>
                <div><span className="font-black text-ink-3 uppercase tracking-widest text-[10px] block">Type</span><span className="text-ink font-bold">{gc.type ?? 'Story'}</span></div>
                {gc.priority && <div><span className="font-black text-ink-3 uppercase tracking-widest text-[10px] block">Priority</span><span className="text-ink font-bold">{gc.priority}</span></div>}
                {gc.assignee && <div><span className="font-black text-ink-3 uppercase tracking-widest text-[10px] block">Assignee</span><span className="text-ink font-bold">{gc.assignee}</span></div>}
              </div>
              {gc.details && <div className="text-xs bg-panel p-3 rounded-lg border border-edge text-ink-2">{gc.details}</div>}
              <button onClick={async () => {
                const { instanceUrl, accessToken } = _integrations.gus ?? {};
                if (!instanceUrl || !accessToken) { showToast('GUS not configured.'); return; }
                try {
                  const { fetchWithRetry: fw } = await import('./services/llm');
                  const url = `${instanceUrl.replace(/\/$/, '')}/services/data/v59.0/sobjects/ADM_Work__c`;
                  const body: any = { Subject__c: gc.subject, Type__c: gc.type ?? 'Story' };
                  if (gc.priority) body.Priority__c = gc.priority;
                  if (gc.details) body.Details__c = gc.details;
                  const res = await fw(url, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                  }, 1);
                  if (res.id) { showToast(`✅ Created ${res.id}`); } else { showToast('GUS create failed'); }
                } catch (e: any) { showToast(`GUS error: ${e.message}`); }
              }} className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold bg-accent hover:bg-accent-strong text-on-accent active:scale-95 transition-all">
                <CheckCircle2 className="w-3.5 h-3.5" /> Create Work Item
              </button>
            </div>
          );
        } catch { elements.push(<div key={`err-gus-${match.index}`} className="p-2 text-xs text-danger">Failed to parse GUS work item.</div>); }
      } else if (lang === 'gcal_event') {
        try {
          const ge = JSON.parse(code);
          elements.push(<GcalEventCard key={`gcal-${match.index}`} data={ge} onToast={showToast} />);
        } catch { elements.push(<div key={`err-gcal-${match.index}`} className="p-2 text-xs text-danger">Failed to parse calendar event.</div>); }
      } else if (lang === 'gcal_update') {
        try {
          const ge = JSON.parse(code);
          elements.push(<GcalUpdateCard key={`gcalu-${match.index}`} data={ge} onToast={showToast} />);
        } catch { elements.push(<div key={`err-gcalu-${match.index}`} className="p-2 text-xs text-danger">Failed to parse calendar update.</div>); }
      } else if (lang === 'gcal_delete') {
        try {
          const ge = JSON.parse(code);
          elements.push(<GcalDeleteCard key={`gcald-${match.index}`} data={ge} onToast={showToast} />);
        } catch { elements.push(<div key={`err-gcald-${match.index}`} className="p-2 text-xs text-danger">Failed to parse calendar delete.</div>); }
      } else if (code.length > 5 && lang !== 'task' && lang !== 'todo' && lang !== 'profile' && lang !== 'save' && lang !== 'event') {
        const codePreview = code.split('\n').slice(0, 4).join('\n') + (code.split('\n').length > 4 ? '\n...' : '');
        elements.push(
          <div key={`art-${match.index}`} className="my-4 rounded-2xl border border-edge bg-inset overflow-hidden flex flex-col group/art shadow-sm transition-all hover:border-accent/50">
            <div className="flex items-center justify-between p-3 border-b border-edge bg-wash">
              <div className="flex items-center gap-2"><Code className="w-4 h-4 text-accent" /><span className="text-xs font-bold text-ink-2">{(lang || 'CODE').toUpperCase()} Snippet</span></div>
              <button onClick={() => { useUIStore.getState().setCanvasContent({ id: generateId('art'), language: lang, content: code, title: 'Extracted Artifact', type: 'code', isStandalone: false, history: [{ timestamp: Date.now(), content: code }], historyIndex: 0 }); useUIStore.getState().setGenerationMode('code'); useUIStore.getState().setCanvasTab('code'); useTaskStore.getState().setShowPlanner(false); }} className="px-3 py-1.5 bg-panel border border-edge rounded-lg text-[10px] font-black uppercase tracking-widest text-accent hover:bg-accent-soft/40 transition-all shadow-sm">Open in Canvas</button>
            </div>
            <div className="p-4 bg-inset text-ink-2 text-xs font-mono overflow-hidden"><pre><code>{codePreview}</code></pre></div>
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
      <div className="h-screen w-full flex flex-col items-center justify-center bg-base text-ink font-sans animate-in fade-in duration-500">
        <div className="p-4 bg-accent rounded-2xl shadow-2xl mb-6 shadow-accent/20"><Bot className="w-8 h-8 text-on-accent animate-pulse" /></div>
        <h1 className="text-2xl font-black uppercase tracking-tighter mb-2">Agent Forge</h1>
        <div className="flex items-center gap-2 text-ink-3 font-bold text-xs uppercase tracking-widest"><Loader2 className="w-4 h-4 animate-spin" /> Secure Storage Linking...</div>
      </div>
    );
  }

  // ── Slash command handler ──────────────────────────────────────────────────
  function handleSlashCommand(cmd: SlashCommand) {
    const ui = useUIStore.getState();
    const mem = useMemoryStore.getState();
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
    }
    ui.setSlashHighlight(0);
  }

  // ── Hoisted prop bags (shared by inline + docked ChatPanel) ──────────────
  const spaceLogProps = {
    activeMessages,
    isGenerating,
    activeAssistant,
    forgettingIndex: appSettings?.showContextWindowLine ? forgettingIndex : -1,
    onConfirmEdit: confirmEditMessage,
    onBookmark: handleBookmark,
    onToggleSpeak: toggleSpeak,
    onAddTask: addTask,
    messagesEndRef,
    onRenderMessage: renderMessageWithWidgets,
    onToast: showToast,
    dropdownRef,
    llamaPaused,
    llamaCoolingDown,
    systemPromptLen,
    hasErrorLogs,
    errorLogsCount,
    onRunDreamCycle: runDreamCycle,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    isDragging,
    showAgentIntro,
    onDismissAgentIntro: () => { setShowAgentIntro(false); db.set('agentIntroSeen', true); },
  };

  const chatInputBarProps = {
    isGenerating,
    isEnhancing,
    selectedModel,
    modelDropdownRef,
    onSend: handleSendMessage,
    onStop: handleStop,
    onChatFileUpload: handleChatFileUpload,
    onEnhancePrompt: handleEnhancePrompt,
    fileInputRef,
    activeAssistant,
    channelParticipants,
    llamaServerPid,
    llamaPaused,
    setLlamaPaused,
    llamaCoolingDown,
    isListening,
    onToggleListening: toggleListening,
    onSlashCommand: handleSlashCommand,
  };

  // Render the content for any tab — the chat (space-log) is just another tab,
  // shown full-width by default and splittable beside another.
  const renderTabContent = (tab: typeof activeOmniTab) => {
    if (tab?.type === 'home') {
      return <StartPage onAsk={handleSendPrompt} tabId={tab.id} />;
    }
    if (!tab || tab.type === 'space-log') {
      return (
        <ChatPanel
          mode="inline"
          spaceLogProps={spaceLogProps}
          chatInputBarProps={chatInputBarProps}
          isThreadEmpty={activeMessages.length === 0}
          onSendPrompt={handleSendPrompt}
        />
      );
    }
    if (tab.type === 'web') {
      return <BrowserTabContent tabId={tab.id} initialUrl={tab.url} />;
    }
    if (tab.type === 'tool' && tab.toolId === 'knowledge-graph') {
      return <KnowledgeGraphPanel />;
    }
    if (tab.type === 'tool' && tab.toolId === 'planner') {
      return <PlannerPanel onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} />;
    }
    if (tab.type === 'tool' && tab.toolId === 'calendar') {
      return <CalendarPanel onToast={showToast} />;
    }
    if (tab.type === 'tool' && tab.toolId === 'inbox') {
      return <MailInboxPanel />;
    }
    if (tab.type === 'tool' && tab.toolId === 'messages') {
      return <MessagesPanel />;
    }
    if (tab.type === 'tool' && tab.toolId === 'notes') {
      return <NotesPanel />;
    }
    if (tab.type === 'tool' && tab.toolId === 'activity') {
      return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <ActivityPanel
            messages={activeMessages}
            systemPromptLen={systemPromptLen}
            limit={selectedModel?.contextLimit ?? 32000}
          />
        </div>
      );
    }
    if (tab.type === 'code-canvas' || tab.type === 'doc') {
      const tabAnns = annotations.filter(a => a.tabId === tab.id && a.status === 'open');
      return (
        <>
          {canvasContent ? (
            <CanvasPanel
              isGenerating={isGenerating}
              onHistoryNavigate={handleHistoryNavigate}
              onSaveToLibrary={saveToLibrary}
              codeRef={codeRef}
              lineNumbersRef={lineNumbersRef}
              onCodeScroll={handleCodeScroll}
              onSendMessage={handleSendMessage}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center h-full gap-4 text-center px-8">
              <p className="text-sm text-ink-2 max-w-xs">
                Nothing here yet. Start {tab.type === 'doc' ? 'a document' : 'a canvas'} and an agent can build in it alongside you.
              </p>
              <button
                onClick={() => setPendingArtifactType(tab.type === 'doc' ? 'doc' : 'code')}
                className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-accent text-on-accent hover:bg-accent-strong transition-all shadow-md"
              >
                Start {tab.type === 'doc' ? 'a document' : 'a canvas'}
              </button>
            </div>
          )}
          {/* Ghost UI: Agent Vision toggle + marginalia overlay */}
          <div className="absolute top-3 right-3 z-50">
            <AgentVisionToggle on={agentVisionOn} onToggle={setAgentVisionOn} />
          </div>
          <MarginaliaLayer
            tabId={tab.id}
            annotations={tabAnns}
            visible={agentVisionOn}
            onAccept={(id) => useMarginaliaStore.getState().updateAnnotationStatus(id, 'accepted')}
            onDismiss={(id) => useMarginaliaStore.getState().updateAnnotationStatus(id, 'dismissed')}
          />
        </>
      );
    }
    return null;
  };

  // Drag the split divider to resize the two panes.
  const handleSplitDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      const rect = splitContainerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      useUIStore.getState().setSplitRatio((ev.clientX - rect.left) / rect.width);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="flex h-screen overflow-hidden w-full font-sans transition-colors duration-300 bg-base text-ink">

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

      {showMemmoPanel && memmoPanelTab === 'inbox' && (
        <div className="fixed inset-0 z-40 bg-transparent" onClick={() => useMemoryStore.getState().setShowMemmoPanel(false)} />
      )}
      {/* Inbox panel — shown instead of MemmoPanel when inbox tab active */}
      <div className={`fixed top-0 right-0 h-full w-80 z-50 bg-panel-2 border-l border-edge shadow-2xl flex flex-col transition-transform duration-300 overflow-y-auto ${
        showMemmoPanel && memmoPanelTab === 'inbox' ? 'translate-x-0' : 'translate-x-full'
      }`}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-edge shrink-0">
          <span className="text-xs font-black uppercase tracking-widest text-ink-2">Inbox</span>
          <button onClick={() => useMemoryStore.getState().setShowMemmoPanel(false)} className="p-1.5 rounded-lg hover:bg-wash text-ink-3 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <InboxPanel
          agentForgePath={agentForgePath}
          activeAgentId={activeFolderId}
          onToast={showToast}
          onOpenChat={() => useMemoryStore.getState().setShowMemmoPanel(false)}
        />
      </div>

      <MemmoPanel
        isOpen={showMemmoPanel && memmoPanelTab !== 'inbox'}
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
        initialTab={memmoPanelTab === 'inbox' ? undefined : memmoPanelTab}
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
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[300] bg-ink text-panel px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300 font-bold text-xs uppercase tracking-widest">
           <AlertTriangle className="w-4 h-4 text-warning" />
           {toastMessage}
           {toastAction && (
             <button
               onClick={() => { toastAction.onClick(); useUIStore.getState().clearToast(); }}
               className="ml-1 underline underline-offset-2 text-warning hover:opacity-80 transition-colors"
             >
               {toastAction.label}
             </button>
           )}
        </div>
      )}

      {showConsole && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-panel-2 w-full max-w-2xl h-[60vh] rounded-2xl flex flex-col shadow-2xl border border-edge-2 font-mono text-xs overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-edge bg-inset shrink-0"><span className="text-ink-2 font-bold flex items-center gap-2"><Activity className="w-4 h-4"/> App Console Log</span><div className="flex gap-4"><button onClick={() => useUIStore.getState().clearLogs()} className="text-ink-3 hover:text-ink font-bold tracking-widest uppercase">Clear</button><button onClick={() => useUIStore.getState().setShowConsole(false)} className="text-ink-3 hover:text-ink"><X className="w-4 h-4"/></button></div></div>
            <div className="flex-1 overflow-auto p-4 space-y-2 custom-scrollbar select-text">{logs.length === 0 ? <span className="text-ink-3 italic">No logs yet...</span> : logs.map((l, i) => (<div key={i} className={`flex gap-3 ${l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warning' : 'text-ink-2'}`}><span className="text-ink-3 shrink-0 select-none">[{l.time}]</span><span className="break-all whitespace-pre-wrap">{l.msg}</span></div>))}</div>
          </div>
        </div>
      )}

      {/* ── Sidebar ── */}
      <AppSidebar />

      {/* ── Center column: tab bar + viewport ── */}
      <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
        <OmniTabBar />

        <div ref={splitContainerRef} className="flex-1 flex overflow-hidden min-h-0">
          {/* PRIMARY pane — the active tab, full width unless split */}
          <div
            className="relative overflow-hidden min-w-0 flex flex-col"
            style={{ flex: splitTab ? `0 0 ${splitRatio * 100}%` : '1 1 100%' }}
          >
            {renderTabContent(activeOmniTab)}
          </div>

          {/* SPLIT pane — a second tab beside the active one, with a draggable divider */}
          {splitTab && (
            <>
              <div
                onMouseDown={handleSplitDrag}
                className="w-1 shrink-0 cursor-col-resize bg-edge-2 hover:bg-accent transition-colors"
                title="Drag to resize"
              />
              <div className="relative overflow-hidden min-w-0 flex flex-col flex-1">
                <button
                  onClick={() => useUIStore.getState().setSplitTabId(null)}
                  className="absolute top-2 right-2 z-[60] p-1 rounded-md bg-panel/80 text-ink-3 hover:text-ink hover:bg-inset transition-colors"
                  title="Close split"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                {renderTabContent(splitTab)}
              </div>
            </>
          )}

          {/* ── Co-pilot rail: the active agent, docked beside a tool/web/canvas tab ── */}
          {activeOmniTab && ['tool', 'web', 'code-canvas', 'doc'].includes(activeOmniTab.type) && (
            copilotOpen ? (
              <>
                <div className="w-px shrink-0 bg-edge-2" />
                <div className="relative shrink-0 w-[360px] min-w-[300px] flex flex-col border-l border-edge bg-panel">
                  <div className="h-9 flex items-center gap-2 px-3 border-b border-edge shrink-0">
                    <Bot className="w-4 h-4 text-accent shrink-0" />
                    <select
                      value={activeAssistant?.id ?? ''}
                      onChange={(e) => useAgentStore.getState().setActiveFolderId(e.target.value)}
                      className="text-xs font-semibold text-ink bg-transparent outline-none flex-1 min-w-0 cursor-pointer"
                      title="Switch agent"
                    >
                      {assistants.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <button
                      onClick={() => toggleCopilot(false)}
                      className="p-1 rounded-md text-ink-3 hover:text-ink hover:bg-inset transition-colors"
                      title="Hide agent"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <ChatPanel
                      mode="inline"
                      spaceLogProps={spaceLogProps}
                      chatInputBarProps={chatInputBarProps}
                      isThreadEmpty={activeMessages.length === 0}
                      onSendPrompt={handleSendPrompt}
                    />
                  </div>
                </div>
              </>
            ) : (
              <button
                onClick={() => toggleCopilot(true)}
                className="shrink-0 w-9 flex flex-col items-center pt-3 border-l border-edge bg-panel text-ink-3 hover:text-ink hover:bg-wash transition-colors"
                title="Show agent"
              >
                <Bot className="w-4 h-4" />
              </button>
            )
          )}
        </div>
      </div>

      {/* ── Modals ── */}

      {/* Global ⌘K command palette / library net */}
      <CmdKPalette />

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
        <ProfileSettingsModal
          fetchImageModels={fetchImageModels}
          testImageEngine={testImageEngine}
          viewImageInCanvas={viewImageInCanvas}
        />
      )}

      {/* New Space wizard — name, goal, invite agents/people */}
      {showNewSpace && <NewSpaceModal />}

      {/* Save Artifact Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-panel-2 w-full max-w-sm rounded-[2rem] shadow-2xl p-6 border border-edge text-ink">
            <h3 className="text-lg font-black mb-4 tracking-tight">Save to Archives</h3>
            <div className="space-y-4">
               <div>
                  <label className="text-[10px] font-black uppercase opacity-40 block mb-1">Project Name</label>
                  <input type="text" value={saveAppData.title} onChange={e => useUIStore.getState().setSaveAppData({ ...useUIStore.getState().saveAppData, title: e.target.value })} className="w-full bg-inset border-none rounded-xl px-4 py-3 text-sm text-ink outline-none font-bold" />
               </div>
            </div>
            <div className="flex gap-2 mt-8">
              <button onClick={() => setShowSaveModal(false)} className="flex-1 py-3 text-xs font-black uppercase text-ink-3 rounded-xl hover:bg-wash">Cancel</button>
              <button onClick={() => saveToLibrary(true)} className="flex-1 py-3 text-xs font-black uppercase bg-accent text-on-accent rounded-xl hover:bg-accent-strong">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding wizard */}
      {showOnboarding && (
        <OnboardingWizard onClose={() => { useSettingsStore.getState().setShowOnboarding(false); useSettingsStore.getState().setOnboardingInitialStep(1); }} initialStep={onboardingInitialStep} />
      )}

      {/* Agent action approval — sends/deletes the agent wants to run (local writes auto-applied) */}
      {pendingActions.length > 0 && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-panel-2 w-full max-w-md rounded-2xl border border-edge shadow-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-accent" />
              <span className="text-sm font-black tracking-tight text-ink">Approve action{pendingActions.length > 1 ? 's' : ''}</span>
            </div>
            <p className="text-xs text-ink-3">{activeAssistant?.name ?? 'The agent'} wants to do {pendingActions.length > 1 ? 'these' : 'this'}. Review before it runs.</p>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {pendingActions.map((a, i) => (
                <div key={i} className="flex items-center gap-2 p-3 rounded-xl border border-edge bg-inset">
                  <span className="text-sm text-ink-2 flex-1 break-words">{describeAction(a)}</span>
                  <button
                    onClick={async () => { try { showToast(`✓ ${await executeAgentAction(a)}`); } catch (e) { showToast(`Failed: ${String(e)}`); } setPendingActions(p => p.filter((_, j) => j !== i)); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-accent text-on-accent hover:bg-accent-strong transition-colors shrink-0"
                  >Approve</button>
                  <button
                    onClick={() => setPendingActions(p => p.filter((_, j) => j !== i))}
                    className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest border border-edge-2 text-ink-2 hover:bg-wash transition-colors shrink-0"
                  >Skip</button>
                </div>
              ))}
            </div>
            <button onClick={() => setPendingActions([])} className="self-end text-xs font-medium text-ink-3 hover:text-ink transition-colors">Dismiss all</button>
          </div>
        </div>
      )}

      {/* Artifact start picker */}
      {pendingArtifactType && (
        <ArtifactStartModal
          type={pendingArtifactType}
          onConfirm={(agentId) => confirmArtifactCreate(agentId, pendingArtifactType)}
          onCancel={() => setPendingArtifactType(null)}
        />
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
