//! Native macOS Calendar via EventKit (objc2 bindings).
//!
//! Reads/writes the user's real calendars — which means iCloud/Google/Exchange accounts they've
//! added to macOS, and edits sync to their other devices for free. Requires the **Calendar** TCC
//! permission (prompted by `eventkit_request_access`).
//!
//! The Rust side speaks epoch-milliseconds (NSDate ↔ ms); the TS `eventkit` backend converts to/from
//! ISO so there's no date parsing down here. Reminders (EKReminder) land in a later phase.

// objc2 0.6 marks some accessors/constructors safe and others unsafe; we wrap calls in `unsafe`
// uniformly so the boundary stays correct across crate versions. Silence the resulting noise.
#![allow(unused_unsafe)]

use block2::{DynBlock, RcBlock};
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2::AnyThread;
use objc2_event_kit::{
    EKCalendar, EKEntityType, EKEvent, EKEventStore, EKRecurrenceFrequency, EKRecurrenceRule,
    EKReminder, EKSpan,
};
use objc2_foundation::{NSArray, NSDate, NSDateComponents, NSError, NSString};
use std::sync::mpsc;
use std::time::Duration;

// ── small bridges ──────────────────────────────────────────────────────────
fn ns(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}
fn nsdate(ms: i64) -> Retained<NSDate> {
    unsafe { NSDate::dateWithTimeIntervalSince1970(ms as f64 / 1000.0) }
}
fn ms_of(d: &NSDate) -> i64 {
    (unsafe { d.timeIntervalSince1970() } * 1000.0) as i64
}
fn err_str(e: Retained<NSError>) -> String {
    unsafe { e.localizedDescription() }.to_string()
}
fn entity(kind: &str) -> EKEntityType {
    if kind == "reminder" { EKEntityType::Reminder } else { EKEntityType::Event }
}

/// Resolve a calendar by identifier, falling back to the default new-event calendar.
fn pick_calendar(store: &EKEventStore, id: Option<&str>) -> Option<Retained<EKCalendar>> {
    if let Some(id) = id {
        let cals = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
        for i in 0..unsafe { cals.count() } {
            let c = unsafe { cals.objectAtIndex(i) };
            if unsafe { c.calendarIdentifier() }.to_string() == id {
                return Some(c);
            }
        }
    }
    unsafe { store.defaultCalendarForNewEvents() }
}

// ── authorization ────────────────────────────────────────────────────────────

/// Current TCC status for "event" or "reminder": notDetermined|restricted|denied|authorized|writeOnly.
#[tauri::command]
pub async fn eventkit_authorization_status(kind: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let s = unsafe { EKEventStore::authorizationStatusForEntityType(entity(&kind)) };
        let label = match s.0 {
            0 => "notDetermined",
            1 => "restricted",
            2 => "denied",
            3 => "authorized", // == FullAccess on macOS 14+
            4 => "writeOnly",
            _ => "unknown",
        };
        Ok(label.to_string())
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}

/// Trigger the macOS permission prompt and block until the user answers. Returns whether granted.
#[tauri::command]
pub async fn eventkit_request_access(kind: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let store = unsafe { EKEventStore::new() };
        let (tx, rx) = mpsc::channel::<bool>();
        let handler = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        // The method copies the block, so our RcBlock can drop after the call regardless of timing.
        let ptr = &*handler as *const DynBlock<dyn Fn(Bool, *mut NSError)>
            as *mut DynBlock<dyn Fn(Bool, *mut NSError)>;
        unsafe {
            if kind == "reminder" {
                store.requestFullAccessToRemindersWithCompletion(ptr);
            } else {
                store.requestFullAccessToEventsWithCompletion(ptr);
            }
        }
        rx.recv_timeout(Duration::from_secs(120))
            .map_err(|_| "permission request timed out".to_string())
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}

// ── calendars + events ────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalRef {
    id: String,
    title: String,
    writable: bool,
    account: String,
}

