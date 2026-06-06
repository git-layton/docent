import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Image,
  Inbox,
  Link,
  Loader2,
  Play,
  RefreshCw,
  Send,
  User,
} from 'lucide-react';
import { useAgentStore } from '../store/useAgentStore';
import { useChatStore } from '../store/useChatStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { normalizeChatRecord } from '../services/channels';
import { generateTextResponse } from '../services/llm';
import { evaluateMemoryGate } from '../services/memoryGatekeeper';
import {
  buildCaptureMarkdown,
  DEFAULT_INBOX_OWNERS,
  formatCaptureAge,
  inferCaptureKind,
  mergeInboxOwners,
  normalizeInboxOwners,
  ownerLabel,
  slugifyCapture,
  type CaptureItem,
} from '../services/inbox';

interface InboxPanelProps {
  agentForgePath: string;
  activeAgentId: string;
  onToast: (msg: string) => void;
}

const emptyTriage = (capture: CaptureItem) => ({
  title: capture.title || 'Inbox Capture',
  summary: capture.bodyText || capture.note || 'Captured item saved for later review.',
  facts: [] as string[],
  tags: ['inbox', capture.kind || 'capture'],
  tasks: [] as string[],
});

function parseJsonObject(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function fileToPayload(file: File): Promise<{ name: string; mimeType: string; dataBase64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const data = String(reader.result ?? '');
      resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: data });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function statusStyle(status: string) {
  if (status === 'saved') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900';
  if (status === 'failed') return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900';
  if (status === 'processing') return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900';
  if (status === 'needs_review') return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900';
  return 'bg-neutral-50 text-neutral-600 border-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:border-neutral-800';
}

