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
