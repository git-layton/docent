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
    use objc2::rc::Retained;
    use objc2::{AllocAnyThread, MainThreadMarker};
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

            unsafe {
                webview.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler)
            };
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

// ─── The browser panel's eyes — snapshot the embedded web content itself ────────────────────────────
//
// `webview_screenshot` above snapshots the MAIN window's WKWebView. The in-app browser renders in a
// SEPARATE child WKWebView (`browser-panel`, created via `add_child`), so the main-window snapshot
// can't see it. These commands snapshot the browser panel's OWN webview via `takeSnapshot`, which
// paints exactly what the user sees — including canvas/image-heavy apps and complex SPAs (Gmail,
// dashboards) that defeat DOM text extraction. This is the "look at the page in detail" path: the PNG
// can go to a vision model, and `browser_snapshot_text` runs it through the same on-device Apple Vision
// OCR the screen-read path uses, so even a text-only model gets a faithful read of the rendered page.
//
// SECURITY: like every capture command, this is granted to LOCAL trusted windows only (auto-generated
// `allow-app-local`) and is NEVER added to `allow-browser-remote` — a remote page must not screenshot
// itself and exfiltrate the frame. The caller-label guard below is defense-in-depth on top of the ACL.

/// Snapshot the given panel webview and return raw PNG bytes. Runs `takeSnapshot` on the child
/// WKWebView's full visible view (no crop rect — the panel IS the page content) and bridges the async
/// completion block back over a one-shot channel with a bounded wait so a stuck snapshot times out.
#[cfg(target_os = "macos")]
fn snapshot_webview_png(app: &tauri::AppHandle, label: &str) -> Result<Vec<u8>, String> {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError, NSString};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use std::sync::mpsc;
    use tauri::Manager;

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();

    webview
        .with_webview(move |pw| {
            // SAFETY: `inner()` is the panel's WKWebView (an NSView subclass), valid for the life of the
            // webview. We only touch it here, on the main thread, inside this closure.
            let wk_ptr = pw.inner() as *mut WKWebView;
            if wk_ptr.is_null() {
                let _ = tx.send(Err("no webview handle".into()));
                return;
            }
            let webview: &WKWebView = unsafe { &*wk_ptr };

            let mtm = match MainThreadMarker::new() {
                Some(m) => m,
                None => {
                    let _ = tx.send(Err("not on main thread".into()));
                    return;
                }
            };
            // No `setRect` — snapshot the panel's full visible view; the whole panel is the web page.
            let config = unsafe { WKSnapshotConfiguration::new(mtm) };

            let tx_done = tx.clone();
            let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let result = (|| -> Result<Vec<u8>, String> {
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
                    Ok(png.to_vec())
                })();
                let _ = tx_done.send(result);
            });

            unsafe {
                webview.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler)
            };
        })
        .map_err(|e| format!("with_webview failed: {e}"))?;

    rx.recv_timeout(std::time::Duration::from_secs(8))
        .map_err(|_| "browser snapshot timed out".to_string())?
}

/// Snapshot the browser panel and return a base64 PNG (no `data:` prefix), ready for a vision model.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn browser_snapshot(
    caller: tauri::Webview,
    app: tauri::AppHandle,
    label: String,
) -> Result<String, String> {
    use base64::Engine;
    if !matches!(caller.label(), "main" | "spotlight") {
        return Err("browser snapshot not permitted from this webview".into());
    }
    let png = snapshot_webview_png(&app, &label)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(png))
}

