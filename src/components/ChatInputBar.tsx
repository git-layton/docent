import React, { useState } from 'react';
import {
  FileText, ChevronDown, Globe, Zap, Send, Square, Wand2, Paperclip, X,
  AlertTriangle, Loader2, Brain, ListTodo, Database, ShieldCheck, Trash2, Plus, Mic,
  Telescope, Code2, ScrollText
} from 'lucide-react';
import { SlashCommandPalette, SLASH_COMMANDS } from './SlashCommandPalette';
import type { SlashCommand } from './SlashCommandPalette';
import { invoke } from '@tauri-apps/api/core';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';

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
}: ChatInputBarProps) {
  const input = useUIStore(s => s.input);
  const isDeepThinking = useUIStore(s => s.isDeepThinking);
  const forcedTool = useUIStore(s => s.forcedTool);
  const isPlanMode = useUIStore(s => s.isPlanMode);
  const attachedDocs = useUIStore(s => s.attachedDocs);
  const uploadError = useUIStore(s => s.uploadError);
  const isModelDropdownOpen = useUIStore(s => s.isModelDropdownOpen);
  const slashHighlight = useUIStore(s => s.slashHighlight);
  const generationMode = useUIStore(s => s.generationMode);
  const { setInput, setIsDeepThinking, setForcedTool, setIsPlanMode,
    setAttachedDocs, setIsModelDropdownOpen, setSlashHighlight, setGenerationMode } = useUIStore.getState();

  const [mentionHighlight, setMentionHighlight] = useState(0);
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

  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);
  const modelValidation = useSettingsStore(s => s.modelValidation);
  const { setSelectedModelId, setModels, setShowModelWizard, setWizardStep } = useSettingsStore.getState();
  return (
    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white dark:from-neutral-900 pt-6 pb-3 px-3 lg:px-4 z-10">
      <div className="max-w-3xl mx-auto">

        {/* Error Display */}
        {uploadError && (
            <div className="mb-2 flex items-center gap-2 text-error text-tiny font-black uppercase tracking-widest bg-error/10 p-2 rounded-xl border border-error/20 animate-in slide-in-from-bottom-2">
                <AlertTriangle size={14} /> {uploadError}
            </div>
        )}

        {attachedDocs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 px-2">
            {attachedDocs.map((doc, idx) => (
              <div key={idx} className="relative group flex items-center gap-2 px-3 py-1.5 bg-white border border-neutral-200 dark:bg-neutral-800 dark:border-neutral-700 rounded-xl text-tiny font-black shadow-sm animate-in slide-in-from-bottom-2">
                {doc.isImage ? <img src={doc.content} alt={doc.name} className="w-6 h-6 object-cover rounded-md" /> : <FileText className="w-4 h-4 text-secondary" />}
                <span className="max-w-[100px] truncate">{doc.name}</span>
                <button onClick={() => setAttachedDocs(prev => prev.filter((_, i) => i !== idx))} className="opacity-50 hover:opacity-100 hover:text-error"><X className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        )}

        {llamaServerPid !== null && llamaPaused && (
          <div className="px-4 py-2 mb-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between">
            <span>🛑 LLaMA hibernating — waiting for RAM to recover</span>
            <button onClick={() => { invoke('sigcont_llama_server').catch(() => {}); setLlamaPaused(false); }} className="text-xs underline ml-3 shrink-0">Resume manually</button>
          </div>
        )}
        {llamaServerPid !== null && llamaCoolingDown && !llamaPaused && (
          <div className="px-4 py-2 mb-2 bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-800 rounded-xl text-yellow-800 dark:text-yellow-300 text-xs">
            ⚠️ RAM pressure — LLaMA will pause after this response
          </div>
        )}
        {selectedModel && modelValidation[selectedModel.id] === 'fail' && (
          <div className="px-4 py-2 mb-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-xs flex items-center gap-2">
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
            <div className="absolute bottom-full left-0 mb-2 w-56 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl z-[100] overflow-hidden animate-in slide-in-from-bottom-2 duration-150">
              <div className="px-3 pt-2 pb-1 text-micro font-black uppercase tracking-widest text-neutral-400">Mention</div>
              <div className="p-1 space-y-0.5">
                {filteredMentions.map((p, i) => (
                  <button key={p.id} onMouseDown={e => { e.preventDefault(); completeMention(p.name); }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all ${i === mentionHighlight ? 'bg-primary text-white' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200'}`}>
                    <span className="text-xs font-bold">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        {/* Textarea */}
        <div className={`bg-white dark:bg-neutral-950 border-2 shadow-2xl rounded-2xl transition-all overflow-hidden ${models.length === 0 ? 'opacity-50 border-neutral-200 dark:border-neutral-800' : 'border-neutral-200 dark:border-neutral-800 focus-within:border-secondary-light'}`}>
          <textarea
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
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
            placeholder={models.length === 0 ? 'Connect an LLM to start...' : `Message ${activeAssistant?.name ?? 'Assistant'}... or type / for commands`}
            className="w-full bg-transparent p-3 min-h-[52px] max-h-40 resize-none outline-none dark:text-neutral-100 text-sm font-medium custom-scrollbar" rows={1} disabled={isGenerating || (llamaServerPid !== null && llamaPaused) || models.length === 0} />
        </div>

        {/* Mode bar + model selector + actions — single row */}
        <div className="flex items-center gap-0.5 px-0.5 pt-1" ref={modelDropdownRef}>
          {/* Thinking & reasoning modes */}
          <button onClick={() => setIsDeepThinking(v => !v)} className={`p-1.5 rounded-lg transition-all ${isDeepThinking ? 'bg-primary-dark text-secondary-light' : 'text-neutral-400 hover:text-secondary-light hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Think — extended chain-of-thought reasoning"><Brain className="w-3.5 h-3.5" /></button>
          <button onClick={() => setIsPlanMode(v => !v)} className={`p-1.5 rounded-lg transition-all ${isPlanMode ? 'bg-success text-white' : 'text-neutral-400 hover:text-success hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Plan — structured step-by-step response"><ListTodo className="w-3.5 h-3.5" /></button>
          {/* Tool overrides */}
          {activeAssistant?.tools?.local_workspace && (
            <button onClick={() => setForcedTool(t => t === 'workspace' ? null : 'workspace')} className={`p-1.5 rounded-lg transition-all ${forcedTool === 'workspace' ? 'bg-primary text-white' : 'text-neutral-400 hover:text-primary hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Knowledge base search (⌘⇧K)"><Database className="w-3.5 h-3.5" /></button>
          )}
          {activeAssistant?.tools?.web_search && (
            <button onClick={() => setForcedTool(t => t === 'search' ? null : 'search')} className={`p-1.5 rounded-lg transition-all ${forcedTool === 'search' ? 'bg-secondary text-white' : 'text-neutral-400 hover:text-secondary hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Web search"><Globe className="w-3.5 h-3.5" /></button>
          )}
          {/* Deep Research stub */}
          <button disabled className="p-1.5 rounded-lg text-neutral-300 dark:text-neutral-600 cursor-default" title="Deep Research — coming soon"><Telescope className="w-3.5 h-3.5" /></button>
          <div className="w-px h-3.5 bg-neutral-200 dark:bg-neutral-700 mx-1 shrink-0" />
          {/* Output mode */}
          <button onClick={() => setGenerationMode(generationMode === 'code' ? 'text' : 'code')} className={`p-1.5 rounded-lg transition-all ${generationMode === 'code' ? 'bg-[#4A5D75] text-white' : 'text-neutral-400 hover:text-[#4A5D75] hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Canvas — generate a code app"><Code2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => setGenerationMode(generationMode === 'doc' ? 'text' : 'doc')} className={`p-1.5 rounded-lg transition-all ${generationMode === 'doc' ? 'bg-[#7A9E8D] text-white' : 'text-neutral-400 hover:text-[#7A9E8D] hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Doc — generate a rich document"><ScrollText className="w-3.5 h-3.5" /></button>
          <div className="flex items-center gap-1 ml-auto">
            {/* Model selector — moved here from its own row */}
            <div className="relative">
              <button onClick={() => setIsModelDropdownOpen(v => !v)} className="flex items-center gap-1 px-2.5 py-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:border-secondary-light transition-all">
                <Zap className="w-3 h-3 text-secondary-light" />
                {selectedModel && modelValidation[selectedModel.id] === 'fail' && <span title="Model unreachable"><AlertTriangle className="w-3 h-3 text-error" /></span>}
                {selectedModel && modelValidation[selectedModel.id] === 'ok'   && <span title="Model verified"><ShieldCheck   className="w-3 h-3 text-[#9FBBAF]" /></span>}
                <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 max-w-[120px] truncate">{selectedModel?.name ?? 'Model'}</span>
                <ChevronDown className="w-3 h-3 text-neutral-400 shrink-0" />
              </button>
              {isModelDropdownOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-64 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in slide-in-from-bottom-2 duration-150">
                  <div className="p-1.5 space-y-1">
                    {(() => {
                      const localModels = models.filter(m => m.isLocal);
                      const cloudModels = models.filter(m => !m.isLocal);
                      const renderModel = (m: any) => (
                        <button key={m.id} onClick={() => { setSelectedModelId(m.id); setIsModelDropdownOpen(false); }} className={`group w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all ${selectedModelId === m.id ? 'bg-primary text-white' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800'}`}>
                          <div className="flex flex-col"><span className="text-xs font-medium">{m.name}</span><span className={`text-[9px] font-medium opacity-50 ${selectedModelId === m.id ? 'text-white' : 'text-neutral-500'}`}>{m.provider}</span></div>
                          <div className="flex items-center gap-1">
                            {modelValidation[m.id] === 'fail'    && <AlertTriangle className="w-3 h-3 text-[#D9A098]" />}
                            {modelValidation[m.id] === 'ok'      && <ShieldCheck   className="w-3 h-3 text-[#B5CDBF]" />}
                            {modelValidation[m.id] === 'pending' && <Loader2       className="w-3 h-3 animate-spin text-secondary-muted" />}
                            <div onClick={e => { e.stopPropagation(); setModels(prev => prev.filter(x => x.id !== m.id)); if (selectedModelId === m.id) setSelectedModelId(models[0]?.id ?? ''); }} className="p-1.5 text-neutral-400 hover:text-error hover:bg-error-light dark:hover:bg-[#4A2E2E]/30 rounded-lg transition-colors" title="Remove Model"><Trash2 className="w-3.5 h-3.5" /></div>
                          </div>
                        </button>
                      );
                      return (
                        <>
                          {localModels.length > 0 && (
                            <>
                              <div className="px-3 pt-1 pb-0.5 text-[9px] font-medium text-neutral-400 flex items-center gap-1.5"><Brain className="w-2.5 h-2.5" /> Local</div>
                              {localModels.map(renderModel)}
                            </>
                          )}
                          {cloudModels.length > 0 && (
                            <>
                              {localModels.length > 0 && <div className="border-t border-neutral-100 dark:border-neutral-800 my-1" />}
                              <div className="px-3 pt-1 pb-0.5 text-[9px] font-medium text-neutral-400 flex items-center gap-1.5"><Globe className="w-2.5 h-2.5" /> Cloud</div>
                              {cloudModels.map(renderModel)}
                            </>
                          )}
                        </>
                      );
                    })()}
                    <button onClick={() => { setWizardStep(3); setShowModelWizard(true); setIsModelDropdownOpen(false); }} className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-primary hover:bg-surface dark:hover:bg-[#1E2B38]/20 transition-all border-t border-neutral-100 dark:border-neutral-800 mt-1"><Plus className="w-3 h-3" /><span className="text-xs font-medium">Connect model</span></button>
                  </div>
                </div>
              )}
            </div>
            <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />
            {models.length > 0 && <button onClick={onToggleListening} className={`p-2 rounded-lg transition-all ${isListening ? 'text-error bg-error-light dark:bg-[#4A2E2E]/30' : 'text-neutral-400 hover:text-secondary hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Dictate"><Mic className={`w-3.5 h-3.5 ${isListening ? 'animate-bounce' : ''}`} /></button>}
            {!isGenerating && models.length > 0 && <button onClick={() => fileInputRef.current?.click()} className="p-2 text-neutral-400 hover:text-secondary hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-all" title="Attach Document"><Paperclip className="w-3.5 h-3.5" /></button>}
            <input type="file" ref={fileInputRef} onChange={onChatFileUpload} className="hidden" />
            {!isGenerating && models.length > 0 && <button onClick={onEnhancePrompt} disabled={isEnhancing || !input.trim()} className={`p-2 rounded-lg transition-all ${input.trim() ? 'text-accent hover:bg-accent-light dark:hover:bg-[#5C452E]/20' : 'text-neutral-300 dark:text-neutral-600 cursor-default'} ${isEnhancing ? 'animate-spin' : ''}`} title="Enhance Prompt"><Wand2 className="w-3.5 h-3.5" /></button>}
            <button
              onClick={isGenerating ? onStop : onSend}
              disabled={(llamaServerPid !== null && llamaPaused) || (!isGenerating && ((!input.trim() && attachedDocs.length === 0) || models.length === 0)) || (!isGenerating && !!selectedModel && modelValidation[selectedModel.id] === 'fail')}
              className={`p-2 rounded-lg transition-all ${isGenerating ? 'bg-error text-white shadow-sm animate-pulse hover:bg-error-dark' : 'bg-secondary-light text-primary-dark shadow-sm hover:bg-secondary-muted active:scale-90 disabled:opacity-50'}`}>
              {isGenerating ? <Square className="w-3.5 h-3.5 fill-primary-dark" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        </div>{/* end relative wrapper for slash palette */}
      </div>
    </div>
  );
}
