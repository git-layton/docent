import React, { useState, useEffect } from 'react';
import {
  UserCog, X, Wand2, ImageIcon, Bot, BookOpen, Paperclip, FileText,
  Pin, Trash2, Loader2, Brain, Database, AlertTriangle, Copy
} from 'lucide-react';
import { BOT_COLORS, AVAILABLE_TOOLS } from './ui/AgentIcon';
import { useAgentStore } from '../store/useAgentStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { invoke } from '@tauri-apps/api/core';

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
      const result = await invoke<{ files: Array<{ name: string }> }>('list_agent_memory_files', { agentId }).catch(() => ({ files: [] }));
      const files = (result.files ?? []).map(f => f.name);
      setMemos(files.sort((a, b) => b.localeCompare(a)));
    }
    load();
  }, [forgePath, agentId]);
  return (
    <div>
      {memos.length === 0 ? (
        <p className="text-tiny text-ink-3 text-center py-4">No memos yet for this agent.</p>
      ) : (
        <div className="space-y-1.5 max-h-[120px] overflow-y-auto custom-scrollbar mb-3">
          {memos.map(f => (
            <div key={f} className="flex items-center gap-2 px-2.5 py-1.5 bg-panel rounded-lg border border-edge">
              <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="text-mini font-bold text-ink-2 truncate">{f}</span>
            </div>
          ))}
        </div>
      )}
      <button onClick={onCompose} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-edge-2 text-tiny font-bold text-ink-3 hover:border-accent hover:text-accent transition-all">
        + New Memo
      </button>
    </div>
  );
}