export function InboxPanel({ agentForgePath, activeAgentId, onToast }: InboxPanelProps) {
  const assistants = useAgentStore(s => s.assistants);
  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);
  const appSettings = useSettingsStore(s => s.appSettings);
  const integrations = useSettingsStore(s => s.integrations);
  const userProfile = useSettingsStore(s => s.userProfile);
  const chats = useChatStore(s => s.chats);

  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [quickText, setQuickText] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [quickOwner, setQuickOwner] = useState<string>('primary');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedModel = models.find((m: any) => m.id === selectedModelId) ?? models[0];
  const activeAgent = assistants.find((a: any) => a.id === activeAgentId) ?? assistants[0];
  const configuredOwners = useMemo(() => normalizeInboxOwners(appSettings.inboxOwners), [appSettings.inboxOwners]);
  const ownerOptions = useMemo(() => mergeInboxOwners(configuredOwners, captures), [configuredOwners, captures]);
  const channels = useMemo(
    () => chats.map((chat: any) => normalizeChatRecord(chat, activeAgentId)).filter((chat: any) => chat.kind === 'channel'),
    [chats, activeAgentId],
  );

  useEffect(() => {
    if (!ownerOptions.some(owner => owner.id === quickOwner)) {
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

  useEffect(() => {
    loadCaptures();
  }, [ownerFilter]);

  function targetFor(capture: CaptureItem) {
    if (capture.targetKind === 'library') return 'library:library';
    if (capture.channelId) return `channel:${capture.channelId}`;
    if (capture.agentId) return `agent:${capture.agentId}`;
    const hint = capture.channelHint?.toLowerCase().trim();
    const hinted = hint
      ? channels.find((c: any) => c.id.toLowerCase() === hint || c.name.toLowerCase().includes(hint))
      : null;
    if (hinted) return `channel:${hinted.id}`;
    return `agent:${activeAgentId}`;
  }

  async function patchCapture(capture: CaptureItem, patch: Partial<CaptureItem>) {
    const result = await invoke<{ ok: boolean; capture?: CaptureItem; error?: string }>('update_inbox_capture', {
      ownerId: capture.ownerId,
      captureId: capture.id,
      patch,
    });
    if (!result.ok) throw new Error(result.error ?? 'Could not update capture');
    if (result.capture) {
      setCaptures(prev => prev.map(c => c.id === capture.id ? result.capture! : c));
    }
    return result.capture;
  }

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
      const attachments = await Promise.all(Array.from(files).map(fileToPayload));
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

  async function readImageAttachments(capture: CaptureItem) {
    const imageAttachments = (capture.attachments ?? [])
      .filter(a => a.mimeType?.startsWith('image/'))
      .slice(0, 4);
    const files = [];
    for (const attachment of imageAttachments) {
      const result = await invoke<{ ok: boolean; name: string; mimeType: string; dataUrl: string; error?: string }>('read_inbox_attachment', {
        ownerId: capture.ownerId,
        captureId: capture.id,
        attachmentId: attachment.id,
      }).catch(() => null);
      if (result?.ok) {
        files.push({ name: result.name, type: result.mimeType, content: result.dataUrl, isImage: true });
      }
    }
    return files;
  }

  async function runTriage(capture: CaptureItem) {
    const attachments = capture.attachments?.length
      ? capture.attachments.map(a => `- ${a.name} (${a.mimeType || 'file'}, ${a.size} bytes)`).join('\n')
      : '- None';
    const urls = capture.urls?.length ? capture.urls.map(url => `- ${url}`).join('\n') : '- None';
    const prompt = `Triage this Forge Inbox capture. Return ONLY valid JSON with keys: title, summary, facts, tags, tasks.\n\nRules:\n- Keep title under 80 characters.\n- Summary should be direct and useful.\n- Facts are durable facts worth remembering and must be directly visible in the capture, note, URL list, or attachment text/image.\n- Do not turn guesses, OCR uncertainty, or your own interpretation into facts.\n- Tags are lowercase short words.\n- Tasks are possible to-dos, not commands to execute.\n\nOwner: ${ownerLabel(capture.ownerId, ownerOptions)}\nInstance: ${capture.instanceId || '(none)'}\nShare route: ${capture.shareId || '(none)'}\nDevice: ${capture.deviceName || '(none)'}\nSource: ${capture.source}\nKind: ${capture.kind}\nNote: ${capture.note || '(none)'}\nChannel hint: ${capture.channelHint || '(none)'}\nURLs:\n${urls}\nAttachments:\n${attachments}\nText:\n${capture.bodyText || '(no text)'}`;

    const imageFiles = await readImageAttachments(capture);
    const agent = {
      id: 'forge-inbox-triage',
      name: 'Forge Inbox Triage',
      prompt: 'You turn raw captures into concise, auditable notes. Separate observed facts from interpretation. Do not invent details that are not visible in the capture.',
      tools: {},
      trainingDocs: [],
      awareOfProfile: true,
    };

    const response = await generateTextResponse({
      messages: [{ role: 'user', content: prompt, attachedFiles: imageFiles }],
      modelConfig: selectedModel,
      profile: userProfile,
      attachedDocs: [],
      agent,
      tasks: [],
      mode: 'text',
      canvasContent: null,
      isDeepThinking: false,
      agentPinnedMessages: [],
      signal: null,
      appSettings,
      integrations,
      models,
    });
    const parsed = parseJsonObject(response);
    if (!parsed) return emptyTriage(capture);
    return {
      title: String(parsed.title ?? capture.title ?? 'Inbox Capture').slice(0, 120),
      summary: String(parsed.summary ?? capture.bodyText ?? capture.note ?? 'Captured item saved for later review.'),
      facts: Array.isArray(parsed.facts) ? parsed.facts.map((f: any) => String(f)).filter(Boolean).slice(0, 12) : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t).toLowerCase()).filter(Boolean).slice(0, 12) : ['inbox'],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map((t: any) => String(t)).filter(Boolean).slice(0, 8) : [],
    };
  }

  async function processCapture(capture: CaptureItem) {
    if (!selectedModel) {
      onToast('Pick a model before processing Inbox captures.');
      return;
    }
    setProcessingIds(prev => new Set(prev).add(capture.id));
    try {
      await patchCapture(capture, { status: 'processing', error: '' } as any);
      const refreshed = captures.find(c => c.id === capture.id) ?? capture;
      const target = targetFor(refreshed);
      const [targetType, targetId] = target.split(':');
      const targetAgent = assistants.find((a: any) => a.id === targetId) ?? activeAgent;
      const targetChannel = channels.find((c: any) => c.id === targetId);
      const triage = await runTriage(refreshed);
      const gatekeeperDecision = evaluateMemoryGate({
        text: [
          refreshed.title,
          refreshed.note,
          refreshed.channelHint,
          refreshed.bodyText,
          triage.summary,
          ...triage.facts,
          ...triage.tasks,
        ].filter(Boolean).join('\n'),
        channelId: targetType === 'channel' ? targetId : undefined,
        agentId: targetType === 'agent' ? targetId : undefined,
        sourceUrls: refreshed.urls ?? [],
        attachedFiles: refreshed.attachments?.map(a => ({
          name: a.name,
          type: a.mimeType,
          isImage: a.mimeType?.startsWith('image/'),
        })) ?? [],
      });
      if (!gatekeeperDecision.shouldSave) {
        await patchCapture(refreshed, {
          status: 'needs_review',
          title: triage.title,
          summary: `Gatekeeper held this for review: ${gatekeeperDecision.reason}`,
          tags: gatekeeperDecision.tags,
          error: '',
        } as any);
        onToast('Gatekeeper held this capture for review.');
        return;
      }
      const tasksBlock = triage.tasks.length
        ? `\n\n## Possible Tasks\n${triage.tasks.map((t: string) => `- ${t}`).join('\n')}\n`
        : '';
      const targetLabel = targetType === 'channel'
        ? `channel:${targetChannel?.name ?? targetId}`
        : targetType === 'library'
          ? 'library'
          : `agent:${targetAgent?.name ?? targetId}`;
      const content = buildCaptureMarkdown({
        capture: { ...refreshed, title: triage.title },
        summary: `${triage.summary}${tasksBlock}`,
        facts: triage.facts,
        tags: triage.tags,
        targetLabel,
        gatekeeperDecision,
      });
      const slug = slugifyCapture(triage.title || refreshed.title);
      const basePath = targetType === 'channel'
        ? `${agentForgePath}/memory/channels/${targetId}/inbox`
        : targetType === 'library'
          ? `${agentForgePath}/library/inbox`
          : `${agentForgePath}/memory/${targetId}/inbox`;
      const path = `${basePath}/${slug}-${refreshed.createdAt || Date.now()}.md`;
      const writeResult = await invoke<{ blocked: boolean; commit: string | null; error?: string }>('write_memory', {
        path,
        content,
        commitMessage: `inbox: ${triage.title}`,
        agentId: targetType === 'agent' ? targetId : activeAgentId,
        contextTokens: null,
        ramState: null,
      });
      if (writeResult.blocked) {
        throw new Error(writeResult.error ?? 'Nuke Shield blocked the Inbox write');
      }
      await patchCapture(refreshed, {
        status: 'saved',
        title: triage.title,
        summary: triage.summary,
        tags: Array.from(new Set([...triage.tags, ...gatekeeperDecision.tags])),
        processedPaths: [path],
        channelId: targetType === 'channel' ? targetId : '',
        agentId: targetType === 'agent' ? targetId : '',
        targetKind: targetType as any,
        error: '',
      } as any);
      onToast('Inbox capture processed and saved.');
    } catch (e: any) {
      await patchCapture(capture, { status: 'failed', error: e?.message ?? String(e) } as any).catch(() => {});
      onToast(`Processing failed: ${e?.message ?? String(e)}`);
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(capture.id);
        return next;
      });
      loadCaptures();
    }
  }

  async function processAll() {
    const todo = captures.filter(c => c.status !== 'saved' && c.status !== 'processing');
    for (const capture of todo) {
      await processCapture(capture);
    }
  }

  async function updateTarget(capture: CaptureItem, target: string) {
    const [type, id] = target.split(':');
    await patchCapture(capture, {
      channelId: type === 'channel' ? id : '',
      agentId: type === 'agent' ? id : '',
      targetKind: type as any,
    } as any).catch((e: any) => onToast(`Could not update target: ${e?.message ?? String(e)}`));
  }

  const visible = captures;
  const pendingCount = captures.filter(c => c.status !== 'saved').length;

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-xl border border-[#4A5D75]/20 bg-[#4A5D75]/5 dark:bg-[#4A5D75]/10 p-3">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[#4A5D75] dark:text-[#9EADC8]">
          <Inbox className="w-4 h-4" />
          Forge Inbox
        </div>
        <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
          Raw captures stay here first. Processing saves derived notes into agent memory, channel memory, or library.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900">
        {['all', ...ownerOptions.map(owner => owner.id)].map(owner => (
          <button
            key={owner}
            onClick={() => setOwnerFilter(owner)}
            className={`py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${ownerFilter === owner ? 'bg-white dark:bg-neutral-800 text-[#4A5D75] shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}
          >
            {owner === 'all' ? 'All' : ownerLabel(owner, ownerOptions)}
          </button>
        ))}
      </div>

      <div className="space-y-2 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
        <div className="flex items-center gap-2">
          <select
            value={quickOwner}
            onChange={e => setQuickOwner(e.target.value)}
            className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-2 py-1.5 text-[11px] font-bold outline-none"
          >
            {ownerOptions.map(owner => <option key={owner.id} value={owner.id}>{owner.label}</option>)}
          </select>
          <input
            value={quickNote}
            onChange={e => setQuickNote(e.target.value)}
            placeholder="optional note or channel hint"
            className="min-w-0 flex-1 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-2 py-1.5 text-[11px] outline-none"
          />
        </div>
        <textarea
          value={quickText}
          onChange={e => setQuickText(e.target.value)}
          placeholder="drop a quick raw capture here"
          rows={3}
          className="w-full resize-none bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-2 text-xs outline-none"
        />
        <div className="flex gap-2">
          <button onClick={addTextCapture} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#4A5D75] hover:bg-[#3D4D61] text-white text-[10px] font-black uppercase tracking-widest transition-colors">
            <Send className="w-3.5 h-3.5" />
            Add Text
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-300 text-[10px] font-black uppercase tracking-widest hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors">
            <FileText className="w-3.5 h-3.5" />
            Add File
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={loadCaptures} disabled={isLoading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-[10px] font-black uppercase tracking-widest text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50">
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
        <button onClick={processAll} disabled={processingIds.size > 0 || pendingCount === 0} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#D4AA7D] hover:bg-[#BE966B] text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-50 disabled:hover:bg-[#D4AA7D]">
          <Play className="w-3.5 h-3.5" />
          Process All ({pendingCount})
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-neutral-400 text-xs">Loading captures...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-neutral-400">
          <Inbox className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-xs font-bold">No captures yet.</p>
          <p className="text-[10px] mt-1 opacity-70">Use the Shortcut or add a local capture above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(capture => {
            const isBusy = processingIds.has(capture.id) || capture.status === 'processing';
            return (
              <div key={`${capture.ownerId}-${capture.id}`} className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden bg-white dark:bg-neutral-950">
                <div className="p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    {capture.kind === 'image' || capture.attachments?.some(a => a.mimeType?.startsWith('image/'))
                      ? <Image className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                      : capture.urls?.length
                        ? <Link className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                        : <FileText className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-neutral-800 dark:text-neutral-200 truncate">{capture.title || 'Untitled capture'}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-neutral-400">
                          <User className="w-3 h-3" />
                          {ownerLabel(capture.ownerId, ownerOptions)}
                        </span>
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusStyle(capture.status)}`}>
                          {capture.status.replace('_', ' ')}
                        </span>
                        <span className="text-[9px] text-neutral-400">{formatCaptureAge(capture.createdAt)}</span>
                      </div>
                    </div>
                    {capture.status === 'saved' && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                    {capture.status === 'failed' && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
                  </div>

                  {capture.bodyText && <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400 line-clamp-3">{capture.bodyText}</p>}
                  {capture.note && <p className="text-[10px] leading-relaxed text-[#4A5D75] dark:text-[#9EADC8]">Note: {capture.note}</p>}
                  {capture.summary && <p className="text-[10px] leading-relaxed text-emerald-700 dark:text-emerald-300">Saved: {capture.summary}</p>}
                  {capture.error && <p className="text-[10px] leading-relaxed text-red-500">Error: {capture.error}</p>}

                  <div className="flex flex-wrap gap-1">
                    {(capture.attachments ?? []).slice(0, 3).map(a => (
                      <span key={a.id} className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-900 text-neutral-500 font-bold truncate max-w-[130px]">
                        {a.name}
                      </span>
                    ))}
                    {(capture.urls ?? []).slice(0, 2).map(url => (
                      <span key={url} className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-900 text-neutral-500 font-bold truncate max-w-[160px]">
                        {url}
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <select
                      value={targetFor(capture)}
                      onChange={e => updateTarget(capture, e.target.value)}
                      disabled={isBusy}
                      className="min-w-0 flex-1 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none disabled:opacity-60"
                    >
                      <option value={`agent:${activeAgentId}`}>Agent: {activeAgent?.name ?? 'Assistant'}</option>
                      {assistants.map((agent: any) => <option key={agent.id} value={`agent:${agent.id}`}>Agent: {agent.name}</option>)}
                      {channels.map((channel: any) => <option key={channel.id} value={`channel:${channel.id}`}>Channel: {channel.name}</option>)}
                      <option value="library:library">Library</option>
                    </select>
                    <button
                      onClick={() => processCapture(capture)}
                      disabled={isBusy}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4A5D75] hover:bg-[#3D4D61] text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                    >
                      {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      Process
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
