//! Local-first iMessage layer.
//!
//! Unlike mail (open IMAP/SMTP), iMessage has no server protocol — it lives entirely on the Mac:
//!   * READING  — the `~/Library/Messages/chat.db` SQLite database. Requires the app to have
//!                **Full Disk Access** (a macOS TCC permission the user grants in System Settings).
//!   * SENDING  — AppleScript driving Messages.app. Requires **Automation** permission (granted via
//!                a system prompt the first time we try to send).
//!
//! Mirrors mail.rs: blocking work (rusqlite + osascript) runs on a blocking thread so the async
//! runtime stays free, and every command surfaces a plain-string error the UI can show verbatim.

use rusqlite::OpenFlags;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Path to the live Messages database in the user's home Library.
fn chat_db_path() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    format!("{home}/Library/Messages/chat.db")
}

/// Open chat.db read-only. A failure here is almost always missing Full Disk Access (TCC), so the
/// error string points the user at the fix.
fn open_db() -> Result<rusqlite::Connection, String> {
    let path = chat_db_path();
    if !std::path::Path::new(&path).exists() {
        return Err("No Messages database found on this Mac (~/Library/Messages/chat.db).".to_string());
    }
    rusqlite::Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| {
        format!(
            "Could not open the Messages database — grant Agent Forge Full Disk Access in \
             System Settings → Privacy & Security → Full Disk Access, then reopen the app. ({e})"
        )
    })
}

/// Apple's Core Data timestamps count from 2001-01-01 UTC. Modern macOS stores nanoseconds; very
/// old databases stored seconds. Returns Unix milliseconds (what the JS frontend wants).
fn apple_date_to_unix_ms(date: i64) -> i64 {
    const APPLE_EPOCH_OFFSET_S: i64 = 978_307_200; // seconds between the Unix and Apple epochs
    if date == 0 {
        return 0;
    }
    if date > 1_000_000_000_000 {
        // nanoseconds since 2001
        date / 1_000_000 + APPLE_EPOCH_OFFSET_S * 1000
    } else {
        // seconds since 2001
        (date + APPLE_EPOCH_OFFSET_S) * 1000
    }
}

/// Find the first occurrence of `needle` in `hay`.
fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Pull the readable text out of a message's `attributedBody` BLOB.
///
/// On recent macOS the `message.text` column is often NULL and the body lives in `attributedBody`,
/// an `NSArchiver` "typedstream". The plain text is stored as an `NSString` right after the class
/// marker: `…NSString… 0x2B <len> <utf8 bytes>`. The length is one byte, or `0x81`/`0x82` flagging a
/// 2-/4-byte little-endian length. This is a pragmatic heuristic (not a full typedstream parser) but
/// it recovers the text for the overwhelming majority of plain-text messages.
fn decode_attributed_body(blob: &[u8]) -> String {
    let Some(marker) = find_subslice(blob, b"NSString") else {
        return String::new();
    };
    let mut i = marker + "NSString".len();
    // Advance to the inline-value marker '+' (0x2B).
    while i < blob.len() && blob[i] != 0x2B {
        i += 1;
    }
    if i >= blob.len() {
        return String::new();
    }
    i += 1; // step past '+'
    if i >= blob.len() {
        return String::new();
    }
    let len = match blob[i] {
        0x81 => {
            let l = u16::from_le_bytes([
                blob.get(i + 1).copied().unwrap_or(0),
                blob.get(i + 2).copied().unwrap_or(0),
            ]) as usize;
            i += 3;
            l
        }
        0x82 => {
            let l = u32::from_le_bytes([
                blob.get(i + 1).copied().unwrap_or(0),
                blob.get(i + 2).copied().unwrap_or(0),
                blob.get(i + 3).copied().unwrap_or(0),
                blob.get(i + 4).copied().unwrap_or(0),
            ]) as usize;
            i += 5;
            l
        }
        b => {
            i += 1;
            b as usize
        }
    };
    let end = i.saturating_add(len).min(blob.len());
    String::from_utf8_lossy(&blob[i..end]).trim().to_string()
}

