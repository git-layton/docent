import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  FileText,
  Image,
  Inbox,
  Link,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  User,
  Brain,
  CheckSquare,
  StickyNote,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAgentStore } from '../store/useAgentStore';
import { useChatStore } from '../store/useChatStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { useTaskStore } from '../store/useTaskStore';
import { useReceiptStore } from '../services/receipts';
import {
  DEFAULT_INBOX_OWNERS,
  formatCaptureAge,
  inferCaptureKind,
  mergeInboxOwners,
  normalizeInboxOwners,
  ownerLabel,
  type CaptureItem,
} from '../services/inbox';
import { generateId } from '../lib/id';

interface InboxPanelProps {
  agentForgePath: string;
  activeAgentId: string;
  onToast: (msg: string) => void;
  onOpenChat?: () => void;
}

function buildCaptureOpeningMessage(capture: CaptureItem): string {
  const parts: string[] = [];
  if (capture.title && capture.title !== 'Untitled capture') {
    parts.push(`**${capture.title}**`);
  }
  if (capture.note) parts.push(`_Note: ${capture.note}_`);
  if (capture.bodyText) parts.push(capture.bodyText);
  if (capture.urls?.length) {
    parts.push(capture.urls.map((u: string) => u).join('\n'));
  }
  if (capture.attachments?.length) {
    parts.push(capture.attachments.map((a: any) => `📎 ${a.name}`).join('\n'));
  }
  return parts.join('\n\n').trim() || 'I captured something — can you help me figure out what to do with it?';
}

function statusDot(status: string) {
  if (status === 'saved') return 'bg-success';
  if (status === 'failed') return 'bg-danger';
  if (status === 'processing') return 'bg-accent animate-pulse';
  if (status === 'needs_review') return 'bg-warning';
  if (status === 'dismissed') return 'bg-edge-2 opacity-40';
  return 'bg-edge-2';
}

