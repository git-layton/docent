import React, { useState, useRef, useEffect } from 'react';
import {
  FileText, ChevronDown, Globe, Zap, Send, Square, Wand2, Paperclip, X,
  AlertTriangle, Loader2, Brain, ListTodo, ShieldCheck, Trash2, Plus, Mic,
  Telescope, Code2, ScrollText, Smile, Eye
} from 'lucide-react';
import { supportsVision, modelSupportsVision, modelSupportsAudio, hasVisionProvider } from '../services/llm';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { SlashCommandPalette, SLASH_COMMANDS } from './SlashCommandPalette';
import type { SlashCommand } from './SlashCommandPalette';
import { invoke } from '@tauri-apps/api/core';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { AVAILABLE_TOOLS } from './ui/AgentIcon';
import { RoutineProposalBar } from './RoutineProposalBar';

// Tool capability ids (web_search/local_workspace) → the canonical forcedTool route
// value the router + gatekeeper understand ('search'/'workspace'). Without this map a
// pinned toggle sets forcedTool to the raw capability id, which the gatekeeper treats as
// "forced but unknown" and routes to *no* tool — so the toggle would highlight yet do nothing.
const TOOL_FORCE_VALUE: Record<string, string> = { web_search: 'search', local_workspace: 'workspace' };

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
  // llama server
  llamaServerPid: number | null;
  llamaPaused: boolean;
  setLlamaPaused: (v: boolean) => void;
  llamaCoolingDown: boolean;
  // listen
  isListening: boolean;
  onToggleListening: () => void;
  // slash command handler
  onSlashCommand: (cmd: SlashCommand) => void;
  // channel @mentions
  channelParticipants?: Array<{ id: string; name: string }>;
  // OPTIONAL composer-state override — lets a SECOND ChatInputBar (e.g. the Code Team rail) run its
  // own input/attachment buffer instead of the global useUIStore one, so two composers can live on
  // one screen without sharing (and corrupting) each other's text. When omitted, the bar reads/writes
  // the global UI store exactly as before. See docs/agentforge-code-design.md pt 9.
  inputValue?: string;
  onInputChange?: (v: string) => void;
  attachedDocsOverride?: any[];
  onAttachedDocsChange?: (fn: (prev: any[]) => any[]) => void;
}

