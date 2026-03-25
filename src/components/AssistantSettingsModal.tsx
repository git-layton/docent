import React, { useState, useEffect } from 'react';
import {
  UserCog, X, Wand2, ImageIcon, Bot, BookOpen, Paperclip, FileText,
  Pin, Trash2, Loader2, Brain, Database
} from 'lucide-react';
import { BOT_COLORS, AVAILABLE_TOOLS } from './ui/AgentIcon';
import { useAgentStore } from '../store/useAgentStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../store/useMemoryStore';

interface AssistantSettingsModalProps {
  onSave: () => void;
  trainingDocUploadRef: React.RefObject<HTMLInputElement | null>;
  avatarUploadRef: React.RefObject<HTMLInputElement | null>;
  onTrainingDocUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUnpin: (chatId: string, msgId: string) => Promise<void>;
  handleEnhanceSystemPrompt: () => void;
  isEnhancingPrompt: boolean;
  onRunDreamCycle: () => void;
}

function AgentMemosSection({ forgePath, agentId, onCompose }: { forgePath: string; agentId: string; onCompose: () => void }) {
  const [memos, setMemos] = useState<string[]>([]);
  useEffect(() => {
    if (!forgePath || !agentId) return;
    async function load() {
      const { readDir } = await import('@tauri-apps/plugin-fs');
      const files: string[] = [];
      async function collect(dir: string) {
        const entries = await readDir(dir).catch(() => []);
        for (const e of entries as any[]) {
          if (e.isFile && e.name?.endsWith('.md') && e.name !== 'tasks.md') {
            files.push(e.name.replace('.md', ''));
          } else if (e.isDirectory) {
            await collect(`${dir}/${e.name}`);
          }
        }
      }
      await collect(`${forgePath}/memory/${agentId}`);
      setMemos(files.sort((a, b) => b.localeCompare(a)));
    }
    load();
  }, [forgePath, agentId]);
  return (
    <div>
      {memos.length === 0 ? (
        <p className="text-[10px] text-neutral-400 text-center py-4">No memos yet for this agent.</p>
      ) : (
        <div className="space-y-1.5 max-h-[120px] overflow-y-auto custom-scrollbar mb-3">
          {memos.map(f => (
            <div key={f} className="flex items-center gap-2 px-2.5 py-1.5 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-700">
              <FileText className="w-3.5 h-3.5 text-[#D4AA7D] shrink-0" />
              <span className="text-[11px] font-bold text-neutral-600 dark:text-neutral-300 truncate">{f}</span>
            </div>
          ))}
        </div>
      )}
      <button onClick={onCompose} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 text-[10px] font-bold text-neutral-500 hover:border-[#4A5D75] hover:text-[#4A5D75] transition-all">
        + New Memo
      </button>
    </div>
  );
}

function LibraryFileList({ path }: { path: string }) {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    if (!path) return;
    import('@tauri-apps/plugin-fs').then(({ readDir }) =>
      readDir(`${path}/library`)
        .then(entries => setFiles(
          entries.filter((e: any) => e.isFile && e.name?.endsWith('.md')).map((e: any) => e.name!.replace('.md', ''))
        ))
        .catch(() => setFiles([]))
    );
  }, [path]);
  if (files.length === 0) return (
    <p className="text-[10px] text-neutral-400 text-center py-4">
      No library files yet. Drop files in the Memmo Panel Library tab.
    </p>
  );
  return (
    <div className="space-y-1.5 max-h-[120px] overflow-y-auto custom-scrollbar">
      {files.map(f => (
        <div key={f} className="flex items-center gap-2 px-2.5 py-1.5 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-700">
          <FileText className="w-3.5 h-3.5 text-[#6A829E] shrink-0" />
          <span className="text-[11px] font-bold text-neutral-600 dark:text-neutral-300 truncate">{f}</span>
        </div>
      ))}
    </div>
  );
}

