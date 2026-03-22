import './index.css';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Menu, Plus, Settings, Trash2, Send, Paperclip, X, RefreshCw, Bot, Wand2, Square, Code,
  FileText, ChevronDown, Globe, Zap, Search, Pin, CalendarDays,
  CheckCircle2, Circle, Clock, ListTodo, ChevronLeft, ChevronRight, LayoutList,
  FileEdit, TerminalSquare, AlignLeft, ImageIcon, MapPin, Workflow, List, ShieldCheck,
  AlertTriangle, Loader2, PlusCircle, Edit2, Brain, Activity, Save, UserPlus,
  MessageSquare, GripVertical, Link, Edit3, BookOpen, UserCog, Mic, Volume2, VolumeX, Copy, Database, Download
} from 'lucide-react';

import { db } from './services/database';
import { loadPDFJS, extractTextFromPDF } from './services/pdfParser';

import { getContextLimit, validateModel, buildSystemPrompt, generateTextResponse } from './services/llm';

// ─── Constants & Configurations ───────────────────────────────────────────────

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB Limit

const BOT_COLORS = [
  { id: 'brand', bg: 'bg-[#2C3E50]', border: 'border-[#2C3E50]', text: 'text-[#9EADC8]' },
  { id: 'amber', bg: 'bg-[#D4AA7D]', border: 'border-[#D4AA7D]', text: 'text-[#D4AA7D]' },
  { id: 'rose', bg: 'bg-[#C98A8A]', border: 'border-[#C98A8A]', text: 'text-[#C98A8A]' },
  { id: 'sage', bg: 'bg-[#9FBBAF]', border: 'border-[#9FBBAF]', text: 'text-[#9FBBAF]' },
  { id: 'lavender', bg: 'bg-[#A89FBB]', border: 'border-[#A89FBB]', text: 'text-[#A89FBB]' },
  { id: 'sky', bg: 'bg-[#9EADC8]', border: 'border-[#9EADC8]', text: 'text-[#9EADC8]' },
  { id: 'mint', bg: 'bg-[#A9C8A1]', border: 'border-[#A9C8A1]', text: 'text-[#A9C8A1]' },
  { id: 'peach', bg: 'bg-[#D9A098]', border: 'border-[#D9A098]', text: 'text-[#D9A098]' },
  { id: 'slate', bg: 'bg-[#6A829E]', border: 'border-[#6A829E]', text: 'text-[#6A829E]' },
  { id: 'blush', bg: 'bg-[#E3B5A4]', border: 'border-[#E3B5A4]', text: 'text-[#E3B5A4]' },
  { id: 'sand', bg: 'bg-[#D4C3A3]', border: 'border-[#D4C3A3]', text: 'text-[#D4C3A3]' },
  { id: 'olive', bg: 'bg-[#899C85]', border: 'border-[#899C85]', text: 'text-[#899C85]' },
  { id: 'crimson', bg: 'bg-[#990000]', border: 'border-[#990000]', text: 'text-[#990000]' },
  { id: 'teal', bg: 'bg-[#008080]', border: 'border-[#008080]', text: 'text-[#008080]' },
  { id: 'indigo', bg: 'bg-[#4B0082]', border: 'border-[#4B0082]', text: 'text-[#4B0082]' },
  { id: 'gold', bg: 'bg-[#DAA520]', border: 'border-[#DAA520]', text: 'text-[#DAA520]' },
  { id: 'plum', bg: 'bg-[#DDA0DD]', border: 'border-[#DDA0DD]', text: 'text-[#DDA0DD]' },
];

const AVAILABLE_TOOLS = [
  { id: 'web_search', name: 'Web Search', icon: Globe, desc: 'Allow agent to search the live internet.' },
  { id: 'local_workspace', name: 'Workspace RAG', icon: Database, desc: 'Allow agent to search local project folders via LanceDB.' },
  { id: 'calendar_sync', name: 'Calendar Sync', icon: CalendarDays, desc: 'Allow agent to read and write to your Planner.' }
];

const DEFAULT_ASSISTANT = {
  id: 'f-default',
  name: 'Assistant',
  avatar: { type: 'color', color: 'brand' },
  prompt: 'You are a helpful AI assistant.',
  trainingDocs: [],
  systemAccess: false,
  tools: { web_search: false, calendar_sync: false, local_workspace: false },
  defaultModelId: '',
  defaultMode: 'text',
  awareOfProfile: true,
  isDefault: true,
};

// ─── Utility Helpers ──────────────────────────────────────────────────────────

const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const toLocalISODate = (dateObj: Date) => {
  if (!dateObj) return null;
  const offset = dateObj.getTimezoneOffset() * 60000;
  return new Date(dateObj.getTime() - offset).toISOString().split('T')[0];
};


// ─── UI Sub-components ─────────────────────────────────────────────────────────

const AgentIcon = ({ agent, sizeClass = 'w-5 h-5', containerClass = 'p-2 rounded-xl shadow-md' }: any) => {
  if (agent?.avatar?.type === 'image' && agent?.avatar?.value) {
    return <img src={agent.avatar.value} alt={agent.name} className={`${containerClass} p-0 object-cover`} style={{ width: '2.25rem', height: '2.25rem' }} />;
  }
  const bg = BOT_COLORS.find(c => c.id === agent?.avatar?.color)?.bg ?? 'bg-[#4A5D75]';
  return <div className={`${containerClass} ${bg} flex items-center justify-center shrink-0`}><Bot className={`${sizeClass} text-white`} /></div>;
};

const TypingIndicator = () => (
  <div className="flex items-center gap-1.5 px-4 py-3 bg-neutral-100 dark:bg-neutral-800 rounded-2xl w-fit shadow-sm border border-neutral-200/50 dark:border-neutral-700/50 animate-in fade-in zoom-in duration-300">
    {[0, 200, 400].map(delay => <div key={delay} className="w-1.5 h-1.5 bg-neutral-400 dark:bg-neutral-500 rounded-full" style={{ animation: `typingBounce 1.4s infinite ${delay}ms` }} />)}
  </div>
);