#[tauri::command]
pub async fn eventkit_list_calendars(kind: String) -> Result<Vec<CalRef>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<CalRef>, String> {
        let store = unsafe { EKEventStore::new() };
        let cals = unsafe { store.calendarsForEntityType(entity(&kind)) };
        let mut out = Vec::new();
        for i in 0..unsafe { cals.count() } {
            let cal = unsafe { cals.objectAtIndex(i) };
            let account = unsafe { cal.source() }
                .map(|s| unsafe { s.title() }.to_string())
                .unwrap_or_default();
            out.push(CalRef {
                id: unsafe { cal.calendarIdentifier() }.to_string(),
                title: unsafe { cal.title() }.to_string(),
                writable: unsafe { cal.allowsContentModifications() },
                account,
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EkEvent {
    id: String,
    calendar_id: String,
    title: String,
    start: i64,
    end: i64,
    all_day: bool,
    location: String,
    notes: String,
}

#[tauri::command]
pub async fn eventkit_list_events(start_ms: i64, end_ms: i64) -> Result<Vec<EkEvent>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<EkEvent>, String> {
        let store = unsafe { EKEventStore::new() };
        let start = nsdate(start_ms);
        let end = nsdate(end_ms);
        let predicate =
            unsafe { store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None) };
        let events = unsafe { store.eventsMatchingPredicate(&predicate) };
        let mut out = Vec::new();
        for i in 0..unsafe { events.count() } {
            let ev = unsafe { events.objectAtIndex(i) };
            let s = unsafe { ev.startDate() };
            let e = unsafe { ev.endDate() };
            let calendar_id = unsafe { ev.calendar() }
                .map(|c| unsafe { c.calendarIdentifier() }.to_string())
                .unwrap_or_default();
            out.push(EkEvent {
                id: unsafe { ev.eventIdentifier() }.map(|x| x.to_string()).unwrap_or_default(),
                calendar_id,
                title: unsafe { ev.title() }.to_string(),
                start: ms_of(&s),
                end: ms_of(&e),
                all_day: unsafe { ev.isAllDay() },
                location: unsafe { ev.location() }.map(|x| x.to_string()).unwrap_or_default(),
                notes: unsafe { ev.notes() }.map(|x| x.to_string()).unwrap_or_default(),
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}

/// Create a calendar event. `yearly` adds an annual recurrence rule (for birthdays/anniversaries).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn eventkit_save_event(
    calendar_id: Option<String>,
    title: String,
    start_ms: i64,
    end_ms: i64,
    all_day: bool,
    location: Option<String>,
    notes: Option<String>,
    yearly: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let store = unsafe { EKEventStore::new() };
        let ev = unsafe { EKEvent::eventWithEventStore(&store) };
        let s = nsdate(start_ms);
        let e = nsdate(end_ms);
        unsafe {
            ev.setTitle(Some(&ns(&title)));
            ev.setStartDate(Some(&s));
            ev.setEndDate(Some(&e));
            ev.setAllDay(all_day);
            if let Some(l) = &location {
                ev.setLocation(Some(&ns(l)));
            }
            if let Some(n) = &notes {
                ev.setNotes(Some(&ns(n)));
            }
        }
        match pick_calendar(&store, calendar_id.as_deref()) {
            Some(c) => unsafe { ev.setCalendar(Some(&c)) },
            None => return Err("no writable calendar available".to_string()),
        }
        if yearly {
            let rule = unsafe {
                EKRecurrenceRule::initRecurrenceWithFrequency_interval_end(
                    EKRecurrenceRule::alloc(),
                    EKRecurrenceFrequency::Yearly,
                    1,
                    None,
                )
            };
            unsafe { ev.addRecurrenceRule(&rule) };
        }
        unsafe { store.saveEvent_span_commit_error(&ev, EKSpan::ThisEvent, true) }.map_err(err_str)?;
        Ok(unsafe { ev.eventIdentifier() }.map(|x| x.to_string()).unwrap_or_default())
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn eventkit_update_event(
    id: String,
    title: Option<String>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    all_day: Option<bool>,
    location: Option<String>,
    notes: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let store = unsafe { EKEventStore::new() };
        let ev = unsafe { store.eventWithIdentifier(&ns(&id)) }.ok_or("event not found")?;
        unsafe {
            if let Some(t) = &title {
                ev.setTitle(Some(&ns(t)));
            }
            if let Some(ms) = start_ms {
                let d = nsdate(ms);
                ev.setStartDate(Some(&d));
            }
            if let Some(ms) = end_ms {
                let d = nsdate(ms);
                ev.setEndDate(Some(&d));
            }
            if let Some(a) = all_day {
                ev.setAllDay(a);
            }
            if let Some(l) = &location {
                ev.setLocation(Some(&ns(l)));
            }
            if let Some(n) = &notes {
                ev.setNotes(Some(&ns(n)));
            }
        }
        unsafe { store.saveEvent_span_commit_error(&ev, EKSpan::ThisEvent, true) }.map_err(err_str)
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}

#[tauri::command]
pub async fn eventkit_delete_event(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let store = unsafe { EKEventStore::new() };
        let ev = unsafe { store.eventWithIdentifier(&ns(&id)) }.ok_or("event not found")?;
        unsafe { store.removeEvent_span_commit_error(&ev, EKSpan::ThisEvent, true) }.map_err(err_str)
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}

// ── reminders (to-dos) ─────────────────────────────────────────────────────────
//
// Reminders model their due date as NSDateComponents (not an NSDate), so we shuttle a bare
// 'YYYY-MM-DD' string across the boundary and build/read the components here. Listing is async in
// EventKit (a completion block), so we collect the rows into Send-able structs inside the block and
// hand them back over a channel — same blocking-bridge trick as `eventkit_request_access`.

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EkReminder {
    id: String,
    list_id: String,
    title: String,
    completed: bool,
    due: Option<String>, // 'YYYY-MM-DD'
}

/// Resolve a reminder list by id, else the default list for new reminders.
fn pick_reminder_list(store: &EKEventStore, id: Option<&str>) -> Option<Retained<EKCalendar>> {
    if let Some(id) = id {
        let cals = unsafe { store.calendarsForEntityType(EKEntityType::Reminder) };
        for i in 0..unsafe { cals.count() } {
            let c = unsafe { cals.objectAtIndex(i) };
            if unsafe { c.calendarIdentifier() }.to_string() == id {
                return Some(c);
            }
        }
    }
    unsafe { store.defaultCalendarForNewReminders() }
}

/// 'YYYY-MM-DD' from a date-components, or None if any field is unset/invalid.
fn ymd_string(c: &NSDateComponents) -> Option<String> {
    let (y, m, d) = unsafe { (c.year(), c.month(), c.day()) };
    if y <= 0 || m <= 0 || d <= 0 {
        return None;
    }
    Some(format!("{y:04}-{m:02}-{d:02}"))
}

/// Date-components carrying just year/month/day, from a 'YYYY-MM-DD' string.
fn components_from_ymd(iso: &str) -> Option<Retained<NSDateComponents>> {
    let p: Vec<&str> = iso.split('-').collect();
    if p.len() < 3 {
        return None;
    }
    let y: isize = p[0].parse().ok()?;
    let m: isize = p[1].parse().ok()?;
    let d: isize = p[2].parse().ok()?;
    let c = unsafe { NSDateComponents::new() };
    unsafe {
        c.setYear(y);
        c.setMonth(m);
        c.setDay(d);
    }
    Some(c)
}

#[tauri::command]
pub async fn eventkit_list_reminders() -> Result<Vec<EkReminder>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Vec<EkReminder>, String> {
        let store = unsafe { EKEventStore::new() };
        let predicate = unsafe { store.predicateForRemindersInCalendars(None) };
        let (tx, rx) = mpsc::channel::<Vec<EkReminder>>();
        let handler = RcBlock::new(move |arr: *mut NSArray<EKReminder>| {
            let mut out = Vec::new();
            if let Some(arr) = unsafe { arr.as_ref() } {
                for i in 0..unsafe { arr.count() } {
                    let r = unsafe { arr.objectAtIndex(i) };
                    let list_id = unsafe { r.calendar() }
                        .map(|c| unsafe { c.calendarIdentifier() }.to_string())
                        .unwrap_or_default();
                    let due = unsafe { r.dueDateComponents() }.and_then(|c| ymd_string(&c));
                    out.push(EkReminder {
                        id: unsafe { r.calendarItemIdentifier() }.to_string(),
                        list_id,
                        title: unsafe { r.title() }.to_string(),
                        completed: unsafe { r.isCompleted() },
                        due,
                    });
                }
            }
            let _ = tx.send(out);
        });
        unsafe { store.fetchRemindersMatchingPredicate_completion(&predicate, &*handler) };
        rx.recv_timeout(Duration::from_secs(30))
            .map_err(|_| "reminders fetch timed out".to_string())
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}

#[tauri::command]
pub async fn eventkit_save_reminder(
    list_id: Option<String>,
    title: String,
    due: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let store = unsafe { EKEventStore::new() };
        let r = unsafe { EKReminder::reminderWithEventStore(&store) };
        unsafe { r.setTitle(Some(&ns(&title))) };
        match pick_reminder_list(&store, list_id.as_deref()) {
            Some(c) => unsafe { r.setCalendar(Some(&c)) },
            None => return Err("no reminders list available".to_string()),
        }
        if let Some(comps) = due.as_deref().and_then(components_from_ymd) {
            unsafe { r.setDueDateComponents(Some(&comps)) };
        }
        unsafe { store.saveReminder_commit_error(&r, true) }.map_err(err_str)?;
        Ok(unsafe { r.calendarItemIdentifier() }.to_string())
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}

#[tauri::command]
pub async fn eventkit_set_reminder_completed(id: String, completed: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let store = unsafe { EKEventStore::new() };
        let item = unsafe { store.calendarItemWithIdentifier(&ns(&id)) }.ok_or("reminder not found")?;
        let r = item.downcast::<EKReminder>().map_err(|_| "item is not a reminder".to_string())?;
        unsafe { r.setCompleted(completed) };
        unsafe { store.saveReminder_commit_error(&r, true) }.map_err(err_str)
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}

#[tauri::command]
pub async fn eventkit_delete_reminder(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let store = unsafe { EKEventStore::new() };
        let item = unsafe { store.calendarItemWithIdentifier(&ns(&id)) }.ok_or("reminder not found")?;
        let r = item.downcast::<EKReminder>().map_err(|_| "item is not a reminder".to_string())?;
        unsafe { store.removeReminder_commit_error(&r, true) }.map_err(err_str)
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}

#[tauri::command]
pub async fn eventkit_update_reminder(
    id: String,
    title: Option<String>,
    due: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let store = unsafe { EKEventStore::new() };
        let item = unsafe { store.calendarItemWithIdentifier(&ns(&id)) }.ok_or("reminder not found")?;
        let r = item.downcast::<EKReminder>().map_err(|_| "item is not a reminder".to_string())?;
        if let Some(t) = &title {
            unsafe { r.setTitle(Some(&ns(t))) };
        }
        if let Some(comps) = due.as_deref().and_then(components_from_ymd) {
            unsafe { r.setDueDateComponents(Some(&comps)) };
        }
        unsafe { store.saveReminder_commit_error(&r, true) }.map_err(err_str)
    })
    .await
    .map_err(|e| format!("eventkit task failed: {e}"))?
}