/// Prefer the plain `text` column; fall back to decoding `attributedBody`.
fn message_text(text: &str, body: Option<&Vec<u8>>) -> String {
    let t = text.trim();
    if !t.is_empty() {
        return t.to_string();
    }
    body.map(|b| decode_attributed_body(b)).unwrap_or_default()
}

// ─── Contacts resolution ───────────────────────────────────────────────────
//
// chat.db only stores raw handles (phone numbers / emails). Names live in the macOS Contacts
// store: one or more `AddressBook-v22.abcddb` SQLite files under
// `~/Library/Application Support/AddressBook/` (covered by the same Full Disk Access). We build a
// handle→name lookup once and cache it for a minute so the list/thread polls stay cheap.

/// handle→display-name maps. Phones are keyed by their last 10 digits so the many ways a number can
/// be written ("+1 (555) 123-4567" vs "5551234567") still match; emails are keyed lowercased.
#[derive(Default)]
struct Contacts {
    by_phone: HashMap<String, String>,
    by_email: HashMap<String, String>,
}

impl Contacts {
    /// Resolve a handle to a contact name, or None if it isn't in the address book.
    fn resolve(&self, handle: &str) -> Option<String> {
        let h = handle.trim();
        if h.is_empty() {
            return None;
        }
        if h.contains('@') {
            self.by_email.get(&h.to_ascii_lowercase()).cloned()
        } else {
            phone_key(h).and_then(|k| self.by_phone.get(&k).cloned())
        }
    }
}

/// Normalise a phone string to its last 10 digits (the US national significant number). Returns None
/// for anything too short to be a real number (short codes, etc.), so they never false-match.
fn phone_key(raw: &str) -> Option<String> {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 7 {
        return None;
    }
    let start = digits.len().saturating_sub(10);
    Some(digits[start..].to_string())
}

/// Best display name from a Contacts record: "First Last" → nickname → organization.
fn contact_name(first: Option<String>, last: Option<String>, org: Option<String>, nick: Option<String>) -> Option<String> {
    let f = first.unwrap_or_default();
    let l = last.unwrap_or_default();
    let full = format!("{} {}", f.trim(), l.trim()).trim().to_string();
    if !full.is_empty() {
        return Some(full);
    }
    let nick = nick.unwrap_or_default();
    if !nick.trim().is_empty() {
        return Some(nick.trim().to_string());
    }
    let org = org.unwrap_or_default();
    if !org.trim().is_empty() {
        return Some(org.trim().to_string());
    }
    None
}

/// Every `AddressBook-v22.abcddb` on this Mac (the top-level db plus one per Source: local, iCloud…).
fn addressbook_dbs() -> Vec<std::path::PathBuf> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let base = format!("{home}/Library/Application Support/AddressBook");
    let mut out = Vec::new();
    let top = std::path::PathBuf::from(format!("{base}/AddressBook-v22.abcddb"));
    if top.exists() {
        out.push(top);
    }
    if let Ok(entries) = std::fs::read_dir(format!("{base}/Sources")) {
        for e in entries.flatten() {
            let p = e.path().join("AddressBook-v22.abcddb");
            if p.exists() {
                out.push(p);
            }
        }
    }
    out
}

/// Run one `(first, last, org, nick, handle)` query and fold the rows into `map`, keying each handle
/// via `key_fn`. Kept as its own fn so the prepared-statement borrow is scoped to the call (and
/// doesn't outlive `conn` in the loop below).
fn index_handles(
    conn: &rusqlite::Connection,
    sql: &str,
    map: &mut HashMap<String, String>,
    key_fn: impl Fn(&str) -> Option<String>,
) {
    let Ok(mut stmt) = conn.prepare(sql) else { return };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    }) else {
        return;
    };
    for (f, l, org, nick, raw) in rows.flatten() {
        if let (Some(name), Some(key)) = (contact_name(f, l, org, nick), raw.and_then(|r| key_fn(&r))) {
            map.entry(key).or_insert(name);
        }
    }
}