const ThoughtProcess = ({ content, isStreaming }: any) => {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, expanded]);

  return (
    <div className={`mb-4 rounded-2xl border transition-all duration-500 overflow-hidden ${isStreaming ? 'border-[#6A829E]/50 bg-neutral-50 dark:bg-neutral-800/50 shadow-sm' : 'border-neutral-200 dark:border-[#2C3E50] bg-neutral-50 dark:bg-[#1E2B38]'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3.5 text-[11px] font-black uppercase tracking-widest text-neutral-500 hover:text-[#6A829E] transition-colors outline-none bg-transparent"
      >
        <div className="flex items-center gap-2.5">
          {isStreaming ? <Loader2 className="w-4 h-4 animate-spin text-[#6A829E]" /> : <Brain className="w-4 h-4 text-[#9FBBAF]" />}
          <span className={isStreaming ? 'animate-pulse text-[#6A829E]' : ''}>{isStreaming ? 'Thinking...' : 'Thought Process'}</span>
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div ref={scrollRef} className="p-4 pt-1 text-sm text-neutral-600 dark:text-[#899AB5] whitespace-pre-wrap leading-relaxed custom-scrollbar max-h-96 overflow-y-auto font-medium border-t border-transparent">
          {content}
          {isStreaming && <span className="inline-block w-2 h-4 ml-1 align-middle bg-neutral-400 dark:bg-neutral-500 animate-pulse" />}
        </div>
      )}
    </div>
  );
};

const FormattedText = ({ text, onSaveImage, onViewImage }: any) => {
  if (!text || typeof text !== 'string') return null;
  try {
    const renderInlines = (textStr: string) => {
      const tokens = [];
      let lastIdx = 0;
      // Regex detects: 1. Bold, 2. [Source: Name](url), 3. Markdown links, 4. Raw URLs
      const regex = /(\*\*.*?\*\*)|(\[Source:\s*.*?\]\(.*?\))|(\[.*?\]\(.*?\))|(https?:\/\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=%]+)/g;
      
      let match;
      while ((match = regex.exec(textStr)) !== null) {
        if (match.index > lastIdx) tokens.push(textStr.slice(lastIdx, match.index));
        
        if (match[1]) { 
          // Bold
          tokens.push(<strong key={match.index} className="font-black text-neutral-900 dark:text-white">{match[1].slice(2, -2)}</strong>);
        } else if (match[2]) { 
          // Source Citation
          const sub = match[2].match(/\[Source:\s*(.+?)\]\((.+?)\)/);
          if (sub) tokens.push(<a key={match.index} href={sub[2]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#4A5D75]/10 text-[#4A5D75] dark:text-[#9EADC8] rounded-md text-[10px] font-bold mx-1 hover:underline"><Globe className="w-3 h-3" /> {sub[1]}</a>);
        } else if (match[3]) { 
          // Standard Markdown Link
          const sub = match[3].match(/\[(.*?)\]\((.*?)\)/);
          if (sub) tokens.push(<a key={match.index} href={sub[2]} target="_blank" rel="noreferrer" className="text-[#6A829E] hover:underline font-bold transition-colors">{sub[1]}</a>);
        } else if (match[4]) { 
          // Raw URL
          tokens.push(<a key={match.index} href={match[4]} target="_blank" rel="noreferrer" className="text-[#6A829E] hover:underline font-bold break-all transition-colors">{match[4]}</a>);
        }
        lastIdx = regex.lastIndex;
      }
      if (lastIdx < textStr.length) tokens.push(textStr.slice(lastIdx));
      return tokens;
    };

    return (
      <div className="space-y-1.5 break-words text-sm">
        {text.split('\n').map((line, idx) => {
          if (line.startsWith('### ')) return <h3 key={idx} className="text-base font-black mt-4 mb-2 dark:text-white uppercase tracking-tight">{line.slice(4)}</h3>;
          if (line.startsWith('## ')) return <h2 key={idx} className="text-lg font-black mt-5 mb-2 dark:text-white border-b border-neutral-200 dark:border-neutral-700 pb-1">{line.slice(3)}</h2>;
          if (line.startsWith('# ')) return <h1 key={idx} className="text-xl font-black mt-6 mb-3 dark:text-white">{line.slice(2)}</h1>;
          if (/^\s*[-*] /.test(line)) return <div key={idx} className="flex gap-2 ml-2"><span className="text-[#D4AA7D] font-bold">•</span><span>{renderInlines(line.replace(/^\s*[-*] /, ''))}</span></div>;
          
          if (line.match(/!\[.*?\]\((.*?)\)/)) {
             const matchResult = line.match(/!\[.*?\]\((.*?)\)/);
             if (matchResult) {
               const src = matchResult[1];
               return (
                 <div key={idx} className="relative group/img flex flex-col gap-2 mt-3 mb-4 max-w-md w-full">
                   <div className="overflow-hidden rounded-2xl shadow-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800">
                      <img 
                        src={src} 
                        alt="Generated Artwork" 
                        className="w-full h-auto object-cover cursor-pointer hover:scale-[1.02] transition-transform duration-300" 
                        onClick={() => onViewImage && onViewImage(src)}
                        title="Click to view full size"
                      />
                   </div>
                   <div className="flex items-center gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity bg-white/50 dark:bg-neutral-900/50 p-1.5 rounded-xl w-fit backdrop-blur-sm border border-neutral-200/50 dark:border-neutral-700/50">
                      {onSaveImage && (
                        <button onClick={() => onSaveImage(src)} className="p-1.5 px-2.5 text-neutral-500 hover:text-[#4A5D75] hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-all flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest" title="Save to Archives">
                          <Save className="w-3.5 h-3.5" /> Save
                        </button>
                      )}
                      <button onClick={() => {
                          const a = document.createElement('a');
                          a.href = src;
                          a.download = `generated_image_${Date.now()}.png`;
                          a.click();
                      }} className="p-1.5 px-2.5 text-neutral-500 hover:text-[#4A5D75] hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-all flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest" title="Download Image">
                          <Download className="w-3.5 h-3.5" /> Download
                      </button>
                   </div>
                 </div>
               );
             }
          }
          
          if (!line.trim()) return <div key={idx} className="h-2" /> ;
          return <p key={idx}>{renderInlines(line)}</p>;
        })}
      </div>
    );
  } catch {
    return <div className="whitespace-pre-wrap text-sm">{text}</div>;
  }
};

const WysiwygEditor = ({ html, onChange, disabled }: any) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && html !== ref.current.innerHTML && document.activeElement !== ref.current) ref.current.innerHTML = html ?? '';
  }, [html]);
  return <div ref={ref} contentEditable={!disabled} onInput={e => onChange(e.currentTarget.innerHTML)} className="flex-1 p-8 lg:p-12 outline-none overflow-y-auto wysiwyg-editor text-base max-w-3xl mx-auto w-full custom-scrollbar dark:text-neutral-200" data-placeholder="Start writing your document here..." />;
};

const ContextMeter = ({ messages, systemPromptLen, limit }: any) => {
  const used = useMemo(() => messages.reduce((n: number, m: any) => n + String(m.content ?? '').length, 0) + systemPromptLen, [messages, systemPromptLen]);
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color = pct > 95 ? 'bg-[#C98A8A]' : pct > 80 ? 'bg-[#D4AA7D]' : 'bg-[#9FBBAF]';
  return (
    <div className="w-full h-1.5 bg-neutral-200 dark:bg-neutral-800 shrink-0" title={`Context: ${used.toLocaleString()} / ${limit.toLocaleString()} chars`}>
      <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [isDbLoaded, setIsDbLoaded] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    const originalLog = console.log, originalError = console.error, originalWarn = console.warn;
    const addLog = (level: string, ...args: any[]) => {
      const msg = args.map(a => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString([], {hour12: false}), level, msg }]);
    };
    console.log = (...args) => { addLog('info', ...args); originalLog(...args); };
    console.error = (...args) => { addLog('error', ...args); originalError(...args); };
    console.warn = (...args) => { addLog('warn', ...args); originalWarn(...args); };
    return () => { console.log = originalLog; console.error = originalError; console.warn = originalWarn; };
  }, []);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingChatName, setEditingChatName] = useState('');
  const [activeFolderId, setActiveFolderId] = useState('f-default');
  
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState('');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
  const [isDeepThinking, setIsDeepThinking] = useState(false);
  const [attachedDocs, setAttachedDocs] = useState<any[]>([]);
  
  // App Settings Integration
  const [appSettings, setAppSettings] = useState({ 
      allowProfileUpdates: true, 
      imageProvider: 'none', 
      imageModelId: '', 
      imageEndpoint: '' 
  });
  const [uploadError, setUploadError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Connection Test & Fetch State for Images
  const [imageTestState, setImageTestState] = useState({ loading: false, error: null as string | null, successUrl: null as string | null });
  const [imageEngineModels, setImageEngineModels] = useState<any[]>([]);
  const [isFetchingImageModels, setIsFetchingImageModels] = useState(false);

  const [generationMode, setGenerationMode] = useState('text');
  const [canvasContent, setCanvasContent] = useState<any>(null);
  const [canvasTab, setCanvasTab] = useState('preview');
  const [viewMode, setViewMode] = useState('chat');
  const [archiveSubView, setArchiveSubView] = useState('code');
  const [archiveSearchQuery, setArchiveSearchQuery] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  
  const [showPlanner, setShowPlanner] = useState(false);
  const [plannerView, setPlannerView] = useState('list');
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date());
  const [newTaskInput, setNewTaskInput] = useState('');
  const [newTaskDate, setNewTaskDate] = useState('');
  const [newTaskDetails, setNewTaskDetails] = useState('');
  const [newTaskLocation, setNewTaskLocation] = useState('');
  const [showTaskDetailsForm, setShowTaskDetailsForm] = useState(false);
  const [taskToDiscuss, setTaskToDiscuss] = useState<any>(null);

  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isAgentDropdownOpen, setIsAgentDropdownOpen] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [profileSettingsTab, setProfileSettingsTab] = useState('profile');
  const [showModelWizard, setShowModelWizard] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveAppData, setSaveAppData] = useState({ title: '' }); 
  
  // Assistant Config States
  const [showAssistantSettings, setShowAssistantSettings] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<any>(null);
  const [assistantSettingsTab, setAssistantSettingsTab] = useState('config');

  const [wizardStep, setWizardStep] = useState(3);
  
  const [editingModel, setEditingModel] = useState({ name: '', provider: 'openai', modelId: '', endpoint: '', apiKey: '', contextLimit: 128000 });
  const [fetchedModels, setFetchedModels] = useState<Array<{id: string, context: number}>>([]);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [modelValidation, setModelValidation] = useState<Record<string, string>>({});
  const [pendingModelSelections, setPendingModelSelections] = useState<Array<{id: string, context: number}>>([]);

  const [userProfile, setUserProfile] = useState('');
  const [integrations, setIntegrations] = useState<any>({ 
      tavily: { enabled: false, apiKey: '' },
      googleCalendar: { connected: false },
      openai: { apiKey: '' },
      google: { apiKey: '' },
      customImage: { apiKey: '' }
  });
  const [models, setModels] = useState<any[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [assistants, setAssistants] = useState<any[]>([DEFAULT_ASSISTANT]);
  const [chats, setChats] = useState<any[]>([]);
  const [messages, setMessages] = useState<Record<string, any[]>>({});
  const [savedApps, setSavedApps] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);

  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const avatarUploadRef = useRef<HTMLInputElement>(null);
  const trainingDocUploadRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<any>(null);

  const codeRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Dynamic Image Key Checking
  const hasImplicitGoogleKey = models.some(m => m.provider === 'google' && m.apiKey);
  const hasImplicitOpenAIKey = models.some(m => m.provider === 'openai' && m.apiKey);

  const activeImageKey = appSettings.imageProvider === 'openai' ? (integrations.openai?.apiKey || models.find(m => m.provider === 'openai' && m.apiKey)?.apiKey) :
                         appSettings.imageProvider === 'google' ? (integrations.google?.apiKey || models.find(m => m.provider === 'google' && m.apiKey)?.apiKey) :
                         integrations.customImage?.apiKey || '';

  useEffect(() => {
    const boot = async () => {
      try {
        await db.init();
        setModels(await db.get('models', []));
        setChats(await db.get('chats', []));
        setMessages(await db.get('messages', {}));
        setAssistants(await db.get('assistants', [DEFAULT_ASSISTANT]));
        setTasks(await db.get('tasks', []));
        setSavedApps(await db.get('savedApps', []));
        setUserProfile(await db.get('userProfile', ''));
        
        const savedIntegrations = await db.get('integrations', {});
        setIntegrations((prev: any) => ({ ...prev, ...savedIntegrations }));
        
        const settings = await db.get('settings', {});
        if (settings.selectedModelId) setSelectedModelId(settings.selectedModelId);

        const loadedSettings = await db.get('appSettings', { 
            allowProfileUpdates: true, 
            imageProvider: 'none', 
            imageModelId: '', 
            imageEndpoint: '' 
        });
        setAppSettings(loadedSettings);

      } catch (err) { console.error('[AgentForge] Boot error:', err); } finally { setIsDbLoaded(true); }
    };
    boot();
  }, []);

  const persistState = useCallback(() => {
    if (!isDbLoaded) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await db.set('models', models);
        await db.set('chats', chats);
        await db.set('messages', messages);
        await db.set('assistants', assistants);
        await db.set('tasks', tasks);
        await db.set('savedApps', savedApps);
        await db.set('userProfile', userProfile);
        await db.set('integrations', integrations);
        await db.set('settings', { selectedModelId });
        await db.set('appSettings', appSettings);
      } catch (err) { console.error('[AgentForge] Save error:', err); }
    }, 1500);
  }, [isDbLoaded, models, chats, messages, assistants, tasks, savedApps, userProfile, integrations, selectedModelId, appSettings]);

  useEffect(() => { persistState(); }, [persistState]);
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  const activeAssistant = useMemo(() => assistants.find(a => a.id === activeFolderId) ?? assistants[0], [assistants, activeFolderId]);
  const activeMessages = useMemo(() => activeChatId ? (messages[activeChatId] ?? []) : [], [messages, activeChatId]);
  const selectedModel = useMemo(() => models.find(m => m.id === selectedModelId) ?? models[0] ?? null, [models, selectedModelId]);
  
  // Extract pinned messages explicitly scoped to the active assistant for Prompt Generation
  const activeAgentPinnedMessageObjects = useMemo(() => {
     const pins: any[] = [];
     Object.entries(messages).forEach(([cId, chatMsgs]) => {
         const chatRecord = chats.find(c => c.id === cId);
         if (chatRecord && chatRecord.folderId === activeAssistant.id) {
             chatMsgs.forEach(m => {
                 if (m.isPinned && m.role === 'user' && m.content) {
                     pins.push({ chatId: cId, msgId: m.id, content: m.content });
                 }
             });
         }
     });
     return pins;
  }, [messages, chats, activeAssistant.id]);
  const agentPinnedMessagesForPrompt = useMemo(() => activeAgentPinnedMessageObjects.map(p => p.content), [activeAgentPinnedMessageObjects]);

  // Extract pinned messages explicitly scoped to the assistant currently being EDITED in settings
  const editingAgentPins = useMemo(() => {
    if (!editingAssistant) return [];
    const pins: any[] = [];
    Object.entries(messages).forEach(([cId, chatMsgs]) => {
        const chatRecord = chats.find(c => c.id === cId);
        if (chatRecord && chatRecord.folderId === editingAssistant.id) {
            chatMsgs.forEach(m => {
                if (m.isPinned && m.role === 'user' && m.content) {
                    pins.push({ chatId: cId, msgId: m.id, content: m.content });
                }
            });
        }
    });
    return pins;
 }, [messages, chats, editingAssistant?.id]);

  const systemPromptLen = useMemo(() => buildSystemPrompt({ agent: activeAssistant ?? DEFAULT_ASSISTANT, profile: userProfile, tasks, canvasContent, mode: generationMode, isDeepThinking, agentPinnedMessages: agentPinnedMessagesForPrompt, appSettings }).length, [activeAssistant, userProfile, tasks, canvasContent, generationMode, isDeepThinking, agentPinnedMessagesForPrompt, appSettings]);

  // Sync mode when switching agents
  useEffect(() => {
    if (activeAssistant) {
      if (activeAssistant.defaultMode === 'image' && appSettings?.imageProvider === 'none') {
         setGenerationMode('text');
      } else {
         setGenerationMode(activeAssistant.defaultMode || 'text');
      }
    }
  }, [activeFolderId, activeAssistant, appSettings?.imageProvider]);

  useEffect(() => { if (canvasContent && isSidebarOpen) setIsSidebarOpen(false); }, [canvasContent]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activeMessages, showPlanner]);
  
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsAgentDropdownOpen(false);
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) setIsModelDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAssistantSettings) setShowAssistantSettings(false);
        else if (showProfileSettings) {
            setShowProfileSettings(false);
            setImageTestState({ loading: false, error: null, successUrl: null });
        }
        else if (showModelWizard) setShowModelWizard(false);
        else if (showSaveModal) setShowSaveModal(false);
        else if (taskToDiscuss) setTaskToDiscuss(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showAssistantSettings, showProfileSettings, showModelWizard, showSaveModal, taskToDiscuss]);

  const fetchImageModels = async () => {
     setIsFetchingImageModels(true);
     setImageTestState({ loading: false, error: null, successUrl: null });
     try {
         let url, headers: any = {};
         let provider = appSettings.imageProvider;
         let key = activeImageKey;
         
         if (!key && provider !== 'custom') throw new Error("API Key required to fetch models.");

         if (provider === 'google') {
             url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
         } else {
             let base = appSettings.imageEndpoint || 'https://api.openai.com/v1';
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
         if (list.length > 0 && !appSettings.imageModelId) {
             setAppSettings(prev => ({...prev, imageModelId: list.find(id => id.includes('dall-e') || id.includes('imagen')) || list[0]}));
         }
         showToast("Models fetched successfully.");
     } catch (err: any) {
         showToast("Failed to fetch models: " + err.message);
     } finally {
         setIsFetchingImageModels(false);
     }
  };

  const viewImageInCanvas = useCallback((src: string) => {
      setCanvasContent({ 
          id: generateId('art'), 
          title: `Image Preview`, 
          type: 'image', 
          language: 'image', 
          content: src, 
          isStandalone: false, 
          history: [{ timestamp: Date.now(), content: src }], 
          historyIndex: 0 
      });
      setCanvasTab('preview');
      setShowPlanner(false);
  }, []);

  const testImageEngine = async () => {
      setImageTestState({ loading: true, error: null, successUrl: null });
      try {
          let imageUrl = '';
          const promptText = "A cute cat wearing a yellow banana costume, high quality photorealistic.";
          let provider = appSettings.imageProvider;
          let modelId = appSettings.imageModelId || (provider === 'google' ? 'imagen-3.0-generate-001' : 'dall-e-3');
          let key = activeImageKey;

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
              const baseEndpoint = (appSettings.imageEndpoint || 'https://api.openai.com/v1').replace(/\/$/, '');
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
          setImageTestState({ loading: false, error: null, successUrl: imageUrl });
      } catch (err: any) {
          setImageTestState({ loading: false, error: err.message || "Failed to generate image. Check your API key or network.", successUrl: null });
      }
  };

  const toggleSpeak = (msgId: string, text: string) => {
    if (speakingId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
    } else {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/[*#`_]/g, '').replace(/<think>[\s\S]*?<\/think>/gi, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.onend = () => setSpeakingId(null);
      utterance.onerror = () => setSpeakingId(null);
      setSpeakingId(msgId);
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
      showToast("Speech recognition is not supported in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
       const transcript = event.results[0][0].transcript;
       setInput(prev => prev + (prev ? ' ' : '') + transcript);
    };
    recognition.onerror = (e: any) => {
       console.error("Speech recognition error", e);
       setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleHistoryNavigate = useCallback((direction: number) => {
    setCanvasContent((prev: any) => {
      if (!prev || !prev.history) return prev;
      const newIndex = (prev.historyIndex ?? 0) + direction;
      if (newIndex >= 0 && newIndex < prev.history.length) return { ...prev, historyIndex: newIndex, content: prev.history[newIndex].content };
      return prev;
    });
  }, []);

  const addTask = useCallback((title: string, dueDate: string | null = null, details = '', location = '') => {
    if (!title.trim()) return;
    setTasks(prev => [{ id: generateId('t'), title: title.trim(), dueDate: dueDate || newTaskDate || null, details, location, completed: false }, ...prev]);
  }, [newTaskDate]);
  
  const toggleTask = useCallback((id: string) => setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t)), []);
  const deleteTask = useCallback((id: string) => setTasks(prev => prev.filter(t => t.id !== id)), []);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedTaskId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Main UI Drag and Drop validation flow
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent, targetId: string | null = null) => {
    e.preventDefault();
    setIsDragging(false);

    // If it's a task reorder drop
    if (draggedTaskId) {
      if (draggedTaskId === targetId) return;
      setTasks(prevTasks => {
        const newTasks = [...prevTasks];
        const draggedIdx = newTasks.findIndex(t => t.id === draggedTaskId);
        const targetIdx = newTasks.findIndex(t => t.id === targetId);
        if (draggedIdx === -1 || targetIdx === -1) return prevTasks;
        const [draggedItem] = newTasks.splice(draggedIdx, 1);
        newTasks.splice(targetIdx, 0, draggedItem);
        return newTasks;
      });
      setDraggedTaskId(null);
      return;
    }

    // If it's a file upload drop
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const fakeEvent = { target: { files: [file], value: '' } } as any;
      await handleChatFileUpload(fakeEvent);
    }
  };

  const handleManualTaskSubmit = (e: React.FormEvent) => {
    e.preventDefault(); addTask(newTaskInput, newTaskDate, newTaskDetails, newTaskLocation);
    setNewTaskInput(''); setNewTaskDate(''); setNewTaskDetails(''); setNewTaskLocation(''); setShowTaskDetailsForm(false);
  };

  const calendarDays = useMemo(() => {
    const year = currentMonthDate.getFullYear(), month = currentMonthDate.getMonth();
    const days = Array(new Date(year, month, 1).getDay()).fill(null);
    for (let i = 1; i <= new Date(year, month + 1, 0).getDate(); i++) days.push(new Date(year, month, i));
    return days;
  }, [currentMonthDate]);
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const handleChatFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    
    setUploadError('');
    if (file.size > MAX_FILE_SIZE) {
      setUploadError(`File is too large. Max 5MB allowed.`);
      showToast("File is too large.");
      e.target.value = '';
      return;
    }
    
    if (file.type === 'application/pdf') {
        showToast("Parsing PDF locally... this might take a moment.");
        try {
           const text = await extractTextFromPDF(file);
           setAttachedDocs(prev => [...prev, { name: file.name, content: text, type: 'text/plain', isImage: false }]);
           showToast("PDF parsed successfully!");
        } catch (err) {
           showToast("Failed to parse PDF.");
           console.error(err);
        }
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    if (file.type.startsWith('image/')) {
      reader.onloadend = () => setAttachedDocs(prev => [...prev, { name: file.name, content: reader.result, type: file.type, isImage: true }]);
      reader.readAsDataURL(file);
    } else {
      reader.onloadend = () => setAttachedDocs(prev => [...prev, { name: file.name, content: reader.result, type: file.type, isImage: false }]);
      reader.readAsText(file);
    }
    e.target.value = '';
  };
  
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(file); })
      .then(val => setEditingAssistant((prev: any) => ({ ...prev, avatar: { type: 'image', value: val } }))); e.target.value = '';
  };
  
  const handleTrainingDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    
    if (file.type.startsWith('image/')) {
        showToast("Images cannot be added to the Knowledge Base. Use chat attachments instead.");
        e.target.value = '';
        return;
    }

    if (file.type === 'application/pdf') {
        showToast("Parsing PDF locally... this might take a moment.");
        try {
           const text = await extractTextFromPDF(file);
           setEditingAssistant((prev: any) => ({ ...prev, trainingDocs: [...(prev.trainingDocs ?? []), { id: generateId('doc'), name: file.name, content: text, type: 'text/plain' }] }));
           showToast("PDF added to Knowledge Base!");
        } catch (err) {
           showToast("Failed to parse PDF.");
           console.error(err);
        }
        e.target.value = '';
        return;
    }
    
    new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsText(file); })
      .then(content => setEditingAssistant((prev: any) => ({ ...prev, trainingDocs: [...(prev.trainingDocs ?? []), { id: generateId('doc'), name: file.name, content, type: file.type }] }))); e.target.value = '';
  };

  const saveAssistantConfig = () => {
    if (editingAssistant.id === 'new') {
      const bot = { ...editingAssistant, id: generateId('bot') };
      setAssistants(prev => [...prev, bot]); 
      setActiveFolderId(bot.id); 
      setActiveChatId(null);
    } else {
      setAssistants(prev => prev.map(a => a.id === editingAssistant.id ? editingAssistant : a));
    }
    setShowAssistantSettings(false);
  };

  const createBlankArtifact = (type: string) => {
    const initialContent = type === 'code' ? '\n' : '<h1>New Document</h1><p>Start writing here...</p>';
    setCanvasContent({ id: generateId('art'), title: `Untitled ${type === 'code' ? 'App' : 'Document'}`, content: initialContent, language: 'html', type, isStandalone: false, history: [{ timestamp: Date.now(), content: initialContent }], historyIndex: 0 });
    setGenerationMode(type); setCanvasTab(type === 'code' ? 'code' : 'preview'); setShowPlanner(false);
  };

  const saveToLibrary = (asNew = false) => {
    const id = (asNew || !canvasContent.id) ? generateId('art') : canvasContent.id;
    let finalCanvas = { ...canvasContent };
    const curHist = finalCanvas.history || [{ timestamp: Date.now(), content: finalCanvas.content }];
    const curIdx = finalCanvas.historyIndex ?? 0;
    if (curHist[curIdx]?.content !== finalCanvas.content) {
        const newHist = curHist.slice(0, curIdx + 1); newHist.push({ timestamp: Date.now(), content: finalCanvas.content });
        finalCanvas.history = newHist; finalCanvas.historyIndex = newHist.length - 1;
    }
    const item = { ...finalCanvas, id, title: saveAppData.title || finalCanvas.title || 'Untitled', updatedAt: Date.now() };
    const exists = savedApps.some(a => a.id === id);
    setSavedApps(prev => exists && !asNew ? prev.map(a => a.id === id ? item : a) : [item, ...prev]); setCanvasContent(item); setShowSaveModal(false);
  };
  const deleteSavedApp = (id: string) => { setSavedApps(prev => prev.filter(app => app.id !== id)); if (canvasContent?.id === id) setCanvasContent(null); };
  
  const saveImageToLibrary = useCallback((src: string) => {
     const item = { id: generateId('art'), title: 'Generated Image', type: 'image', content: src, updatedAt: Date.now() };
     setSavedApps(prev => [item, ...prev]);
  }, []);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value; let endpoint = '';
    if (provider === 'ollama') endpoint = 'http://127.0.0.1:11434/v1';
    if (provider === 'lmstudio') endpoint = 'http://127.0.0.1:1234/v1';
    if (provider === 'native') endpoint = 'http://127.0.0.1:8080/v1';
    if (provider === 'huggingface') endpoint = 'https://api-inference.huggingface.co/v1';
    const existingKey = models.find(m => m.provider === provider && m.apiKey)?.apiKey || '';
    setEditingModel({ name: provider === 'native' ? 'Agent Forge Engine' : provider === 'ollama' ? 'Local Ollama' : provider === 'lmstudio' ? 'LM Studio Engine' : 'Custom Model', provider, modelId: '', endpoint, apiKey: existingKey, contextLimit: 32000 });
    setFetchedModels([]); setPendingModelSelections([]); setFetchModelsError(null); setModelSearchQuery('');
  };

  const handleFetchModels = async () => {
    if (!editingModel.apiKey && !['custom', 'ollama', 'lmstudio', 'native'].includes(editingModel.provider)) { setFetchModelsError('Please enter your API Key first.'); return; }
    setIsFetchingModels(true); setFetchModelsError(null); setFetchedModels([]); setModelSearchQuery('');
    try {
      let url = '', hdrs: any = {};
      const { provider, endpoint, apiKey } = editingModel;
      
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
      setFetchedModels(list.map(id => ({ id, context: getContextLimit(id) })));
    } catch (e: any) {
      setFetchModelsError(e.message.includes('CORS') ? e.message : `Fetch failed: ${e.message}`);
    } finally { setIsFetchingModels(false); }
  };

  const toggleModelSelection = (m: any) => setPendingModelSelections(prev => prev.some(p => p.id === m.id) ? prev.filter(p => p.id !== m.id) : [...prev, m]);

  const handleBulkAdd = () => {
    const newModels = pendingModelSelections.map(m => ({ id: generateId('m'), name: m.id, provider: editingModel.provider, modelId: m.id, endpoint: editingModel.endpoint, apiKey: editingModel.apiKey, contextLimit: m.context, canImage: false }));
    setModels(prev => [...prev, ...newModels]);
    if (!selectedModelId && newModels.length > 0) setSelectedModelId(newModels[0].id);
    setPendingModelSelections([]); setFetchedModels([]); setShowModelWizard(false); setWizardStep(3);
    newModels.forEach(async (mdl) => {
        setModelValidation(prev => ({ ...prev, [mdl.id]: 'pending' }));
        const ok = await validateModel(mdl);
        setModelValidation(prev => ({ ...prev, [mdl.id]: ok ? 'ok' : 'fail' }));
    });
  };

  const executeAddLLM = async (cfg: any) => {
    const id = generateId('m');
    const mdl = { id, name: String(cfg.name || 'Custom Model').trim(), provider: cfg.provider, modelId: String(cfg.modelId || 'custom').trim(), endpoint: String(cfg.endpoint || '').trim(), apiKey: String(cfg.apiKey || '').trim(), contextLimit: parseInt(cfg.contextLimit, 10) || 32000, canImage: false };
    setModels(prev => [...prev, mdl]); setSelectedModelId(id); setShowModelWizard(false); setWizardStep(3); setEditingModel({ name: '', provider: 'openai', modelId: '', endpoint: '', apiKey: '', contextLimit: 128000 });
    setModelValidation(prev => ({ ...prev, [id]: 'pending' }));
    const ok = await validateModel(mdl);
    setModelValidation(prev => ({ ...prev, [id]: ok ? 'ok' : 'fail' }));
  };

  const enhance = async (text: string, systemInstruction: string, onResult: (res: string) => void) => {
    const agent = { prompt: systemInstruction, tools: {}, awareOfProfile: false, trainingDocs: [] };
    const result = await generateTextResponse({ messages: [{ id: generateId('msg'), role: 'user', content: text }], modelConfig: selectedModel, profile: '', attachedDocs: [], agent, tasks: [], mode: 'text', canvasContent: null, isDeepThinking: false, agentPinnedMessages: agentPinnedMessagesForPrompt, onChunk: null, signal: null, appSettings, integrations, models });
    onResult(result.replace(/```[a-zA-Z]*\n/g, '').replace(/```/g, '').trim());
  };

  const handleEnhancePrompt = async () => {
    if (!input.trim() || isEnhancing || !selectedModel) return;
    setIsEnhancing(true);
    try { await enhance(input, 'Enhance this user prompt to be more detailed, precise, and effective for an AI. Return ONLY the improved prompt.', setInput); }
    catch { } finally { setIsEnhancing(false); }
  };
  const handleEnhanceSystemPrompt = async () => {
    if (!editingAssistant?.prompt || isEnhancingPrompt || !selectedModel) return;
    setIsEnhancingPrompt(true);
    try { await enhance(editingAssistant.prompt, 'Rewrite this AI system instruction to be professional and precise. Return ONLY the improved prompt.', val => setEditingAssistant((prev: any) => ({ ...prev, prompt: val }))); }
    catch { } finally { setIsEnhancingPrompt(false); }
  };

  const processChatRequest = async (chatId: string, userMsg: any, historyToPass: any[]) => {
    setIsGenerating(true);
    try {
      const history = [...historyToPass, userMsg];
      const inputLower = userMsg.content.toLowerCase();
      let toolUsed = null;
      let toolData = "";
      let foundSources: any[] = [];

      // Improved Tool Routing
      if (activeAssistant.tools?.local_workspace && /code|file|folder|project|repository|read|workspace|local/i.test(inputLower)) {
          toolUsed = 'Workspace RAG';
      } else if (activeAssistant.tools?.web_search && /search|weather|news|who is|what is|find|how/i.test(inputLower)) {
          toolUsed = 'Web Search';
      }
      
      let messagesForLLM = [...history];

      if (toolUsed) {
        const toolMsgId = generateId('tool');
        setMessages(prev => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), { id: toolMsgId, role: 'bot', content: `[ ⚡ Interfacing with ${toolUsed}... ]`, isToolCall: true, isPinned: false }] }));
        
        if (toolUsed === 'Workspace RAG') {
             try {
                 let ragData = "No context found.";
                 // Wire this up to the Rust Backend
                 if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
                     try {
                         const { invoke } = await import('@tauri-apps/api/core');
                         // This connects directly to LanceDB in the Rust memory.rs file
                         ragData = await invoke('query_lance_db', { query: userMsg.content });
                     } catch (tauriErr: any) {
                         console.warn("Tauri RAG failed:", tauriErr);
                         ragData = `Error communicating with local LanceDB backend: ${tauriErr.message || tauriErr}`;
                     }
                 } else {
                     ragData = `(Mocked RAG Data: LanceDB is not running in the web preview. In your Tauri app, this will return local file chunks.)`;
                 }
                 toolData += `\n\n[SYSTEM NOTE: LOCAL WORKSPACE RAG RESULTS]\n${ragData}\n[END SEARCH]`;
             } catch (e: any) {
                 console.error('Local RAG failed:', e);
                 toolData += `\n\n[SYSTEM NOTE: LOCAL RAG FAILED]\nError: ${e.message}\n[END SEARCH]`;
             }
        } else if (toolUsed === 'Web Search') {
            try {
                const query = userMsg.content.replace(/search( for)?|who is|what is|find/gi, '').trim() || userMsg.content;
                
                // Bullet-proof Tavily Fetch
                if (integrations.tavily?.enabled && integrations.tavily?.apiKey) {
                    const tvRes = await fetch('https://api.tavily.com/search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            api_key: integrations.tavily.apiKey, 
                            query, 
                            max_results: 3,
                            search_depth: "advanced",
                            include_answer: true
                        })
                    });
                    if (tvRes.ok) {
                        const tvData = await tvRes.json();
                        if (tvData.results) {
                            tvData.results.forEach((r: any) => foundSources.push({ title: r.title, url: r.url, snippet: r.content }));
                        }
                        if (tvData.answer) {
                            toolData += `\n[TAVILY AI SUMMARY]\n${tvData.answer}\n`;
                        }
                    } else {
                        console.warn("Tavily search returned a non-200 status code.");
                    }
                }
                
                // Bullet-proof Wiki Fetch
                const wikiQuery = query.split(' ').slice(0, 4).join(' ').trim();
                if (wikiQuery) {
                    const wikiRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(wikiQuery)}&utf8=&format=json&origin=*`);
                    if (wikiRes.ok) {
                        const wikiData = await wikiRes.json();
                        if (wikiData && wikiData.query && wikiData.query.search) {
                            wikiData.query.search.slice(0, 2).forEach((s: any) => {
                                const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`;
                                if (!foundSources.some(x => x.url === url)) {
                                    foundSources.push({ title: `Wikipedia: ${s.title}`, url, snippet: s.snippet.replace(/<[^>]*>?/gm, '') });
                                }
                            });
                        }
                    }
                }
                
                if (foundSources.length > 0) {
                    const searchResults = foundSources.map(s => `- ${s.title}: ${s.snippet} (URL: ${s.url})`).join('\n');
                    toolData += `\n\n[SYSTEM NOTE: WEB SEARCH RESULTS]\n${searchResults}\n[END SEARCH]`;
                } else {
                    toolData += `\n\n[SYSTEM NOTE: WEB SEARCH RESULTS]\nNo relevant results found online.\n[END SEARCH]`;
                }
            } catch (e: any) {
                console.error('Web search failed:', e);
                showToast("Web search failed. Check console logs.");
                toolData += `\n\n[SYSTEM NOTE: WEB SEARCH FAILED]\nThe web search encountered an error: ${e.message}\n[END SEARCH]`;
            }
        }
        
        await new Promise(r => setTimeout(r, 800));
        setMessages(prev => ({ ...prev, [chatId]: prev[chatId].filter(m => m.id !== toolMsgId) }));
        
        if (toolData) {
            setMessages(prev => ({
                ...prev,
                [chatId]: prev[chatId].map(m => m.id === userMsg.id ? { ...m, content: m.content + toolData } : m)
            }));
            messagesForLLM = history.map(m => m.id === userMsg.id ? { ...m, content: m.content + toolData } : m);
        }
      }
      
      const botId = generateId('msg');
      setMessages(prev => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), { id: botId, role: 'bot', content: '', sources: foundSources, isPinned: false, isStreaming: true }] }));

      let currentText = '';
      let lastCanvasSync = Date.now();

      const handleChunk = (chunk: string) => {
          currentText += chunk;
          setMessages(prev => ({ ...prev, [chatId]: (prev[chatId] ?? []).map(m => m.id === botId ? { ...m, content: currentText } : m) }));

          const now = Date.now();
          if ((generationMode === 'code' || generationMode === 'doc') && now - lastCanvasSync > 300) {
              const contentWithoutThink = currentText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
              const match = contentWithoutThink.match(/```([a-zA-Z]*)\n([\s\S]*?)($|```)/);
              if (match) {
                  const lang = (match[1] || '').toLowerCase();
                  const code = match[2];
                  if (lang !== 'task' && lang !== 'todo' && lang !== 'profile') {
                      setCanvasContent((prev: any) => {
                          if (!prev) return { id: generateId('art'), title: `Generated ${generationMode === 'code' ? 'App' : 'Document'}`, type: generationMode, language: lang || 'html', content: code, isStandalone: false, history: [{ timestamp: Date.now(), content: code }], historyIndex: 0 };
                          return { ...prev, content: code };
                      });
                      setCanvasTab('preview'); lastCanvasSync = now;
                  }
              }
          }
      };

      const isImageRequest = generationMode === 'image' || /^(generate|create|draw|make|show me) (an image|a picture|a photo|a drawing|art)/i.test(inputLower);

      const response = await generateTextResponse({ 
          messages: messagesForLLM, 
          modelConfig: selectedModel, 
          profile: userProfile, 
          attachedDocs: userMsg.attachedFiles, 
          agent: activeAssistant, 
          tasks, 
          mode: isImageRequest ? 'image' : generationMode, 
          canvasContent, 
          isDeepThinking, 
          agentPinnedMessages: agentPinnedMessagesForPrompt, 
          onChunk: handleChunk,
          signal: abortControllerRef.current?.signal,
          appSettings,
          integrations,
          models
      });

      setMessages(prev => ({ ...prev, [chatId]: (prev[chatId] ?? []).map(m => m.id === botId ? { ...m, content: response, isStreaming: false } : m) }));

      if (generationMode === 'code' || generationMode === 'doc') {
         const contentWithoutThink = response.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
         const finalMatch = contentWithoutThink.match(/```([a-zA-Z]*)\n([\s\S]*?)```/);
         if (finalMatch) {
             const lang = (finalMatch[1] || '').toLowerCase();
             const code = finalMatch[2];
             if (lang !== 'task' && lang !== 'todo' && lang !== 'profile') {
                 setCanvasContent((prev: any) => {
                     if (!prev) return prev;
                     const curHist = prev.history || [{ timestamp: Date.now(), content: prev.content }];
                     const curIdx = prev.historyIndex ?? 0;
                     if (curHist[curIdx]?.content !== code) {
                         const newHist = curHist.slice(0, curIdx + 1); newHist.push({ timestamp: Date.now(), content: code });
                         return { ...prev, content: code, history: newHist, historyIndex: newHist.length - 1 };
                     }
                     return prev;
                 });
             }
         }
      }

    } catch (err: any) {
      if (err.name === 'AbortError') { setIsGenerating(false); return; }
      setMessages(prev => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), { id: generateId('err'), role: 'bot', content: `### ⚠️ Generation Failed\n${err.message ?? 'An unexpected error occurred.'}`, isPinned: false }] }));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendMessage = async () => {
    if (isGenerating || !selectedModel) return;
    if (!input.trim() && attachedDocs.length === 0) return;

    if (canvasContent && (generationMode === 'code' || generationMode === 'doc')) {
      setCanvasContent((prev: any) => {
          if (!prev) return prev;
          const curHist = prev.history || [{ timestamp: Date.now(), content: prev.content }];
          const curIdx = prev.historyIndex ?? 0;
          if (curHist[curIdx]?.content !== prev.content) {
              const newHist = curHist.slice(0, curIdx + 1);
              newHist.push({ timestamp: Date.now(), content: prev.content });
              return { ...prev, history: newHist, historyIndex: newHist.length - 1 };
          }
          return prev;
      });
    }

    abortControllerRef.current?.abort(); abortControllerRef.current = new AbortController();
    let chatId = activeChatId; const isNewChat = !chatId;
    if (isNewChat) {
      chatId = generateId('c'); setChats(prev => [{ id: chatId, folderId: activeFolderId, name: input.slice(0, 30) || 'New Session', updatedAt: Date.now() }, ...prev]); setActiveChatId(chatId);
    }
    const userMsg = { id: generateId('msg'), role: 'user', content: input, attachedFiles: [...attachedDocs], isPinned: false };
    if(chatId) {
        setMessages(prev => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), userMsg] }));
        
        if (isNewChat && input.trim() && !selectedModel.modelId.includes('dall-e') && !selectedModel.modelId.includes('image')) {
          generateTextResponse({ messages: [{ role: 'user', content: `Generate a very short, 2 to 4 word title for a conversation starting with this prompt: "${input.slice(0, 100)}". Return ONLY the title, no quotes, no extra text.` }], modelConfig: selectedModel, profile: '', attachedDocs: [], agent: { tools: {} }, tasks: [], mode: 'text', canvasContent: null, isDeepThinking: false, agentPinnedMessages: agentPinnedMessagesForPrompt, signal: null, appSettings, integrations, models })
          .then(title => setChats(prev => prev.map(c => c.id === chatId ? { ...c, name: title.replace(/["']/g, '').trim().slice(0, 40) } : c))).catch(() => {});
        }

        const currentHistory = messages[chatId] ?? [];
        setInput(''); setAttachedDocs([]); 
        
        await processChatRequest(chatId, userMsg, currentHistory);
    }
  };
  
  const confirmEditMessage = async (msgId: string) => {
     if (!editingMessageContent.trim() || !activeChatId) return;
     const chatMsgs = messages[activeChatId];
     const msgIdx = chatMsgs.findIndex(m => m.id === msgId);
     if (msgIdx === -1) return;
     
     const targetMsg = chatMsgs[msgIdx];
     const historyToKeep = chatMsgs.slice(0, msgIdx);
     const newMsg = { ...targetMsg, id: generateId('msg'), content: editingMessageContent };
     
     setMessages(prev => ({...prev, [activeChatId]: [...historyToKeep, newMsg]}));
     setEditingMessageId(null);
     
     abortControllerRef.current?.abort(); abortControllerRef.current = new AbortController();
     await processChatRequest(activeChatId, newMsg, historyToKeep);
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
    if (rawText.startsWith('### ⚠️')) return <div className="text-[#C98A8A] font-medium"><FormattedText text={rawText} onViewImage={viewImageInCanvas} /></div>;

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
      if (match.index > lastIndex) elements.push(<FormattedText key={`t-${match.index}`} text={displayContent.slice(lastIndex, match.index)} onSaveImage={saveImageToLibrary} onViewImage={viewImageInCanvas} />);
      const lang = (match[1] ?? 'text').toLowerCase(), code = match[2].trim();
      
      if (lang === 'task' || lang === 'todo') {
        try {
          const td = JSON.parse(code);
          elements.push(
            <div key={`task-${match.index}`} className="my-3 p-4 rounded-xl border-2 border-[#D6E0EA] dark:border-[#2C3E50]/50 bg-[#F0F4F8] dark:bg-[#4A5D75]/20 flex flex-col gap-3 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3"><div className="p-2 bg-[#4A5D75] rounded-lg shrink-0"><ListTodo className="w-5 h-5 text-white" /></div><div className="flex flex-col"><span className="text-xs font-black text-[#1E2B38] dark:text-[#D6E0EA] uppercase tracking-widest">Proposed Action</span><span className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{td.title}</span><div className="flex items-center gap-3 mt-1 flex-wrap">{td.dueDate && <span className="text-[10px] text-neutral-600 dark:text-[#899AB5] flex items-center gap-1 font-bold"><Clock className="w-3 h-3 text-[#6A829E]" /> Due: {td.dueDate}</span>}{td.location && <span className="text-[10px] text-neutral-600 dark:text-[#899AB5] flex items-center gap-1 font-bold"><MapPin className="w-3 h-3 text-[#9FBBAF]" /> {td.location}</span>}</div></div></div>
                <button onClick={() => { addTask(td.title, td.dueDate, td.details, td.location); setShowPlanner(true); }} className="px-3 py-2 bg-[#4A5D75] text-white rounded-lg text-xs font-bold hover:bg-[#3D4D61] shadow-md transition-all active:scale-95 shrink-0">Add to Planner</button>
              </div>
              {td.details && <div className="text-xs bg-white dark:bg-[#1E2B38] p-2 rounded-lg border border-[#D6E0EA] dark:border-[#4A5D75]/50 text-neutral-600 dark:text-[#C5D3E0]"><span className="font-bold flex items-center gap-1 mb-1"><AlignLeft className="w-3 h-3" /> Details</span>{td.details}</div>}
            </div>
          );
        } catch { elements.push(<div key={`err-${match.index}`} className="p-2 text-xs text-[#C98A8A]">Failed to parse task.</div>); }
      } else if (lang === 'profile') {
        try {
          const pData = JSON.parse(code);
          const isApproved = userProfile.includes(pData.fact);
          elements.push(
             <div key={`prof-${match.index}`} className="my-3 p-4 rounded-xl border border-[#9EADC8] dark:border-[#6A829E]/50 bg-[#F0F4F8] dark:bg-[#1E2B38]/30 flex flex-col gap-2">
               <div className="flex items-center gap-2 text-[#4A5D75] dark:text-[#9EADC8] font-bold text-xs uppercase tracking-widest"><UserPlus className="w-4 h-4"/> Profile Knowledge Update</div>
               <p className="text-sm text-neutral-700 dark:text-neutral-300">"{pData.fact}"</p>
               <button disabled={isApproved} onClick={() => setUserProfile(p => p + (p ? '\n' : '') + pData.fact)} className={`mt-2 py-2 rounded-lg text-xs font-bold transition-all ${isApproved ? 'bg-[#9FBBAF] text-white opacity-50 cursor-default' : 'bg-[#6A829E] hover:bg-[#4A5D75] text-white active:scale-95'}`}>
                 {isApproved ? 'Saved to Profile' : 'Approve & Save'}
               </button>
             </div>
          );
        } catch { elements.push(<div key={`err-p-${match.index}`} className="p-2 text-xs text-[#C98A8A]">Failed to parse profile update.</div>); }
      } else if (code.length > 5 && lang !== 'task' && lang !== 'todo' && lang !== 'profile') {
        const codePreview = code.split('\n').slice(0, 4).join('\n') + (code.split('\n').length > 4 ? '\n...' : '');
        elements.push(
          <div key={`art-${match.index}`} className="my-4 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 overflow-hidden flex flex-col group/art shadow-sm transition-all hover:border-[#899AB5]">
            <div className="flex items-center justify-between p-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800/50">
              <div className="flex items-center gap-2"><Code className="w-4 h-4 text-[#6A829E]" /><span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{(lang || 'CODE').toUpperCase()} Snippet</span></div>
              <button onClick={() => { setCanvasContent({ id: generateId('art'), language: lang, content: code, title: 'Extracted Artifact', type: 'code', isStandalone: false, history: [{ timestamp: Date.now(), content: code }], historyIndex: 0 }); setGenerationMode('code'); setCanvasTab('code'); setShowPlanner(false); }} className="px-3 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-[10px] font-black uppercase tracking-widest text-[#4A5D75] hover:bg-[#F0F4F8] transition-all shadow-sm">Open in Canvas</button>
            </div>
            <div className="p-4 bg-neutral-900 text-neutral-300 text-xs font-mono overflow-hidden"><pre><code>{codePreview}</code></pre></div>
          </div>
        );
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < displayContent.length) elements.push(<FormattedText key="t-end" text={displayContent.slice(lastIndex)} onSaveImage={saveImageToLibrary} onViewImage={viewImageInCanvas} />);
    
    // --- Render Sources Shelf ---
    if (sources && sources.length > 0 && msg.role === 'bot') {
       elements.push(
          <div key={`sources-${msg.id}`} className="mt-5 pt-4 border-t border-neutral-200 dark:border-neutral-700/50 flex flex-col gap-2">
             <span className="text-[9px] font-black uppercase tracking-widest text-neutral-400 flex items-center gap-1.5"><Globe className="w-3 h-3" /> Sources Referenced</span>
             <div className="flex flex-wrap gap-2">
                {sources.map((src: any, idx: number) => (
                   <a key={idx} href={src.url} target="_blank" rel="noreferrer" className="group/src flex items-center gap-2 p-1.5 px-2.5 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-[#6A829E] hover:bg-white dark:hover:bg-neutral-800 transition-all max-w-[200px] shadow-sm hover:shadow-md">
                      <img src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(src.url)}`} className="w-4 h-4 rounded-sm object-cover bg-white" alt="" />
                      <span className="text-[10px] font-bold text-neutral-600 dark:text-neutral-300 truncate group-hover/src:text-[#4A5D75] dark:group-hover/src:text-[#9EADC8]">{src.title.replace('Wiki: ', '')}</span>
                   </a>
                ))}
             </div>
          </div>
       );
    }

    return elements;
  }, [generationMode, addTask, userProfile, saveImageToLibrary, viewImageInCanvas]);

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

  return (
    <div className="flex h-screen overflow-hidden w-full font-sans transition-colors duration-300 bg-transparent text-neutral-900 dark:text-neutral-100">

      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[300] bg-[#2C3E50] text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-4 fade-in duration-300 font-bold text-xs uppercase tracking-widest">
           <AlertTriangle className="w-4 h-4 text-[#D4AA7D]" />
           {toastMessage}
        </div>
      )}

      {showConsole && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-neutral-900 w-full max-w-2xl h-[60vh] rounded-2xl flex flex-col shadow-2xl border border-neutral-700 font-mono text-xs overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-neutral-800 bg-neutral-950 shrink-0"><span className="text-neutral-400 font-bold flex items-center gap-2"><Activity className="w-4 h-4"/> App Console Log</span><div className="flex gap-4"><button onClick={() => setLogs([])} className="text-neutral-500 hover:text-white font-bold tracking-widest uppercase">Clear</button><button onClick={() => setShowConsole(false)} className="text-neutral-500 hover:text-white"><X className="w-4 h-4"/></button></div></div>
            <div className="flex-1 overflow-auto p-4 space-y-2 custom-scrollbar select-text">{logs.length === 0 ? <span className="text-neutral-600 italic">No logs yet...</span> : logs.map((l, i) => (<div key={i} className={`flex gap-3 ${l.level === 'error' ? 'text-[#C98A8A]' : l.level === 'warn' ? 'text-[#D4AA7D]' : 'text-neutral-300'}`}><span className="text-neutral-600 shrink-0 select-none">[{l.time}]</span><span className="break-all whitespace-pre-wrap">{l.msg}</span></div>))}</div>
          </div>
        </div>
      )}

      {/* ── Sidebar ── */}
      <div className={`shrink-0 transition-all duration-300 border-r border-neutral-200 dark:border-neutral-800 z-[60] bg-white dark:bg-neutral-950 overflow-hidden flex flex-col ${isSidebarOpen && !canvasContent?.isStandalone ? 'w-72' : 'w-0'}`}>
        <div className="w-72 h-full flex flex-col">
          <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-3 bg-[#2C3E50]">
            <div className="p-2 bg-[#9EADC8] rounded-xl shadow-md shrink-0"><Bot className="w-5 h-5 text-[#2C3E50]" /></div>
            <div><span className="text-sm font-black tracking-tighter uppercase text-white block">Agent Forge</span><span className="text-[9px] font-bold uppercase tracking-widest text-[#9EADC8]">Workspace</span></div>
          </div>

          <div className="flex p-1 gap-1 mx-4 mt-4 bg-neutral-100 dark:bg-neutral-800 rounded-xl shrink-0">
            {['chat', 'archives'].map(v => <button key={v} onClick={() => setViewMode(v)} className={`flex-1 text-[10px] uppercase font-black py-2 rounded-lg transition-all ${viewMode === v ? 'bg-white dark:bg-neutral-700 shadow-sm text-[#4A5D75]' : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200'}`}>{v}</button>)}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2 no-scrollbar">
            {viewMode === 'chat' ? (
              <div className="space-y-3">
                <div className="px-1 mb-2 relative mt-2"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400" /><input className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-lg pl-8 pr-4 py-2.5 text-[10px] font-bold outline-none focus:ring-1 ring-[#6A829E]/30" placeholder="Search chats..." value={chatSearchQuery} onChange={e => setChatSearchQuery(e.target.value)} /></div>
                {/* Scoped Sidebar Chats to Active Folder ID */}
                {chats.filter(c => c.folderId === activeFolderId && c.name.toLowerCase().includes(chatSearchQuery.toLowerCase())).map(chat => (
                  <div key={chat.id} onClick={() => { setActiveChatId(chat.id); setCanvasContent(null); setShowPlanner(false); }} className={`group flex items-center justify-between px-3 py-3 rounded-xl cursor-pointer transition-all ${activeChatId === chat.id && !showPlanner ? 'bg-neutral-100 dark:bg-neutral-800 font-bold border-l-2 border-[#4A5D75]' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900/50 text-neutral-500'}`}>
                    {editingChatId === chat.id ? (<input autoFocus value={editingChatName} onChange={e => setEditingChatName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setChats(prev => prev.map(c => c.id === chat.id ? { ...c, name: editingChatName || 'Unnamed' } : c)); setEditingChatId(null); } else if (e.key === 'Escape') setEditingChatId(null); }} onBlur={() => { setChats(prev => prev.map(c => c.id === chat.id ? { ...c, name: editingChatName || 'Unnamed' } : c)); setEditingChatId(null); }} className="w-full bg-white dark:bg-neutral-950 text-xs font-bold px-2 py-1 rounded outline-none border border-[#6A829E]" />) : (<><span className="text-xs truncate flex-1">{chat.name}</span><div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={(e) => { e.stopPropagation(); setEditingChatId(chat.id); setEditingChatName(chat.name); }} className="text-neutral-400 hover:text-[#6A829E]"><Edit2 className="w-3 h-3" /></button><button onClick={e => { e.stopPropagation(); setChats(prev => prev.filter(c => c.id !== chat.id)); if (activeChatId === chat.id) setActiveChatId(null); }} className="text-neutral-400 hover:text-[#C98A8A]"><Trash2 className="w-3.5 h-3.5" /></button></div></>)}
                  </div>
                ))}
                {chats.filter(c => c.folderId === activeFolderId).length === 0 && (
                    <div className="text-center text-xs text-neutral-400 font-bold mt-4">No chats found for this bot.</div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2 px-1 mb-4"><button onClick={() => createBlankArtifact('code')} className="flex-1 flex justify-center items-center gap-1.5 py-3 rounded-xl border border-[#D6E0EA] dark:border-[#4A5D75]/50 bg-[#F0F4F8] dark:bg-[#4A5D75]/20 text-[9px] font-black uppercase text-[#4A5D75] dark:text-[#899AB5] hover:bg-[#D6E0EA] dark:hover:bg-[#4A5D75]/40 transition-all"><TerminalSquare className="w-3.5 h-3.5" /> Blank App</button><button onClick={() => createBlankArtifact('doc')} className="flex-1 flex justify-center items-center gap-1.5 py-3 rounded-xl border border-[#DCE7E1] dark:border-[#2C3E35]/50 bg-[#EEF3F0] dark:bg-[#2C3E35]/20 text-[9px] font-black uppercase text-[#7A9E8D] dark:text-[#B5CDBF] hover:bg-[#DCE7E1] dark:hover:bg-[#2C3E35]/40 transition-all"><FileEdit className="w-3.5 h-3.5" /> Blank Doc</button></div>
                <div className="px-1 mb-2 relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400" /><input className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-lg pl-8 pr-4 py-2.5 text-[10px] font-bold outline-none focus:ring-1 ring-[#6A829E]/30" placeholder="Search saved items..." value={archiveSearchQuery} onChange={e => setArchiveSearchQuery(e.target.value)} /></div>
                <div className="flex gap-1 border-b border-neutral-100 dark:border-neutral-800 mb-2 px-1">{['code', 'doc', 'image'].map(v => <button key={v} onClick={() => setArchiveSubView(v)} className={`flex-1 pb-2 text-[9px] font-black uppercase tracking-tighter transition-all ${archiveSubView === v ? (v === 'code' ? 'text-[#4A5D75] border-b-2 border-[#4A5D75]' : v === 'doc' ? 'text-[#7A9E8D] border-b-2 border-[#7A9E8D]' : 'text-[#D4AA7D] border-b-2 border-[#D4AA7D]') : 'text-neutral-400'}`}>{v === 'code' ? 'Code' : v === 'doc' ? 'Docs' : 'Images'}</button>)}</div>
                
                <div className="space-y-2 px-1">
                  {savedApps.filter(a => a.type === archiveSubView && a.title.toLowerCase().includes(archiveSearchQuery.toLowerCase())).map(app => (
                    <div key={app.id} onClick={() => { const appToLoad = { ...app, isStandalone: true }; if (!appToLoad.history && app.type !== 'image') { appToLoad.history = [{ timestamp: appToLoad.updatedAt || Date.now(), content: appToLoad.content }]; appToLoad.historyIndex = 0; } setCanvasContent(appToLoad); setCanvasTab('preview'); setShowPlanner(false); }} className="group px-3 py-3 rounded-xl cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-3 border border-transparent hover:border-neutral-200 dark:hover:border-neutral-700 transition-all">
                      <div className={`p-2 rounded-lg shrink-0 ${archiveSubView === 'code' ? 'bg-[#F0F4F8] dark:bg-[#1E2B38]/20' : archiveSubView === 'doc' ? 'bg-[#EEF3F0] dark:bg-[#2C3E35]/20' : 'bg-[#FFF9F2] dark:bg-[#5C452E]/20'}`}>{archiveSubView === 'code' ? <Code className="w-4 h-4 text-[#6A829E]" /> : archiveSubView === 'doc' ? <FileText className="w-4 h-4 text-[#9FBBAF]" /> : <ImageIcon className="w-4 h-4 text-[#D4AA7D]" />}</div>
                      <span className="text-xs truncate font-bold text-neutral-800 dark:text-neutral-200 flex-1">{app.title}</span>
                      <button onClick={(e) => { e.stopPropagation(); deleteSavedApp(app.id); }} className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-[#C98A8A] transition-all p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  {savedApps.filter(a => a.type === archiveSubView).length === 0 && (
                      <div className="text-center text-xs text-neutral-400 font-bold mt-4">No saved items found.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-neutral-200 dark:border-neutral-800 shrink-0">
            <button onClick={() => { const id = generateId('c'); setChats(prev => [{ id, folderId: activeFolderId, name: 'New Session', updatedAt: Date.now() }, ...prev]); setActiveChatId(id); setMessages(prev => ({ ...prev, [id]: [] })); setShowPlanner(false); setViewMode('chat'); }} className="w-full flex items-center justify-center gap-2 bg-[#9EADC8] hover:bg-[#899AB5] text-[#2C3E50] font-black text-[10px] uppercase tracking-widest rounded-xl px-4 py-3.5 shadow-lg transition-all active:scale-95"><Plus className="w-4 h-4" /> New Chat</button>
          </div>
        </div>
      </div>

      {/* ── Main Panel ── */}
      <div className="flex-1 flex flex-row overflow-hidden relative">
        {!canvasContent?.isStandalone && (
          <div className={`flex flex-col h-full bg-white dark:bg-neutral-900 transition-all duration-300 flex-shrink-0 relative ${canvasContent ? 'w-1/2 border-r border-neutral-200 dark:border-neutral-800' : 'w-full'}`}>
            
            {/* Header */}
            <header className="h-16 shrink-0 flex items-center justify-between px-4 lg:px-6 border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md z-10">
              <div className="flex items-center gap-3 relative" ref={dropdownRef}>
                <button onClick={() => setIsSidebarOpen(v => !v)} className="p-2 -ml-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 transition-colors"><Menu className="w-5 h-5" /></button>
                <button onClick={() => setIsAgentDropdownOpen(v => !v)} className="flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 p-2 rounded-xl transition-all">
                  {!showPlanner && activeAssistant && <AgentIcon agent={activeAssistant} sizeClass="w-4 h-4" containerClass="p-1 rounded-md shadow-sm" />}
                  <span className="text-sm font-black tracking-tight">{showPlanner ? 'My Planner' : activeAssistant?.name ?? 'Assistant'}</span>
                  {!showPlanner && <ChevronDown className="w-4 h-4 text-neutral-400" />}
                </button>

                {isAgentDropdownOpen && !showPlanner && (
                  <div className="absolute top-full left-10 mt-1 w-72 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in fade-in zoom-in duration-150">
                    <div className="max-h-64 overflow-y-auto p-1.5 custom-scrollbar space-y-1">
                      {assistants.map(agent => (
                        <div key={agent.id} className={`group flex items-center justify-between px-2 py-2 rounded-xl cursor-pointer transition-all ${activeFolderId === agent.id ? 'bg-[#F0F4F8] dark:bg-[#4A5D75]/20' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800'}`}>
                          <div className="flex items-center gap-3 truncate flex-1" onClick={() => { setActiveFolderId(agent.id); setActiveChatId(null); setIsAgentDropdownOpen(false); if (agent.defaultModelId) setSelectedModelId(agent.defaultModelId); }}>
                            <AgentIcon agent={agent} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm" />
                            <div className="flex flex-col truncate"><span className="text-xs font-bold truncate dark:text-white">{agent.name}</span><div className="flex gap-1 mt-0.5">{agent.tools?.web_search && <Globe className="w-2.5 h-2.5 text-[#9EADC8]" />}{agent.tools?.local_workspace && <Database className="w-2.5 h-2.5 text-[#C98A8A]" />}{agent.tools?.calendar_sync && <CalendarDays className="w-2.5 h-2.5 text-[#9FBBAF]" />}</div></div>
                          </div>
                          <button onClick={e => { e.stopPropagation(); setEditingAssistant({ ...agent }); setAssistantSettingsTab('config'); setShowAssistantSettings(true); setIsAgentDropdownOpen(false); }} className="p-1.5 text-neutral-400 hover:text-[#4A5D75] hover:bg-white dark:hover:bg-neutral-700 rounded-lg transition-all"><Settings className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                      <div className="border-t border-neutral-100 dark:border-neutral-800 mt-1 pt-1"><button onClick={() => { setEditingAssistant({ id: 'new', name: 'New Assistant', prompt: 'You are a helpful AI assistant.', avatar: { type: 'color', color: 'sage' }, trainingDocs: [], systemAccess: false, tools: {}, awareOfProfile: true, defaultModelId: selectedModel?.id ?? '', defaultMode: 'text' }); setShowAssistantSettings(true); setIsAgentDropdownOpen(false); }} className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl text-[#4A5D75] hover:bg-[#F0F4F8] dark:hover:bg-[#1E2B38]/20 transition-all text-[10px] font-black uppercase tracking-widest"><Plus className="w-3 h-3" /> Create Bot</button></div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button onClick={() => setShowConsole(v => !v)} className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${showConsole ? 'bg-[#D6E0EA] dark:bg-[#1E2B38]/50 text-[#4A5D75]' : hasErrorLogs ? 'text-[#C98A8A] hover:bg-[#F7EBEB] dark:hover:bg-[#4A2E2E]/30' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400'}`} title="Open App Console">
                  {hasErrorLogs ? (
                    <div className="relative">
                      <AlertTriangle className="w-5 h-5 animate-pulse text-[#C98A8A]" />
                      <span className="absolute -top-1.5 -right-1.5 bg-[#C98A8A] text-white text-[9px] font-black w-4 h-4 flex items-center justify-center rounded-full shadow-sm">{errorLogsCount}</span>
                    </div>
                  ) : <Activity className="w-5 h-5" />}
                </button>
                <button onClick={() => setShowPlanner(v => !v)} className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${showPlanner ? 'bg-[#D6E0EA] dark:bg-[#1E2B38]/50 text-[#4A5D75]' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400'}`}>
                  <CalendarDays className="w-5 h-5" />
                  {tasks.filter(t => !t.completed).length > 0 && <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#6A829E] text-white text-[9px] font-black">{tasks.filter(t => !t.completed).length}</span>}
                </button>
                <div className="w-px h-6 bg-neutral-200 dark:bg-neutral-800 mx-1" />
                <button onClick={() => setShowProfileSettings(true)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-neutral-400"><Settings className="w-5 h-5" /></button>
              </div>
            </header>

            {/* Context Progress Bar */}
            {!showPlanner && selectedModel && activeMessages.length > 0 && (
              <ContextMeter messages={activeMessages} systemPromptLen={systemPromptLen} limit={selectedModel?.contextLimit ?? 32000} />
            )}

            {/* Views */}
            {showPlanner ? (
              <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-neutral-50/50 dark:bg-neutral-900/50 no-scrollbar relative">
                
                {/* Task Discuss Bot Selector Modal */}
                {taskToDiscuss && (
                  <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                     <div className="bg-white dark:bg-neutral-900 w-full max-w-sm rounded-2xl shadow-xl p-5 border border-neutral-200 dark:border-neutral-800">
                        <div className="flex justify-between items-center mb-4">
                           <h3 className="text-sm font-black uppercase tracking-widest text-[#4A5D75] dark:text-[#899AB5]">Ask which Agent?</h3>
                           <button onClick={() => setTaskToDiscuss(null)} className="text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4"/></button>
                        </div>
                        <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                           {assistants.map(a => (
                              <button key={a.id} onClick={() => {
                                  setActiveFolderId(a.id);
                                  setInput(`I need help with this task: ${taskToDiscuss.title}${taskToDiscuss.details ? `\nDetails: ${taskToDiscuss.details}` : ''}`); 
                                  setShowPlanner(false); 
                                  setViewMode('chat');
                                  setActiveChatId(null);
                                  setTaskToDiscuss(null);
                              }} className="w-full flex items-center gap-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all text-left">
                                  <AgentIcon agent={a} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm" />
                                  <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200 flex-1">{a.name}</span>
                                  <ChevronRight className="w-4 h-4 text-neutral-400" />
                              </button>
                           ))}
                        </div>
                     </div>
                  </div>
                )}

                <div className="max-w-4xl mx-auto space-y-8">
                  <div className="bg-white dark:bg-neutral-950 p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg font-black tracking-tight flex items-center gap-2"><ListTodo className="w-5 h-5 text-[#6A829E]" /> Agenda</h2>
                      <div className="flex bg-neutral-100 dark:bg-neutral-900 p-1 rounded-lg">
                        <button onClick={() => setPlannerView('list')} className={`p-1.5 rounded-md transition-all ${plannerView === 'list' ? 'bg-white dark:bg-neutral-800 shadow-sm text-[#4A5D75]' : 'text-neutral-400'}`}><LayoutList className="w-4 h-4" /></button>
                        <button onClick={() => setPlannerView('calendar')} className={`p-1.5 rounded-md transition-all ${plannerView === 'calendar' ? 'bg-white dark:bg-neutral-800 shadow-sm text-[#4A5D75]' : 'text-neutral-400'}`}><CalendarDays className="w-4 h-4" /></button>
                      </div>
                    </div>

                    {plannerView === 'calendar' ? (
                      <div className="animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between mb-4 px-2">
                          <button onClick={() => setCurrentMonthDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"><ChevronLeft className="w-5 h-5" /></button>
                          <span className="text-sm font-black uppercase tracking-widest">{MONTHS[currentMonthDate.getMonth()]} {currentMonthDate.getFullYear()}</span>
                          <button onClick={() => setCurrentMonthDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"><ChevronRight className="w-5 h-5" /></button>
                        </div>
                        <div className="grid grid-cols-7 gap-1 mb-2">
                          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="text-center text-[10px] font-black uppercase tracking-widest text-neutral-400 py-2">{d}</div>)}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {calendarDays.map((dateObj, i) => {
                            if (!dateObj) return <div key={`empty-${i}`} className="min-h-[80px] bg-neutral-50/50 dark:bg-neutral-900/20 rounded-xl" />;
                            const ds = toLocalISODate(dateObj), isToday = ds === toLocalISODate(new Date()), isSelected = ds === newTaskDate;
                            const dayTasks = tasks.filter(t => t.dueDate === ds && !t.completed);
                            return (
                              <div key={ds} onClick={() => setNewTaskDate(ds as string)} className={`min-h-[80px] p-2 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 ${isSelected ? 'border-[#6A829E] bg-[#F0F4F8]' : isToday ? 'border-neutral-300 dark:border-neutral-600' : 'border-neutral-100 dark:border-neutral-800 hover:border-[#899AB5]'}`}>
                                <span className={`text-xs font-bold ${isToday ? 'text-[#4A5D75]' : 'text-neutral-500'}`}>{dateObj.getDate()}</span>
                                {dayTasks.map(t => <div key={t.id} className="text-[9px] font-bold truncate bg-[#D6E0EA] dark:bg-[#1E2B38]/50 text-[#1E2B38] dark:text-[#C5D3E0] px-1.5 py-0.5 rounded" title={t.title}>{t.title}</div>)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 animate-in fade-in duration-200">
                        {tasks.filter(t => !t.completed).length === 0 ? (
                          <div className="text-center py-6 text-neutral-400 text-sm font-bold">No pending tasks — you're clear!</div>
                        ) : tasks.filter(t => !t.completed).map(task => (
                          <div key={task.id}
                               draggable
                               onDragStart={(e) => handleDragStart(e, task.id)}
                               onDragOver={handleDragOver}
                               onDrop={(e) => handleDrop(e, task.id)}
                               onDragEnd={() => setDraggedTaskId(null)}
                               className={`flex items-start justify-between group p-3 hover:bg-neutral-50 dark:hover:bg-neutral-900 rounded-xl border transition-all ${draggedTaskId === task.id ? 'opacity-50 border-[#6A829E] bg-neutral-100 dark:bg-neutral-800' : 'border-transparent hover:border-neutral-100 dark:hover:border-neutral-800'}`}>
                            <div className="flex items-start gap-3 mt-1">
                              <div className="cursor-grab text-neutral-300 hover:text-neutral-500 mt-1 flex shrink-0" title="Drag to reorder"><GripVertical className="w-4 h-4" /></div>
                              <button onClick={() => toggleTask(task.id)} className="text-neutral-300 hover:text-[#6A829E] transition-colors mt-0.5"><Circle className="w-5 h-5" /></button>
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{task.title}</span>
                                <div className="flex items-center gap-3 mt-1 flex-wrap">
                                  {task.dueDate    && <span className="text-[10px] font-black uppercase text-[#6A829E] tracking-wider flex items-center gap-1"><Clock className="w-3 h-3" /> {task.dueDate}</span>}
                                  {task.location  && <span className="text-[10px] font-bold text-[#7A9E8D] flex items-center gap-1"><MapPin className="w-3 h-3" /> {task.location}</span>}
                                </div>
                                {task.details && <p className="text-xs text-neutral-500 mt-1.5 max-w-xl bg-neutral-50 dark:bg-neutral-900 p-2 rounded-lg">{task.details}</p>}
                              </div>
                            </div>
                            <div className="opacity-0 group-hover:opacity-100 flex items-center transition-all">
                              <button onClick={() => setTaskToDiscuss(task)} className="p-2 text-neutral-400 hover:text-[#4A5D75] transition-all" title="Get Help"><MessageSquare className="w-4 h-4" /></button>
                              <button onClick={() => deleteTask(task.id)} className="p-2 text-neutral-400 hover:text-[#C98A8A] transition-all" title="Delete"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-auto pt-6 border-t border-neutral-100 dark:border-neutral-800">
                      <form onSubmit={handleManualTaskSubmit} className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                          <input type="text" value={newTaskInput} onChange={e => setNewTaskInput(e.target.value)} placeholder="Add new task..." className="flex-1 bg-neutral-100 dark:bg-neutral-900 border-none outline-none px-4 py-3 rounded-xl text-sm font-medium" />
                          <input type="date" value={newTaskDate} onChange={e => setNewTaskDate(e.target.value)} className="bg-neutral-100 dark:bg-neutral-900 border-none outline-none px-3 py-3 rounded-xl text-xs font-bold text-neutral-600 dark:text-neutral-300" />
                          <button type="button" onClick={() => setShowTaskDetailsForm(v => !v)} className={`p-3 rounded-xl transition-all ${showTaskDetailsForm ? 'bg-[#D6E0EA] text-[#4A5D75]' : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-500 hover:bg-neutral-200'}`}><AlignLeft className="w-4 h-4" /></button>
                          <button type="submit" disabled={!newTaskInput.trim()} className="px-6 py-3 bg-[#4A5D75] disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#3D4D61] transition-all">Add</button>
                        </div>
                        {showTaskDetailsForm && (
                          <div className="flex gap-2 animate-in slide-in-from-top-2">
                            <div className="flex items-center bg-neutral-100 dark:bg-neutral-900 rounded-xl px-3 w-1/3"><MapPin className="w-4 h-4 text-neutral-400 shrink-0" /><input type="text" value={newTaskLocation} onChange={e => setNewTaskLocation(e.target.value)} placeholder="Location..." className="w-full bg-transparent border-none outline-none p-2 text-xs font-medium" /></div>
                            <div className="flex items-center bg-neutral-100 dark:bg-neutral-900 rounded-xl px-3 flex-1"><AlignLeft className="w-4 h-4 text-neutral-400 shrink-0" /><input type="text" value={newTaskDetails} onChange={e => setNewTaskDetails(e.target.value)} placeholder="Notes..." className="w-full bg-transparent border-none outline-none p-2 text-xs font-medium" /></div>
                          </div>
                        )}
                      </form>
                    </div>
                  </div>

                  {tasks.filter(t => t.completed).length > 0 && (
                    <div className="opacity-60 hover:opacity-100 transition-all">
                      <h3 className="text-xs font-black uppercase tracking-widest mb-4 px-2 text-neutral-500 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Completed</h3>
                      {tasks.filter(t => t.completed).map(task => (
                        <div key={task.id} className="flex items-center justify-between p-2 px-4 bg-neutral-100 dark:bg-neutral-800/30 rounded-lg mb-2">
                          <div className="flex items-center gap-3"><button onClick={() => toggleTask(task.id)} className="text-[#9FBBAF]"><CheckCircle2 className="w-4 h-4" /></button><span className="text-sm font-medium line-through text-neutral-500">{task.title}</span></div>
                          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-all">
                            <button onClick={() => { setInput(`I need help with this completed task: ${task.title}${task.details ? `\nDetails: ${task.details}` : ''}`); setShowPlanner(false); setViewMode('chat'); }} className="p-2 text-neutral-400 hover:text-[#4A5D75] transition-all" title="Get Help"><MessageSquare className="w-3.5 h-3.5" /></button>
                            <button onClick={() => deleteTask(task.id)} className="p-2 text-neutral-400 hover:text-[#C98A8A]"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div 
                className={`flex-1 flex flex-col relative overflow-hidden transition-colors ${isDragging ? 'bg-[#9EADC8]/10' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {/* Drag and Drop Overlay */}
                {isDragging && (
                  <div className="absolute inset-0 z-50 bg-[#6A829E]/10 border-4 border-[#6A829E]/50 border-dashed rounded-[2rem] m-4 flex items-center justify-center pointer-events-none backdrop-blur-[2px] transition-all">
                      <div className="bg-white dark:bg-neutral-800 px-6 py-4 rounded-2xl shadow-xl flex items-center gap-3 text-[#4A5D75] dark:text-[#9EADC8] font-black tracking-widest uppercase">
                          <Paperclip className="animate-bounce" /> Drop file to attach
                      </div>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 lg:p-6 no-scrollbar scroll-smooth">
                  {models.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center pb-20 animate-in fade-in zoom-in duration-500">
                      <div className="p-6 bg-[#2C3E50]/10 dark:bg-[#9EADC8]/10 rounded-full mb-6 border border-[#2C3E50]/20 dark:border-[#9EADC8]/20"><Zap className="w-12 h-12 text-[#2C3E50] dark:text-[#9EADC8]" /></div>
                      <h2 className="text-3xl font-black tracking-tighter uppercase mb-3">Welcome to Agent Forge</h2>
                      <p className="text-sm font-medium text-neutral-500 max-w-md mb-8 leading-relaxed">Connect an LLM to begin. Initialize a Native AI, scan local ports, or enter a cloud API key.</p>
                      <button onClick={() => { setWizardStep(3); setShowModelWizard(true); setIsModelDropdownOpen(false); }} className="px-8 py-4 bg-[#9EADC8] hover:bg-[#899AB5] text-[#2C3E50] rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-[#9EADC8]/30 transition-all active:scale-95 flex items-center gap-3"><Plus className="w-5 h-5" /> Connect Your First LLM</button>
                    </div>
                  ) : activeChatId && activeMessages.length > 0 ? (
                    <div className="max-w-3xl mx-auto space-y-6 pb-64">
                      {activeMessages.map(msg => (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          {msg.role === 'bot' && <div className="shrink-0 mr-3 mt-1 hidden sm:block"><AgentIcon agent={activeAssistant} sizeClass="w-4 h-4" containerClass="p-1.5 rounded-lg shadow-sm" /></div>}
                          
                          <div className={`group relative flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} ${editingMessageId === msg.id ? 'w-full' : ''}`}>
                             <div className={`p-4 rounded-2xl max-w-[92%] shadow-sm ${msg.role === 'user' ? 'bg-[#4A5D75] text-white' : 'bg-white dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 text-neutral-800 dark:text-neutral-100'} ${editingMessageId === msg.id ? 'w-full' : ''}`}>
                               
                               {editingMessageId === msg.id ? (
                                  <div className="flex flex-col gap-3 w-full animate-in fade-in">
                                     <textarea value={editingMessageContent} onChange={e => setEditingMessageContent(e.target.value)} className="w-full bg-white/10 dark:bg-black/20 border border-white/20 dark:border-neutral-600 rounded-xl p-3 text-sm outline-none resize-none font-medium custom-scrollbar" rows={3} autoFocus />
                                     <div className="flex justify-end gap-2">
                                        <button onClick={() => setEditingMessageId(null)} className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest opacity-70 hover:opacity-100 transition-opacity">Cancel</button>
                                        <button onClick={() => confirmEditMessage(msg.id)} disabled={!editingMessageContent.trim()} className="px-4 py-1.5 bg-white text-[#4A5D75] dark:bg-neutral-700 dark:text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-neutral-100 dark:hover:bg-neutral-600 transition-colors shadow-sm disabled:opacity-50">Resend</button>
                                     </div>
                                  </div>
                               ) : (
                                  <div className="leading-relaxed">{renderMessageWithWidgets(msg)}</div>
                               )}
                             </div>

                             {/* Actions Bar - Positioned Below Bubble */}
                             {!editingMessageId && (
                               <div className={`flex items-center gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} px-1`}>
                                  {msg.role === 'user' && !isGenerating && <button onClick={() => { setEditingMessageId(msg.id); setEditingMessageContent(msg.content); }} className="p-1.5 text-neutral-400 hover:text-[#4A5D75] hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-all" title="Edit & Resend"><Edit3 className="w-3.5 h-3.5" /></button>}
                                  <button onClick={() => { navigator.clipboard.writeText(msg.content); showToast("Copied to clipboard!"); }} className="p-1.5 text-neutral-400 hover:text-[#4A5D75] hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-all" title="Copy Content"><Copy className="w-3.5 h-3.5" /></button>
                                  {msg.role === 'bot' && !isGenerating && <button onClick={() => toggleSpeak(msg.id, msg.content)} className={`p-1.5 rounded-md transition-all ${speakingId === msg.id ? 'text-[#C98A8A] bg-[#C98A8A]/10' : 'text-neutral-400 hover:text-[#4A5D75] hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title={speakingId === msg.id ? "Stop Reading" : "Read Aloud"}>{speakingId === msg.id ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}</button>}
                                  <button onClick={() => { addTask(msg.content.slice(0, 100)); setShowPlanner(true); }} className="p-1.5 text-neutral-400 hover:text-[#4A5D75] hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-all" title="Turn into task"><ListTodo className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => setMessages(prev => ({ ...prev, [activeChatId as string]: prev[activeChatId as string].map(m => m.id === msg.id ? { ...m, isPinned: !m.isPinned } : m) }))} className={`p-1.5 rounded-md transition-all ${msg.isPinned ? 'text-[#D4AA7D] bg-[#D4AA7D]/10' : 'text-neutral-400 hover:text-[#4A5D75] hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Pin to Memory (Agent KB)"><Pin className="w-3.5 h-3.5" /></button>
                               </div>
                             )}
                          </div>
                        </div>
                      ))}
                      {isGenerating && !activeMessages[activeMessages.length - 1]?.isStreaming && <div className="flex justify-start"><TypingIndicator /></div>}
                      <div ref={messagesEndRef} className="h-4" />
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-20 pointer-events-none grayscale pb-20">
                      <AgentIcon agent={activeAssistant} sizeClass="w-16 h-16" containerClass="p-4 rounded-3xl mb-4" />
                      <h2 className="text-2xl font-black italic tracking-tighter uppercase">Start Session</h2>
                    </div>
                  )}
                </div>

                {/* Input Bar */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white dark:from-neutral-900 pt-10 pb-6 px-4 lg:px-6 z-10">
                  <div className="max-w-3xl mx-auto">
                    
                    {/* Error Display */}
                    {uploadError && (
                        <div className="mb-2 flex items-center gap-2 text-[#C98A8A] text-[10px] font-black uppercase tracking-widest bg-[#C98A8A]/10 p-2 rounded-xl border border-[#C98A8A]/20 animate-in slide-in-from-bottom-2">
                            <AlertTriangle size={14} /> {uploadError}
                        </div>
                    )}

                    {attachedDocs.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3 px-2">
                        {attachedDocs.map((doc, idx) => (
                          <div key={idx} className="relative group flex items-center gap-2 px-3 py-1.5 bg-white border border-neutral-200 dark:bg-neutral-800 dark:border-neutral-700 rounded-xl text-[10px] font-black shadow-sm animate-in slide-in-from-bottom-2">
                            {doc.isImage ? <img src={doc.content} alt={doc.name} className="w-6 h-6 object-cover rounded-md" /> : <FileText className="w-4 h-4 text-[#6A829E]" />}
                            <span className="max-w-[100px] truncate">{doc.name}</span>
                            <button onClick={() => setAttachedDocs(prev => prev.filter((_, i) => i !== idx))} className="opacity-50 hover:opacity-100 hover:text-[#C98A8A]"><X className="w-3 h-3" /></button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between mb-3 px-2">
                      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                        {[{ id: 'text', label: 'Chat', icon: MessageSquare }, { id: 'code', label: 'Code', icon: Code }, { id: 'doc', label: 'Doc', icon: FileEdit }, { id: 'image', label: 'Image', icon: ImageIcon }]
                          .filter(m => m.id !== 'image' || appSettings?.imageProvider !== 'none')
                          .map(({ id, label, icon: Icon }) => (
                          <button key={id} onClick={() => setGenerationMode(id)} className={`flex items-center gap-1.5 text-[9px] uppercase font-black px-3 py-1.5 rounded-full transition-all border ${generationMode === id ? 'bg-[#2C3E50] text-[#9EADC8] border-[#2C3E50] dark:bg-[#9EADC8] dark:text-[#2C3E50] dark:border-[#9EADC8]' : 'bg-white dark:bg-neutral-800 text-neutral-500 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'}`}>
                            <Icon className="w-3 h-3" /> {label}
                          </button>
                        ))}
                      </div>

                      {/* Model Selector */}
                      <div className="flex items-center gap-2" ref={modelDropdownRef}>
                        <div className="relative">
                          <button onClick={() => setIsModelDropdownOpen(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full border border-neutral-200 dark:border-neutral-700 hover:border-[#9EADC8] transition-all shadow-sm">
                            <Zap className="w-3 h-3 text-[#9EADC8]" />
                            {selectedModel && modelValidation[selectedModel.id] === 'fail' && <span title="Model unreachable"><AlertTriangle className="w-3 h-3 text-[#C98A8A]" /></span>}
                            {selectedModel && modelValidation[selectedModel.id] === 'ok'   && <span title="Model verified"><ShieldCheck   className="w-3 h-3 text-[#9FBBAF]" /></span>}
                            <span className="text-[9px] font-black text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{selectedModel?.name ?? 'Select Brain'}</span>
                            <ChevronDown className="w-3 h-3 text-neutral-400" />
                          </button>
                          {isModelDropdownOpen && (
                            <div className="absolute bottom-full right-0 mb-2 w-64 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in slide-in-from-bottom-2 duration-150">
                              <div className="p-1.5 space-y-1">
                                {models.map(m => (
                                  <button key={m.id} onClick={() => { setSelectedModelId(m.id); setIsModelDropdownOpen(false); }} className={`group w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all ${selectedModelId === m.id ? 'bg-[#4A5D75] text-white' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800'}`}>
                                    <div className="flex flex-col"><span className="text-xs font-bold">{m.name}</span><span className={`text-[9px] uppercase font-black opacity-60 ${selectedModelId === m.id ? 'text-white' : 'text-neutral-500'}`}>{m.provider}</span></div>
                                    <div className="flex items-center gap-1">
                                      {modelValidation[m.id] === 'fail'    && <AlertTriangle className="w-3 h-3 text-[#D9A098]" />}
                                      {modelValidation[m.id] === 'ok'      && <ShieldCheck   className="w-3 h-3 text-[#B5CDBF]" />}
                                      {modelValidation[m.id] === 'pending' && <Loader2       className="w-3 h-3 animate-spin text-[#899AB5]" />}
                                      <div onClick={e => { e.stopPropagation(); setModels(prev => prev.filter(x => x.id !== m.id)); if (selectedModelId === m.id) setSelectedModelId(models[0]?.id ?? ''); }} className="p-1.5 text-neutral-400 hover:text-[#C98A8A] hover:bg-[#F7EBEB] dark:hover:bg-[#4A2E2E]/30 rounded-lg transition-colors" title="Remove Model"><Trash2 className="w-3.5 h-3.5" /></div>
                                    </div>
                                  </button>
                                ))}
                                <button onClick={() => { setWizardStep(3); setShowModelWizard(true); setIsModelDropdownOpen(false); }} className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-[#4A5D75] hover:bg-[#F0F4F8] dark:hover:bg-[#1E2B38]/20 transition-all border-t border-neutral-100 dark:border-neutral-800 mt-1"><Plus className="w-3 h-3" /><span className="text-[10px] font-black uppercase tracking-widest">Connect LLM</span></button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className={`relative bg-white dark:bg-neutral-950 border-2 shadow-2xl rounded-2xl transition-all overflow-hidden ${models.length === 0 ? 'opacity-50 border-neutral-200 dark:border-neutral-800' : 'border-neutral-200 dark:border-neutral-800 focus-within:border-[#9EADC8]'}`}>
                      <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                        placeholder={models.length === 0 ? 'Connect an LLM to start...' : generationMode === 'code' ? 'What application should I build?' : generationMode === 'doc' ? 'What document should I draft?' : generationMode === 'image' ? 'Describe the image you want to generate...' : `Message ${activeAssistant?.name ?? 'Assistant'}...`}
                        className="w-full bg-transparent p-4 pr-32 min-h-[60px] max-h-40 resize-none outline-none dark:text-neutral-100 text-sm font-medium custom-scrollbar" rows={1} disabled={isGenerating || models.length === 0} />
                      <div className="absolute right-2 bottom-2 flex items-center gap-1.5 bg-white/90 dark:bg-neutral-950/90 backdrop-blur px-1.5 py-1 rounded-xl">
                        {!isGenerating && models.length > 0 && <button onClick={toggleListening} className={`p-2 transition-colors rounded-lg ${isListening ? 'text-[#C98A8A] bg-[#F7EBEB] dark:bg-[#4A2E2E]/30' : 'text-neutral-400 hover:text-[#6A829E] hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Dictate"><Mic className={`w-4 h-4 ${isListening ? 'animate-bounce' : ''}`} /></button>}
                        <button onClick={() => setIsDeepThinking(v => !v)} className={`p-2 rounded-lg transition-all ${isDeepThinking ? 'bg-[#2C3E50] text-[#9EADC8] dark:bg-[#9EADC8]/20 dark:text-[#9EADC8]' : 'text-neutral-400 hover:text-[#9EADC8] hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Deep Thinking Mode"><Brain className="w-4 h-4" /></button>
                        {!isGenerating && input.trim() && models.length > 0 && <button onClick={handleEnhancePrompt} disabled={isEnhancing} className={`p-2 text-[#D4AA7D] hover:bg-[#F9F4EE] dark:hover:bg-[#5C452E]/20 rounded-lg transition-all ${isEnhancing ? 'animate-spin' : ''}`} title="Enhance Prompt"><Wand2 className="w-4 h-4" /></button>}
                        {!isGenerating && models.length > 0 && <button onClick={() => fileInputRef.current?.click()} className="p-2 text-neutral-400 hover:text-[#6A829E] transition-colors" title="Attach Document"><Paperclip className="w-4 h-4" /></button>}
                        <input type="file" ref={fileInputRef} onChange={handleChatFileUpload} className="hidden" />
                        <button
                          onClick={isGenerating ? handleStop : handleSendMessage}
                          disabled={!isGenerating && ((!input.trim() && attachedDocs.length === 0) || models.length === 0)}
                          className={`p-2.5 rounded-xl transition-all ${isGenerating ? 'bg-[#C98A8A] text-white shadow-lg animate-pulse hover:bg-[#B57070]' : 'bg-[#9EADC8] text-[#2C3E50] shadow-lg hover:bg-[#899AB5] active:scale-90 disabled:opacity-50'}`}>
                          {isGenerating ? <Square className="w-4 h-4 fill-[#2C3E50]" /> : <Send className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Canvas Panel ── */}
        {canvasContent && (
          <div className={`${canvasContent.isStandalone ? 'w-full' : 'w-1/2'} h-full flex flex-col bg-white dark:bg-neutral-950 z-50 min-w-0 transition-all duration-300 relative overflow-hidden shadow-2xl border-l border-neutral-200 dark:border-neutral-800`}>
            <div className="h-16 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between px-4 bg-neutral-50 dark:bg-neutral-900/50 shrink-0">
              <div className="flex items-center gap-3 w-2/3">
                <button onClick={() => setIsSidebarOpen(v => !v)} className="p-2 -ml-2 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 hidden lg:block"><Menu className="w-5 h-5" /></button>
                <div className={`p-2 ${canvasContent.type === 'doc' ? 'bg-[#7A9E8D]' : canvasContent.type === 'image' ? 'bg-[#D4AA7D]' : 'bg-[#4A5D75]'} rounded-lg shadow-md shrink-0 ${isGenerating ? 'animate-pulse' : ''}`}>{canvasContent.type === 'doc' ? <FileEdit className="w-4 h-4 text-white" /> : canvasContent.type === 'image' ? <ImageIcon className="w-4 h-4 text-white" /> : <Code className="w-4 h-4 text-white" />}</div>
                
                <div className="flex flex-col w-full min-w-0 max-w-[200px]">
                   <input value={canvasContent.title} onChange={e => setCanvasContent((prev: any) => ({ ...prev, title: e.target.value }))} className="bg-transparent border-none font-bold text-sm w-full outline-none focus:ring-0 truncate dark:text-neutral-100" />
                </div>

                {canvasContent.history?.length > 1 && (
                  <div className="flex items-center gap-1.5 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg p-1 shrink-0 ml-1 border border-neutral-200 dark:border-neutral-700">
                    <button onClick={() => handleHistoryNavigate(-1)} disabled={(canvasContent.historyIndex ?? 0) === 0} className="p-1 rounded-md text-neutral-500 hover:bg-white dark:hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all" title="Undo / Previous Version"><ChevronLeft className="w-4 h-4" /></button>
                    <span className="text-[10px] font-black text-neutral-500 tracking-widest px-1 w-12 text-center" title="Version History">v{(canvasContent.historyIndex ?? 0) + 1}/{canvasContent.history.length}</span>
                    <button onClick={() => handleHistoryNavigate(1)} disabled={(canvasContent.historyIndex ?? 0) === (canvasContent.history?.length ?? 1) - 1} className="p-1 rounded-md text-neutral-500 hover:bg-white dark:hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all" title="Redo / Next Version"><ChevronRight className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {canvasContent.id && savedApps.some(a => a.id === canvasContent.id) ? (
                  <div className="flex gap-1">
                    <button onClick={() => saveToLibrary(false)} className="px-3 py-2 bg-[#4A5D75] text-white rounded-xl text-[10px] font-black uppercase hover:bg-[#3D4D61] transition-all">Update</button>
                    <button onClick={() => { setSaveAppData({ title: canvasContent.title + ' (Copy)' }); setShowSaveModal(true); }} className="px-3 py-2 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded-xl text-[10px] font-black uppercase hover:bg-neutral-200 hidden lg:block">Save Copy</button>
                  </div>
                ) : (
                  <button onClick={() => { setSaveAppData({ title: canvasContent.title }); setShowSaveModal(true); }} className="px-3 py-2 text-[#4A5D75] bg-[#F0F4F8] dark:bg-[#1E2B38]/30 rounded-xl hover:bg-[#D6E0EA] transition-all text-[10px] font-black uppercase">Save</button>
                )}
                <div className="w-px h-6 bg-neutral-200 dark:bg-neutral-800 mx-1" />
                <button onClick={() => setCanvasContent(null)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-neutral-400"><X className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="flex flex-col flex-1 overflow-hidden">
              {canvasContent.type === 'code' && (
                <div className="flex border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 shrink-0">
                  {['preview', 'code'].map(tab => <button key={tab} onClick={() => setCanvasTab(tab)} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${canvasTab === tab ? 'text-[#4A5D75] border-b-2 border-[#4A5D75] bg-white dark:bg-neutral-950' : 'text-neutral-400'}`}>{tab === 'preview' ? 'Live Preview' : 'Source Code'}</button>)}
                </div>
              )}
              <div className="flex-1 bg-white dark:bg-neutral-950 overflow-hidden relative flex flex-col text-sm leading-relaxed">
                {canvasContent.type === 'image' ? (
                  <div className="flex-1 flex items-center justify-center bg-neutral-100 dark:bg-neutral-900 p-8">
                     <img src={canvasContent.content} alt={canvasContent.title} className="max-w-full max-h-full object-contain rounded-lg shadow-xl" />
                  </div>
                ) : canvasContent.type === 'doc' ? (
                  <div className="flex flex-col h-full">
                    <div className="flex gap-1 p-2 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 shrink-0 overflow-x-auto no-scrollbar">
                      {[['bold','B'],['italic','I'],['underline','U']].map(([cmd, lbl]) => <button key={cmd} onMouseDown={e => { e.preventDefault(); document.execCommand(cmd); }} className={`p-1.5 px-3 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded text-neutral-700 dark:text-neutral-300 ${cmd === 'bold' ? 'font-black' : cmd === 'italic' ? 'italic font-serif' : 'underline'}`}>{lbl}</button>)}
                      <div className="w-px h-4 bg-neutral-300 dark:bg-neutral-700 mx-1 self-center" />
                      {[['H1','H1'],['H2','H2']].map(([cmd, lbl]) => <button key={cmd} onMouseDown={e => { e.preventDefault(); document.execCommand('formatBlock', false, cmd); }} className="p-1.5 px-2 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded font-black text-xs text-neutral-700 dark:text-neutral-300">{lbl}</button>)}
                      <div className="w-px h-4 bg-neutral-300 dark:bg-neutral-700 mx-1 self-center" />
                      <button onMouseDown={e => { e.preventDefault(); document.execCommand('insertUnorderedList'); }} className="p-1.5 px-2 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded font-bold text-xs flex items-center gap-1 text-neutral-700 dark:text-neutral-300"><List className="w-3 h-3" /> List</button>
                    </div>
                    {isGenerating && !canvasContent.content ? (
                      <div className="flex-1 flex flex-col items-center justify-center space-y-4 opacity-40"><RefreshCw className="w-12 h-12 animate-spin text-[#9FBBAF]" /><span className="text-xs font-black uppercase tracking-widest">Drafting...</span></div>
                    ) : (
                      <WysiwygEditor html={canvasContent.content} disabled={isGenerating} onChange={(html: string) => setCanvasContent((prev: any) => ({ ...prev, content: html }))} />
                    )}
                  </div>
                ) : canvasTab === 'code' ? (
                  <div className="flex-1 flex overflow-hidden bg-white dark:bg-neutral-950 relative font-mono text-xs leading-[1.6]">
                    <div className="absolute left-0 top-0 bottom-0 w-12 bg-neutral-50 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 z-0" />
                    <div ref={lineNumbersRef} className="w-12 py-6 pr-3 text-right text-neutral-400 overflow-hidden select-none opacity-50 z-10 shrink-0 border-r border-transparent">
                      {canvasContent.content.split('\n').map((_: any, i: number) => <div key={i}>{i + 1}</div>)}
                    </div>
                    <textarea 
                       ref={codeRef}
                       onScroll={handleCodeScroll}
                       className="flex-1 w-full bg-transparent py-6 px-4 outline-none resize-none overflow-auto dark:text-neutral-300 custom-scrollbar whitespace-pre z-10 font-mono text-xs leading-[1.6]" 
                       value={canvasContent.content} 
                       onChange={e => setCanvasContent((prev: any) => ({ ...prev, content: e.target.value }))} 
                       spellCheck="false" 
                    />
                  </div>
                ) : isGenerating && !canvasContent.content ? (
                  <div className="flex-1 flex flex-col items-center justify-center space-y-4 opacity-40"><RefreshCw className="w-12 h-12 animate-spin text-[#6A829E]" /><span className="text-xs font-black uppercase tracking-widest">Building App...</span></div>
                ) : (
                  <iframe title="Preview" className="flex-1 w-full border-none bg-white" srcDoc={canvasContent.content} sandbox="allow-scripts allow-same-origin allow-forms allow-modals" />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}

      {/* Assistant Settings */}
      {showAssistantSettings && editingAssistant && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-neutral-900 w-full max-w-3xl rounded-[2rem] p-8 shadow-2xl border border-neutral-200 dark:border-neutral-800 max-h-[90vh] overflow-y-auto custom-scrollbar text-neutral-900 dark:text-white flex flex-col">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <div className="flex items-center gap-3"><div className="p-2 bg-[#4A5D75] rounded-xl"><UserCog className="w-6 h-6 text-white" /></div><h3 className="text-xl font-black tracking-tighter uppercase">Agent Settings</h3></div>
              <button onClick={() => setShowAssistantSettings(false)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800 mb-6 shrink-0">
              {['config', 'memory'].map(tab => (
                 <button key={tab} onClick={() => setAssistantSettingsTab(tab)} className={`pb-3 px-4 text-xs font-black uppercase tracking-widest transition-all ${assistantSettingsTab === tab ? 'text-[#4A5D75] border-b-2 border-[#4A5D75]' : 'text-neutral-400'}`}>
                    {tab === 'config' ? 'Configuration' : 'Knowledge & Memory'}
                 </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
               {assistantSettingsTab === 'config' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="space-y-6">
                        <div><label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Name</label><input type="text" value={editingAssistant.name} onChange={e => setEditingAssistant((prev: any) => ({ ...prev, name: e.target.value }))} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-2xl px-5 py-4 text-sm font-bold outline-none focus:border-[#6A829E] dark:text-neutral-100" /></div>
                        
                        <div>
                           <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Default Output Mode</label>
                           <div className="flex bg-neutral-100 dark:bg-neutral-800 p-1.5 rounded-2xl">
                             {[{id:'text', lbl:'Chat'}, {id:'code',lbl:'Code Canvas'}, {id:'doc',lbl:'Doc Draft'}, {id:'image',lbl:'Image Gen'}]
                               .filter(m => m.id !== 'image' || appSettings?.imageProvider !== 'none')
                               .map(m => (
                               <button key={m.id} onClick={() => setEditingAssistant((prev: any) => ({ ...prev, defaultMode: m.id }))} className={`flex-1 py-2.5 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all ${editingAssistant.defaultMode === m.id || (!editingAssistant.defaultMode && m.id === 'text') ? 'bg-white dark:bg-neutral-700 shadow-sm text-[#4A5D75] dark:text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}>
                                 {m.lbl}
                               </button>
                             ))}
                           </div>
                        </div>

                        <div>
                        <div className="flex items-center justify-between mb-2">
                           <label className="text-[10px] font-black uppercase opacity-50 block tracking-widest">System Prompt</label>
                           <button onClick={handleEnhanceSystemPrompt} disabled={isEnhancingPrompt || !editingAssistant.prompt || models.length === 0} className="flex items-center gap-1 text-[10px] font-black uppercase text-[#D4AA7D] hover:text-[#C29462] disabled:opacity-40"><Wand2 className={`w-3.5 h-3.5 ${isEnhancingPrompt ? 'animate-spin' : ''}`} /> Polish</button>
                        </div>
                        <textarea value={editingAssistant.prompt} onChange={e => setEditingAssistant((prev: any) => ({ ...prev, prompt: e.target.value }))} rows={8} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-2xl px-5 py-4 text-sm font-medium resize-none outline-none focus:border-[#6A829E] dark:text-neutral-100 custom-scrollbar" placeholder="You are a helpful assistant..." />
                        </div>
                     </div>
                     <div className="space-y-6">
                        <div>
                           <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Avatar</label>
                           <div className="flex gap-2 items-center flex-wrap">
                              <input type="file" accept="image/*" ref={avatarUploadRef} onChange={handleAvatarUpload} className="hidden" />
                              <button onClick={() => avatarUploadRef.current?.click()} className="w-12 h-12 rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 flex items-center justify-center hover:bg-neutral-50 dark:hover:bg-neutral-800"><ImageIcon className="w-5 h-5 text-neutral-400" /></button>
                              {BOT_COLORS.map(c => <button key={c.id} onClick={() => setEditingAssistant((prev: any) => ({ ...prev, avatar: { type: 'color', color: c.id } }))} className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all border-2 ${c.bg} ${editingAssistant?.avatar?.color === c.id && editingAssistant?.avatar?.type === 'color' ? 'ring-4 ring-[#6A829E]/30 scale-105 border-white dark:border-neutral-900' : 'border-transparent opacity-80 hover:opacity-100'}`}><Bot className="w-6 h-6 text-white" /></button>)}
                           </div>
                        </div>

                        <div>
                        <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Capabilities</label>
                        <div className="space-y-2">
                           {AVAILABLE_TOOLS.map(tool => {
                              const Icon = tool.icon, enabled = editingAssistant.tools?.[tool.id] ?? false;
                              return (
                              <div key={tool.id} className="flex flex-col bg-neutral-50 dark:bg-neutral-800/20 rounded-xl overflow-hidden border border-neutral-100 dark:border-neutral-800">
                                 <div className={`flex items-center justify-between p-3 transition-all ${enabled ? 'bg-[#F0F4F8] dark:bg-[#1E2B38]/30' : ''}`}>
                                    <div className="flex items-center gap-3">
                                    <div className={`p-1.5 rounded-lg ${enabled ? 'bg-[#4A5D75] text-white' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-500'}`}><Icon className="w-4 h-4" /></div>
                                    <div className="flex flex-col"><span className="text-xs font-bold dark:text-neutral-200">{tool.name}</span><span className="text-[9px] text-neutral-500">{tool.desc}</span></div>
                                    </div>
                                    <button onClick={() => setEditingAssistant((prev: any) => ({ ...prev, tools: { ...(prev.tools ?? {}), [tool.id]: !enabled } }))} className={`w-8 h-4 rounded-full transition-all relative shrink-0 ${enabled ? 'bg-[#4A5D75]' : 'bg-neutral-300 dark:bg-neutral-700'}`}>
                                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${enabled ? 'right-0.5' : 'left-0.5'}`} />
                                    </button>
                                 </div>
                              </div>
                              );
                           })}
                        </div>
                        </div>
                     </div>
                  </div>
               ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     {/* Knowledge Base List */}
                     <div className="p-5 bg-neutral-50 dark:bg-neutral-800/50 rounded-2xl border border-neutral-100 dark:border-neutral-800">
                        <div className="flex items-center justify-between mb-4">
                           <label className="text-[10px] font-black uppercase tracking-widest text-[#6A829E] dark:text-[#899AB5] flex items-center gap-2"><BookOpen className="w-3.5 h-3.5" /> Static Knowledge Base</label>
                           <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-widest">{editingAssistant.trainingDocs?.length ?? 0} Docs</span>
                        </div>
                        <div className="space-y-2 mb-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                           {editingAssistant.trainingDocs?.map((doc: any) => (
                              <div key={doc.id} className="flex items-center justify-between p-2.5 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700">
                                 <div className="flex items-center gap-2 truncate"><FileText className="w-4 h-4 text-[#6A829E] shrink-0" /><span className="text-xs font-bold truncate">{doc.name}</span></div>
                                 <button onClick={() => setEditingAssistant((prev: any) => ({ ...prev, trainingDocs: prev.trainingDocs.filter((d: any) => d.id !== doc.id) }))} className="p-1 text-neutral-400 hover:text-[#C98A8A]"><X className="w-4 h-4" /></button>
                              </div>
                           ))}
                           {(!editingAssistant.trainingDocs || editingAssistant.trainingDocs.length === 0) && (
                              <div className="text-center p-4 py-8 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-400 text-xs font-bold">No documents uploaded.</div>
                           )}
                        </div>
                        <input type="file" accept="text/*,.pdf,.doc,.docx" ref={trainingDocUploadRef} onChange={handleTrainingDocUpload} className="hidden" />
                        <button onClick={() => trainingDocUploadRef.current?.click()} className="w-full flex items-center justify-center gap-2 py-3 border-2 border-[#D6E0EA] dark:border-[#1E2B38] text-[#4A5D75] dark:text-[#899AB5] rounded-xl hover:bg-[#F0F4F8] dark:hover:bg-[#1E2B38]/20 transition-all text-[10px] font-black uppercase tracking-widest bg-white dark:bg-neutral-900 shadow-sm"><Paperclip className="w-4 h-4" /> Upload Document</button>
                     </div>
                     
                     {/* Pinned Memories List */}
                     <div className="p-5 bg-[#F9F4EE] dark:bg-[#5C452E]/10 rounded-2xl border border-[#EEDCC4] dark:border-[#5C452E]/30">
                        <div className="flex items-center justify-between mb-4">
                           <label className="text-[10px] font-black uppercase tracking-widest text-[#D4AA7D] flex items-center gap-2"><Pin className="w-3.5 h-3.5" /> Pinned Memories</label>
                           <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-widest">{editingAgentPins.length} Facts</span>
                        </div>
                        <div className="space-y-2 max-h-[350px] overflow-y-auto custom-scrollbar pr-1">
                           {editingAgentPins.length === 0 ? (
                              <div className="text-center p-4 py-8 border-2 border-dashed border-[#EEDCC4] dark:border-[#5C452E]/40 rounded-xl text-neutral-400 text-xs font-bold">No memories pinned yet. Use the pin icon on chat messages to save facts here forever.</div>
                           ) : (
                              editingAgentPins.map((pin: any, i: number) => (
                                 <div key={i} className="flex items-start justify-between p-3 rounded-xl border border-white dark:border-neutral-700 bg-white/50 dark:bg-neutral-800/50 group hover:border-[#D4AA7D] transition-all shadow-sm">
                                    <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300 pr-4 break-words">{pin.content}</p>
                                    <button onClick={() => setMessages(prev => ({ ...prev, [pin.chatId]: prev[pin.chatId].map(m => m.id === pin.msgId ? { ...m, isPinned: false } : m) }))} className="p-1 text-neutral-400 hover:text-[#C98A8A] hover:bg-white dark:hover:bg-neutral-800 rounded-md opacity-0 group-hover:opacity-100 transition-all shrink-0" title="Delete Memory"><Trash2 className="w-4 h-4" /></button>
                                 </div>
                              ))
                           )}
                        </div>
                     </div>
                  </div>
               )}
            </div>
            
            <button onClick={saveAssistantConfig} className="w-full py-5 bg-[#4A5D75] text-white font-black text-xs uppercase tracking-[0.2em] rounded-2xl shadow-xl mt-6 active:scale-[0.98] hover:bg-[#3D4D61] transition-all shrink-0">Save Configuration</button>
          </div>
        </div>
      )}

      {/* Global Profile/System Settings */}
      {showProfileSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-white dark:bg-neutral-900 w-full max-w-2xl rounded-[2rem] p-8 shadow-2xl border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-white flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <div className="flex items-center gap-3"><div className="p-2 bg-neutral-900 dark:bg-white rounded-xl"><Settings className="w-6 h-6 text-white dark:text-neutral-900" /></div><h3 className="text-xl font-black tracking-tighter uppercase">System Settings</h3></div>
              <button onClick={() => { setShowProfileSettings(false); setImageTestState({ loading: false, error: null, successUrl: null }); }} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800 mb-6 shrink-0">
              {['profile', 'integrations'].map(tab => <button key={tab} onClick={() => setProfileSettingsTab(tab)} className={`pb-3 px-4 text-xs font-black uppercase tracking-widest transition-all ${profileSettingsTab === tab ? 'text-[#4A5D75] border-b-2 border-[#4A5D75]' : 'text-neutral-400'}`}>{tab === 'profile' ? 'My Profile' : 'Integrations'}</button>)}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
              {profileSettingsTab === 'profile' ? (
                <div>
                  <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">About Me (Global Context)</label>
                  <textarea value={userProfile} onChange={e => setUserProfile(e.target.value)} rows={8} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-2xl px-5 py-4 text-sm font-medium resize-none outline-none focus:border-[#6A829E] dark:text-neutral-100" placeholder="" />
                  
                  {/* Automated Profile Update Toggle */}
                  <div className="mt-6 flex items-center justify-between p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
                     <div className="flex flex-col">
                        <span className="text-sm font-bold dark:text-neutral-200 block">Allow Profile Updates</span>
                        <span className="text-[10px] text-neutral-500 font-medium tracking-wide">AI can autonomously propose updates to your profile from chat conversations.</span>
                     </div>
                     <button onClick={() => setAppSettings(prev => ({ ...prev, allowProfileUpdates: !prev.allowProfileUpdates }))} className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${appSettings.allowProfileUpdates ? 'bg-[#4A5D75]' : 'bg-neutral-300 dark:bg-neutral-700'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${appSettings.allowProfileUpdates ? 'right-0.5' : 'left-0.5'}`} />
                     </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">

                  {/* Image Generation Tooling - Engineered UX */}
                  <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-6">
                     <div>
                        <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 mb-1"><ImageIcon className="w-4 h-4 text-[#D4AA7D]" /> Image Engine</h4>
                        <p className="text-xs text-neutral-500 font-medium">Configure your preferred AI image generator API. Keys are stored locally.</p>
                     </div>

                     <div>
                        <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Provider</label>
                        <select value={appSettings.imageProvider} onChange={e => { setAppSettings(prev => ({ ...prev, imageProvider: e.target.value, imageModelId: '', imageEndpoint: '' })); setImageTestState({loading:false, error:null, successUrl:null}); setImageEngineModels([]); }} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-bold">
                           <option value="none">Disabled</option>
                           <option value="openai">OpenAI (DALL-E & Compatible)</option>
                           <option value="google">Google (Imagen)</option>
                           <option value="custom">Custom Endpoint</option>
                        </select>
                     </div>

                     {/* Dynamic API Key Reveal & Testing */}
                     {appSettings.imageProvider !== 'none' && (
                        <div className="animate-in slide-in-from-top-2 fade-in duration-300 bg-neutral-50 dark:bg-neutral-950 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-800 flex flex-col gap-4">
                           
                           {/* Key Handling */}
                           {appSettings.imageProvider === 'google' && hasImplicitGoogleKey ? (
                              <div className="flex items-center gap-3 text-xs font-bold text-[#9FBBAF] bg-[#9FBBAF]/10 p-3 rounded-xl border border-[#9FBBAF]/20">
                                 <ShieldCheck className="w-5 h-5 shrink-0" /> Active: Inheriting Google API Key from Chat Models.
                              </div>
                           ) : appSettings.imageProvider === 'openai' && hasImplicitOpenAIKey ? (
                              <div className="flex items-center gap-3 text-xs font-bold text-[#9FBBAF] bg-[#9FBBAF]/10 p-3 rounded-xl border border-[#9FBBAF]/20">
                                 <ShieldCheck className="w-5 h-5 shrink-0" /> Active: Inheriting OpenAI API Key from Chat Models.
                              </div>
                           ) : (
                              <div className="flex flex-col gap-2">
                                 <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">API Key</label>
                                 <input
                                    type="password"
                                    value={
                                       appSettings.imageProvider === 'google' ? integrations.google?.apiKey || '' :
                                       appSettings.imageProvider === 'openai' ? integrations.openai?.apiKey || '' :
                                       integrations.customImage?.apiKey || ''
                                    }
                                    onChange={e => {
                                       const val = e.target.value;
                                       if (appSettings.imageProvider === 'google') setIntegrations((prev: any) => ({ ...prev, google: { apiKey: val } }));
                                       else if (appSettings.imageProvider === 'openai') setIntegrations((prev: any) => ({ ...prev, openai: { apiKey: val } }));
                                       else setIntegrations((prev: any) => ({ ...prev, customImage: { apiKey: val } }));
                                    }}
                                    placeholder={appSettings.imageProvider === 'google' ? "AIzaSy..." : "sk-..."}
                                    className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#4A5D75] font-mono transition-all"
                                 />
                              </div>
                           )}

                           {/* Custom Endpoint Field */}
                           {appSettings.imageProvider === 'custom' && (
                              <div className="flex flex-col gap-2">
                                 <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Custom Base URL</label>
                                 <input
                                    type="text"
                                    value={appSettings.imageEndpoint || ''}
                                    onChange={e => setAppSettings(prev => ({ ...prev, imageEndpoint: e.target.value }))}
                                    placeholder="https://your-custom-endpoint.com/v1"
                                    className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#4A5D75] font-mono transition-all"
                                 />
                              </div>
                           )}

                           {/* Fetch Models & Model Selection */}
                           <div className="flex flex-col gap-2 border-t border-neutral-200 dark:border-neutral-800 pt-4">
                               <div className="flex items-center justify-between">
                                  <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Target Model ID</label>
                                  <button onClick={fetchImageModels} disabled={isFetchingImageModels || !activeImageKey} className="text-[10px] font-black uppercase tracking-widest text-[#4A5D75] hover:text-[#2C3E50] dark:text-[#9EADC8] dark:hover:text-white disabled:opacity-50 transition-all flex items-center gap-1">
                                      {isFetchingImageModels ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />} Fetch Models
                                  </button>
                               </div>
                               
                               {imageEngineModels.length > 0 ? (
                                   <select value={appSettings.imageModelId || ''} onChange={e => setAppSettings(prev => ({ ...prev, imageModelId: e.target.value }))} className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#4A5D75] font-bold transition-all">
                                       <option value="" disabled>Select a model...</option>
                                       {imageEngineModels.map(m => <option key={m} value={m}>{m}</option>)}
                                   </select>
                               ) : (
                                   <input
                                      type="text"
                                      value={appSettings.imageModelId || ''}
                                      onChange={e => setAppSettings(prev => ({ ...prev, imageModelId: e.target.value }))}
                                      placeholder={appSettings.imageProvider === 'google' ? "e.g. imagen-3.0-generate-001" : "e.g. dall-e-3"}
                                      className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#4A5D75] font-mono transition-all"
                                   />
                               )}
                           </div>

                           {/* TEST INTEGRATION BLOCK */}
                           <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800 flex flex-col gap-3">
                              <button 
                                 onClick={testImageEngine}
                                 disabled={imageTestState.loading || !activeImageKey || !appSettings.imageModelId}
                                 className="flex items-center justify-center gap-2 w-full py-3 bg-[#F0F4F8] hover:bg-[#D6E0EA] text-[#4A5D75] dark:bg-[#1E2B38]/30 dark:hover:bg-[#1E2B38]/50 dark:text-[#9EADC8] rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
                              >
                                 {imageTestState.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                                 {imageTestState.loading ? 'Testing...' : 'Test Connection (Cat in Banana Costume)'}
                              </button>

                              {imageTestState.loading && (
                                  <div className="p-3 bg-[#4A5D75]/10 text-[#4A5D75] dark:text-[#9EADC8] rounded-xl border border-[#4A5D75]/20 text-xs font-bold leading-relaxed flex items-center gap-2 animate-pulse">
                                      <Loader2 className="w-4 h-4 animate-spin" /> Generating test image, please wait...
                                  </div>
                              )}

                              {imageTestState.error && (
                                  <div className="p-3 bg-[#C98A8A]/10 text-[#C98A8A] rounded-xl border border-[#C98A8A]/20 text-xs font-bold leading-relaxed">
                                      {imageTestState.error}
                                  </div>
                              )}
                              {imageTestState.successUrl && (
                                  <div className="p-2 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-sm text-center animate-in fade-in zoom-in-95">
                                      <img src={imageTestState.successUrl} alt="Test Success" className="w-full max-w-[200px] h-auto rounded-lg mx-auto mb-2 cursor-pointer" onClick={() => viewImageInCanvas(imageTestState.successUrl as string)} title="View full size in Canvas" />
                                      <span className="text-[10px] font-black uppercase tracking-widest text-[#9FBBAF] flex items-center justify-center gap-1 mt-2"><ShieldCheck className="w-3 h-3" /> Connection Successful</span>
                                  </div>
                              )}
                           </div>
                        </div>
                     )}
                     
                     {/* Output Preference */}
                     {appSettings.imageProvider !== 'none' && (
                         <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
                            <span className="text-[10px] font-black uppercase opacity-50 mb-3 block tracking-widest">Image Delivery Method</span>
                            <div className="flex bg-neutral-100 dark:bg-neutral-800 p-1.5 rounded-xl">
                               <button onClick={() => setAppSettings(prev => ({ ...prev, defaultImageOutput: 'canvas' } as any))} className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${(appSettings as any).defaultImageOutput === 'canvas' ? 'bg-white dark:bg-neutral-700 shadow-sm text-[#4A5D75] dark:text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}>Canvas Artifact</button>
                               <button onClick={() => setAppSettings(prev => ({ ...prev, defaultImageOutput: 'document' } as any))} className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${(appSettings as any).defaultImageOutput === 'document' ? 'bg-white dark:bg-neutral-700 shadow-sm text-[#4A5D75] dark:text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}>In-Chat Message</button>
                            </div>
                         </div>
                     )}
                  </div>

                  {/* Tavily Web Search Integration */}
                  <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-4">
                     <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                         <div className="flex items-center gap-3">
                             <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-100 dark:border-neutral-700"><Globe className="w-5 h-5 text-[#6A829E]" /></div>
                             <div className="flex flex-col">
                                <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200 block">Tavily Web Search</span>
                                <span className="text-xs text-neutral-500 font-medium mt-0.5">1,000 free AI searches/month. <a href="https://tavily.com" target="_blank" rel="noreferrer" className="text-[#6A829E] hover:underline font-bold inline-flex items-center gap-1">Get API Key <Link className="w-2.5 h-2.5"/></a></span>
                             </div>
                         </div>
                         <button onClick={() => setIntegrations((prev: any) => ({ ...prev, tavily: { ...prev.tavily, enabled: !prev.tavily?.enabled } }))} className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm ${integrations.tavily?.enabled ? 'bg-[#DCE7E1] text-[#7A9E8D] dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-[#4A5D75] text-white hover:bg-[#3D4D61]'}`}>{integrations.tavily?.enabled ? 'Enabled' : 'Enable'}</button>
                     </div>
                     {integrations.tavily?.enabled && (
                        <div className="animate-in slide-in-from-top-2 pt-4 border-t border-neutral-100 dark:border-neutral-800">
                           <input type="password" value={integrations.tavily?.apiKey || ''} onChange={e => setIntegrations((prev: any) => ({ ...prev, tavily: { ...prev.tavily, apiKey: e.target.value } }))} placeholder="Paste your tvly-... API key here" className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all" />
                        </div>
                     )}
                  </div>

                  {/* Calendar Connect */}
                  <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-100 dark:border-neutral-700"><CalendarDays className="w-5 h-5 text-[#D4AA7D]" /></div>
                      <div className="flex flex-col">
                        <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200">Google Calendar</span>
                        <span className="text-xs text-neutral-500 font-medium mt-0.5">Requires localhost OAuth loopback via Tauri.</span>
                      </div>
                    </div>
                    <button disabled className="px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest bg-neutral-200 dark:bg-neutral-800 text-neutral-400 cursor-not-allowed shadow-sm">Coming Soon</button>
                  </div>

                </div>
              )}
            </div>
            <button onClick={() => { setShowProfileSettings(false); setImageTestState({ loading: false, error: null, successUrl: null }); }} className="w-full py-5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-black text-xs uppercase tracking-[0.2em] rounded-2xl shadow-xl mt-6 shrink-0 active:scale-[0.98] transition-all">Done</button>
          </div>
        </div>
      )}

      {/* Save Artifact Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-white dark:bg-neutral-900 w-full max-w-sm rounded-[2rem] shadow-2xl p-6 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-white">
            <h3 className="text-lg font-black mb-4 tracking-tight">Save to Archives</h3>
            <div className="space-y-4">
               <div>
                  <label className="text-[10px] font-black uppercase opacity-40 block mb-1">Project Name</label>
                  <input type="text" value={saveAppData.title} onChange={e => setSaveAppData(prev => ({...prev, title: e.target.value}))} className="w-full bg-neutral-100 dark:bg-neutral-800 border-none rounded-xl px-4 py-3 text-sm dark:text-neutral-100 outline-none font-bold" />
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200 text-neutral-900 dark:text-white">
          <div className="bg-white dark:bg-neutral-900 w-full max-w-lg rounded-[2rem] p-8 shadow-2xl border border-neutral-200 dark:border-neutral-800 max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <div className="flex items-center gap-3"><div className="p-2 bg-[#4A5D75] rounded-xl"><Zap className="w-6 h-6 text-white" /></div><h3 className="text-xl font-black tracking-tighter uppercase">Connect LLM</h3></div>
              <button onClick={() => { setShowModelWizard(false); setWizardStep(3); }} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"><X className="w-5 h-5" /></button>
            </div>

            {/* Hidden Local Wizard Steps Commented Out For Future Use */}
            {wizardStep === 3 && (
              <div className="flex flex-col flex-1 animate-in slide-in-from-right-2 duration-300 space-y-4">
                <h4 className="text-sm font-black mb-2 uppercase tracking-widest text-neutral-400 shrink-0">Manual Configuration</h4>
                
                <select value={editingModel.provider} onChange={handleProviderChange} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-bold shrink-0">
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="google">Google (Gemini)</option>
                  <option value="huggingface">Hugging Face</option>
                </select>

                <div className="shrink-0">
                  <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Endpoint URL</label>
                  <input type="text" placeholder="e.g. https://api.openai.com/v1" value={editingModel.endpoint} onChange={e => setEditingModel(prev => ({ ...prev, endpoint: e.target.value }))} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono placeholder:font-sans" />
                </div>
                
                <div className="relative shrink-0">
                  <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">API Key (Optional for Local)</label>
                  <input type="password" placeholder="sk-…" value={editingModel.apiKey} onChange={e => setEditingModel(prev => ({ ...prev, apiKey: e.target.value }))} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono pr-28" />
                  <button onClick={handleFetchModels} disabled={isFetchingModels} className="absolute right-2 bottom-1.5 px-3 py-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-lg text-[9px] font-black uppercase text-[#4A5D75] dark:text-[#899AB5] hover:bg-[#D6E0EA] dark:hover:bg-[#1E2B38]/20 transition-all disabled:opacity-50">{isFetchingModels ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Fetch Models'}</button>
                </div>
                {fetchModelsError && <p className="text-[10px] text-[#C98A8A] mt-1 shrink-0">{fetchModelsError}</p>}

                {fetchedModels.length > 0 ? (
                  <div className="flex flex-col flex-1 min-h-[30vh] space-y-3 animate-in slide-in-from-top-2">
                    <label className="text-[10px] font-black uppercase text-neutral-400 px-2 tracking-widest shrink-0">Tap to select models to import:</label>
                    <div className="px-2 shrink-0">
                      <input type="text" placeholder="Search models..." value={modelSearchQuery} onChange={e => setModelSearchQuery(e.target.value)} className="w-full bg-neutral-100 dark:bg-neutral-800 border-none rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[#6A829E]/50 font-bold" />
                    </div>
                    <div className="flex-1 overflow-y-auto border-2 dark:border-neutral-800 p-2 rounded-2xl bg-neutral-50 dark:bg-neutral-950 space-y-2 custom-scrollbar min-h-[200px] max-h-[40vh]">
                      {fetchedModels.filter(m => m.id.toLowerCase().includes(modelSearchQuery.toLowerCase())).map(m => {
                        const isSelected = pendingModelSelections.some(p => p.id === m.id);
                        return (
                          <button key={m.id} onClick={() => toggleModelSelection(m)} className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all ${isSelected ? 'border-[#4A5D75] bg-[#F0F4F8] dark:bg-[#1E2B38]/20 shadow-sm' : 'border-transparent hover:bg-white dark:hover:bg-neutral-800'}`}>
                            <div className="flex flex-col text-left overflow-hidden">
                              <div className="flex items-center gap-1.5">
                                 {m.id.includes('dall-e') || m.id.includes('image') ? <span title="Image Generation Model"><ImageIcon className="w-3 h-3 text-[#D4AA7D]" /></span> : null}
                                 <span className="text-xs font-bold truncate text-neutral-800 dark:text-neutral-100">{m.id}</span>
                              </div>
                              <span className="text-[9px] font-black text-[#6A829E] uppercase tracking-tight">Limit: {m.context.toLocaleString()} tokens</span>
                            </div>
                            {isSelected ? <CheckCircle2 className="w-5 h-5 text-[#4A5D75] shrink-0" /> : <PlusCircle className="w-5 h-5 text-neutral-300 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                    <button onClick={handleBulkAdd} disabled={pendingModelSelections.length === 0} className="shrink-0 w-full py-5 bg-[#4A5D75] text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-[#3D4D61] active:scale-95 transition-all disabled:opacity-50">Add {pendingModelSelections.length} Model(s)</button>
                  </div>
                ) : (
                  <div className="pt-2 space-y-4 shrink-0">
                    <div className="flex gap-3">
                      <div className="flex-1"><label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Model ID</label><input type="text" placeholder="e.g. llama-3, dall-e-3" value={editingModel.modelId} onChange={e => setEditingModel(prev => ({ ...prev, modelId: e.target.value }))} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono" /></div>
                      <div className="w-1/3"><label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Context Limit</label><input type="number" placeholder="32000" value={editingModel.contextLimit} onChange={e => setEditingModel(prev => ({ ...prev, contextLimit: parseInt(e.target.value) || 0 }))} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono" /></div>
                    </div>
                    <div><label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Display Name</label><input type="text" placeholder="Custom Model" value={editingModel.name} onChange={e => setEditingModel(prev => ({ ...prev, name: e.target.value }))} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none font-bold focus:border-[#6A829E]" /></div>
                    <button onClick={() => executeAddLLM({ ...editingModel, name: editingModel.name || editingModel.modelId })} disabled={!editingModel.modelId} className="w-full py-4 bg-[#4A5D75] text-white rounded-xl font-black text-xs uppercase hover:bg-[#3D4D61] disabled:opacity-50 transition-all active:scale-95 shadow-md">Connect Single LLM</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
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