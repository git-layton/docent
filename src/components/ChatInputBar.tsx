import React from 'react';
import {
  FileText, ChevronDown, Globe, Zap, Send, Square, Wand2, Paperclip, X,
  AlertTriangle, Loader2, Brain, ListTodo, Database, ShieldCheck, Trash2, Plus, Mic, Code, FileEdit, ImageIcon, MessageSquare
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
}: ChatInputBarProps) {
  const input = useUIStore(s => s.input);
  const isDeepThinking = useUIStore(s => s.isDeepThinking);
  const forcedTool = useUIStore(s => s.forcedTool);
  const isPlanMode = useUIStore(s => s.isPlanMode);
  const generationMode = useUIStore(s => s.generationMode);
  const attachedDocs = useUIStore(s => s.attachedDocs);
  const uploadError = useUIStore(s => s.uploadError);
  const isModelDropdownOpen = useUIStore(s => s.isModelDropdownOpen);
  const slashHighlight = useUIStore(s => s.slashHighlight);
  const { setInput, setIsDeepThinking, setForcedTool, setIsPlanMode, setGenerationMode,
    setAttachedDocs, setIsModelDropdownOpen, setSlashHighlight } = useUIStore.getState();

  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);
  const modelValidation = useSettingsStore(s => s.modelValidation);
  const appSettings = useSettingsStore(s => s.appSettings);
  const { setSelectedModelId, setModels, setShowModelWizard, setWizardStep } = useSettingsStore.getState();
  return (
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
        {forcedTool && (
          <div className="px-4 py-1.5 mb-2 flex items-center gap-2 bg-[#F0F4F8] dark:bg-[#1E2B38]/40 border border-[#9EADC8]/40 rounded-xl text-[10px] font-bold text-[#4A5D75] dark:text-[#9EADC8]">
            {forcedTool === 'workspace' ? <Database className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
            Next message will force {forcedTool === 'workspace' ? 'Knowledge Search' : 'Web Search'}
            <button onClick={() => setForcedTool(null)} className="ml-auto text-neutral-400 hover:text-neutral-600"><X className="w-3 h-3" /></button>
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
        {/* Textarea */}
        <div className={`bg-white dark:bg-neutral-950 border-2 shadow-2xl rounded-2xl transition-all overflow-hidden ${models.length === 0 ? 'opacity-50 border-neutral-200 dark:border-neutral-800' : 'border-neutral-200 dark:border-neutral-800 focus-within:border-[#9EADC8]'}`}>
          <textarea
            value={input}
            onChange={e => { setInput(e.target.value); setSlashHighlight(0); }}
            onKeyDown={e => {
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
            placeholder={models.length === 0 ? 'Connect an LLM to start...' : generationMode === 'code' ? 'What application should I build?' : generationMode === 'doc' ? 'What document should I draft?' : generationMode === 'image' ? 'Describe the image you want to generate...' : `Message ${activeAssistant?.name ?? 'Assistant'}... or type / for commands`}
            className="w-full bg-transparent p-4 min-h-[60px] max-h-40 resize-none outline-none dark:text-neutral-100 text-sm font-medium custom-scrollbar" rows={1} disabled={isGenerating || (llamaServerPid !== null && llamaPaused) || models.length === 0} />
        </div>

        {/* Mode bar + attachment — below textarea */}
        <div className="flex items-center gap-1 px-0.5 pt-1.5">
          <button onClick={() => setIsDeepThinking(v => !v)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${isDeepThinking ? 'bg-[#2C3E50] text-[#9EADC8]' : 'text-neutral-400 hover:text-[#9EADC8] hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Deep Thinking Mode"><Brain className="w-3.5 h-3.5" /><span>Think</span></button>
          <button onClick={() => setIsPlanMode(v => !v)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${isPlanMode ? 'bg-[#7A9E8D] text-white' : 'text-neutral-400 hover:text-[#7A9E8D] hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Plan Mode"><ListTodo className="w-3.5 h-3.5" /><span>Plan</span></button>
          {activeAssistant?.tools?.local_workspace && (
            <button onClick={() => { setForcedTool(t => t === 'workspace' ? null : 'workspace'); }} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${forcedTool === 'workspace' ? 'bg-[#4A5D75] text-white' : 'text-neutral-400 hover:text-[#4A5D75] hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Knowledge Base Search (⌘⇧K)"><Database className="w-3.5 h-3.5" /><span>Knowledge</span></button>
          )}
          {activeAssistant?.tools?.web_search && (
            <button onClick={() => { setForcedTool(t => t === 'search' ? null : 'search'); }} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${forcedTool === 'search' ? 'bg-[#6A829E] text-white' : 'text-neutral-400 hover:text-[#6A829E] hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Search Web"><Globe className="w-3.5 h-3.5" /><span>Search</span></button>
          )}
          <div className="flex items-center gap-1 ml-auto">
            {models.length > 0 && <button onClick={onToggleListening} className={`p-1.5 rounded-lg transition-all ${isListening ? 'text-[#C98A8A] bg-[#F7EBEB] dark:bg-[#4A2E2E]/30' : 'text-neutral-400 hover:text-[#6A829E] hover:bg-neutral-100 dark:hover:bg-neutral-800'}`} title="Dictate"><Mic className={`w-3.5 h-3.5 ${isListening ? 'animate-bounce' : ''}`} /></button>}
            {!isGenerating && models.length > 0 && <button onClick={() => fileInputRef.current?.click()} className="p-1.5 text-neutral-400 hover:text-[#6A829E] hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-all" title="Attach Document"><Paperclip className="w-3.5 h-3.5" /></button>}
            <input type="file" ref={fileInputRef} onChange={onChatFileUpload} className="hidden" />
            {!isGenerating && input.trim() && models.length > 0 && <button onClick={onEnhancePrompt} disabled={isEnhancing} className={`p-1.5 text-[#D4AA7D] hover:bg-[#F9F4EE] dark:hover:bg-[#5C452E]/20 rounded-lg transition-all ${isEnhancing ? 'animate-spin' : ''}`} title="Enhance Prompt"><Wand2 className="w-3.5 h-3.5" /></button>}
            <button
              onClick={isGenerating ? onStop : onSend}
              disabled={(llamaServerPid !== null && llamaPaused) || (!isGenerating && ((!input.trim() && attachedDocs.length === 0) || models.length === 0))}
              className={`p-1.5 rounded-lg transition-all ${isGenerating ? 'bg-[#C98A8A] text-white shadow-sm animate-pulse hover:bg-[#B57070]' : 'bg-[#9EADC8] text-[#2C3E50] shadow-sm hover:bg-[#899AB5] active:scale-90 disabled:opacity-50'}`}>
              {isGenerating ? <Square className="w-3.5 h-3.5 fill-[#2C3E50]" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        </div>{/* end relative wrapper for slash palette */}
      </div>
    </div>
  );
}
