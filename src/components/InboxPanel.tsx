import { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { useAgentStore } from '../store/useAgentStore';
import { useChatStore } from '../store/useChatStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  DEFAULT_INBOX_OWNERS,
  formatCaptureAge,
  inferCaptureKind,
  mergeInboxOwners,
  normalizeInboxOwners,
  ownerLabel,
  type CaptureItem,
} from '../services/inbox';

interface InboxPanelProps {
  agentForgePath: string;
  activeAgentId: string;
  onToast: (msg: string) => void;
  onOpenChat?: () => void;
}

const generateId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

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
  if (status === 'saved') return 'bg-emerald-400';
  if (status === 'failed') return 'bg-red-400';
  if (status === 'processing') return 'bg-blue-400 animate-pulse';
  if (status === 'needs_review') return 'bg-amber-400';
  return 'bg-neutral-300 dark:bg-neutral-600';
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
  // Per-capture agent picker state
  const [captureAgents, setCaptureAgents] = useState<Record<string, string>>({});
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
        deviceName: 'Agent Forge Desktop',
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
        deviceName: 'Agent Forge Desktop',
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

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-[#4A5D75]/20 bg-[#4A5D75]/5 dark:bg-[#4A5D75]/10 p-3">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[#4A5D75] dark:text-[#9EADC8]">
          <Inbox className="w-4 h-4" />
          Forge Inbox
        </div>
        <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
          Drop anything here. Open it with an agent when you're ready to talk about it.
        </p>
      </div>

      {/* Owner filter */}
      {ownerOptions.length > 1 && (
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900">
          {['all', ...ownerOptions.map(o => o.id)].map(owner => (
            <button
              key={owner}
              onClick={() => setOwnerFilter(owner)}
              className={`py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${ownerFilter === owner ? 'bg-white dark:bg-neutral-800 text-[#4A5D75] shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}
            >
              {owner === 'all' ? 'All' : ownerLabel(owner, ownerOptions)}
            </button>
          ))}
        </div>
      )}

      {/* Quick capture */}
      <div className="space-y-2 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
        <div className="flex items-center gap-2">
          <select
            value={quickOwner}
            onChange={e => setQuickOwner(e.target.value)}
            className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-2 py-1.5 text-[11px] font-bold outline-none"
          >
            {ownerOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <input
            value={quickNote}
            onChange={e => setQuickNote(e.target.value)}
            placeholder="optional note"
            className="min-w-0 flex-1 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-2 py-1.5 text-[11px] outline-none"
          />
        </div>
        <textarea
          value={quickText}
          onChange={e => setQuickText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addTextCapture(); }}
          placeholder="paste text, a URL, or a thought…"
          rows={3}
          className="w-full resize-none bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-2 text-xs outline-none"
        />
        <div className="flex gap-2">
          <button onClick={addTextCapture} disabled={!quickText.trim()} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#4A5D75] hover:bg-[#3D4D61] disabled:opacity-40 text-white text-[10px] font-black uppercase tracking-widest transition-colors">
            <Send className="w-3.5 h-3.5" />
            Capture
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-300 text-[10px] font-black uppercase tracking-widest hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors">
            <FileText className="w-3.5 h-3.5" />
            File
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
        </div>
      </div>

      {/* Refresh */}
      <button onClick={loadCaptures} disabled={isLoading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-[10px] font-black uppercase tracking-widest text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50 transition-colors">
        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        Refresh
      </button>

      {/* Capture list */}
      {isLoading ? (
        <div className="text-center py-8 text-neutral-400 text-xs">Loading…</div>
      ) : captures.length === 0 ? (
        <div className="text-center py-12 text-neutral-400">
          <Inbox className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-xs font-bold">Nothing here yet.</p>
          <p className="text-[10px] mt-1 opacity-70">Captures from your phone or the box above will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {captures.map(capture => (
            <div key={`${capture.ownerId}-${capture.id}`} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 overflow-hidden">
              <div className="p-3 space-y-2.5">
                {/* Title row */}
                <div className="flex items-start gap-2">
                  <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(capture.status)}`} />
                  {capture.kind === 'image' || capture.attachments?.some((a: any) => a.mimeType?.startsWith('image/'))
                    ? <Image className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                    : capture.urls?.length
                      ? <Link className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                      : <FileText className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-neutral-800 dark:text-neutral-200 truncate">{capture.title || 'Untitled capture'}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-neutral-400 flex items-center gap-1">
                        <User className="w-2.5 h-2.5" />
                        {ownerLabel(capture.ownerId, ownerOptions)}
                      </span>
                      <span className="text-[9px] text-neutral-400">{formatCaptureAge(capture.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Preview */}
                {(capture.bodyText || capture.note) && (
                  <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400 line-clamp-2 pl-6">
                    {capture.note ? `${capture.note} — ` : ''}{capture.bodyText}
                  </p>
                )}

                {/* Attachments / URLs preview */}
                {(capture.attachments?.length > 0 || capture.urls?.length > 0) && (
                  <div className="flex flex-wrap gap-1 pl-6">
                    {capture.attachments?.slice(0, 2).map((a: any) => (
                      <span key={a.id} className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-900 text-neutral-500 font-bold truncate max-w-[140px]">{a.name}</span>
                    ))}
                    {capture.urls?.slice(0, 1).map((url: string) => (
                      <span key={url} className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-900 text-neutral-500 font-bold truncate max-w-[160px]">{url}</span>
                    ))}
                  </div>
                )}

                {/* Agent picker + Chat CTA */}
                <div className="flex items-center gap-2 pl-6">
                  <select
                    value={captureAgents[capture.id] ?? activeAgentId}
                    onChange={e => setCaptureAgents(prev => ({ ...prev, [capture.id]: e.target.value }))}
                    className="min-w-0 flex-1 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none"
                  >
                    {assistants.map((a: any) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => openChatWithCapture(capture)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4A5D75] hover:bg-[#3D4D61] text-white text-[10px] font-black uppercase tracking-widest transition-colors shrink-0"
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
