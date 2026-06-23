import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Terminal, Check, X, Loader2, ShieldAlert, Lock, FolderGit2 } from 'lucide-react';
import { useMemoryStore } from '../store/useMemoryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { findGrant, makeGrant } from '../services/fileAccess/consent';
import type { FileOp } from '../services/fileAccess/types';

// Idempotent auto-run for commands already covered by an "Always in this repo" grant.
const handled = new Set<string>();

interface Props {
  op: FileOp;
  opKey: string;
  streaming: boolean;
  onToast: (msg: string) => void;
}

type Phase = 'idle' | 'gate' | 'preview' | 'running' | 'done' | 'denied' | 'error';

export function CommandActionCard({ op, opKey, streaming, onToast }: Props) {
  const agentForgePath = useMemoryStore(s => s.agentForgePath);
  const developerMode = useSettingsStore(s => s.appSettings.developerMode);
  const grants = useSettingsStore(s => s.appSettings.fileAccessGrants);

  const command = (op.command ?? '').trim();
  const cwd = op.cwd && op.cwd.trim().length > 0 ? op.cwd : (agentForgePath ? `${agentForgePath}/workspace` : '');
  // SEC-GRANTS: command auto-run requires a dedicated, unexpired COMMAND grant — a file-write grant in
  // the repo no longer silently authorizes arbitrary shell.
  const preapproved = !!developerMode && findGrant(grants, cwd, 'command', Date.now())?.scope === 'folder';

  const [phase, setPhase] = useState<Phase>('idle');
  const [out, setOut] = useState<{ stdout: string; stderr: string; code: number | null } | null>(null);

  const run = useCallback(async (remember?: boolean) => {
    if (remember && cwd) {
      // A command-scoped grant (not file-write), expiring in 24h so standing shell authority lapses.
      useSettingsStore.getState().addFileGrant(makeGrant(cwd, 'folder', 'command', Date.now(), 24 * 60 * 60 * 1000));
    }
    setPhase('running');
    try {
      const r = await invoke<any>('run_command', { command, cwd });
      const result = { stdout: r?.stdout ?? '', stderr: r?.stderr ?? '', code: r?.code ?? null };
      setOut(result);
      const ok = !!r?.ok;
      setPhase(ok ? 'done' : 'error');
      useSettingsStore.getState().logFileActivity({
        id: opKey, action: 'command', path: cwd, tier: 'command', ok,
        detail: `$ ${command}`, at: Date.now(),
      });
      if (!ok) onToast(`Command exited ${result.code ?? '?'}`);
    } catch (e: any) {
      setOut({ stdout: '', stderr: e?.message ?? String(e), code: null });
      setPhase('error');
      onToast(`Command failed: ${e?.message ?? e}`);
    }
  }, [command, cwd, opKey, onToast]);

  useEffect(() => {
    if (streaming || !command) return;
    if (!developerMode) { setPhase('gate'); return; }
    if (preapproved) {
      if (handled.has(opKey)) return;
      handled.add(opKey);
      // Ensure the backend DEV_MODE mirror is set BEFORE auto-running — otherwise a boot-time auto-run
      // can race the App.tsx sync effect and run_command rejects with "Developer Mode is disabled"
      // even though the UI shows it on.
      void (async () => {
        await invoke('set_developer_mode', { on: true }).catch(() => {});
        await run();
      })();
      return;
    }
    setPhase('preview');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, command, developerMode, preapproved, opKey]);

  if (!command) {
    return (
      <div className="my-3 p-3 rounded-xl border border-danger/40 bg-danger-soft/30 flex items-center gap-2 text-xs font-bold text-danger">
        <X className="w-4 h-4" /> Empty command — not run.
      </div>
    );
  }

  // Developer Mode gate
  if (phase === 'gate') {
    return (
      <div className="my-3 rounded-xl border border-edge-2 bg-inset overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2">
          <Lock className="w-4 h-4 text-ink-3" />
          <span className="text-xs font-black uppercase tracking-widest text-ink-2">Developer Mode is off</span>
        </div>
        <div className="px-4 pb-3">
          <p className="text-xs text-ink-2 mb-1">The agent wanted to run a command, but command execution is disabled.</p>
          <pre className="text-[11px] font-mono bg-panel-2 rounded-lg p-2 mb-2 whitespace-pre-wrap text-ink-3">$ {command}</pre>
          <button
            onClick={() => { useSettingsStore.getState().setProfileSettingsTab('advanced'); useSettingsStore.getState().setShowProfileSettings(true); }}
            className="px-3 py-2 rounded-lg border border-edge-2 text-xs font-bold text-ink-2 hover:bg-wash transition-all"
          >
            Open Settings → Advanced
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'denied') {
    return (
      <div className="my-3 p-3 rounded-xl border border-edge-2 bg-inset flex items-center gap-2 text-xs font-bold text-ink-3">
        <X className="w-4 h-4" /> Command denied — not run.
      </div>
    );
  }

  if (phase === 'running' || phase === 'done' || phase === 'error' || (preapproved && phase === 'idle')) {
    const busy = phase === 'running' || phase === 'idle';
    const ok = phase === 'done';
    return (
      <div className={`my-3 rounded-xl border overflow-hidden ${ok ? 'border-success/30' : busy ? 'border-edge-2' : 'border-danger/40'}`}>
        <div className={`px-4 py-2.5 flex items-center gap-2 ${ok ? 'bg-success-soft/20' : busy ? 'bg-inset' : 'bg-danger-soft/30'}`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin text-ink-2" /> : ok ? <Check className="w-4 h-4 text-success" /> : <X className="w-4 h-4 text-danger" />}
          <Terminal className="w-4 h-4 text-ink-2" />
          <span className="text-xs font-mono font-bold text-ink-2 break-all">$ {command}</span>
          {out?.code != null && <span className="ml-auto text-[10px] font-bold text-ink-3">exit {out.code}</span>}
        </div>
        {out && (out.stdout || out.stderr) && (
          <pre className="max-h-56 overflow-auto text-[11px] font-mono bg-panel-2 p-3 whitespace-pre-wrap text-ink-2">
            {out.stdout}
            {out.stderr && <span className="text-danger">{out.stderr}</span>}
          </pre>
        )}
      </div>
    );
  }

  // Awaiting approval
  return (
    <div className="my-3 rounded-xl border-2 border-warning/40 overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 bg-warning-soft/40">
        <ShieldAlert className="w-4 h-4 text-warning" />
        <span className="text-xs font-black uppercase tracking-widest text-warning">Approve command</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-ink-3"><FolderGit2 className="w-3 h-3" /> {cwd.split('/').slice(-2).join('/')}</span>
      </div>
      <div className="px-4 py-3 bg-panel-2">
        {op.summary && <p className="text-xs text-ink-2 mb-2">{op.summary}</p>}
        <pre className="text-[12px] font-mono bg-inset rounded-lg p-2.5 mb-1 whitespace-pre-wrap text-ink break-all">$ {command}</pre>
        <p className="text-[10px] text-ink-3 mb-3 font-mono break-all">in {cwd}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setPhase('denied')} className="px-3 py-2 rounded-lg border border-edge-2 text-xs font-bold text-ink-2 hover:bg-wash transition-all">Deny</button>
          <button onClick={() => run(false)} className="px-3 py-2 rounded-lg bg-accent hover:bg-accent-strong text-on-accent text-xs font-bold transition-all active:scale-95">Run once</button>
          <button onClick={() => run(true)} title="Auto-run commands in this repo for 24 hours, then you'll be asked again." className="px-3 py-2 rounded-lg border border-edge-2 text-xs font-bold text-ink-2 hover:bg-wash transition-all">Trust this repo (24h)</button>
        </div>
      </div>
    </div>
  );
}