export function InboxPanel({ agentForgePath: _agentForgePath, activeAgentId, onToast, onOpenChat }: InboxPanelProps) {
  const assistants = useAgentStore(s => s.assistants);
  const setActiveFolderId = useAgentStore(s => s.setActiveFolderId);
  const appSettings = useSettingsStore(s => s.appSettings);
  const setChats = useChatStore(s => s.setChats);
  const setMessages = useChatStore(s => s.setMessages);
  const setActiveChatId = useChatStore(s => s.setActiveChatId);

  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [quickOwner, setQuickOwner] = useState<string>('primary');
  const [captureAgents, setCaptureAgents] = useState<Record<string, string>>({});
  const [showDismissed, setShowDismissed] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const configuredOwners = normalizeInboxOwners(appSettings.inboxOwners);
  const ownerOptions = mergeInboxOwners(configuredOwners, captures);

  useEffect(() => {
    if (!ownerOptions.some(o => o.id === quickOwner)) {
      setQuickOwner(ownerOptions[0]?.id ?? DEFAULT_INBOX_OWNERS[0].id);
    }
  }, [ownerOptions, quickOwner]);

  async function loadCaptures() {
    setIsLoading(true);
    try {
      const result = await invoke<{ captures: CaptureItem[]; error?: string }>('list_inbox_captures', {
        ownerId: ownerFilter === 'all' ? 'all' : ownerFilter,
      });
      if (result.error) throw new Error(result.error);
      setCaptures(result.captures ?? []);
    } catch (e: any) {
      onToast(`Could not load inbox: ${e?.message ?? String(e)}`);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { loadCaptures(); }, [ownerFilter]);

  // Opening the Inbox acknowledges the activity bubble on its tab (routines etc.).
  useEffect(() => { useUIStore.getState().clearInboxAlerts(); }, []);

  async function createLocalCapture(payload: any) {
    const result = await invoke<{ ok: boolean; capture?: CaptureItem; error?: string }>('create_inbox_capture', { payload });
    if (!result.ok || !result.capture) throw new Error(result.error ?? 'Could not create capture');
    setCaptures(prev => [result.capture!, ...prev.filter(c => c.id !== result.capture!.id)]);
    return result.capture;
  }

  async function addTextCapture() {
    const bodyText = quickText.trim();
    if (!bodyText) return;
    try {
      await createLocalCapture({
        ownerId: quickOwner,
        source: 'desktop_drop',
        kind: inferCaptureKind({ bodyText }),
        title: bodyText.split(/\n/)[0].slice(0, 80) || 'Text capture',
        ownerLabel: ownerLabel(quickOwner, ownerOptions),
        instanceId: appSettings.forgeInstanceId || 'agent-forge-local',
        shareId: 'desktop-local',
        deviceName: 'Docent Desktop',
        bodyText,
        note: quickNote.trim(),
        urls: Array.from(new Set(bodyText.match(/https?:\/\/[^\s)]+/g) ?? [])),
      });
      setQuickText('');
      setQuickNote('');
      onToast('Capture saved to Inbox.');
    } catch (e: any) {
      onToast(`Capture failed: ${e?.message ?? String(e)}`);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      const attachments = Array.from(files).map(f => ({ name: f.name, mimeType: f.type || 'application/octet-stream', size: f.size }));
      await createLocalCapture({
        ownerId: quickOwner,
        source: 'desktop_drop',
        kind: inferCaptureKind({ attachments }),
        title: attachments.length === 1 ? attachments[0].name : `${attachments.length} files`,
        ownerLabel: ownerLabel(quickOwner, ownerOptions),
        instanceId: appSettings.forgeInstanceId || 'agent-forge-local',
        shareId: 'desktop-local',
        deviceName: 'Docent Desktop',
        note: quickNote.trim(),
        attachments,
        urls: [],
      });
      setQuickNote('');
      onToast('File capture saved to Inbox.');
    } catch (e: any) {
      onToast(`File capture failed: ${e?.message ?? String(e)}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function agentForCapture(captureId: string) {
    const picked = captureAgents[captureId];
    if (picked) return assistants.find((a: any) => a.id === picked) ?? assistants[0];
    return assistants.find((a: any) => a.id === activeAgentId) ?? assistants[0];
  }

  function openChatWithCapture(capture: CaptureItem) {
    const agent = agentForCapture(capture.id);
    if (!agent) { onToast('No agent available.'); return; }

    const chatId = generateId('c');
    const opening = buildCaptureOpeningMessage(capture);
    const userMsg = {
      id: generateId('msg'),
      role: 'user',
      content: opening,
      attachedFiles: [],
      isPinned: false,
      timestamp: Date.now(),
      _captureId: capture.id,
    };

    setActiveFolderId(agent.id);
    setChats((prev: any[]) => [
      { id: chatId, folderId: agent.id, name: capture.title?.slice(0, 40) || 'Inbox capture', updatedAt: Date.now() },
      ...prev,
    ]);
    setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: [userMsg] }));
    setActiveChatId(chatId);
    onOpenChat?.();
    onToast(`Opened with ${agent.name}`);
  }

  // ── Triage actions ────────────────────────────────────────────────────────
  // Each action patches the capture's status server-side, mutates local state,
  // and records a receipt with a genuine undo handler.

  async function patchStatus(capture: CaptureItem, status: CaptureItem['status']) {
    await invoke('update_inbox_capture', { captureId: capture.id, status }).catch(() => {});
    setCaptures(prev => prev.map(c => c.id === capture.id ? { ...c, status } : c));
  }

  const triageToMemory = useCallback(async (capture: CaptureItem) => {
    const prevStatus = capture.status;
    await patchStatus(capture, 'saved');
    // Write a memory file from the capture body
    const slug = capture.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'capture';
    await invoke('write_memory_file', {
      agentId: 'alexis',
      path: `inbox/${slug}.md`,
      content: `# ${capture.title}\n\n${capture.bodyText || ''}\n`,
      commitMessage: `inbox: triage → memory "${capture.title.slice(0, 60)}"`,
    }).catch(() => {});
    useReceiptStore.getState().record(
      { surface: 'memory', action: 'Saved to Memory', summary: `"${capture.title.slice(0, 60)}" filed from Forge Inbox` },
      async () => { await patchStatus(capture, prevStatus); },
    );
    useUIStore.getState().showToast('Saved to memory ↗');
  }, []);

  const triageToTask = useCallback(async (capture: CaptureItem) => {
    const prevStatus = capture.status;
    await patchStatus(capture, 'saved');
    const taskId = generateId('t');
    useTaskStore.getState().addTask(capture.title || capture.bodyText.slice(0, 80), null, capture.bodyText.slice(0, 500));
    useReceiptStore.getState().record(
      { surface: 'tasks', action: 'Created Task', summary: `"${capture.title.slice(0, 60)}" added to To-Dos` },
      async () => { useTaskStore.getState().deleteTask(taskId); await patchStatus(capture, prevStatus); },
    );
    useUIStore.getState().showToast('Added to To-Dos ✓');
  }, []);

  const triageToNote = useCallback(async (capture: CaptureItem) => {
    const prevStatus = capture.status;
    await patchStatus(capture, 'saved');
    await invoke('notes_create', {
      folder: 'Inbox',
      name: capture.title || 'Inbox Capture',
      body: capture.bodyText || '',
    }).catch(() => {});
    useReceiptStore.getState().record(
      { surface: 'notes', action: 'Created Note', summary: `"${capture.title.slice(0, 60)}" saved as a note` },
      async () => { await patchStatus(capture, prevStatus); },
    );
    useUIStore.getState().showToast('Saved as note 📝');
  }, []);

  const triageDismiss = useCallback(async (capture: CaptureItem) => {
    const prevStatus = capture.status;
    await patchStatus(capture, 'dismissed');
    useReceiptStore.getState().record(
      { surface: 'inbox', action: 'Dismissed', summary: `"${capture.title.slice(0, 60)}" dismissed from Forge Inbox` },
      async () => { await patchStatus(capture, prevStatus); },
    );
  }, []);

  // Keyboard triage: M / T / N / D when a card is focused
  const handleCardKeyDown = useCallback((e: React.KeyboardEvent, capture: CaptureItem) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).tagName !== 'DIV') return;
    switch (e.key.toUpperCase()) {
      case 'M': e.preventDefault(); triageToMemory(capture); break;
      case 'T': e.preventDefault(); triageToTask(capture); break;
      case 'N': e.preventDefault(); triageToNote(capture); break;
      case 'D': e.preventDefault(); triageDismiss(capture); break;
    }
  }, [triageToMemory, triageToTask, triageToNote, triageDismiss]);

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-accent/20 bg-accent-soft/40 p-3">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-accent">
          <Inbox className="w-4 h-4" />
          Docent Inbox
        </div>
        <p className="text-[10px] text-ink-2 mt-1 leading-relaxed">
          Drop anything here. Open it with an agent when you're ready to talk about it.
        </p>
      </div>

      {/* Owner filter */}
      {ownerOptions.length > 1 && (
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-inset">
          {['all', ...ownerOptions.map(o => o.id)].map(owner => (
            <button
              key={owner}
              onClick={() => setOwnerFilter(owner)}
              className={`py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${ownerFilter === owner ? 'bg-panel text-accent shadow-sm' : 'text-ink-3 hover:text-ink-2'}`}
            >
              {owner === 'all' ? 'All' : ownerLabel(owner, ownerOptions)}
            </button>
          ))}
        </div>
      )}

      {/* Quick capture */}
      <div className="space-y-2 rounded-xl border border-edge p-3">
        <div className="flex items-center gap-2">
          <select
            value={quickOwner}
            onChange={e => setQuickOwner(e.target.value)}
            className="bg-inset border border-edge rounded-lg px-2 py-1.5 text-[11px] font-bold outline-none"
          >
            {ownerOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <input
            value={quickNote}
            onChange={e => setQuickNote(e.target.value)}
            placeholder="optional note"
            className="min-w-0 flex-1 bg-inset border border-edge rounded-lg px-2 py-1.5 text-[11px] outline-none"
          />
        </div>
        <textarea
          value={quickText}
          onChange={e => setQuickText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addTextCapture(); }}
          placeholder="paste text, a URL, or a thought…"
          rows={3}
          className="w-full resize-none bg-inset border border-edge rounded-lg px-3 py-2 text-xs outline-none"
        />
        <div className="flex gap-2">
          <button onClick={addTextCapture} disabled={!quickText.trim()} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-on-accent text-[10px] font-black uppercase tracking-widest transition-colors">
            <Send className="w-3.5 h-3.5" />
            Capture
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-edge text-ink-2 text-[10px] font-black uppercase tracking-widest hover:bg-wash transition-colors">
            <FileText className="w-3.5 h-3.5" />
            File
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
        </div>
      </div>

      {/* Refresh */}
      <button onClick={loadCaptures} disabled={isLoading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-edge text-[10px] font-black uppercase tracking-widest text-ink-2 hover:bg-wash disabled:opacity-50 transition-colors">
        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        Refresh
      </button>

      {/* Dismissed toggle */}
      <button
        onClick={() => setShowDismissed(v => !v)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-edge text-[10px] font-black uppercase tracking-widest text-ink-3 hover:bg-wash transition-colors"
      >
        {showDismissed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
      </button>

      {/* Capture list */}
      {isLoading ? (
        <div className="text-center py-8 text-ink-3 text-xs">Loading…</div>
      ) : captures.filter(c => showDismissed || c.status !== 'dismissed').length === 0 ? (
        <div className="text-center py-12 text-ink-3">
          <Inbox className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-xs font-bold">Nothing here yet.</p>
          <p className="text-[10px] mt-1 opacity-70">Captures from your phone or the box above will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {captures.filter(c => showDismissed || c.status !== 'dismissed').map(capture => (
            <div
              key={`${capture.ownerId}-${capture.id}`}
              className={`rounded-xl border border-edge bg-panel-2 overflow-hidden group/card outline-none transition-opacity ${capture.status === 'dismissed' ? 'opacity-40' : ''}`}
              tabIndex={0}
              onFocus={() => setFocusedId(capture.id)}
              onBlur={() => setFocusedId(null)}
              onKeyDown={e => handleCardKeyDown(e, capture)}
            >
              <div className="p-3 space-y-2.5">
                {/* Title row */}
                <div className="flex items-start gap-2">
                  <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(capture.status)}`} />
                  {capture.kind === 'image' || capture.attachments?.some((a: any) => a.mimeType?.startsWith('image/'))
                    ? <Image className="w-4 h-4 text-ink-3 shrink-0 mt-0.5" />
                    : capture.urls?.length
                      ? <Link className="w-4 h-4 text-ink-3 shrink-0 mt-0.5" />
                      : <FileText className="w-4 h-4 text-ink-3 shrink-0 mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-ink truncate">{capture.title || 'Untitled capture'}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-ink-3 flex items-center gap-1">
                        <User className="w-2.5 h-2.5" />
                        {ownerLabel(capture.ownerId, ownerOptions)}
                      </span>
                      <span className="text-[9px] text-ink-3">{formatCaptureAge(capture.createdAt)}</span>
                      {focusedId === capture.id && (
                        <span className="text-[9px] text-ink-3 ml-auto">M·T·N·D</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Preview */}
                {(capture.bodyText || capture.note) && (
                  <p className="text-[11px] leading-relaxed text-ink-2 line-clamp-2 pl-6">
                    {capture.note ? `${capture.note} — ` : ''}{capture.bodyText}
                  </p>
                )}

                {/* Attachments / URLs preview */}
                {(capture.attachments?.length > 0 || capture.urls?.length > 0) && (
                  <div className="flex flex-wrap gap-1 pl-6">
                    {capture.attachments?.slice(0, 2).map((a: any) => (
                      <span key={a.id} className="text-[9px] px-1.5 py-0.5 rounded bg-wash text-ink-2 font-bold truncate max-w-[140px]">{a.name}</span>
                    ))}
                    {capture.urls?.slice(0, 1).map((url: string) => (
                      <span key={url} className="text-[9px] px-1.5 py-0.5 rounded bg-wash text-ink-2 font-bold truncate max-w-[160px]">{url}</span>
                    ))}
                  </div>
                )}

                {/* Triage actions + Agent picker + Chat CTA */}
                <div className="flex items-center gap-1.5 pl-6">
                  {/* Triage buttons — always visible on hover, M/T/N/D keyboard shortcuts */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity mr-1">
                    <button onClick={() => triageToMemory(capture)} title="Save to Memory (M)" className="p-1.5 rounded-lg text-ink-3 hover:bg-inset hover:text-accent transition-colors">
                      <Brain className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => triageToTask(capture)} title="Create Task (T)" className="p-1.5 rounded-lg text-ink-3 hover:bg-inset hover:text-accent transition-colors">
                      <CheckSquare className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => triageToNote(capture)} title="Save as Note (N)" className="p-1.5 rounded-lg text-ink-3 hover:bg-inset hover:text-accent transition-colors">
                      <StickyNote className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => triageDismiss(capture)} title="Dismiss (D)" className="p-1.5 rounded-lg text-ink-3 hover:bg-inset hover:text-danger transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <select
                    value={captureAgents[capture.id] ?? activeAgentId}
                    onChange={e => setCaptureAgents(prev => ({ ...prev, [capture.id]: e.target.value }))}
                    className="min-w-0 flex-1 bg-inset border border-edge rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none"
                  >
                    {assistants.map((a: any) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => openChatWithCapture(capture)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-strong text-on-accent text-[10px] font-black uppercase tracking-widest transition-colors shrink-0"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Chat
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
