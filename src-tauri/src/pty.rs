//! Interactive terminal (PTY) backend — the crux of AgentForge Code Phase 3.
//!
//! `run_command` (lib.rs) is one-shot: spawn, wait, return stdout/stderr. Hosting an *interactive*
//! shell, a REPL, or a long-lived `claude`/`codex`/`gemini`/dev-server needs a real pseudo-terminal
//! with streaming two-way I/O, resize, and a persistent session. We use `portable-pty` (wezterm) and
//! keep one `PtySession` per `session_id` in a `Mutex<HashMap>` — the exact thread→event emit pattern
//! the rest of the app uses (cf. `download-progress` in lib.rs).
//!
//! Design (docs/agentforge-code-architecture.md §9, Phase 3):
//!   * Commands are SYNC; the blocking master read happens on a `std::thread::spawn` reader loop, so
//!     the Tauri main thread never blocks. The reader thread owns its own `reader` handle — we never
//!     hold the `PtyState` mutex across blocking I/O.
//!   * Each read is shipped as base64 of the RAW bytes over the `pty:data` event. We deliberately do
//!     NOT `String::from_utf8_lossy` per-read: a multibyte UTF-8 codepoint (or an escape sequence) can
//!     straddle a 4 KiB read boundary, and lossy decoding would corrupt it. Base64 of raw bytes lets
//!     the frontend reassemble the byte stream and decode once, intact (xterm.js handles this).
//!   * On EOF/error we emit `pty:exit` and drop the session from the map (no leaked handles).
//!
//! SECURITY: every `pty_*` command runs the user's real login shell with their real credentials and
//! is therefore on the remote-isolation DENIED list (see the test in lib.rs). A prompt-injected page
//! in the browser-panel webview must never reach a shell. Developer-Mode + command-approval gating of
//! agent-originated `pty_write` lives in the frontend; this module is the privileged primitive.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{Emitter, Manager};

/// One live pseudo-terminal. The reader thread owns its own `reader` clone (not stored here), so the
/// only things we keep are the handles needed to write to, resize, and kill the session.
pub struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// session_id → live PTY. Default = empty map.
pub struct PtyState(pub Mutex<HashMap<String, PtySession>>);

impl Default for PtyState {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// Spawn a login/interactive shell under a fresh PTY and start streaming its output.
///
/// Mirrors `run_command`: shell from `$SHELL` (fallback `/bin/zsh`), run with the login/interactive
/// flag so PATH/aliases match the user's terminal. The reader loop streams the master to the webview
/// over `pty:data`; the session lives in `PtyState` under `session_id` until `pty_kill` or EOF.
#[tauri::command]
pub fn pty_spawn(
    app: tauri::AppHandle,
    state: tauri::State<PtyState>,
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    // `-il` = interactive login shell: loads the user's profile/rc (PATH, aliases) the same way their
    // real terminal does, so `gh`/`git`/`npm`/`claude` resolve identically.
    cmd.arg("-il");
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    // The reader thread gets its OWN handle to the master; the writer + master go into state. We must
    // take the reader BEFORE moving the master into the session struct.
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    {
        let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
        sessions.insert(
            session_id.clone(),
            PtySession {
                writer,
                master: pair.master,
                child,
            },
        );
    }

    // Reader loop: drain raw bytes, ship base64 over `pty:data`. Owns only `reader` + `app` + id — it
    // never touches the PtyState mutex, so a blocking read can't stall any other command.
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let engine = base64::engine::general_purpose::STANDARD;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF — the shell closed its end
                Ok(n) => {
                    let data_b64 = engine.encode(&buf[..n]);
                    let _ = app_handle.emit(
                        "pty:data",
                        serde_json::json!({ "sessionId": session_id, "dataB64": data_b64 }),
                    );
                }
                Err(_) => break, // read error — treat as session end
            }
        }
        // Tell the frontend the stream ended, then drop the session so no handles leak.
        let _ = app_handle.emit("pty:exit", serde_json::json!({ "sessionId": session_id }));
        if let Some(state) = app_handle.try_state::<PtyState>() {
            if let Ok(mut sessions) = state.0.lock() {
                if let Some(mut session) = sessions.remove(&session_id) {
                    let _ = session.child.kill();
                }
            }
        }
    });

    Ok(())
}

/// Feed keystrokes / pasted text into the PTY. Bytes are written verbatim to the shell's stdin.
#[tauri::command]
pub fn pty_write(
    state: tauri::State<PtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("no PTY session: {session_id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Resize the PTY (e.g. when the terminal pane changes size) so line-wrapping/redraw stay correct.
#[tauri::command]
pub fn pty_resize(
    state: tauri::State<PtyState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("no PTY session: {session_id}"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Kill the shell and drop the session. The reader loop will then hit EOF and also emit `pty:exit`.
#[tauri::command]
pub fn pty_kill(state: tauri::State<PtyState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

/// Kill every live session — called from the window Destroyed/exit hook so no zombie shells or
/// dev-servers outlive the app (mirrors how the llama sidecar is reaped on exit).
pub fn kill_all_sessions(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<PtyState>() {
        if let Ok(mut sessions) = state.0.lock() {
            for (_, mut session) in sessions.drain() {
                let _ = session.child.kill();
            }
        }
    }
}
