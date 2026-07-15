use tauri::command;

#[cfg(target_os = "macos")]
use core_graphics::event::{CGEvent, CGEventType, CGMouseButton, CGEventTapLocation};
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
#[cfg(target_os = "macos")]
use core_graphics::geometry::CGPoint;

#[command]
pub fn inject_click(x: f64, y: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| "Failed to create event source".to_string())?;

        let point = CGPoint::new(x, y);

        // Create mouse down event
        let mouse_down = CGEvent::new_mouse_event(
            source.clone(),
            CGEventType::LeftMouseDown,
            point,
            CGMouseButton::Left,
        ).map_err(|_| "Failed to create mouse down event".to_string())?;

        // Create mouse up event
        let mouse_up = CGEvent::new_mouse_event(
            source,
            CGEventType::LeftMouseUp,
            point,
            CGMouseButton::Left,
        ).map_err(|_| "Failed to create mouse up event".to_string())?;

        // Post events
        mouse_down.post(CGEventTapLocation::HID);
        mouse_up.post(CGEventTapLocation::HID);

        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Mouse injection is only supported on macOS".to_string())
    }
}
