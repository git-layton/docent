import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  FileText, FilePlus, Trash2, FolderInput, ArrowRight, Check, X, ShieldAlert,
  Loader2, FileSearch, FolderTree, AlertTriangle,
} from 'lucide-react';
import { useMemoryStore } from '../store/useMemoryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSpaceStore } from '../store/useSpaceStore';
import { classifyOp, isPreapproved, effectOf, makeGrant } from '../services/fileAccess/consent';
import { resolveWorkspaceOpPaths } from '../services/fileAccess/spaces';
import type { FileOp, OpTier, GrantScope } from '../services/fileAccess/types';

// Auto-apply must be idempotent across React re-renders (chat messages re-render constantly while
// streaming / scrolling). We key by the stable message-block id so a workspace write fires exactly once.
const handled = new Set<string>();

interface Props {
  op: FileOp;
  opKey: string;
  streaming: boolean;
  onToast: (msg: string) => void;
  /** SEC-AUTOAPPLY: when the producing turn ingested untrusted-external content, workspace mutations
   *  must NOT auto-apply (even under a standing grant) — they route to the preview/approve path. */
  forcePreview?: boolean;
}

type Phase = 'idle' | 'preview' | 'running' | 'done' | 'denied' | 'error';

const VERB: Record<string, string> = {
  write: 'Write', create: 'Create', delete: 'Delete', move: 'Move',
  import: 'Import', read: 'Read', list: 'List', command: 'Run',
};

function ActionIcon({ action }: { action: string }) {
  const cls = 'w-4 h-4';
  if (action === 'delete') return <Trash2 className={cls} />;
  if (action === 'create' || action === 'write') return <FilePlus className={cls} />;
  if (action === 'move') return <ArrowRight className={cls} />;
  if (action === 'import') return <FolderInput className={cls} />;
  if (action === 'list') return <FolderTree className={cls} />;
  if (action === 'read') return <FileSearch className={cls} />;
  return <FileText className={cls} />;
}

/** Map an op to its Rust command. Returns { ok, detail, content? }. */
async function runOp(op: FileOp, tier: OpTier): Promise<{ ok: boolean; detail: string; content?: string }> {
  const ext = tier === 'external';
  try {
    switch (op.action) {
      case 'write':
      case 'create': {
        const r = await invoke<any>(ext ? 'fs_write_external' : 'fs_write', { path: op.path, content: op.content ?? '' });
        return { ok: !!r?.ok, detail: r?.ok ? `Wrote ${op.path}` : (r?.error ?? 'write failed') };
      }
      case 'delete': {
        const r = await invoke<any>(ext ? 'fs_delete_external' : 'fs_delete', { path: op.path });
        return { ok: !!r?.ok, detail: r?.ok ? `Deleted ${op.path}` : (r?.error ?? 'delete failed') };
      }
      case 'move': {
        const r = await invoke<any>('fs_move', { from: op.path, to: op.to });
        return { ok: !!r?.ok, detail: r?.ok ? `Moved to ${op.to}` : (r?.error ?? 'move failed') };
      }
      case 'import': {
        const r = await invoke<any>('fs_import', { sourcePath: op.source, destName: op.to });
        return { ok: !!r?.ok, detail: r?.ok ? `Imported → ${r.path}` : (r?.error ?? 'import failed') };
      }
      case 'read': {
        const r = await invoke<any>(ext ? 'fs_read_external' : 'fs_read', { path: op.path });
        return { ok: !!r?.ok, detail: r?.ok ? `Read ${op.path}` : (r?.error ?? 'read failed'), content: r?.content };
      }
      case 'list': {
        const r = await invoke<any>(ext ? 'fs_list_external' : 'fs_list', { path: op.path ?? '' });
        const names = (r?.entries ?? []).map((e: any) => (e.isDir ? `${e.path}/` : e.path)).join('\n');
        return { ok: !!r?.ok, detail: r?.ok ? `${(r?.entries ?? []).length} entries` : (r?.error ?? 'list failed'), content: names };
      }
      default:
        return { ok: false, detail: `Unsupported action: ${op.action}` };
    }
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? String(e) };
  }
}