/// Read every address book and build the handle→name maps. Any unreadable source is skipped — if the
/// whole thing fails we just return empty maps and the UI falls back to showing raw handles.
fn load_contacts() -> Contacts {
    let mut c = Contacts::default();
    for db in addressbook_dbs() {
        let Ok(conn) = rusqlite::Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
            continue;
        };
        index_handles(
            &conn,
            "SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME, p.ZFULLNUMBER \
             FROM ZABCDPHONENUMBER p JOIN ZABCDRECORD r ON r.Z_PK = p.ZOWNER \
             WHERE p.ZFULLNUMBER IS NOT NULL",
            &mut c.by_phone,
            |s| phone_key(s),
        );
        index_handles(
            &conn,
            "SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME, e.ZADDRESS \
             FROM ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON r.Z_PK = e.ZOWNER \
             WHERE e.ZADDRESS IS NOT NULL",
            &mut c.by_email,
            |s| {
                let k = s.trim().to_ascii_lowercase();
                if k.is_empty() { None } else { Some(k) }
            },
        );
    }
    c
}

/// Process-wide contacts cache, rebuilt at most once a minute (contacts rarely change mid-session).
fn contacts() -> Arc<Contacts> {
    static CACHE: OnceLock<Mutex<Option<(Instant, Arc<Contacts>)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((built, c)) = guard.as_ref() {
        if built.elapsed() < Duration::from_secs(60) {
            return c.clone();
        }
    }
    let fresh = Arc::new(load_contacts());
    *guard = Some((Instant::now(), fresh.clone()));
    fresh
}

/// For a group chat with no explicit name, build one from its participant handles, resolving each to
/// a contact name where possible.
fn group_name_from_participants(participants: &str, contacts: &Contacts) -> String {
    participants
        .split(", ")
        .filter(|s| !s.is_empty())
        .map(|h| contacts.resolve(h).unwrap_or_else(|| h.to_string()))
        .collect::<Vec<_>>()
        .join(", ")
}

/// One conversation in the list, newest activity first.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImessageChat {
    chat_id: i64,
    guid: String,
    /// Best display name: explicit group name → participant handles → raw chat identifier.
    name: String,
    identifier: String,
    is_group: bool,
    service: String,
    last_text: String,
    last_date: i64,
    last_from_me: bool,
}

/// One message inside a thread.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImessageMessage {
    id: i64,
    text: String,
    from_me: bool,
    /// Sender handle (phone/email) — useful to label senders in group threads.
    handle: String,
    /// Resolved contact name for `handle`, or empty if not in the address book.
    sender_name: String,
    date: i64,
    service: String,
}

/// Connection probe: open chat.db and count conversations. Returns the chat count on success, so the
/// settings UI can confirm Full Disk Access the same way mail confirms IMAP login.
#[tauri::command]
pub async fn imessage_check_access() -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<u32, String> {
        let conn = open_db()?;
        conn.query_row("SELECT COUNT(*) FROM chat", [], |r| r.get(0))
            .map_err(|e| format!("Opened the database but could not read it: {e}"))
    })
    .await
    .map_err(|e| format!("imessage task failed: {e}"))?
}

/// Open System Settings → Privacy & Security → Full Disk Access.
///
/// Uses the macOS `open` CLI because it reliably handles the `x-apple.systempreferences:` URL
/// scheme — the webview's opener plugin silently does nothing with it.
#[tauri::command]
pub fn imessage_open_fda_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open System Settings: {e}"))
}

/// Count unread incoming messages — the badge number (mirrors what Messages.app shows).
#[tauri::command]
pub async fn imessage_unread_count() -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<u32, String> {
        let conn = open_db()?;
        conn.query_row(
            "SELECT COUNT(*) FROM message WHERE is_from_me = 0 AND is_read = 0",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("unread count failed: {e}"))
    })
    .await
    .map_err(|e| format!("imessage task failed: {e}"))?
}

