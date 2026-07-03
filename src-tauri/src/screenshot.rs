//! Codey's "LOOK" eyes — capture the live Preview iframe so a vision model can SEE the running app.
//!
//! macOS: WKWebView's `takeSnapshot(with:completionHandler:)` renders the webview's painted content —
//! INCLUDING the cross-origin `localhost` preview iframe, which a JS canvas can't touch (the same-origin
//! wall taints it). We snapshot the MAIN window's WKWebView, cropped to the iframe's rect (passed in CSS
//! points = `getBoundingClientRect()` coords, which is exactly the coordinate space WKSnapshotConfiguration
//! expects), encode PNG, and hand back base64. The TS side feeds it to the already-wired `describeImage`.
//!
//! SECURITY: like the fs / pty / run_command surface, this is DENIED to the remote `browser-panel` webview
//! — a remote page must never screenshot the user's app. Registered in `generate_handler!` → auto-granted
//! to LOCAL windows only via `allow-app-local`; it is NEVER added to `allow-browser-remote` in app.toml.
//! The `remote_origin_is_locked_out_of_privileged_commands` test in lib.rs asserts the denial.
//!
//! `with_webview` runs its closure on the main thread (required for AppKit/WebKit). `takeSnapshot` itself
//! completes asynchronously via a block, so we bridge back to the async command over a one-shot channel
//! with a bounded wait — a stuck snapshot times out instead of hanging the command.

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn webview_screenshot(
    window: tauri::WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, String> {
    use base64::Engine;
    use block2::RcBlock;
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2::rc::Retained;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSDictionary, NSError, NSString};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use std::sync::mpsc;

    // SEC-SCREENSHOT: defense-in-depth caller guard — the ACL already denies the remote browser-panel,
    // but this also stops a misconfigured ACL from ever exposing a screen capture. And require an
    // explicit, finite, in-bounds crop rect: a null/zero rect must NOT fall through to a FULL-window
    // snapshot (which would capture mail, Keychain prompts, iMessage, etc.).
    if !matches!(window.label(), "main" | "spotlight") {
        return Err("screenshot not permitted from this window".into());
    }
    if !(x.is_finite() && y.is_finite() && width.is_finite() && height.is_finite())
        || x < 0.0
        || y < 0.0
        || width <= 1.0
        || height <= 1.0
    {
        return Err("a finite, in-bounds capture rect is required".into());
    }

    let (tx, rx) = mpsc::channel::<Result<String, String>>();

    window
        .with_webview(move |pw| {
            // SAFETY: `inner()` is the main window's WKWebView (an NSView subclass), valid for the life of
            // the window. We only touch it here, on the main thread, inside this closure.
            let wk_ptr = pw.inner() as *mut WKWebView;
            if wk_ptr.is_null() {
                let _ = tx.send(Err("no webview handle".into()));
                return;
            }
            let webview: &WKWebView = unsafe { &*wk_ptr };

            // with_webview runs on the main thread, so a marker is always available here.
            let mtm = match MainThreadMarker::new() {
                Some(m) => m,
                None => {
                    let _ = tx.send(Err("not on main thread".into()));
                    return;
                }
            };
            let config = unsafe { WKSnapshotConfiguration::new(mtm) };
            // Rect was validated finite + in-bounds at the command boundary; always crop to it — never
            // fall through to a full-window snapshot.
            let rect = CGRect {
                origin: CGPoint { x, y },
                size: CGSize { width, height },
            };
            unsafe { config.setRect(rect) };

            // The completion block fires (on the main thread) once the snapshot is ready. It owns the only
            // surviving Sender, so `recv` below unblocks exactly when the PNG is encoded (or on failure).
            let tx_done = tx.clone();
            let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let result = (|| -> Result<String, String> {
                    if image.is_null() {
                        return Err(if error.is_null() {
                            "snapshot returned no image".into()
                        } else {
                            "snapshot failed".into()
                        });
                    }
                    let image: &NSImage = unsafe { &*image };
                    let tiff = image.TIFFRepresentation().ok_or("no TIFF representation")?;
                    let rep = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)
                        .ok_or("could not build bitmap rep")?;
                    let props: Retained<NSDictionary<NSString>> = NSDictionary::new();
                    let png = unsafe {
                        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props)
                    }
                    .ok_or("PNG encode failed")?;
                    Ok(base64::engine::general_purpose::STANDARD.encode(png.to_vec()))
                })();
                let _ = tx_done.send(result);
            });

            unsafe { webview.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler) };
        })
        .map_err(|e| format!("with_webview failed: {e}"))?;

    rx.recv_timeout(std::time::Duration::from_secs(8))
        .map_err(|_| "screenshot timed out".to_string())?
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn webview_screenshot(
    _window: tauri::WebviewWindow,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<String, String> {
    Err("webview_screenshot is only available on macOS".into())
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// The agent's SCREEN eyes — capture whatever app the user is looking at (Slack, Mail, Messages,
// anything) so a vision model can read it. This is the "perception" leg of the screen-aware overlay.
//
// PROTOTYPE SCOPE: captures the full main display via the macOS `screencapture` CLI (no new native
// deps; same shell-out pattern as notes.rs/imessage.rs). The FIRST call trips the system Screen
// Recording permission prompt; until the user grants it (System Settings → Privacy & Security →
// Screen Recording) and relaunches, the capture comes back as desktop-only/empty and the UI surfaces
// a hint. Narrowing capture to JUST the frontmost window (CGWindowList) is the next step.
//
// SECURITY: like `webview_screenshot`, this is granted ONLY to local trusted windows via the
// auto-generated `allow-app-local` ACL and is NEVER added to `allow-browser-remote` — a remote page
// must never screenshot the user's desktop. The window-label guard below is defense-in-depth.

/// Capture the current screen as a PNG, returned as a base64 `data:` URL ready for `describeImage`.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn capture_screen(window: tauri::WebviewWindow) -> Result<String, String> {
    use base64::Engine;

    // Defense-in-depth: the ACL already denies the remote browser-panel, but never let a misconfig
    // expose a full-desktop capture to anything but the trusted local windows.
    if !matches!(window.label(), "main" | "spotlight") {
        return Err("screen capture not permitted from this window".into());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("agentforge-capture-{stamp}.png"));

    // Absolute path: a GUI-launched app may not have /usr/sbin on PATH. -x = no shutter sound.
    let status = std::process::Command::new("/usr/sbin/screencapture")
        .arg("-x")
        .arg("-t")
        .arg("png")
        .arg(&path)
        .status()
        .map_err(|e| format!("could not run screencapture: {e}"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&path);
        return Err("screencapture failed".into());
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("could not read capture: {e}"))?;
    let _ = std::fs::remove_file(&path);
    if bytes.is_empty() {
        return Err(
            "screen capture was empty — grant Screen Recording in System Settings, then relaunch".into(),
        );
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn capture_screen(_window: tauri::WebviewWindow) -> Result<String, String> {
    Err("capture_screen is only available on macOS".into())
}

// ─── On-device OCR (the fast, private "read the screen" path) ─────────────────────────────────────
// Capture the screen and recognize its text entirely on-device via Apple's Vision framework — NO
// cloud, NO API key, NO vision model. The text goes straight to any chat model (even a text-only
// local one), so this is the primary "read what's on screen" path. The vision-model route
// (`capture_screen` + `describeImage`) is reserved for genuinely visual content (charts, images).

/// Capture the screen and return its recognized text (on-device OCR).
///
/// Protocol with the TS side: the caller HIDES the overlay window before invoking (so the capture
/// shows the app underneath, not our own chat). We wait a beat for the hide animation to leave the
/// screen, grab the frame, then emit `screen-ocr:captured` so the overlay can re-show itself
/// immediately — the (slower) OCR pass runs after that, off the UI's critical path.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn capture_screen_text(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    if !matches!(window.label(), "main" | "spotlight") {
        return Err("screen capture not permitted from this window".into());
    }
    // Let the just-hidden overlay actually leave the compositor before we grab the frame.
    tokio::time::sleep(std::time::Duration::from_millis(160)).await;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("agentforge-ocr-{stamp}.png"));
    let status = std::process::Command::new("/usr/sbin/screencapture")
        .arg("-x")
        .arg("-t")
        .arg("png")
        .arg(&path)
        .status()
        .map_err(|e| format!("could not run screencapture: {e}"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&path);
        return Err("screencapture failed".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("could not read capture: {e}"))?;
    // Downscaled thumbnail — the "preview receipt" the overlay shows so the user sees exactly what
    // was read (and that the overlay isn't in the frame). Built before we delete the full grab.
    let thumb = make_thumb(&path);
    let _ = std::fs::remove_file(&path);

    // Frame is in hand — tell the overlay to come back while we OCR.
    {
        use tauri::Emitter;
        let _ = window.emit("screen-ocr:captured", ());
    }

    if bytes.is_empty() {
        return Err(
            "screen capture was empty — grant Screen Recording in System Settings, then relaunch".into(),
        );
    }
    // Vision is synchronous; run it off the async runtime. Cap like the tab path (12k chars) so a
    // dense screen can't blow a small local model's context.
    let text = tauri::async_runtime::spawn_blocking(move || ocr_png(&bytes))
        .await
        .map_err(|e| format!("ocr task failed: {e}"))??;
    let capped: String = text.chars().take(12000).collect();
    Ok(serde_json::json!({ "text": capped, "thumb": thumb }))
}

/// Downscale a PNG (max 480px) via `sips` → base64 `data:` URL. None on any failure (non-fatal).
#[cfg(target_os = "macos")]
fn make_thumb(src: &std::path::Path) -> Option<String> {
    use base64::Engine;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let out = std::env::temp_dir().join(format!("agentforge-thumb-{stamp}.png"));
    let ok = std::process::Command::new("/usr/bin/sips")
        .arg("-Z")
        .arg("480")
        .arg(src)
        .arg("--out")
        .arg(&out)
        .status()
        .ok()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        let _ = std::fs::remove_file(&out);
        return None;
    }
    let bytes = std::fs::read(&out).ok();
    let _ = std::fs::remove_file(&out);
    let b = bytes?;
    if b.is_empty() {
        return None;
    }
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
}