export function FileActionCard({ op, opKey, streaming, onToast, forcePreview }: Props) {
  const agentForgePath = useMemoryStore(s => s.agentForgePath);
  const grants = useSettingsStore(s => s.appSettings.fileAccessGrants);
  const workspaceRoot = agentForgePath ? `${agentForgePath}/workspace` : '/__no_workspace__';

  const tier = classifyOp(op, workspaceRoot);
  const preapproved = tier !== 'invalid' && isPreapproved(op, workspaceRoot, grants);

  // Workspace-tier ops land in the ACTIVE SPACE's home folder (spaces/<id>/…), matching the human
  // panel. Relative paths get the space prefix; absolute/external paths are untouched. No active
  // space ⇒ no prefix (today's behavior). Classification stays on the original op above — a prefixed
  // relative path is still workspace-tier — and a space ≈ a project, so its folder is the agent's desk.
  const activeSpaceId = useSpaceStore.getState().activeSpaceId;
  const resolved = resolveWorkspaceOpPaths(op, tier, activeSpaceId);

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<string>('');
  const [readOut, setReadOut] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  const finish = useCallback((ok: boolean, detail: string, content?: string) => {
    // Log the RESOLVED path so the activity receipt matches where the op actually landed.
    useSettingsStore.getState().logFileActivity({
      id: opKey, action: op.action, path: resolved.path ?? resolved.to ?? '', tier, ok, detail, at: Date.now(),
    });
    if (content !== undefined && (op.action === 'read' || op.action === 'list')) setReadOut(content);
    setResult(detail);
    setPhase(ok ? 'done' : 'error');
  }, [op, opKey, tier, resolved]);

  const apply = useCallback(async (scope?: GrantScope) => {
    setPhase('running');
    // External grants are keyed off the absolute target, which the space prefix never touches.
    const target = op.action === 'import' ? op.source : op.path;
    if (scope && scope !== 'once' && target) {
      useSettingsStore.getState().addFileGrant(makeGrant(target, scope, effectOf(op.action), Date.now()));
    }
    const r = await runOp(resolved, tier);
    finish(r.ok, r.detail, r.content);
    if (!r.ok) onToast(`File op failed: ${r.detail}`);
  }, [op, resolved, tier, finish, onToast]);

  // Auto-apply workspace ops (and anything a remembered grant already covers) — exactly once.
  useEffect(() => {
    if (tier === 'invalid') return;
    if (streaming) return;
    // SEC-AUTOAPPLY: if the producing turn ingested untrusted content, a workspace MUTATION must not
    // auto-apply (even under a standing grant) — route it to preview/approve. Reads/lists are harmless.
    const isMutation = op.action === 'write' || op.action === 'create' || op.action === 'delete' || op.action === 'move' || op.action === 'import';
    if (forcePreview && isMutation) { setPhase('preview'); return; }
    if (!(tier === 'workspace' || preapproved)) { setPhase('preview'); return; }
    if (handled.has(opKey)) { if (phase === 'idle') setPhase('done'); return; }
    handled.add(opKey);
    void apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, opKey, tier, preapproved, forcePreview]);

  // For external write/delete we read the current contents so the user sees the actual change.
  useEffect(() => {
    if (phase !== 'preview' || current !== null) return;
    if (!(tier === 'external' && (op.action === 'write' || op.action === 'delete'))) return;
    invoke<any>('fs_read_external', { path: op.path })
      .then(r => setCurrent(r?.ok ? (r.content ?? '') : ''))
      .catch(() => setCurrent(''));
  }, [phase, tier, op, current]);

  if (tier === 'invalid') {
    return (
      <div className="my-3 p-3 rounded-xl border border-danger/40 bg-danger-soft/30 flex items-center gap-2 text-xs font-bold text-danger">
        <AlertTriangle className="w-4 h-4" /> Malformed file operation — not run.
      </div>
    );
  }

  const filename = (op.path ?? op.to ?? op.source ?? '').split('/').pop() || op.path || '';
  const verb = VERB[op.action] ?? op.action;
  const needsConsent = tier === 'external' && !preapproved;

  if (phase === 'denied') {
    return (
      <div className="my-3 p-3 rounded-xl border border-edge-2 bg-inset flex items-center gap-2 text-xs font-bold text-ink-3">
        <X className="w-4 h-4" /> Denied — {verb.toLowerCase()} {filename} was not run.
      </div>
    );
  }

  // Compact status chip: workspace auto-apply (idle/running), finished reads/lists, completed ops.
  if (!needsConsent || phase === 'running' || phase === 'done' || phase === 'error') {
    const busy = phase === 'idle' || phase === 'running';
    const ok = phase === 'done';
    return (
      <div className={`my-3 p-3 rounded-xl border text-xs ${ok ? 'border-success/30 bg-success-soft/20 text-ink-2' : busy ? 'border-edge-2 bg-inset text-ink-2' : 'border-danger/40 bg-danger-soft/30 text-danger'}`}>
        <div className="flex items-center gap-2 font-bold">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : ok ? <Check className="w-4 h-4 text-success" /> : <X className="w-4 h-4" />}
          <ActionIcon action={op.action} />
          <span>{busy ? `${verb}…` : result}</span>
          <span className="ml-auto text-[10px] uppercase tracking-widest text-ink-3">{tier}</span>
        </div>
        {readOut !== null && (
          <pre className="mt-2 max-h-48 overflow-auto text-[11px] font-mono bg-inset rounded-lg p-2 whitespace-pre-wrap text-ink-2">{readOut || '(empty)'}</pre>
        )}
      </div>
    );
  }

  // External op awaiting consent — show the actual change + scope ladder.
  const isWrite = op.action === 'write' || op.action === 'create';
  const isDelete = op.action === 'delete';
  const danger = isDelete;
  const canFolderGrant = effectOf(op.action) === 'read' || isWrite || isDelete;

  return (
    <div className={`my-3 rounded-xl border-2 overflow-hidden ${danger ? 'border-danger/40' : 'border-warning/40'}`}>
      <div className={`px-4 py-3 flex items-center gap-2 ${danger ? 'bg-danger-soft/40' : 'bg-warning-soft/40'}`}>
        <ShieldAlert className={`w-4 h-4 ${danger ? 'text-danger' : 'text-warning'}`} />
        <span className={`text-xs font-black uppercase tracking-widest ${danger ? 'text-danger' : 'text-warning'}`}>
          Approve file access
        </span>
        <span className="ml-auto flex items-center gap-2 text-[10px] font-bold tracking-widest">
          {forcePreview && <span className="text-danger flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> Prompted by on-screen content</span>}
          <span className="text-ink-3 flex items-center gap-1 uppercase"><AlertTriangle className="w-3 h-3" /> outside workspace</span>
        </span>
      </div>
      <div className="px-4 py-3 bg-panel-2">
        <div className="flex items-center gap-2 text-sm font-bold text-ink">
          <ActionIcon action={op.action} />
          {verb} <span className="font-mono text-[12px] text-ink-2 break-all">{op.path ?? op.source}</span>
          {op.to && <><ArrowRight className="w-3 h-3 text-ink-3" /> <span className="font-mono text-[12px] text-ink-2 break-all">{op.to}</span></>}
        </div>
        {op.summary && <p className="mt-1 text-xs text-ink-2">{op.summary}</p>}

        {/* Show the actual change */}
        {isWrite && (
          <div className="mt-3 grid grid-cols-1 gap-2">
            {current ? (
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1">Current</div>
                <pre className="max-h-32 overflow-auto text-[11px] font-mono bg-inset rounded-lg p-2 whitespace-pre-wrap text-danger/80">{current.slice(0, 4000)}</pre>
              </div>
            ) : null}
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-ink-3 mb-1">{current ? 'Proposed' : 'New file'}</div>
              <pre className="max-h-40 overflow-auto text-[11px] font-mono bg-inset rounded-lg p-2 whitespace-pre-wrap text-success">{(op.content ?? '').slice(0, 4000)}</pre>
            </div>
          </div>
        )}
        {isDelete && current !== null && (
          <pre className="mt-3 max-h-40 overflow-auto text-[11px] font-mono bg-inset rounded-lg p-2 whitespace-pre-wrap text-danger/80">{current.slice(0, 4000) || `(${filename})`}</pre>
        )}

        {/* Scope ladder, narrowest first */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => { setPhase('denied'); }} className="px-3 py-2 rounded-lg border border-edge-2 text-xs font-bold text-ink-2 hover:bg-wash transition-all">
            Deny
          </button>
          <button onClick={() => apply('once')} className={`px-3 py-2 rounded-lg text-xs font-bold text-on-accent transition-all active:scale-95 ${danger ? 'bg-danger' : 'bg-accent hover:bg-accent-strong'}`}>
            Just this once
          </button>
          <button onClick={() => apply('file')} className="px-3 py-2 rounded-lg border border-edge-2 text-xs font-bold text-ink-2 hover:bg-wash transition-all">
            This file
          </button>
          {canFolderGrant && (
            <button onClick={() => apply('folder')} className="px-3 py-2 rounded-lg border border-edge-2 text-xs font-bold text-ink-2 hover:bg-wash transition-all">
              This folder
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