/// Snapshot the browser panel and return its on-device-OCR text (`{ text }`). The primary "read the
/// rendered page" path for text-only models — no cloud, no API key.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn browser_snapshot_text(
    caller: tauri::Webview,
    app: tauri::AppHandle,
    label: String,
) -> Result<serde_json::Value, String> {
    if !matches!(caller.label(), "main" | "spotlight") {
        return Err("browser snapshot not permitted from this webview".into());
    }
    let png = snapshot_webview_png(&app, &label)?;
    // Vision is synchronous; run it off the async runtime. Cap like the tab/screen paths (12k chars).
    let text = tauri::async_runtime::spawn_blocking(move || ocr_png(&png))
        .await
        .map_err(|e| format!("ocr task failed: {e}"))??;
    let capped: String = text.chars().take(12000).collect();
    Ok(serde_json::json!({ "text": capped }))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn browser_snapshot(
    _caller: tauri::Webview,
    _app: tauri::AppHandle,
    _label: String,
) -> Result<String, String> {
    Err("browser_snapshot is only available on macOS".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn browser_snapshot_text(
    _caller: tauri::Webview,
    _app: tauri::AppHandle,
    _label: String,
) -> Result<serde_json::Value, String> {
    Err("browser_snapshot_text is only available on macOS".into())
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

// ─── The perception glow (shutter-flash receipt) ──────────────────────────────────────────────────
// Every screen grab flashes an edge glow on the captured display — the user-visible "I just looked"
// signal. It fires AFTER the frame is in hand, camera-shutter style, so the ring can never appear in
// its own screenshot (the receipt thumbnail must show a clean frame). Living here, at the perception
// layer, means no capture path can forget it — frontends don't orchestrate it at all.
//
// Lifecycle is owned HERE too: a generation-checked failsafe hides the window after the animation
// (3.6s) plus margin, so a stalled/dead glow webview can never strand an always-on-top overlay on
// screen. The webview side (GlowOverlay.tsx) only paints.

#[cfg(target_os = "macos")]
static GLOW_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(target_os = "macos")]
fn pulse_glow(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    use tauri::{Emitter, Manager};
    let Some(w) = app.get_webview_window("glow") else {
        return;
    };
    // `screencapture` grabs the MAIN display, so the glow must ride that same monitor — the
    // primary — not whichever screen the (never user-moved) glow window happens to sit on.
    if let Ok(Some(monitor)) = w.primary_monitor() {
        let _ = w.set_size(monitor.size().clone());
        let _ = w.set_position(monitor.position().clone());
    }
    let _ = w.show();
    let _ = app.emit("glow:pulse", ());
    let generation = GLOW_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(4200)).await;
        // A newer pulse re-armed the window; let ITS failsafe do the hiding.
        if GLOW_GEN.load(Ordering::SeqCst) == generation {
            let _ = w.hide();
        }
    });
}

