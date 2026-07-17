//! Apple Notes via AppleScript (`osascript`).
//!
//! Notes has no public read/write API except AppleScript, so we drive Notes.app the same way
//! `imessage_send` drives Messages — passing all user data as `on run argv` arguments (never string-
//! interpolated into the script) so titles/bodies can't break out of the script. Notes synced through
//! iCloud round-trip to the user's other devices for free.
//!
//! Sharing/collaboration is deliberately NOT here: Apple exposes no scripting to add collaborators,
//! so the app shares a note's *contents* via the existing iMessage/Mail commands instead (TS side).
//!
//! First use triggers the macOS Automation prompt (allow Agent Forge to control Notes).

/// Run an AppleScript, passing `args` as `on run argv` items (safe — not interpolated). Returns
/// trimmed stdout, or a friendly error pointing at the Automation permission on failure.
fn run_osascript(script: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = std::process::Command::new("osascript");
    cmd.arg("-e").arg(script);
    for a in args {
        cmd.arg(a);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("could not run osascript: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!(
            "Notes refused the request: {err}. If this is the first time, allow Agent Forge to control \
             Notes in System Settings → Privacy & Security → Automation."
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

/// One note's metadata (no body — listing stays cheap). Tab-delimited rows from AppleScript.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    id: String,
    name: String,
    modified: String, // AppleScript date string; the TS side best-effort parses it
}

/// Folder names across all Notes accounts.
#[tauri::command]
pub async fn notes_list_folders() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<String>, String> {
        let script = "tell application \"Notes\"\n\
            set out to \"\"\n\
            repeat with f in folders\n\
            set out to out & (name of f) & linefeed\n\
            end repeat\n\
            return out\n\
            end tell";
        let raw = run_osascript(script, &[])?;
        Ok(raw
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect())
    })
    .await
    .map_err(|e| format!("notes task failed: {e}"))?
}

/// Note metadata (id, name, modified) for a folder — newest handling left to the caller.
#[tauri::command]
pub async fn notes_list(folder: String) -> Result<Vec<NoteMeta>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<NoteMeta>, String> {
        let script = "on run argv\n\
            tell application \"Notes\"\n\
            set theFolder to folder (item 1 of argv)\n\
            set out to \"\"\n\
            repeat with n in notes of theFolder\n\
            set out to out & (id of n) & tab & (name of n) & tab & ((modification date of n) as string) & linefeed\n\
            end repeat\n\
            return out\n\
            end tell\n\
            end run";
        let raw = run_osascript(script, &[&folder])?;
        let mut out = Vec::new();
        for line in raw.lines() {
            let mut parts = line.splitn(3, '\t');
            let id = parts.next().unwrap_or("").trim().to_string();
            if id.is_empty() {
                continue;
            }
            out.push(NoteMeta {
                id,
                name: parts.next().unwrap_or("").trim().to_string(),
                modified: parts.next().unwrap_or("").trim().to_string(),
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("notes task failed: {e}"))?
}

/// The HTML body of one note.
#[tauri::command]
pub async fn notes_read(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let script = "on run argv\n\
            tell application \"Notes\" to return body of note id (item 1 of argv)\n\
            end run";
        run_osascript(script, &[&id])
    })
    .await
    .map_err(|e| format!("notes task failed: {e}"))?
}

/// Create a note in `folder` with `title` + HTML `body`. Returns the new note's id.
#[tauri::command]
pub async fn notes_create(folder: String, title: String, body: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let script = "on run argv\n\
            tell application \"Notes\"\n\
            set newNote to make new note at folder (item 1 of argv) with properties {name:(item 2 of argv), body:(item 3 of argv)}\n\
            return id of newNote\n\
            end tell\n\
            end run";
        run_osascript(script, &[&folder, &title, &body])
    })
    .await
    .map_err(|e| format!("notes task failed: {e}"))?
}

/// Replace a note's HTML body.
#[tauri::command]
pub async fn notes_update(id: String, body: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let script = "on run argv\n\
            tell application \"Notes\" to set body of note id (item 1 of argv) to (item 2 of argv)\n\
            end run";
        run_osascript(script, &[&id, &body]).map(|_| ())
    })
    .await
    .map_err(|e| format!("notes task failed: {e}"))?
}

/// Delete a note by id.
#[tauri::command]
pub async fn notes_delete(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let script = "on run argv\n\
            tell application \"Notes\" to delete note id (item 1 of argv)\n\
            end run";
        run_osascript(script, &[&id]).map(|_| ())
    })
    .await
    .map_err(|e| format!("notes task failed: {e}"))?
}