function LibraryFileList({ path }: { path: string }) {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    if (!path) return;
    invoke<{ files: Array<{ name: string }> }>('list_library_files')
      .then(result => setFiles((result.files ?? []).map(f => f.name)))
      .catch(() => setFiles([]));
  }, [path]);
  if (files.length === 0) return (
    <p className="text-tiny text-ink-3 text-center py-4">
      No library files yet. Drop files in the Memmo Panel Library tab.
    </p>
  );
  return (
    <div className="space-y-1.5 max-h-[120px] overflow-y-auto custom-scrollbar">
      {files.map(f => (
        <div key={f} className="flex items-center gap-2 px-2.5 py-1.5 bg-panel rounded-lg border border-edge">
          <FileText className="w-3.5 h-3.5 text-secondary shrink-0" />
          <span className="text-mini font-bold text-ink-2 truncate">{f}</span>
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
  const integrations = useSettingsStore(s => s.integrations);

  const agentForgePath = useMemoryStore(s => s.agentForgePath);
  const isDreamRunning = useMemoryStore(s => s.isDreamRunning);
  const globalPins = useMemoryStore(s => s.globalPins);
  const editingAgentPins = globalPins.filter((p: any) => p.agentId === editingAssistant?.id);

  const onClose = () => setShowAssistantSettings(false);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-panel-2 w-full max-w-3xl rounded-[2rem] p-8 shadow-2xl border border-edge max-h-[90vh] overflow-y-auto custom-scrollbar text-ink flex flex-col">
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div className="flex items-center gap-3"><div className="p-2 bg-accent rounded-xl"><UserCog className="w-6 h-6 text-on-accent" /></div><h3 className="text-xl font-black tracking-tighter uppercase">Agent Settings</h3></div>
          <button onClick={onClose} className="p-2 hover:bg-wash rounded-full"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex gap-1 border-b border-edge mb-6 shrink-0">
          {['config', 'memory'].map(tab => (
             <button key={tab} onClick={() => setAssistantSettingsTab(tab)} className={`pb-3 px-4 text-xs font-black uppercase tracking-widest transition-all ${assistantSettingsTab === tab ? 'text-accent border-b-2 border-accent' : 'text-ink-3'}`}>
                {tab === 'config' ? 'Configuration' : 'Knowledge & Memory'}
             </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
           {assistantSettingsTab === 'config' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="space-y-6">
                    <div><label className="text-tiny font-black uppercase opacity-50 mb-2 block tracking-widest">Name</label><input type="text" value={editingAssistant.name} onChange={e => setEditingAssistant((prev: any) => ({ ...prev, name: e.target.value }))} className="w-full bg-inset border-2 border-edge rounded-2xl px-5 py-4 text-sm font-bold outline-none focus:border-accent text-ink" /></div>

                    <div><label className="text-tiny font-black uppercase opacity-50 mb-2 block tracking-widest">Description</label><textarea value={editingAssistant.description ?? ''} onChange={e => setEditingAssistant((prev: any) => ({ ...prev, description: e.target.value }))} rows={2} className="w-full bg-inset border-2 border-edge rounded-2xl px-5 py-4 text-sm font-medium resize-none outline-none focus:border-accent text-ink custom-scrollbar" placeholder="What does this assistant do?" /></div>

                    <div>
                       <label className="text-tiny font-black uppercase opacity-50 mb-2 block tracking-widest">Default Output Mode</label>
                       <div className="flex bg-inset p-1.5 rounded-2xl">
                         {[{id:'text', lbl:'Chat'}, {id:'code',lbl:'Code Canvas'}, {id:'doc',lbl:'Doc Draft'}, {id:'image',lbl:'Image Gen'}]
                           .filter(m => m.id !== 'image' || appSettings?.imageProvider !== 'none')
                           .map(m => (
                           <button key={m.id} onClick={() => setEditingAssistant((prev: any) => ({ ...prev, defaultMode: m.id }))} className={`flex-1 py-2.5 text-micro font-black uppercase tracking-widest rounded-xl transition-all ${editingAssistant.defaultMode === m.id || (!editingAssistant.defaultMode && m.id === 'text') ? 'bg-panel shadow-sm text-accent' : 'text-ink-3 hover:text-ink-2'}`}>
                             {m.lbl}
                           </button>
                         ))}
                       </div>
                    </div>

                    <div>
                    <div className="flex items-center justify-between mb-2">
                       <label className="text-tiny font-black uppercase opacity-50 block tracking-widest">System Prompt</label>
                       <button onClick={handleEnhanceSystemPrompt} disabled={isEnhancingPrompt || !editingAssistant.prompt || models.length === 0} className="flex items-center gap-1 text-tiny font-black uppercase text-accent hover:text-accent-strong disabled:opacity-40"><Wand2 className={`w-3.5 h-3.5 ${isEnhancingPrompt ? 'animate-spin' : ''}`} /> Polish</button>
                    </div>
                    <textarea value={editingAssistant.prompt} onChange={e => setEditingAssistant((prev: any) => ({ ...prev, prompt: e.target.value }))} rows={8} className="w-full bg-inset border-2 border-edge rounded-2xl px-5 py-4 text-sm font-medium resize-none outline-none focus:border-accent text-ink custom-scrollbar" placeholder="You are a helpful assistant..." />
                    </div>

                    {/* Role — the agent's specialty in a workspace (drives orchestration, spec §6) */}
                    <div>
                      <label className="text-tiny font-black uppercase opacity-50 block tracking-widest mb-2">Role</label>
                      <p className="text-tiny text-ink-3 mb-2">A short specialty label — e.g. Engineer, Research, Writer. Shown in the header and injected into the agent's prompt so it leans into that lane.</p>
                      <input
                        value={editingAssistant.role ?? ''}
                        onChange={e => setEditingAssistant((prev: any) => ({ ...prev, role: e.target.value }))}
                        className="w-full bg-inset border-2 border-edge rounded-2xl px-5 py-3 text-sm font-medium outline-none focus:border-accent text-ink"
                        placeholder="e.g. Engineer"
                      />
                    </div>

                    {/* Core Drive */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-tiny font-black uppercase opacity-50 block tracking-widest">Core Drive</label>
                        <button
                          onClick={() => setEditingAssistant((prev: any) => ({ ...prev, driveEnabled: !prev.driveEnabled }))}
                          className={`w-8 h-4 rounded-full transition-all relative shrink-0 ${editingAssistant.driveEnabled !== false ? 'bg-accent' : 'bg-edge-2'}`}
                        >
                          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-panel transition-all ${editingAssistant.driveEnabled !== false ? 'right-0.5' : 'left-0.5'}`} />
                        </button>
                      </div>
                      <p className="text-tiny text-ink-3 mb-2">A persistent motivation injected into every prompt — the agent's underlying goal beyond the task at hand.</p>
                      <textarea
                        value={editingAssistant.drive ?? ''}
                        onChange={e => setEditingAssistant((prev: any) => ({ ...prev, drive: e.target.value }))}
                        disabled={editingAssistant.driveEnabled === false}
                        rows={2}
                        className="w-full bg-inset border-2 border-edge rounded-2xl px-5 py-3 text-sm font-medium resize-none outline-none focus:border-accent text-ink disabled:opacity-40"
                        placeholder="e.g. Always push toward clarity and the simplest correct solution."
                      />
                    </div>
                 </div>
                 <div className="space-y-6">
                    <div>
                       <label className="text-tiny font-black uppercase opacity-50 mb-2 block tracking-widest">Avatar</label>
                       <div className="flex gap-2 items-center flex-wrap">
                          <input type="file" accept="image/*" ref={avatarUploadRef} onChange={onAvatarUpload} className="hidden" />
                          <button onClick={() => avatarUploadRef.current?.click()} className="w-12 h-12 rounded-2xl border-2 border-dashed border-edge-2 flex items-center justify-center hover:bg-wash"><ImageIcon className="w-5 h-5 text-ink-3" /></button>
                          {BOT_COLORS.map(c => <button key={c.id} onClick={() => setEditingAssistant((prev: any) => ({ ...prev, avatar: { type: 'color', color: c.id } }))} className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all border-2 ${c.bg} ${editingAssistant?.avatar?.color === c.id && editingAssistant?.avatar?.type === 'color' ? 'ring-4 ring-accent/30 scale-105 border-panel' : 'border-transparent opacity-80 hover:opacity-100'}`}><Bot className="w-6 h-6 text-white" /></button>)}
                       </div>
                    </div>

                    <div>
                    <label className="text-tiny font-black uppercase opacity-50 mb-2 block tracking-widest">Capabilities</label>
                    <div className="space-y-2">
                       {AVAILABLE_TOOLS.map(tool => {
                          const Icon = tool.icon, enabled = editingAssistant.tools?.[tool.id] ?? false;
                          const needsSetup = (tool as any).requiresIntegration && (() => {
                            const key = (tool as any).requiresIntegration;
                            const scope = (tool as any).requiresScope;
                            const intg = (integrations as any)[key];
                            if (!intg) return true;
                            if (key === 'slack') return !intg.botToken;
                            if (key === 'googleWorkspaces') {
                              const accounts: any[] = intg ?? [];
                              if (accounts.length === 0) return true;
                              if (scope) return !accounts.some((a: any) => a.scopes?.[scope]);
                              return false;
                            }
                            return false;
                          })();
                          const isGoogleTool = ['gmail', 'google_drive', 'google_calendar'].includes(tool.id);
                          const gwAccounts: any[] = (integrations as any).googleWorkspaces ?? [];
                          const relevantAccounts = isGoogleTool
                            ? gwAccounts.filter((a: any) => {
                                const scopeMap: Record<string, string> = { gmail: 'gmail', google_drive: 'drive', google_calendar: 'calendar' };
                                return a.scopes?.[scopeMap[tool.id]] && a.clientId && a.refreshToken;
                              })
                            : [];
                          const allowedIds: string[] = editingAssistant.toolAccounts?.[tool.id] ?? [];
                          const toggleAccount = (acctId: string) => {
                            const current: string[] = editingAssistant.toolAccounts?.[tool.id] ?? [];
                            const next = current.includes(acctId) ? current.filter((x: string) => x !== acctId) : [...current, acctId];
                            setEditingAssistant((prev: any) => ({ ...prev, toolAccounts: { ...(prev.toolAccounts ?? {}), [tool.id]: next } }));
                          };
                          return (
                          <div key={tool.id} className="flex flex-col bg-inset rounded-xl overflow-hidden border border-edge">
                             <div className={`flex items-center justify-between p-4 transition-all ${enabled ? 'bg-accent-soft/40' : ''}`}>
                                <div className="flex items-center gap-3">
                                <div className={`p-1.5 rounded-lg ${enabled ? 'bg-accent text-on-accent' : 'bg-wash text-ink-3'}`}><Icon className="w-4 h-4" /></div>
                                <div className="flex flex-col">
                                  <span className="text-xs font-bold text-ink">{tool.name}</span>
                                  <span className="text-micro text-ink-3">{tool.desc}</span>
                                  {needsSetup && (
                                    <span className="text-micro font-bold text-warning flex items-center gap-1 mt-0.5">
                                      <AlertTriangle className="w-2.5 h-2.5" /> Setup required in System Settings → Integrations
                                    </span>
                                  )}
                                </div>
                                </div>
                                <button onClick={() => setEditingAssistant((prev: any) => ({ ...prev, tools: { ...(prev.tools ?? {}), [tool.id]: !enabled } }))} className={`w-8 h-4 rounded-full transition-all relative shrink-0 ${enabled ? 'bg-accent' : 'bg-edge-2'}`}>
                                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-panel transition-all ${enabled ? 'right-0.5' : 'left-0.5'}`} />
                                </button>
                             </div>
                             {enabled && relevantAccounts.length > 1 && (
                               <div className="px-4 pb-4 pt-1 flex flex-col gap-1.5">
                                 <span className="text-micro font-black uppercase tracking-widest text-ink-3">Allowed Accounts <span className="normal-case font-normal">(leave all off = access all)</span></span>
                                 <div className="flex flex-wrap gap-1.5">
                                   {relevantAccounts.map((acct: any) => {
                                     const active = allowedIds.length === 0 || allowedIds.includes(acct.id);
                                     const pinned = allowedIds.includes(acct.id);
                                     return (
                                       <button
                                         key={acct.id}
                                         onClick={() => toggleAccount(acct.id)}
                                         className={`px-2.5 py-1 rounded-xl text-tiny font-bold border transition-all ${pinned ? 'bg-accent text-on-accent border-accent' : active ? 'bg-panel border-edge text-ink-2' : 'bg-panel border-edge text-ink-3 line-through'}`}
                                       >
                                         {acct.label || acct.id}
                                       </button>
                                     );
                                   })}
                                 </div>
                               </div>
                             )}
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
                 <div className="p-5 bg-inset rounded-2xl border border-edge">
                    <div className="flex items-center justify-between mb-4">
                       <div>
                         <label className="text-tiny font-black uppercase tracking-widest text-secondary dark:text-secondary-muted flex items-center gap-2"><BookOpen className="w-3.5 h-3.5" /> Always-On Docs</label>
                         <p className="text-micro text-ink-3 mt-0.5">📌 Always injected into every message · max 25K chars</p>
                       </div>
                       <span className="text-micro font-bold text-ink-3 uppercase tracking-widest">{editingAssistant.trainingDocs?.length ?? 0} Docs</span>
                    </div>
                    <div className="space-y-2 mb-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                       {editingAssistant.trainingDocs?.map((doc: any) => (
                          <div key={doc.id} className="flex items-center justify-between p-2.5 bg-panel rounded-xl border border-edge">
                             <div className="flex items-center gap-2 truncate"><FileText className="w-4 h-4 text-secondary shrink-0" /><span className="text-xs font-bold truncate">{doc.name}</span><span className="text-tiny text-ink-3 shrink-0">{(doc.content?.length ?? 0).toLocaleString()} chars</span></div>
                             <button onClick={() => setEditingAssistant((prev: any) => ({ ...prev, trainingDocs: prev.trainingDocs.filter((d: any) => d.id !== doc.id) }))} className="p-1 text-ink-3 hover:text-error"><X className="w-4 h-4" /></button>
                          </div>
                       ))}
                       {(!editingAssistant.trainingDocs || editingAssistant.trainingDocs.length === 0) && (
                          <div className="text-center p-4 py-8 border-2 border-dashed border-edge-2 rounded-xl text-ink-3 text-xs font-bold">No documents uploaded.</div>
                       )}
                    </div>
                    <input type="file" accept="text/*,.pdf,.doc,.docx" ref={trainingDocUploadRef} onChange={onTrainingDocUpload} className="hidden" />
                    <button onClick={() => trainingDocUploadRef.current?.click()} className="w-full flex items-center justify-center gap-2 py-3 border-2 border-accent/25 text-accent rounded-xl hover:bg-accent-soft/40 transition-all text-tiny font-black uppercase tracking-widest bg-panel shadow-sm"><Paperclip className="w-4 h-4" /> Upload Document</button>
                 </div>

                 {/* Agent Memos */}
                 <div className="p-5 bg-inset rounded-2xl border border-edge">
                   <div className="flex items-center justify-between mb-3">
                     <div>
                       <label className="text-tiny font-black uppercase tracking-widest text-accent flex items-center gap-2"><BookOpen className="w-3.5 h-3.5" /> Agent Memos</label>
                       <p className="text-micro text-ink-3 mt-0.5">🔍 Searched when relevant — not always injected</p>
                     </div>
                     <button onClick={() => useMemoryStore.getState().setShowMemmoPanel(true)} className="text-micro font-bold text-primary underline">View →</button>
                   </div>
                   <AgentMemosSection forgePath={agentForgePath} agentId={editingAssistant?.id ?? 'default'} onCompose={() => { onClose(); useMemoryStore.getState().setShowMemoCompose(true); }} />
                   <button
                     onClick={() => { onClose(); onRunDreamCycle(); }}
                     disabled={isDreamRunning}
                     className="w-full flex items-center justify-center gap-2 py-2.5 mt-3 rounded-xl border border-primary/30 text-xs font-bold text-primary dark:text-secondary-muted hover:bg-primary/10 transition-all disabled:opacity-50"
                   >
                     {isDreamRunning
                       ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Dream Cycle Running...</>
                       : <><Brain className="w-3.5 h-3.5" /> Run Dream Cycle</>
                     }
                   </button>
                 </div>

                 {/* Knowledge Library */}
                 <div className="p-5 bg-inset rounded-2xl border border-edge">
                   <div className="flex items-center justify-between mb-3">
                     <div>
                       <label className="text-tiny font-black uppercase tracking-widest text-secondary dark:text-secondary-muted flex items-center gap-2"><Database className="w-3.5 h-3.5" /> Knowledge Library</label>
                       <p className="text-micro text-ink-3 mt-0.5">🔍 Searched when relevant — shared across all agents</p>
                     </div>
                     <button onClick={() => useMemoryStore.getState().setShowMemmoPanel(true)} className="text-micro font-bold text-primary underline">Manage →</button>
                   </div>
                   <LibraryFileList path={agentForgePath} />
                 </div>

                 {/* Pinned Memories List */}
                 <div className="p-5 bg-warning-soft/50 rounded-2xl border border-warning/25">
                    <div className="flex items-center justify-between mb-4">
                       <div>
                         <label className="text-tiny font-black uppercase tracking-widest text-accent flex items-center gap-2"><Pin className="w-3.5 h-3.5" /> Pinned Memories</label>
                         <p className="text-micro text-ink-3 mt-0.5">📌 Always in context — injected into every message</p>
                       </div>
                       <span className="text-micro font-bold text-ink-3 uppercase tracking-widest">{editingAgentPins.length} Facts</span>
                    </div>
                    <div className="space-y-2 max-h-[350px] overflow-y-auto custom-scrollbar pr-1">
                       {editingAgentPins.length === 0 ? (
                          <div className="text-center p-4 py-8 border-2 border-dashed border-warning/30 rounded-xl text-ink-3 text-xs font-bold">No memories pinned yet. Use the pin icon on chat messages to save facts here forever.</div>
                       ) : (
                          editingAgentPins.map((pin: any, i: number) => (
                             <div key={i} className="flex items-start justify-between p-4 rounded-xl border border-edge bg-panel/60 group hover:border-accent transition-all shadow-sm">
                                <p className="text-xs font-medium text-ink-2 pr-4 break-words">{pin.content}</p>
                                <button onClick={async () => { await onUnpin(pin.chatId, pin.msgId); }} className="p-1 text-ink-3 hover:text-danger hover:bg-wash rounded-md opacity-0 group-hover:opacity-100 transition-all shrink-0" title="Delete Memory"><Trash2 className="w-4 h-4" /></button>
                             </div>
                          ))
                       )}
                    </div>
                 </div>
              </div>
           )}
        </div>

        <div className="flex gap-3 mt-6 shrink-0">
          <button
            onClick={() => {
              const { assistants, setAssistants, setActiveFolderId, setShowAssistantSettings } = useAgentStore.getState();
              const cloned = {
                ...editingAssistant,
                id: `clone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name: `${editingAssistant.name} (copy)`,
                isDefault: false,
              };
              setAssistants([...assistants, cloned]);
              useAgentStore.getState().persist();
              setActiveFolderId(cloned.id);
              setShowAssistantSettings(false);
            }}
            className="flex items-center gap-2 px-5 py-4 border-2 border-edge-2 text-ink-2 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-wash active:scale-[0.98] transition-all"
            title="Clone this bot as a new starting point"
          >
            <Copy className="w-4 h-4" /> Clone
          </button>
          <button onClick={onSave} className="flex-1 py-4 bg-accent text-on-accent font-black text-xs uppercase tracking-[0.2em] rounded-2xl shadow-xl active:scale-[0.98] hover:bg-accent-strong transition-all">Save Configuration</button>
        </div>
      </div>
    </div>
  );
}