/// Run Apple's on-device text recognition over PNG bytes; returns the recognized lines joined.
#[cfg(target_os = "macos")]
fn ocr_png(bytes: &[u8]) -> Result<String, String> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::AllocAnyThread;
    use objc2_foundation::{NSArray, NSData, NSDictionary};
    use objc2_vision::{
        VNImageOption, VNImageRequestHandler, VNRecognizeTextRequest, VNRequest,
        VNRequestTextRecognitionLevel,
    };

    let data = NSData::with_bytes(bytes);
    let options: Retained<NSDictionary<VNImageOption, AnyObject>> = NSDictionary::new();
    let handler =
        VNImageRequestHandler::initWithData_options(VNImageRequestHandler::alloc(), &data, &options);

    let request = VNRecognizeTextRequest::new();
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);

    let request_ref: &VNRequest = &request;
    let requests = NSArray::from_slice(&[request_ref]);
    handler
        .performRequests_error(&requests)
        .map_err(|e| e.localizedDescription().to_string())?;

    let mut out = String::new();
    if let Some(results) = request.results() {
        for i in 0..results.count() {
            let obs = results.objectAtIndex(i);
            let candidates = obs.topCandidates(1);
            if candidates.count() > 0 {
                let top = candidates.objectAtIndex(0);
                out.push_str(&top.string().to_string());
                out.push('\n');
            }
        }
    }
    Ok(out)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn capture_screen_text(_window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    Err("capture_screen_text is only available on macOS".into())
}

// ─── Screen Recording permission flow ────────────────────────────────────────────────────────────
// macOS gates screen capture behind the Screen Recording TCC permission. We can't grant it, but we
// CAN: (a) check if it's already granted — CGPreflightScreenCaptureAccess, no prompt; (b) fire the
// one-time system prompt — CGRequestScreenCaptureAccess; (c) deep-link to the exact System Settings
// pane so the UI can walk the user through it instead of leaving them at a bare OS pop-up. This
// mirrors the Full Disk Access flow already used for iMessage.

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// True if Agent Forge already holds Screen Recording permission. Does NOT prompt.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn screen_capture_authorized() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

/// Fire the one-time macOS Screen Recording prompt (the result often stays stale until relaunch).
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn request_screen_capture_access() -> bool {
    unsafe { CGRequestScreenCaptureAccess() }
}

/// Open System Settings → Privacy & Security → Screen Recording (same `open` + URL-scheme trick the
/// FDA and Spoken Content panes use; the webview opener ignores the `x-apple.systempreferences:` scheme).
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_screen_recording_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open System Settings: {e}"))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn screen_capture_authorized() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn request_screen_capture_access() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn open_screen_recording_settings() -> Result<(), String> {
    Err("screen recording settings are only available on macOS".into())
}