export function AssistantSettingsModal({
  onSave,
  trainingDocUploadRef,
  avatarUploadRef,
  onTrainingDocUpload,
  onAvatarUpload,
  onUnpin,
  handleEnhanceSystemPrompt,
  isEnhancingPrompt,
  onRunDreamCycle,
}: AssistantSettingsModalProps) {
  const editingAssistant = useAgentStore(s => s.editingAssistant);
  const assistantSettingsTab = useAgentStore(s => s.assistantSettingsTab);
  const { setEditingAssistant, setAssistantSettingsTab, setShowAssistantSettings } = useAgentStore.getState();

  const models = useSettingsStore(s => s.models);
  const appSettings = useSettingsStore(s => s.appSettings);

  const agentForgePath = useMemoryStore(s => s.agentForgePath);
  const isDreamRunning = useMemoryStore(s => s.isDreamRunning);
  const globalPins = useMemoryStore(s => s.globalPins);
  const editingAgentPins = globalPins.filter((p: any) => p.agentId === editingAssistant?.id);

  const onClose = () => setShowAssistantSettings(false);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-neutral-900 w-full max-w-3xl rounded-[2rem] p-8 shadow-2xl border border-neutral-200 dark:border-neutral-800 max-h-[90vh] overflow-y-auto custom-scrollbar text-neutral-900 dark:text-white flex flex-col">
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div className="flex items-center gap-3"><div className="p-2 bg-[#4A5D75] rounded-xl"><UserCog className="w-6 h-6 text-white" /></div><h3 className="text-xl font-black tracking-tighter uppercase">Agent Settings</h3></div>
          <button onClick={onClose} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"><X className="w-5 h-5" /></button>
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

                    <div><label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Description</label><textarea value={editingAssistant.description ?? ''} onChange={e => setEditingAssistant((prev: any) => ({ ...prev, description: e.target.value }))} rows={2} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-2xl px-5 py-4 text-sm font-medium resize-none outline-none focus:border-[#6A829E] dark:text-neutral-100 custom-scrollbar" placeholder="What does this assistant do?" /></div>

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
                          <input type="file" accept="image/*" ref={avatarUploadRef} onChange={onAvatarUpload} className="hidden" />
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
                       <div>
                         <label className="text-[10px] font-black uppercase tracking-widest text-[#6A829E] dark:text-[#899AB5] flex items-center gap-2"><BookOpen className="w-3.5 h-3.5" /> Always-On Docs</label>
                         <p className="text-[9px] text-neutral-400 mt-0.5">📌 Always injected into every message · max 25K chars</p>
                       </div>
                       <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-widest">{editingAssistant.trainingDocs?.length ?? 0} Docs</span>
                    </div>
                    <div className="space-y-2 mb-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                       {editingAssistant.trainingDocs?.map((doc: any) => (
                          <div key={doc.id} className="flex items-center justify-between p-2.5 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700">
                             <div className="flex items-center gap-2 truncate"><FileText className="w-4 h-4 text-[#6A829E] shrink-0" /><span className="text-xs font-bold truncate">{doc.name}</span><span className="text-[10px] text-neutral-400 shrink-0">{(doc.content?.length ?? 0).toLocaleString()} chars</span></div>
                             <button onClick={() => setEditingAssistant((prev: any) => ({ ...prev, trainingDocs: prev.trainingDocs.filter((d: any) => d.id !== doc.id) }))} className="p-1 text-neutral-400 hover:text-[#C98A8A]"><X className="w-4 h-4" /></button>
                          </div>
                       ))}
                       {(!editingAssistant.trainingDocs || editingAssistant.trainingDocs.length === 0) && (
                          <div className="text-center p-4 py-8 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-400 text-xs font-bold">No documents uploaded.</div>
                       )}
                    </div>
                    <input type="file" accept="text/*,.pdf,.doc,.docx" ref={trainingDocUploadRef} onChange={onTrainingDocUpload} className="hidden" />
                    <button onClick={() => trainingDocUploadRef.current?.click()} className="w-full flex items-center justify-center gap-2 py-3 border-2 border-[#D6E0EA] dark:border-[#1E2B38] text-[#4A5D75] dark:text-[#899AB5] rounded-xl hover:bg-[#F0F4F8] dark:hover:bg-[#1E2B38]/20 transition-all text-[10px] font-black uppercase tracking-widest bg-white dark:bg-neutral-900 shadow-sm"><Paperclip className="w-4 h-4" /> Upload Document</button>
                 </div>

                 {/* Agent Memos */}
                 <div className="p-5 bg-neutral-50 dark:bg-neutral-800/50 rounded-2xl border border-neutral-100 dark:border-neutral-800">
                   <div className="flex items-center justify-between mb-3">
                     <div>
                       <label className="text-[10px] font-black uppercase tracking-widest text-[#D4AA7D] flex items-center gap-2"><BookOpen className="w-3.5 h-3.5" /> Agent Memos</label>
                       <p className="text-[9px] text-neutral-400 mt-0.5">🔍 Searched when relevant — not always injected</p>
                     </div>
                     <button onClick={() => useMemoryStore.getState().setShowMemmoPanel(true)} className="text-[9px] font-bold text-[#4A5D75] underline">View →</button>
                   </div>
                   <AgentMemosSection forgePath={agentForgePath} agentId={editingAssistant?.id ?? 'default'} onCompose={() => { onClose(); useMemoryStore.getState().setShowMemoCompose(true); }} />
                   <button
                     onClick={() => { onClose(); onRunDreamCycle(); }}
                     disabled={isDreamRunning}
                     className="w-full flex items-center justify-center gap-2 py-2.5 mt-3 rounded-xl border border-[#4A5D75]/30 text-xs font-bold text-[#4A5D75] dark:text-[#899AB5] hover:bg-[#4A5D75]/10 transition-all disabled:opacity-50"
                   >
                     {isDreamRunning
                       ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Dream Cycle Running...</>
                       : <><Brain className="w-3.5 h-3.5" /> Run Dream Cycle</>
                     }
                   </button>
                 </div>

                 {/* Knowledge Library */}
                 <div className="p-5 bg-neutral-50 dark:bg-neutral-800/50 rounded-2xl border border-neutral-100 dark:border-neutral-800">
                   <div className="flex items-center justify-between mb-3">
                     <div>
                       <label className="text-[10px] font-black uppercase tracking-widest text-[#6A829E] dark:text-[#899AB5] flex items-center gap-2"><Database className="w-3.5 h-3.5" /> Knowledge Library</label>
                       <p className="text-[9px] text-neutral-400 mt-0.5">🔍 Searched when relevant — shared across all agents</p>
                     </div>
                     <button onClick={() => useMemoryStore.getState().setShowMemmoPanel(true)} className="text-[9px] font-bold text-[#4A5D75] underline">Manage →</button>
                   </div>
                   <LibraryFileList path={agentForgePath} />
                 </div>

                 {/* Pinned Memories List */}
                 <div className="p-5 bg-[#F9F4EE] dark:bg-[#5C452E]/10 rounded-2xl border border-[#EEDCC4] dark:border-[#5C452E]/30">
                    <div className="flex items-center justify-between mb-4">
                       <div>
                         <label className="text-[10px] font-black uppercase tracking-widest text-[#D4AA7D] flex items-center gap-2"><Pin className="w-3.5 h-3.5" /> Pinned Memories</label>
                         <p className="text-[9px] text-neutral-400 mt-0.5">📌 Always in context — injected into every message</p>
                       </div>
                       <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-widest">{editingAgentPins.length} Facts</span>
                    </div>
                    <div className="space-y-2 max-h-[350px] overflow-y-auto custom-scrollbar pr-1">
                       {editingAgentPins.length === 0 ? (
                          <div className="text-center p-4 py-8 border-2 border-dashed border-[#EEDCC4] dark:border-[#5C452E]/40 rounded-xl text-neutral-400 text-xs font-bold">No memories pinned yet. Use the pin icon on chat messages to save facts here forever.</div>
                       ) : (
                          editingAgentPins.map((pin: any, i: number) => (
                             <div key={i} className="flex items-start justify-between p-3 rounded-xl border border-white dark:border-neutral-700 bg-white/50 dark:bg-neutral-800/50 group hover:border-[#D4AA7D] transition-all shadow-sm">
                                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300 pr-4 break-words">{pin.content}</p>
                                <button onClick={async () => { await onUnpin(pin.chatId, pin.msgId); }} className="p-1 text-neutral-400 hover:text-[#C98A8A] hover:bg-white dark:hover:bg-neutral-800 rounded-md opacity-0 group-hover:opacity-100 transition-all shrink-0" title="Delete Memory"><Trash2 className="w-4 h-4" /></button>
                             </div>
                          ))
                       )}
                    </div>
                 </div>
              </div>
           )}
        </div>

        <button onClick={onSave} className="w-full py-5 bg-[#4A5D75] text-white font-black text-xs uppercase tracking-[0.2em] rounded-2xl shadow-xl mt-6 active:scale-[0.98] hover:bg-[#3D4D61] transition-all shrink-0">Save Configuration</button>
      </div>
    </div>
  );
}