/// List the most recent `limit` conversations, each with a one-line preview of its latest message.
#[tauri::command]
pub async fn imessage_list_chats(limit: u32) -> Result<Vec<ImessageChat>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<ImessageChat>, String> {
        let conn = open_db()?;
        let contacts = contacts();
        let want = limit.max(1);
        // Latest message per chat (correlated MAX(date)); GROUP BY collapses ties on identical dates.
        let mut stmt = conn
            .prepare(
                "SELECT c.ROWID, c.guid, c.chat_identifier, COALESCE(c.display_name, ''), c.style, \
                        COALESCE(c.service_name, ''), COALESCE(m.text, ''), m.attributedBody, \
                        m.is_from_me, m.date, \
                        (SELECT GROUP_CONCAT(h.id, ', ') FROM chat_handle_join chj \
                           JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID) \
                 FROM chat c \
                 JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID \
                 JOIN message m ON m.ROWID = cmj.message_id \
                 WHERE m.date = ( \
                     SELECT MAX(m2.date) FROM chat_message_join cmj2 \
                       JOIN message m2 ON m2.ROWID = cmj2.message_id \
                       WHERE cmj2.chat_id = c.ROWID) \
                 GROUP BY c.ROWID \
                 ORDER BY m.date DESC \
                 LIMIT ?1",
            )
            .map_err(|e| format!("query prepare failed: {e}"))?;

        let rows = stmt
            .query_map([want], |row| {
                let chat_id: i64 = row.get(0)?;
                let guid: String = row.get(1)?;
                let identifier: String = row.get(2)?;
                let display_name: String = row.get(3)?;
                let style: i64 = row.get(4)?;
                let service: String = row.get(5)?;
                let text: String = row.get(6)?;
                let body: Option<Vec<u8>> = row.get(7)?;
                let from_me: i64 = row.get(8)?;
                let date: i64 = row.get(9)?;
                let participants: Option<String> = row.get(10)?;

                let is_group = style == 43;
                let name = if !display_name.trim().is_empty() {
                    display_name
                } else if is_group {
                    match participants {
                        Some(p) if !p.is_empty() => group_name_from_participants(&p, &contacts),
                        _ => identifier.clone(),
                    }
                } else {
                    // 1:1 → resolve the other party's handle to their contact name.
                    contacts.resolve(&identifier).unwrap_or_else(|| identifier.clone())
                };
                Ok(ImessageChat {
                    chat_id,
                    guid,
                    name,
                    identifier,
                    is_group,
                    service,
                    last_text: message_text(&text, body.as_ref()),
                    last_date: apple_date_to_unix_ms(date),
                    last_from_me: from_me != 0,
                })
            })
            .map_err(|e| format!("query failed: {e}"))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| format!("row read failed: {e}"))?);
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("imessage task failed: {e}"))?
}

/// Fetch the most recent `limit` messages in one conversation, oldest→newest (chat order).
#[tauri::command]
pub async fn imessage_fetch_messages(chat_id: i64, limit: u32) -> Result<Vec<ImessageMessage>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<ImessageMessage>, String> {
        let conn = open_db()?;
        let contacts = contacts();
        let want = limit.max(1);
        let mut stmt = conn
            .prepare(
                "SELECT m.ROWID, COALESCE(m.text, ''), m.attributedBody, m.is_from_me, m.date, \
                        COALESCE(h.id, ''), COALESCE(m.service, '') \
                 FROM chat_message_join cmj \
                 JOIN message m ON m.ROWID = cmj.message_id \
                 LEFT JOIN handle h ON h.ROWID = m.handle_id \
                 WHERE cmj.chat_id = ?1 \
                 ORDER BY m.date DESC \
                 LIMIT ?2",
            )
            .map_err(|e| format!("query prepare failed: {e}"))?;

        let rows = stmt
            .query_map(rusqlite::params![chat_id, want], |row| {
                let id: i64 = row.get(0)?;
                let text: String = row.get(1)?;
                let body: Option<Vec<u8>> = row.get(2)?;
                let from_me: i64 = row.get(3)?;
                let date: i64 = row.get(4)?;
                let handle: String = row.get(5)?;
                let service: String = row.get(6)?;
                let sender_name = contacts.resolve(&handle).unwrap_or_default();
                Ok(ImessageMessage {
                    id,
                    text: message_text(&text, body.as_ref()),
                    from_me: from_me != 0,
                    handle,
                    sender_name,
                    date: apple_date_to_unix_ms(date),
                    service,
                })
            })
            .map_err(|e| format!("query failed: {e}"))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| format!("row read failed: {e}"))?);
        }
        out.reverse(); // oldest first for natural reading order
        Ok(out)
    })
    .await
    .map_err(|e| format!("imessage task failed: {e}"))?
}