export function ChatInputBar({
  isGenerating,
  isEnhancing,
  selectedModel,
  modelDropdownRef,
  onSend,
  onStop,
  onChatFileUpload,
  onEnhancePrompt,
  fileInputRef,
  activeAssistant,
  llamaServerPid,
  llamaPaused,
  setLlamaPaused,
  llamaCoolingDown,
  isListening,
  onToggleListening,
  onSlashCommand,
  channelParticipants = [],
  inputValue,
  onInputChange,
  attachedDocsOverride,
  onAttachedDocsChange,
}: ChatInputBarProps) {
  const storeInput = useUIStore(s => s.input);
  const forcedTool = useUIStore(s => s.forcedTool);
  const isPlanMode = useUIStore(s => s.isPlanMode);
  const storeAttachedDocs = useUIStore(s => s.attachedDocs);
  const uploadError = useUIStore(s => s.uploadError);
  const isModelDropdownOpen = useUIStore(s => s.isModelDropdownOpen);
  const slashHighlight = useUIStore(s => s.slashHighlight);
  const generationMode = useUIStore(s => s.generationMode);
  const pinnedTools = useUIStore(s => s.pinnedTools);
  const { setInput: setStoreInput, setForcedTool, setIsPlanMode,
    setAttachedDocs: setStoreAttachedDocs, setIsModelDropdownOpen, setSlashHighlight, setGenerationMode, setPinnedTools } = useUIStore.getState();

  // Composer state — use the caller's own buffer when provided (the Code Team rail), else the
  // global UI store. This is the single decoupling that lets the center (Codey) and rail (Team)
  // composers coexist without sharing one input/attachment buffer.
  const isOverridden = inputValue !== undefined && !!onInputChange;
  const input = isOverridden ? (inputValue as string) : storeInput;
  const setInput = (next: string | ((prev: string) => string)) => {
    const value = typeof next === 'function' ? (next as (p: string) => string)(input) : next;
    if (isOverridden) onInputChange!(value); else setStoreInput(value);
  };
  const attachedDocs = attachedDocsOverride !== undefined ? attachedDocsOverride : storeAttachedDocs;
  const setAttachedDocs = (fn: (prev: any[]) => any[]) => {
    if (onAttachedDocsChange) onAttachedDocsChange(fn); else setStoreAttachedDocs(fn);
  };

  const [showToolPopover, setShowToolPopover] = useState(false);
  const toolPopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showToolPopover) return;
    const handler = (e: MouseEvent) => {
      if (toolPopoverRef.current && !toolPopoverRef.current.contains(e.target as Node)) setShowToolPopover(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showToolPopover]);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) setShowEmojiPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojiPicker]);

  const [mentionHighlight, setMentionHighlight] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const mentionMatch = channelParticipants.length > 0 ? input.match(/@(\w*)$/) : null;
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const filteredMentions = mentionQuery !== null
    ? channelParticipants.filter(p => p.name.toLowerCase().replace(/\s+/g, '').startsWith(mentionQuery) || p.name.toLowerCase().split(/\s+/)[0].startsWith(mentionQuery))
    : [];
  const showMentionPalette = filteredMentions.length > 0;

  const completeMention = (name: string) => {
    const newInput = input.replace(/@(\w*)$/, `@${name} `);
    setInput(newInput);
    setMentionHighlight(0);
  };

  // Cmd/Ctrl+Shift+@ — summon the agent picker on the current surface (spec §5). Inserts a trailing
  // '@' so the existing mention palette opens, scoped to this chat's participants, then focuses the
  // composer. (Shift+2 on US layouts yields e.key === '@'.)
  // Only the global (non-overridden) composer owns this global shortcut — an overridden rail composer
  // (the Code Team rail) skips it so it never hijacks the shortcut from the center conversation.
  useEffect(() => {
    if (isOverridden) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '@') {
        e.preventDefault();
        const cur = useUIStore.getState().input;
        const next = !cur || cur.endsWith(' ') || cur.endsWith('@') ? `${cur}@` : `${cur} @`;
        useUIStore.getState().setInput(next);
        composerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOverridden]);

  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);
  const modelValidation = useSettingsStore(s => s.modelValidation);
  const appSettings = useSettingsStore(s => s.appSettings);
  const integrations = useSettingsStore(s => s.integrations);
  const { setSelectedModelId, setModels, setShowModelWizard, setWizardStep } = useSettingsStore.getState();

  // Docs/PDFs work everywhere. Images need either a vision-capable model OR a configured Image
  // Understanding provider (which reads the image into text for any model). When neither is available,
  // the picker is restricted to text/doc types and the tooltip says so.
  // Derive the active model from the store (matching App.tsx's handleChatFileUpload backstop) so the
  // composer gate never disagrees with the handler over a stale `selectedModel` prop.
  const liveSelectedModel = models.find(m => m.id === selectedModelId) ?? selectedModel ?? null;
  const modelSees = modelSupportsVision(liveSelectedModel);
  const modelHears = modelSupportsAudio(liveSelectedModel);
  const canAttachImages = modelSees || hasVisionProvider(appSettings, integrations, models);
  const DOC_ACCEPT = 'text/*,application/pdf,.md,.markdown,.csv,.tsv,.json,.xml,.yml,.yaml,.log,.rtf';
  // Accept filter widens with the model's senses: docs always, images when it sees, audio when it hears.
  const attachAccept = [DOC_ACCEPT, canAttachImages ? 'image/*' : '', modelHears ? 'audio/*' : '']
    .filter(Boolean).join(',');

  // The input bar IS frosted, deliberately — it's the one exception to the chat's clear glass. The
  // conversation above reads through to the wallpaper undistorted; the bar is a control surface, and
  // frosting is what lifts its small icons off a busy sky enough to be legible. Clear glass here was
  // tried and the icons vanished into the wallpaper.
  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white/10 dark:bg-black/5 backdrop-blur-xl border-t border-edge/50 shadow-[0_-8px_32px_rgba(0,0,0,0.1)] pt-4 pb-3 px-3 lg:px-4 z-10">
      <div className="max-w-3xl mx-auto">

        {/* Error Display */}
        {uploadError && (
            <div className="mb-2 flex items-center gap-2 text-danger text-tiny font-black uppercase tracking-widest bg-danger-soft p-2 rounded-xl border border-danger/20 animate-in slide-in-from-bottom-2">
                <AlertTriangle size={14} /> {uploadError}
            </div>
        )}

        {/* Routine proposal — Docent noticed a recurring/watch request in the last message. */}
        <RoutineProposalBar />

        {attachedDocs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 px-2">
            {attachedDocs.map((doc, idx) => (
              <div key={idx} className="relative group flex items-center gap-2 px-3 py-1.5 bg-panel-2 border border-edge rounded-xl text-tiny font-black text-ink shadow-sm animate-in slide-in-from-bottom-2">
                {doc.isImage ? <img src={doc.content} alt={doc.name} className="w-6 h-6 object-cover rounded-md" /> : <FileText className="w-4 h-4 text-accent" />}
                <span className="max-w-[100px] truncate">{doc.name}</span>
                <button onClick={() => setAttachedDocs(prev => prev.filter((_, i) => i !== idx))} className="opacity-50 hover:opacity-100 hover:text-danger"><X className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        )}

        {llamaServerPid !== null && llamaPaused && (
          <div className="px-4 py-2 mb-2 bg-warning-soft border border-warning/30 rounded-xl text-warning text-xs flex items-center justify-between">
            <span>🛑 LLaMA hibernating — waiting for RAM to recover</span>
            <button onClick={() => { invoke('sigcont_llama_server').catch(() => {}); setLlamaPaused(false); }} className="text-xs underline ml-3 shrink-0">Resume manually</button>
          </div>
        )}
        {llamaServerPid !== null && llamaCoolingDown && !llamaPaused && (
          <div className="px-4 py-2 mb-2 bg-warning-soft border border-warning/30 rounded-xl text-warning text-xs">
            ⚠️ RAM pressure — LLaMA will pause after this response
          </div>
        )}
        {selectedModel && modelValidation[selectedModel.id] === 'fail' && (
          <div className="px-4 py-2 mb-2 bg-danger-soft border border-danger/30 rounded-xl text-danger text-xs flex items-center gap-2">
            <span title="Model unreachable"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /></span>
            <span>
              {selectedModel.isLocal
                ? `${selectedModel.name} is offline — open LM Studio and make sure a model is loaded`
                : `${selectedModel.name} is unreachable — check your API key and connection`}
            </span>
          </div>
        )}
        <div className="relative">
          {/* Slash command palette — outside overflow-hidden so it's not clipped */}
          {input.startsWith('/') && !input.includes(' ') && (
            <SlashCommandPalette
              query={input.slice(1)}
              highlightIndex={slashHighlight}
              onSelect={cmd => onSlashCommand(cmd)}
              onHighlight={setSlashHighlight}
              enabledTools={activeAssistant?.tools ?? {}}
            />
          )}
          {/* @mention palette for channels */}
          {showMentionPalette && (
            <div className="absolute bottom-full left-0 mb-2 w-56 rounded-2xl bg-panel-2 border border-edge shadow-2xl z-[100] overflow-hidden animate-in slide-in-from-bottom-2 duration-150">
              <div className="px-3 pt-2 pb-1 text-micro font-black uppercase tracking-widest text-ink-3">Mention</div>
              <div className="p-1 space-y-0.5">
                {filteredMentions.map((p, i) => (
                  <button key={p.id} onMouseDown={e => { e.preventDefault(); completeMention(p.name); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all ${i === mentionHighlight ? 'bg-accent text-on-accent' : 'hover:bg-wash text-ink'}`}>
                    <span className="text-xs font-bold">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        {/* Textarea — with no model connected the whole bar becomes a "connect a model" prompt */}
        <div
          className={`bg-panel border shadow-sm rounded-3xl transition-all overflow-hidden ${models.length === 0 ? 'border-accent/60 cursor-pointer hover:border-accent hover:bg-accent-soft/20' : 'border-edge-2 focus-within:border-accent'}`}
          onClick={models.length === 0 ? () => { setWizardStep(3); setShowModelWizard(true); } : undefined}
        >
          <textarea
            ref={composerRef}
            value={input}
            onChange={e => { setInput(e.target.value); setSlashHighlight(0); }}
            onKeyDown={e => {
              if (showMentionPalette) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setMentionHighlight(h => (h + 1) % filteredMentions.length); return; }
                if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionHighlight(h => (h - 1 + filteredMentions.length) % filteredMentions.length); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); completeMention(filteredMentions[mentionHighlight % filteredMentions.length].name); return; }
                if (e.key === 'Escape')    { setInput(input.replace(/@(\w*)$/, '')); return; }
              }
              const showPalette = input.startsWith('/') && !input.includes(' ');
              const toolGate: Record<string, string> = { search: 'web_search', workspace: 'local_workspace' };
              const available = SLASH_COMMANDS.filter(c => { const g = toolGate[c.cmd]; return !g || activeAssistant?.tools?.[g]; });
              const filtered = showPalette ? available.filter(c => c.cmd.startsWith(input.slice(1).toLowerCase()) || c.label.toLowerCase().startsWith(input.slice(1).toLowerCase())) : [];
              if (showPalette && filtered.length > 0) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSlashHighlight(h => (h + 1) % filtered.length); return; }
                if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashHighlight(h => (h - 1 + filtered.length) % filtered.length); return; }
                if (e.key === 'Enter')     { e.preventDefault(); onSlashCommand(filtered[slashHighlight % filtered.length]); return; }
                if (e.key === 'Escape')    { setInput(''); return; }
              }
              // Enter sends only when idle. While a response streams the composer stays editable (so you
              // can write the next message), but Enter is swallowed rather than starting/aborting a run.
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isGenerating) onSend(); }
            }}
            placeholder={models.length === 0 ? 'Connect a model to start chatting →' : `Message ${activeAssistant?.name ?? 'Assistant'}... or type / for commands`}
            className="w-full bg-transparent p-3 min-h-[52px] max-h-40 resize-none outline-none text-ink placeholder-ink-3 text-sm font-medium custom-scrollbar" rows={1} disabled={(llamaServerPid !== null && llamaPaused) || models.length === 0} />
        </div>

        {/* Mode bar + model selector + actions — single row */}
        <div className="flex items-center gap-0.5 px-0.5 pt-1" ref={modelDropdownRef}>
          {/* Reasoning modes */}
          <button onClick={() => setIsPlanMode(v => !v)} className={`p-1.5 rounded-full transition-all ${isPlanMode ? 'bg-success-soft text-success' : 'text-ink-2 hover:text-success hover:bg-wash'}`} title="Plan — structured step-by-step response"><ListTodo className="w-3.5 h-3.5" /></button>
          {/* Output modes */}
          <button onClick={() => setGenerationMode(generationMode === 'code' ? 'text' : 'code')} className={`p-1.5 rounded-full transition-all ${generationMode === 'code' ? 'bg-accent text-on-accent' : 'text-ink-2 hover:text-accent hover:bg-wash'}`} title="Canvas — generate a code app"><Code2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => setGenerationMode(generationMode === 'doc' ? 'text' : 'doc')} className={`p-1.5 rounded-full transition-all ${generationMode === 'doc' ? 'bg-success-soft text-success' : 'text-ink-2 hover:text-success hover:bg-wash'}`} title="Doc — generate a rich document"><ScrollText className="w-3.5 h-3.5" /></button>
          {/* Pinned tools — dynamic, only shows if enabled on current agent */}
          {AVAILABLE_TOOLS.filter(t => pinnedTools.includes(t.id) && activeAssistant?.tools?.[t.id]).map(tool => {
            const Icon = tool.icon;
            const force = TOOL_FORCE_VALUE[tool.id] ?? tool.id;
            const isActive = forcedTool === force;
            return (
              <button key={tool.id} onClick={() => setForcedTool(f => f === force ? null : force)} className={`p-1.5 rounded-full transition-all ${isActive ? 'bg-accent-soft text-accent-soft-ink' : 'text-ink-2 hover:text-accent hover:bg-wash'}`} title={tool.name}>
                <Icon className="w-3.5 h-3.5" />
              </button>
            );
          })}
          {/* + Tools popover */}
          <div className="relative" ref={toolPopoverRef}>
            <button onClick={() => setShowToolPopover(v => !v)} className={`p-1.5 rounded-full transition-all ${showToolPopover ? 'bg-wash text-ink-2' : 'text-ink-2 hover:text-ink hover:bg-wash'}`} title="Add tools"><Plus className="w-3 h-3" /></button>
            {showToolPopover && (
              <div className="absolute bottom-full left-0 mb-2 w-52 bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-edge/50 rounded-2xl shadow-2xl z-[100] p-1.5 animate-in slide-in-from-bottom-2 duration-150">
                <div className="px-2 py-1 text-[9px] font-medium text-ink-3 uppercase tracking-wider">Pin tools to toolbar</div>
                <div className="space-y-0.5">
                  {AVAILABLE_TOOLS.map(tool => {
                    const Icon = tool.icon;
                    const enabled = !!activeAssistant?.tools?.[tool.id];
                    const pinned = pinnedTools.includes(tool.id);
                    return (
                      <button key={tool.id} onClick={() => { if (!enabled) return; setPinnedTools(p => pinned ? p.filter(id => id !== tool.id) : [...p, tool.id]); }} className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left transition-all ${enabled ? 'hover:bg-wash' : 'opacity-40 cursor-default'}`}>
                        <Icon className="w-3.5 h-3.5 shrink-0 text-ink-3" />
                        <span className="text-xs font-medium text-ink-2 flex-1">{tool.name}</span>
                        {pinned && enabled && <div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                        {!enabled && <span className="text-[9px] text-ink-3">off</span>}
                      </button>
                    );
                  })}
                  <div className="border-t border-edge my-1" />
                  <button disabled className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl opacity-40 cursor-default">
                    <Telescope className="w-3.5 h-3.5 shrink-0 text-ink-3" />
                    <span className="text-xs font-medium text-ink-3 flex-1">Deep Research</span>
                    <span className="text-[9px] text-ink-3">soon</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 ml-auto">
            {/* Model selector — moved here from its own row */}
            <div className="relative">
              <button onClick={() => setIsModelDropdownOpen(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-soft/30 hover:bg-accent-soft/60 border border-accent/10 transition-all shadow-sm">
                <Zap className="w-3 h-3 text-accent" />
                {selectedModel && modelValidation[selectedModel.id] === 'fail' && <span title="Model unreachable"><AlertTriangle className="w-3 h-3 text-danger" /></span>}
                {selectedModel && modelValidation[selectedModel.id] === 'ok'   && <span title="Model verified"><ShieldCheck   className="w-3 h-3 text-success" /></span>}
                <span className="text-[11px] font-bold text-accent-strong max-w-[120px] truncate">{selectedModel?.name ?? 'Model'}</span>
                <ChevronDown className="w-3 h-3 text-accent/50 shrink-0" />
              </button>
              {isModelDropdownOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-64 bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-edge/50 rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in slide-in-from-bottom-2 duration-150">
                  <div className="p-1.5 space-y-1">
                    {(() => {
                      const localModels = models.filter(m => m.isLocal);
                      const cloudModels = models.filter(m => !m.isLocal);
                      const renderModel = (m: any) => (
                        <button key={m.id} onClick={() => { setSelectedModelId(m.id); setIsModelDropdownOpen(false); }} className={`group w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all ${selectedModelId === m.id ? 'bg-accent text-on-accent' : 'text-ink hover:bg-wash'}`}>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-medium flex items-center gap-1 truncate">
                              {m.name}
                              {supportsVision(m.modelId) && <span title="Reads images (vision)"><Eye className={`w-2.5 h-2.5 shrink-0 ${selectedModelId === m.id ? 'text-on-accent' : 'text-accent'}`} /></span>}
                            </span>
                            <span className={`text-[9px] font-medium opacity-50 ${selectedModelId === m.id ? 'text-on-accent' : 'text-ink-3'}`}>{m.provider}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {modelValidation[m.id] === 'fail'    && <AlertTriangle className="w-3 h-3 text-danger" />}
                            {modelValidation[m.id] === 'ok'      && <ShieldCheck   className="w-3 h-3 text-success" />}
                            {modelValidation[m.id] === 'pending' && <Loader2       className="w-3 h-3 animate-spin text-ink-3" />}
                            <div onClick={e => { e.stopPropagation(); setModels(prev => prev.filter(x => x.id !== m.id)); if (selectedModelId === m.id) setSelectedModelId(models[0]?.id ?? ''); }} className="p-1.5 text-ink-2 hover:text-danger hover:bg-danger-soft rounded-lg transition-colors" title="Remove Model"><Trash2 className="w-3.5 h-3.5" /></div>
                          </div>
                        </button>
                      );
                      return (
                        <>
                          {localModels.length > 0 && (
                            <>
                              <div className="px-3 pt-1 pb-0.5 text-[9px] font-medium text-ink-3 flex items-center gap-1.5"><Brain className="w-2.5 h-2.5" /> Local</div>
                              {localModels.map(renderModel)}
                            </>
                          )}
                          {cloudModels.length > 0 && (
                            <>
                              {localModels.length > 0 && <div className="border-t border-edge my-1" />}
                              <div className="px-3 pt-1 pb-0.5 text-[9px] font-medium text-ink-3 flex items-center gap-1.5"><Globe className="w-2.5 h-2.5" /> Cloud</div>
                              {cloudModels.map(renderModel)}
                            </>
                          )}
                        </>
                      );
                    })()}
                    <button onClick={() => { setWizardStep(3); setShowModelWizard(true); setIsModelDropdownOpen(false); }} className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-accent hover:bg-wash transition-all border-t border-edge mt-1"><Plus className="w-3 h-3" /><span className="text-xs font-medium">Connect model</span></button>
                  </div>
                </div>
              )}
            </div>
            <div className="w-px h-4 bg-edge mx-0.5" />
            {models.length > 0 && <button onClick={onToggleListening} className={`p-2 rounded-full transition-all ${isListening ? 'text-danger bg-danger-soft' : 'text-ink-2 hover:text-ink hover:bg-wash'}`} title="Dictate"><Mic className={`w-3.5 h-3.5 ${isListening ? 'animate-bounce' : ''}`} /></button>}
            {!isGenerating && models.length > 0 && <button onClick={() => fileInputRef.current?.click()} className="p-2 text-ink-2 hover:text-ink hover:bg-wash rounded-full transition-all" title={`Attach document${canAttachImages ? ' or image' : ''}${modelHears ? ' or audio' : ''}${!modelSees && canAttachImages ? ' — images read by your Image Understanding model' : ''}`}><Paperclip className="w-3.5 h-3.5" /></button>}
            <input type="file" ref={fileInputRef} onChange={onChatFileUpload} accept={attachAccept} className="hidden" />
            {/* Emoji picker */}
            {models.length > 0 && (
              <div className="relative" ref={emojiPickerRef}>
                <button
                  onClick={() => setShowEmojiPicker(v => !v)}
                  className={`p-2 rounded-full transition-all ${showEmojiPicker ? 'text-accent-soft-ink bg-accent-soft' : 'text-ink-2 hover:text-ink hover:bg-wash'}`}
                  title="Emoji"
                >
                  <Smile className="w-3.5 h-3.5" />
                </button>
                {showEmojiPicker && (
                  <div className="absolute bottom-full right-0 mb-2 z-[200] animate-in slide-in-from-bottom-2 duration-150 drop-shadow-2xl">
                    <Picker
                      data={data}
                      set="native"
                      theme="auto"
                      previewPosition="none"
                      skinTonePosition="none"
                      onEmojiSelect={(emoji: any) => {
                        setInput(input + emoji.native);
                        setShowEmojiPicker(false);
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            {!isGenerating && models.length > 0 && <button onClick={onEnhancePrompt} disabled={isEnhancing || !input.trim()} className={`p-2 rounded-full transition-all ${input.trim() ? 'text-accent hover:bg-accent-soft' : 'text-ink-3 opacity-50 cursor-default'} ${isEnhancing ? 'animate-spin' : ''}`} title="Enhance Prompt"><Wand2 className="w-3.5 h-3.5" /></button>}
            <button
              onClick={isGenerating ? onStop : onSend}
              disabled={(llamaServerPid !== null && llamaPaused) || (!isGenerating && ((!input.trim() && attachedDocs.length === 0) || models.length === 0)) || (!isGenerating && !!selectedModel && modelValidation[selectedModel.id] === 'fail')}
              className={`p-2 rounded-full transition-all ${isGenerating ? 'bg-danger text-on-accent shadow-sm animate-pulse' : 'bg-accent text-on-accent shadow-sm hover:bg-accent-strong active:scale-90 disabled:opacity-50'}`}>
              {isGenerating ? <Square className="w-3.5 h-3.5 fill-current" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        </div>{/* end relative wrapper for slash palette */}
      </div>
    </div>
  );
}