#[derive(serde::Serialize)]
pub struct WindowInfo {
    pub id: u32,
    pub app: String,
    pub title: String,
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn list_windows() -> Result<Vec<WindowInfo>, String> {
    use core_foundation::array::CFArray;
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::window::{
        kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
        CGWindowListCopyWindowInfo,
    };

    let mut windows = Vec::new();
    unsafe {
        let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
        let window_info = CGWindowListCopyWindowInfo(options, kCGNullWindowID);
        if window_info.is_null() {
            return Err("Failed to get window list".into());
        }
        let array = CFArray::<CFDictionary>::wrap_under_create_rule(window_info);

        let k_owner_name = CFString::new("kCGWindowOwnerName");
        let k_name = CFString::new("kCGWindowName");
        let k_number = CFString::new("kCGWindowNumber");
        let k_layer = CFString::new("kCGWindowLayer");

        for i in 0..array.len() {
            let dict = array.get(i).unwrap();

            let layer_ref = dict.find(k_layer.as_CFTypeRef() as *const _);
            if let Some(l) = layer_ref {
                let cf_num = CFNumber::wrap_under_get_rule(*l as _);
                if cf_num.to_i32() != Some(0) {
                    continue;
                }
            } else {
                continue;
            }

            let mut id = 0u32;
            let num_ref = dict.find(k_number.as_CFTypeRef() as *const _);
            if let Some(n) = num_ref {
                let cf_num = CFNumber::wrap_under_get_rule(*n as _);
                if let Some(val) = cf_num.to_i32() {
                    id = val as u32;
                }
            }

            let mut app = String::new();
            let app_ref = dict.find(k_owner_name.as_CFTypeRef() as *const _);
            if let Some(a) = app_ref {
                let cf_str = CFString::wrap_under_get_rule(*a as _);
                app = cf_str.to_string();
            }

            let mut title = String::new();
            let title_ref = dict.find(k_name.as_CFTypeRef() as *const _);
            if let Some(t) = title_ref {
                let cf_str = CFString::wrap_under_get_rule(*t as _);
                title = cf_str.to_string();
            }

            if app.is_empty() && title.is_empty() {
                continue;
            }

            windows.push(WindowInfo { id, app, title });
        }
    }

    Ok(windows)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn list_windows() -> Result<Vec<WindowInfo>, String> {
    Err("list_windows is only available on macOS".into())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn capture_window(
    window_id: u32,
    window: tauri::WebviewWindow,
) -> Result<String, String> {
    use base64::Engine;

    if !matches!(window.label(), "main" | "spotlight") {
        return Err("screen capture not permitted from this window".into());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("agentforge-capture-{stamp}.png"));

    let status = std::process::Command::new("/usr/sbin/screencapture")
        .arg("-x")
        .arg("-t")
        .arg("png")
        .arg("-l")
        .arg(window_id.to_string())
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
        return Err("screen capture was empty".into());
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn capture_window(
    _window_id: u32,
    _window: tauri::WebviewWindow,
) -> Result<String, String> {
    Err("capture_window is only available on macOS".into())
}

/// On-device OCR of ONE window — the screen log's read path.
///
/// SEC-SCOPE: this exists because `capture_screen_text` grabs the WHOLE DISPLAY. The screen log
/// applies its exclusion policy to the window the user selected, so pairing a window-scoped frame
/// with full-display text would file text from every other visible window — including apps the
/// policy explicitly refuses (password managers, private-browsing windows) — under an entry that
/// claims to be about the allowed one. The exclusion promise is only meaningful if the TEXT is
/// scoped the same way the frame is.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn capture_window_text(
    window_id: u32,
    window: tauri::WebviewWindow,
) -> Result<serde_json::Value, String> {
    if !matches!(window.label(), "main" | "spotlight") {
        return Err("screen capture not permitted from this window".into());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("docent-winocr-{stamp}.png"));

    let status = std::process::Command::new("/usr/sbin/screencapture")
        .arg("-x")
        .arg("-t")
        .arg("png")
        .arg("-l")
        .arg(window_id.to_string())
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
        return Err("window capture was empty".into());
    }

    // Vision is synchronous; run it off the async runtime. Capped like every other OCR path.
    let text = tauri::async_runtime::spawn_blocking(move || ocr_png(&bytes))
        .await
        .map_err(|e| format!("ocr task failed: {e}"))??;
    let capped: String = text.chars().take(12000).collect();
    Ok(serde_json::json!({ "text": capped }))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn capture_window_text(
    _window_id: u32,
    _window: tauri::WebviewWindow,
) -> Result<serde_json::Value, String> {
    Err("capture_window_text is only available on macOS".into())
}

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
    {
        use tauri::Manager;
        pulse_glow(window.app_handle());
    }
    if bytes.is_empty() {
        return Err(
            "screen capture was empty — grant Screen Recording in System Settings, then relaunch"
                .into(),
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

/// LOCAL-ONLY transparency preview: a downscaled thumbnail of what a screen read would capture,
/// shown in the spotlight's "seeing your screen" popover. The image is displayed to the user and
/// never sent to a model, so it deliberately does NOT pulse the glow (that signal means "a read
/// left for the model") and runs no OCR. Unlike a real read, the overlay stays visible — the
/// user is looking at the preview, after all.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn preview_screen_thumb(window: tauri::WebviewWindow) -> Result<String, String> {
    if !matches!(window.label(), "main" | "spotlight") {
        return Err("screen preview not permitted from this window".into());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("agentforge-preview-{stamp}.png"));
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
    let thumb = make_thumb(&path);
    let _ = std::fs::remove_file(&path);
    thumb.ok_or_else(|| {
        "could not build preview — grant Screen Recording in System Settings, then relaunch".into()
    })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn preview_screen_thumb(_window: tauri::WebviewWindow) -> Result<String, String> {
    Err("preview_screen_thumb is only available on macOS".into())
}

/// The frontmost on-screen window that ISN'T ours: `(window id, owning app name)`.
///
/// "Do you see what I see" was answering about Docent. The overlay hides itself before capture,
/// but the MAIN window does not — and it is usually near-fullscreen — so a whole-display grab read
/// our own UI back to us. Verified 2026-08-12: OCR returned Docent's tiles and menu labels, and the
/// model concluded, correctly for what it was given, "I can see the labels on the furniture, but I
/// can't see the stuff on top of the tables."
///
/// Matched on PID, not on the owner name. The bundle is `com.gitlayton.agentforge`, its display
/// name is "Agent Forge", and the menu bar says "Docent" — three spellings of us, and a name-based
/// filter would have to guess which one CoreGraphics reports. `std::process::id()` cannot drift.
///
/// Windows are returned front-to-back, so the first match is the one the user is actually looking
/// at. Layer 0 only — that skips the menu bar, Dock and other chrome, which are not "what I see"
/// in any useful sense.
#[cfg(target_os = "macos")]
fn frontmost_foreign_window() -> Option<(u32, String)> {
    use core_foundation::array::CFArray;
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::window::{
        kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
        CGWindowListCopyWindowInfo,
    };

    let our_pid = std::process::id() as i32;
    unsafe {
        let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
        let info = CGWindowListCopyWindowInfo(options, kCGNullWindowID);
        if info.is_null() {
            return None;
        }
        let array = CFArray::<CFDictionary>::wrap_under_create_rule(info);

        let k_pid = CFString::new("kCGWindowOwnerPID");
        let k_number = CFString::new("kCGWindowNumber");
        let k_layer = CFString::new("kCGWindowLayer");
        let k_owner_name = CFString::new("kCGWindowOwnerName");
        let k_bounds = CFString::new("kCGWindowBounds");

        let num = |dict: &CFDictionary, key: &CFString| -> Option<i32> {
            dict.find(key.as_CFTypeRef() as *const _)
                .and_then(|v| CFNumber::wrap_under_get_rule(*v as _).to_i32())
        };

        for i in 0..array.len() {
            let dict = array.get(i).unwrap();

            if num(&dict, &k_layer) != Some(0) {
                continue;
            }
            if num(&dict, &k_pid) == Some(our_pid) {
                continue; // ours — the whole point
            }

            // Skip slivers. Menu-bar extras and 1px helper windows sit at layer 0 and would
            // otherwise win simply by being frontmost, capturing nothing readable.
            if let Some(b) = dict.find(k_bounds.as_CFTypeRef() as *const _) {
                let bounds = CFDictionary::<CFString, CFNumber>::wrap_under_get_rule(*b as _);
                let get = |name: &str| -> f64 {
                    bounds
                        .find(&CFString::new(name))
                        .and_then(|n| n.to_f64())
                        .unwrap_or(0.0)
                };
                if get("Width") < 200.0 || get("Height") < 200.0 {
                    continue;
                }
            }

            let id = num(&dict, &k_number)? as u32;
            let app = dict
                .find(k_owner_name.as_CFTypeRef() as *const _)
                .map(|a| CFString::wrap_under_get_rule(*a as _).to_string())
                .unwrap_or_default();
            return Some((id, app));
        }
    }
    None
}

/// Capture the screen and return its recognized text (on-device OCR).
///
/// Protocol with the TS side: the caller HIDES the overlay window before invoking (so the capture
/// shows the app underneath, not our own chat). We wait a beat for the hide animation to leave the
/// screen, grab the frame, then emit `screen-ocr:captured` so the overlay can re-show itself
/// immediately — the (slower) OCR pass runs after that, off the UI's critical path.
///
/// The frame is scoped to the frontmost window that isn't ours, so Docent's own main window can't
/// end up being the thing it reads back to the user. Falls back to the full display when nothing
/// else is open — with only Docent on screen, "what I see" genuinely is Docent.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn capture_screen_text(
    window: tauri::WebviewWindow,
) -> Result<serde_json::Value, String> {
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

    // Window-scoped first, whole-display as the fallback.
    //
    // A window id is a racy handle: it is read from the window list and used a moment later, and
    // the user can close, minimise or space-switch that window in between. Verified against the
    // binary: `-l <missing id>` prints "could not create image from window", writes no file, and
    // exits 1. Both signals agree, so this checks BOTH — a non-zero status or a missing/empty file
    // means fall back rather than fail, because losing the user's whole message over a window that
    // closed half a second ago would be a worse bug than the one this fixes.
    let target = frontmost_foreign_window();
    let mut captured = false;
    if let Some((id, ref app)) = target {
        eprintln!("[screen-ocr] reading frontmost window: {app} (id {id})");
        // `-o` drops the drop-shadow: transparent padding that OCR reads as nothing and that
        // skews the thumbnail. `-l <id>` IS accepted separated, despite `-h` printing `-l<windowid>`.
        let ok = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-o", "-t", "png", "-l", &id.to_string()])
            .arg(&path)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        captured = ok && std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false);
        if !captured {
            eprintln!("[screen-ocr] window {id} vanished mid-capture — falling back to the display");
            let _ = std::fs::remove_file(&path);
        }
    }
    if !captured {
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-t", "png"])
            .arg(&path)
            .status()
            .map_err(|e| format!("could not run screencapture: {e}"))?;
        if !status.success() {
            let _ = std::fs::remove_file(&path);
            return Err("screencapture failed".into());
        }
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("could not read capture: {e}"))?;
    // Downscaled thumbnail — the "preview receipt" the overlay shows so the user sees exactly what
    // was read (and that the overlay isn't in the frame). Built before we delete the full grab.
    let thumb = make_thumb(&path);
    let _ = std::fs::remove_file(&path);

    // Frame is in hand — flash the perception glow (it also reads as "reading…" feedback while the
    // OCR pass runs) and tell the overlay to come back.
    {
        use tauri::{Emitter, Manager};
        pulse_glow(window.app_handle());
        let _ = window.emit("screen-ocr:captured", ());
    }

    if bytes.is_empty() {
        return Err(
            "screen capture was empty — grant Screen Recording in System Settings, then relaunch"
                .into(),
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
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(b)
    ))
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
    let handler = VNImageRequestHandler::initWithData_options(
        VNImageRequestHandler::alloc(),
        &data,
        &options,
    );

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
/// Recognized text WITH its position — the same Vision pass, keeping the rectangle it already
/// computes instead of throwing it away.
///
/// `ocr_png` above returns only strings, which starves everything downstream that needs to know
/// WHERE something is: `resolveSemanticTarget` (desktopVision.ts) can only click blocks that have
/// real bounds, and the annotation layer cannot draw a highlight around a thing it cannot locate.
/// Vision hands the bounding box back for free on every observation; dropping it was pure loss.
///
/// Coordinates are Vision's normalized space — origin BOTTOM-left, 0..1 on both axes. Callers
/// convert to screen points; keeping them normalized here means the result stays correct
/// regardless of the capture's pixel size or the display's scale factor.
#[cfg(target_os = "macos")]
fn ocr_png_boxed(bytes: &[u8]) -> Result<Vec<serde_json::Value>, String> {
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
    let handler = VNImageRequestHandler::initWithData_options(
        VNImageRequestHandler::alloc(),
        &data,
        &options,
    );

    let request = VNRecognizeTextRequest::new();
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);

    let request_ref: &VNRequest = &request;
    let requests = NSArray::from_slice(&[request_ref]);
    handler
        .performRequests_error(&requests)
        .map_err(|e| e.localizedDescription().to_string())?;

    let mut blocks = Vec::new();
    if let Some(results) = request.results() {
        for i in 0..results.count() {
            let obs = results.objectAtIndex(i);
            let candidates = obs.topCandidates(1);
            if candidates.count() == 0 {
                continue;
            }
            let top = candidates.objectAtIndex(0);
            let text = top.string().to_string();
            if text.trim().is_empty() {
                continue;
            }
            let bb = unsafe { obs.boundingBox() };
            blocks.push(serde_json::json!({
                "text": text,
                "confidence": top.confidence(),
                // Normalized, bottom-left origin — see the note above.
                "x": bb.origin.x,
                "y": bb.origin.y,
                "width": bb.size.width,
                "height": bb.size.height,
            }));
        }
    }
    Ok(blocks)
}


#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn capture_screen_text(
    _window: tauri::WebviewWindow,
) -> Result<serde_json::Value, String> {
    Err("capture_screen_text is only available on macOS".into())
}


/// Capture ONE window and return its recognized text WITH positions, ready to draw highlights over.
///
/// This is the missing half of "point at what you mean". `capture_window_text` answers WHAT is on
/// screen; this answers WHERE, which is what an annotation layer and `resolveSemanticTarget` both
/// need. Boxes come back in Vision's normalized bottom-left space along with the captured image's
/// pixel size, so the caller can map to screen points without guessing the scale factor.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn capture_window_boxes(
    window_id: u32,
    window: tauri::WebviewWindow,
) -> Result<serde_json::Value, String> {
    if !matches!(window.label(), "main" | "spotlight") {
        return Err("screen capture not permitted from this window".into());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("docent-winbox-{stamp}.png"));

    let status = std::process::Command::new("/usr/sbin/screencapture")
        .arg("-x").arg("-t").arg("png").arg("-l").arg(window_id.to_string())
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
        return Err("window capture was empty".into());
    }