/// Send a message to an existing conversation by its chat GUID (e.g. `iMessage;-;+15551234567`).
///
/// Using the chat GUID is service-correct — it routes over iMessage or SMS exactly as the existing
/// thread does. Text is passed to AppleScript as a `run` argument (not interpolated into the script),
/// so quotes/newlines/backslashes in the message are handled natively and there's no injection risk.
#[tauri::command]
pub async fn imessage_send(chat_guid: String, text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if text.trim().is_empty() {
            return Err("Can't send an empty message.".to_string());
        }
        if chat_guid.trim().is_empty() {
            return Err("Missing conversation id.".to_string());
        }
        let script = "on run {msg, gid}\n\
                      \ttell application \"Messages\" to send msg to chat id gid\n\
                      end run";
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .arg(&text)
            .arg(&chat_guid)
            .output()
            .map_err(|e| format!("could not run osascript: {e}"))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!(
                "Messages refused to send: {err}. If this is the first time, allow Agent Forge to \
                 control Messages in System Settings → Privacy & Security → Automation."
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("imessage task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apple_nanoseconds_convert_to_unix_ms() {
        // 2022-01-01T00:00:00Z = 662688000 s after the Apple epoch = 1640995200 s Unix.
        let apple_ns = 662_688_000i64 * 1_000_000_000;
        assert_eq!(apple_date_to_unix_ms(apple_ns), 1_640_995_200_000);
    }

    #[test]
    fn apple_seconds_legacy_convert_to_unix_ms() {
        let apple_s = 662_688_000i64; // legacy seconds form
        assert_eq!(apple_date_to_unix_ms(apple_s), 1_640_995_200_000);
    }

    #[test]
    fn zero_date_stays_zero() {
        assert_eq!(apple_date_to_unix_ms(0), 0);
    }

    #[test]
    fn decodes_short_attributed_body() {
        // Minimal typedstream-ish blob: marker, '+', 1-byte length, then UTF-8 text.
        let mut blob = b"streamtyped...NSString".to_vec();
        blob.push(0x2B); // '+'
        blob.push(5); // length
        blob.extend_from_slice(b"hello");
        blob.extend_from_slice(&[0x86, 0x84]); // trailing control bytes, ignored
        assert_eq!(decode_attributed_body(&blob), "hello");
    }

    #[test]
    fn phone_key_matches_across_formats() {
        // A handle and a contact written differently should land on the same key.
        assert_eq!(phone_key("+1 (555) 123-4567").as_deref(), Some("5551234567"));
        assert_eq!(phone_key("+15551234567").as_deref(), Some("5551234567"));
        assert_eq!(phone_key("5551234567").as_deref(), Some("5551234567"));
        // Too short to be a real number → no key (avoids false matches on short codes).
        assert_eq!(phone_key("262966"), None);
    }

    #[test]
    fn contact_name_prefers_full_then_nick_then_org() {
        assert_eq!(contact_name(Some("Ada".into()), Some("Lovelace".into()), None, None).as_deref(), Some("Ada Lovelace"));
        assert_eq!(contact_name(None, None, None, Some("Ace".into())).as_deref(), Some("Ace"));
        assert_eq!(contact_name(None, None, Some("Analytical Engines".into()), None).as_deref(), Some("Analytical Engines"));
        assert_eq!(contact_name(None, None, None, None), None);
    }

    #[test]
    fn empty_text_falls_back_to_body() {
        let mut blob = b"NSString".to_vec();
        blob.push(0x2B);
        blob.push(2);
        blob.extend_from_slice(b"hi");
        assert_eq!(message_text("   ", Some(&blob)), "hi");
        assert_eq!(message_text("real", Some(&blob)), "real");
    }
}
