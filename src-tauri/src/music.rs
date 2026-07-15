//! Apple Music via AppleScript (`osascript`).
//!
//! Exposes basic playback controls and playlist manipulation to the LLM, safely bounded
//! via parameterized AppleScript execution.

fn run_osascript(script: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = std::process::Command::new("osascript");
    cmd.arg("-e").arg(script);
    for a in args {
        cmd.arg(a);
    }
    let out = cmd.output().map_err(|e| format!("could not run osascript: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!(
            "Apple Music refused the request: {err}. If this is the first time, allow Agent Forge to control \
             Music in System Settings → Privacy & Security → Automation."
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

#[tauri::command]
pub async fn music_play() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<(), String> {
        let script = "tell application \"Music\" to play";
        run_osascript(script, &[]).map(|_| ())
    })
    .await
    .map_err(|e| format!("music task failed: {e}"))?
}

#[tauri::command]
pub async fn music_pause() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<(), String> {
        let script = "tell application \"Music\" to pause";
        run_osascript(script, &[]).map(|_| ())
    })
    .await
    .map_err(|e| format!("music task failed: {e}"))?
}

#[tauri::command]
pub async fn music_create_playlist(name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let script = "on run argv\n\
            tell application \"Music\"\n\
            set newPlaylist to make new user playlist with properties {name:(item 1 of argv)}\n\
            return id of newPlaylist as string\n\
            end tell\n\
            end run";
        run_osascript(script, &[&name])
    })
    .await
    .map_err(|e| format!("music task failed: {e}"))?
}

#[tauri::command]
pub async fn music_add_track_to_playlist(track_name: String, playlist_name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let script = "on run argv\n\
            tell application \"Music\"\n\
            set trackName to item 1 of argv\n\
            set targetPlaylist to item 2 of argv\n\
            -- Try to find the track in the user's library\n\
            set foundTracks to (every track of library playlist 1 whose name contains trackName)\n\
            if length of foundTracks is 0 then\n\
                error \"Track not found in library: \" & trackName\n\
            end if\n\
            duplicate (item 1 of foundTracks) to playlist targetPlaylist\n\
            end tell\n\
            end run";
        run_osascript(script, &[&track_name, &playlist_name]).map(|_| ())
    })
    .await
    .map_err(|e| format!("music task failed: {e}"))?
}