    // Pixel dimensions of what we actually captured — the caller needs these to turn normalized
    // boxes into screen points, and they are NOT the window's logical size on a retina display.
    let (w, h) = image_pixel_size(&bytes);

    let blocks = tauri::async_runtime::spawn_blocking(move || ocr_png_boxed(&bytes))
        .await
        .map_err(|e| format!("ocr task failed: {e}"))??;

    Ok(serde_json::json!({ "blocks": blocks, "imageWidth": w, "imageHeight": h }))
}

/// PNG pixel dimensions, read from the IHDR header — no decode, no AppKit.
#[cfg(target_os = "macos")]
fn image_pixel_size(png: &[u8]) -> (u32, u32) {
    // 8-byte signature, then a 4-byte length + "IHDR", then width/height as big-endian u32s.
    if png.len() < 24 || &png[12..16] != b"IHDR" {
        return (0, 0);
    }
    let w = u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
    let h = u32::from_be_bytes([png[20], png[21], png[22], png[23]]);
    (w, h)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn capture_window_boxes(
    _window_id: u32,
    _window: tauri::WebviewWindow,
) -> Result<serde_json::Value, String> {
    Err("capture_window_boxes is only available on macOS".into())
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    /// The screen-read path shells out to `/usr/sbin/screencapture`, so its argument contract
    /// lives in the BINARY, not in this crate — the same class of contract that broke the local
    /// engine when llama.cpp changed `-fa` from a bare flag to `-fa <value>` and the launcher
    /// silently fed it `--host`. Two assumptions are worth pinning:
    ///
    ///   1. `-h` prints `-l<windowid>`, concatenated. We pass `-l <id>` SEPARATED. If that form
    ///      ever stops parsing, the id would be taken as the OUTPUT FILENAME and every screen read
    ///      would silently capture the whole display again — the exact bug this replaced, back
    ///      with no error to notice it by. This is the assertion that matters.
    ///   2. A window that cannot be captured fails cleanly: non-zero exit AND no file. Both are
    ///      checked at the call site, so a window the user closed mid-capture falls back to the
    ///      display instead of erroring.
    ///
    /// Written after getting (2) backwards: a shell probe read `$?` after a pipe, so it reported
    /// `sed`'s exit code and "proved" screencapture returns 0 on failure. It does not. Hence the
    /// direct `.status()` here, with no pipe anywhere near it.
    ///
    /// Uses a deliberately impossible window id, so it needs no live window and is safe in CI.
    #[test]
    fn screencapture_takes_a_separated_window_id_and_fails_cleanly() {
        use std::path::PathBuf;

        let bin = PathBuf::from("/usr/sbin/screencapture");
        if !bin.exists() {
            eprintln!("skipping: {} not present", bin.display());
            return;
        }

        let dir = std::env::temp_dir().join(format!("docent-screencap-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let out = dir.join("out.png");

        let status = std::process::Command::new(&bin)
            .args(["-x", "-o", "-t", "png", "-l", "999999999"])
            .arg(&out)
            .status()
            .expect("screencapture should be runnable");

        // (1) The id was consumed by -l, NOT treated as a filename. If the separated form ever
        // stops parsing, a file literally named "999999999" appears next to the real output path.
        let stray = dir.join("999999999");
        assert!(
            !stray.exists(),
            "screencapture treated the window id as a FILENAME — `-l <id>` no longer parses \
             separated, so window-scoped capture is silently grabbing the whole display again",
        );

        // (2) An uncapturable window fails loudly and leaves nothing behind.
        assert!(
            !status.success(),
            "screencapture now SUCCEEDS for an impossible window id — the exit-status check in \
             capture_screen_text no longer detects a vanished window",
        );
        assert!(
            !out.exists() || std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0) == 0,
            "screencapture produced a file for an impossible window id",
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
