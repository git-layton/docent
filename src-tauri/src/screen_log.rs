//! Frame storage for the screen log.
//!
//! The `observed` provenance tier promises a frame you can look at — that is what makes a log
//! entry *checkable* rather than merely labelled. These commands are where that promise is kept.
//!
//! WHY NOT `fs_write`: it calls `commit_workspace()` on every write, which runs `git add -A` at
//! `~/AgentForge`. A log capturing every few seconds would produce thousands of commits a day in
//! the user's Knowledge Core. That behaviour is right for notes — versioned, auditable — and
//! disqualifying for a high-frequency binary log. Frames therefore live OUTSIDE the git root, in
//! the macOS application-support directory, and are never touched by the workspace committer.
//!
//! WHY JPEG: `capture_window` hands back PNG, which is several times larger than JPEG for screen
//! content. Every product in this category (Recall, screenpipe, Windrecorder) stores JPEGs on disk
//! at roughly 300 MB per 8 hours; PNG would multiply that for no benefit, since these frames are
//! read by human eyes and OCR, not re-edited. Transcoding uses `sips`, the same shell-out the
//! existing `make_thumb` uses — no new dependency.
//!
//! SECURITY: like every capture surface, these are granted to LOCAL trusted windows only via the
//! auto-generated `allow-app-local` ACL, and must NEVER be added to `allow-browser-remote` — a
//! remote page must not read or write the user's screen history. The caller-label guard below is
//! defense-in-depth on top of the ACL. Frame ids are additionally sanitized to a strict charset so
//! a crafted id can never traverse out of the frames directory.

use std::path::PathBuf;

/// `~/Library/Application Support/Docent/screen-log/frames`
///
/// Deliberately NOT under `~/AgentForge`: that tree is a git repository and the workspace
/// committer runs `git add -A` across it.
fn frames_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Docent")
        .join("screen-log")
        .join("frames");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Frame ids are generated here and echoed back by callers, so they are untrusted on the way in.
/// Restricting to `[A-Za-z0-9_-]` makes `..`, `/` and absolute paths unrepresentable rather than
/// merely rejected — there is no traversal to defend against if a separator cannot be spelled.
fn safe_frame_id(id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 128 {
        return Err("invalid frame id".into());
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("invalid frame id".into());
    }
    Ok(id.to_string())
}

fn guard(label: &str) -> Result<(), String> {
    if matches!(label, "main" | "spotlight") {
        Ok(())
    } else {
        Err("screen log frames are not accessible from this window".into())
    }
}

/// Decode a `data:image/...;base64,...` URL (or a bare base64 payload) into bytes.
fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let payload = match data_url.find(";base64,") {
        Some(idx) => &data_url[idx + 8..],
        None => data_url,
    };
    base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("could not decode frame: {e}"))
}

