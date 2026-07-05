//! Unified macOS permission (TCC) helpers for the "Mac permissions" hub in Settings.
//!
//! macOS grants arrive through several unrelated mechanisms — Screen Recording, Automation
//! (AppleEvents), Full Disk Access, EventKit — and most prompt exactly ONCE: after a deny the
//! system goes silent and calls simply fail. These commands give the settings UI one place to
//! (a) fire the genuine system prompt where one exists and (b) deep-link to the exact System
//! Settings pane where it doesn't. Per-domain status probes stay in their modules
//! (`screen_capture_authorized`, `eventkit_authorization_status`, `imessage_check_access`);
//! this module only adds what was missing: Automation consent and a generic settings opener.

/// Ask for Automation consent for a scriptable app by sending it a benign AppleEvent (`get name`).
///
/// The first call launches the target app and fires the macOS consent dialog — unavoidable:
/// Automation consent can only be requested against a running app, and only by actually sending
/// it an event. Returns `"granted"` or `"denied"` (AppleEvent error -1743).
#[tauri::command]
pub async fn automation_grant(target: String) -> Result<String, String> {
    // Closed set — never let the frontend script an arbitrary application.
    let app = match target.as_str() {
        "notes" => "Notes",
        "messages" => "Messages",
        "chrome" => "Google Chrome",
        "safari" => "Safari",
        other => return Err(format!("unknown automation target '{other}'")),
    };
    let script = format!("tell application \"{app}\" to get name");
    let out = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("osascript").arg("-e").arg(&script).output()
    })
    .await
    .map_err(|e| format!("automation probe task failed: {e}"))?
    .map_err(|e| format!("could not run osascript: {e}"))?;

    if out.status.success() {
        return Ok("granted".into());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    if err.contains("-1743") {
        // errAEEventNotPermitted — the user denied (now or previously). macOS will NOT re-prompt;
        // the UI should offer the Privacy → Automation pane instead.
        Ok("denied".into())
    } else {
        Err(err.trim().to_string())
    }
}

/// Open a specific Privacy & Security pane in System Settings — for the grants macOS refuses to
/// re-prompt for (previously denied Automation, Full Disk Access, etc.).
#[tauri::command]
pub fn open_privacy_settings(pane: String) -> Result<(), String> {
    let anchor = match pane.as_str() {
        "screen" => "Privacy_ScreenCapture",
        "automation" => "Privacy_Automation",
        "fulldisk" => "Privacy_AllFiles",
        "calendars" => "Privacy_Calendars",
        "reminders" => "Privacy_Reminders",
        other => return Err(format!("unknown privacy pane '{other}'")),
    };
    // Same `open x-apple.systempreferences:` pattern as imessage_open_fda_settings.
    let status = std::process::Command::new("open")
        .arg(format!("x-apple.systempreferences:com.apple.preference.security?{anchor}"))
        .status()
        .map_err(|e| format!("could not open System Settings: {e}"))?;
    if status.success() { Ok(()) } else { Err("System Settings did not open".into()) }
}
