import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Live interactive terminal over the Rust PTY backend (src-tauri/src/pty.rs). One xterm.js instance
// per mount, bound to one PTY session (session_id). The Rust side streams raw bytes as base64 over the
// `pty:data` event and signals end-of-stream over `pty:exit`; keystrokes flow back via `pty_write`.
// Resizes are mirrored both to xterm (fit) and the PTY (`pty_resize`) so line-wrapping stays correct.
// Without Tauri (plain browser/test), there is no shell to host, so we degrade to an explainer.

const hasTauri = typeof window !== 'undefined' && !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

interface PtyDataPayload { sessionId: string; dataB64: string }
interface PtyExitPayload { sessionId: string }

/** Decode a base64 string into the raw bytes it encodes (PTY output may straddle UTF-8/escape
 * boundaries, so the Rust side ships raw bytes and we hand the bytes straight to xterm to decode). */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function TerminalPane({ cwd }: { cwd: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [exited, setExited] = useState(false);

  useEffect(() => {
    if (!hasTauri || !containerRef.current) return;

    const sessionId = crypto.randomUUID();
    let disposed = false;
    const unlistens: UnlistenFn[] = [];

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      // Read the app's theme tokens off the CSS variables so the terminal matches the panel.
      theme: { background: 'transparent' },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Clipboard: Cmd/Ctrl+C copies the current selection (and only then — with nothing selected it still
    // sends ^C / SIGINT to the shell, so interrupt isn't lost); Cmd/Ctrl+V pastes into stdin. xterm sends
    // everything else straight to the PTY, so returning true keeps normal keystrokes flowing.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'c' && term.hasSelection()) {
        const sel = term.getSelection();
        if (sel) navigator.clipboard.writeText(sel).catch(() => {});
        return false;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        navigator.clipboard.readText()
          .then((text) => { if (text) void invoke('pty_write', { sessionId, data: text }).catch(() => {}); })
          .catch(() => {});
        return false;
      }
      return true;
    });

    term.open(containerRef.current);
    try { fit.fit(); } catch { /* element may not be laid out yet */ }

    // Keystrokes / pasted text → the shell's stdin.
    const dataSub = term.onData((d) => {
      void invoke('pty_write', { sessionId, data: d }).catch(() => {});
    });

    // Wire up the event listeners + spawn, in that order, so no early output is dropped.
    void (async () => {
      const onData = await listen<PtyDataPayload>('pty:data', (e) => {
        if (e.payload.sessionId !== sessionId) return;
        term.write(b64ToBytes(e.payload.dataB64));
      });
      const onExit = await listen<PtyExitPayload>('pty:exit', (e) => {
        if (e.payload.sessionId !== sessionId) return;
        term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n');
        setExited(true);
      });
      if (disposed) { onData(); onExit(); return; }
      unlistens.push(onData, onExit);
      try {
        await invoke('pty_spawn', { sessionId, cwd, cols: term.cols, rows: term.rows });
      } catch (err) {
        term.write(`\r\n\x1b[31m[could not start terminal: ${String(err)}]\x1b[0m\r\n`);
        setExited(true);
      }
    })();

    // Keep xterm and the PTY sized to the container.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void invoke('pty_resize', { sessionId, cols: term.cols, rows: term.rows }).catch(() => {});
      } catch { /* ignore transient layout errors */ }
    });
    ro.observe(containerRef.current);

    return () => {
      disposed = true;
      ro.disconnect();
      dataSub.dispose();
      for (const u of unlistens) u();
      void invoke('pty_kill', { sessionId }).catch(() => {});
      term.dispose();
    };
  }, [cwd]);

  if (!hasTauri) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ink-3 text-center px-8 bg-panel">
        <p className="text-sm max-w-xs">The terminal runs in the desktop app.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-panel">
      <div className="flex-1 min-h-0 px-3 py-2 overflow-hidden" ref={containerRef} />
      {exited && (
        <div className="px-4 py-2 border-t border-edge text-[11px] text-ink-3 shrink-0">
          This session ended. Switch away and back to start a new one.
        </div>
      )}
    </div>
  );
}