/// Store a captured frame as a downscaled JPEG. Returns the frame id to put on the log entry.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn screen_log_write_frame(
    window: tauri::WebviewWindow,
    data_url: String,
    max_px: Option<u32>,
) -> Result<String, String> {
    guard(window.label())?;

    let bytes = decode_data_url(&data_url)?;
    if bytes.is_empty() {
        return Err("frame was empty".into());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let id = format!("f{stamp}");

    let tmp = std::env::temp_dir().join(format!("docent-frame-{stamp}.png"));
    std::fs::write(&tmp, &bytes).map_err(|e| format!("could not stage frame: {e}"))?;

    // Cap the long edge: a log is read at thumbnail-to-medium size, and full-resolution retina
    // frames would multiply storage for detail nobody looks at.
    let max = max_px.unwrap_or(1280).clamp(320, 3840);
    let out = frames_dir().join(format!("{id}.jpg"));

    let status = std::process::Command::new("/usr/bin/sips")
        .arg("-s").arg("format").arg("jpeg")
        .arg("-s").arg("formatOptions").arg("70")
        .arg("-Z").arg(max.to_string())
        .arg(&tmp)
        .arg("--out").arg(&out)
        .status();
    let _ = std::fs::remove_file(&tmp);

    match status {
        Ok(s) if s.success() => {}
        _ => {
            let _ = std::fs::remove_file(&out);
            return Err("could not encode frame".into());
        }
    }

    // A zero-byte output means sips reported success on a file it did not write; storing the id
    // anyway would leave an entry pointing at evidence that does not exist.
    match std::fs::metadata(&out) {
        Ok(m) if m.len() > 0 => Ok(id),
        _ => {
            let _ = std::fs::remove_file(&out);
            Err("frame was not written".into())
        }
    }
}

/// Read a stored frame back as a `data:image/jpeg;base64,…` URL.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn screen_log_read_frame(
    window: tauri::WebviewWindow,
    frame_id: String,
) -> Result<String, String> {
    use base64::Engine;
    guard(window.label())?;
    let id = safe_frame_id(&frame_id)?;
    let path = frames_dir().join(format!("{id}.jpg"));
    let bytes = std::fs::read(&path).map_err(|_| "frame not found".to_string())?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Delete frames whose entries retention has dropped. Returns how many were removed.
///
/// This is the other half of `screenLogStore.saveEntry()` returning its orphan list: an entry
/// pruned from the index while its frame lingers on disk is exactly the leak the exclusion policy
/// exists to prevent.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn screen_log_delete_frames(
    window: tauri::WebviewWindow,
    frame_ids: Vec<String>,
) -> Result<usize, String> {
    guard(window.label())?;
    let dir = frames_dir();
    let mut removed = 0usize;
    for raw in frame_ids {
        // A malformed id is skipped rather than failing the batch — one bad id must not strand
        // every other orphaned frame on disk.
        let Ok(id) = safe_frame_id(&raw) else { continue };
        if std::fs::remove_file(dir.join(format!("{id}.jpg"))).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Total bytes on disk, for the "your screen log is using N MB" readout and a delete-all affordance.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn screen_log_frames_bytes(window: tauri::WebviewWindow) -> Result<u64, String> {
    guard(window.label())?;
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(frames_dir()) {
        for e in entries.flatten() {
            if let Ok(m) = e.metadata() {
                total += m.len();
            }
        }
    }
    Ok(total)
}

/// Remove every stored frame — the file half of "forget everything I've seen".
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn screen_log_clear_frames(window: tauri::WebviewWindow) -> Result<usize, String> {
    guard(window.label())?;
    let mut removed = 0usize;
    if let Ok(entries) = std::fs::read_dir(frames_dir()) {
        for e in entries.flatten() {
            if std::fs::remove_file(e.path()).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

// ─── Non-macOS stubs ────────────────────────────────────────────────────────────────────────────

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn screen_log_write_frame(
    _window: tauri::WebviewWindow,
    _data_url: String,
    _max_px: Option<u32>,
) -> Result<String, String> {
    Err("screen log frames are only available on macOS".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn screen_log_read_frame(
    _window: tauri::WebviewWindow,
    _frame_id: String,
) -> Result<String, String> {
    Err("screen log frames are only available on macOS".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn screen_log_delete_frames(
    _window: tauri::WebviewWindow,
    _frame_ids: Vec<String>,
) -> Result<usize, String> {
    Err("screen log frames are only available on macOS".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn screen_log_frames_bytes(_window: tauri::WebviewWindow) -> Result<u64, String> {
    Err("screen log frames are only available on macOS".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn screen_log_clear_frames(_window: tauri::WebviewWindow) -> Result<usize, String> {
    Err("screen log frames are only available on macOS".into())
}

#[cfg(test)]
mod tests {
    use super::{decode_data_url, safe_frame_id};

    #[test]
    fn frame_ids_cannot_spell_a_path() {
        // Traversal is unrepresentable rather than merely rejected.
        assert!(safe_frame_id("../../etc/passwd").is_err());
        assert!(safe_frame_id("a/b").is_err());
        assert!(safe_frame_id("a.jpg").is_err());
        assert!(safe_frame_id("").is_err());
        assert!(safe_frame_id(&"f".repeat(200)).is_err());
        assert!(safe_frame_id("f1234567890").is_ok());
        assert!(safe_frame_id("frame_id-1").is_ok());
    }

    #[test]
    fn decodes_with_or_without_a_data_url_prefix() {
        let bare = decode_data_url("aGVsbG8=").unwrap();
        assert_eq!(bare, b"hello");
        let prefixed = decode_data_url("data:image/png;base64,aGVsbG8=").unwrap();
        assert_eq!(prefixed, b"hello");
    }

    #[test]
    fn rejects_undecodable_payloads() {
        assert!(decode_data_url("not valid base64!!!").is_err());
    }
}
