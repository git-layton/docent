//! Local-first mail layer.
//!
//! Connects to standard IMAP/SMTP using **app-specific passwords**, which sidestep the provider
//! web-login walls entirely (the thing that blocked the embedded webview). No OAuth, no proprietary
//! API — just open protocols the user controls. Credentials live in the macOS Keychain (added next
//! to the existing browser-password keychain usage).
//!
//! This first slice is a connection probe: verify credentials and report the INBOX message count.
//! Fetch (read) and SMTP (send) build on the same provider presets.

/// IMAP host/port for a known provider.
///
/// Gmail and iCloud both expose standard IMAPS on 993 and accept app-specific passwords.
fn imap_endpoint(provider: &str) -> Result<(&'static str, u16), String> {
    match provider.to_ascii_lowercase().as_str() {
        "gmail" | "google" => Ok(("imap.gmail.com", 993)),
        "icloud" | "apple" | "me" => Ok(("imap.mail.me.com", 993)),
        other => Err(format!("unknown mail provider '{other}' (expected 'gmail' or 'icloud')")),
    }
}

/// Verify IMAP credentials by logging in and selecting INBOX. Returns the message count on success.
///
/// `imap` is a blocking client, so the work runs on a blocking thread to keep the async runtime free.
#[tauri::command]
pub async fn mail_test_connection(
    provider: String,
    email: String,
    password: String,
) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<u32, String> {
        let (host, port) = imap_endpoint(&provider)?;
        let tls = native_tls::TlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS init failed: {e}"))?;
        let client = imap::connect((host, port), host, &tls)
            .map_err(|e| format!("could not reach {host}:{port}: {e}"))?;
        let mut session = client
            .login(&email, &password)
            .map_err(|(e, _client)| format!("login rejected: {e}"))?;
        let mailbox = session
            .select("INBOX")
            .map_err(|e| format!("could not open INBOX: {e}"))?;
        let _ = session.logout();
        Ok(mailbox.exists)
    })
    .await
    .map_err(|e| format!("mail task failed: {e}"))?
}

/// A single message header for the inbox list. Returned newest-first.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailHeader {
    uid: u32,
    from_name: String,
    from_email: String,
    subject: String,
    date: String,
    seen: bool,
}

/// Fetch the most recent `limit` headers from INBOX (ENVELOPE + flags only — cheap, no bodies).
///
/// NOTE: subjects/sender names are decoded as lossy UTF-8 for now; MIME encoded-word subjects
/// (`=?UTF-8?B?…?=`) will look raw until we add a decoder or fetch+parse full headers.
#[tauri::command]
pub async fn mail_fetch_recent(
    provider: String,
    email: String,
    password: String,
    limit: u32,
) -> Result<Vec<MailHeader>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<MailHeader>, String> {
        let (host, port) = imap_endpoint(&provider)?;
        let tls = native_tls::TlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS init failed: {e}"))?;
        let client = imap::connect((host, port), host, &tls)
            .map_err(|e| format!("could not reach {host}:{port}: {e}"))?;
        let mut session = client
            .login(&email, &password)
            .map_err(|(e, _client)| format!("login rejected: {e}"))?;
        let mailbox = session
            .select("INBOX")
            .map_err(|e| format!("could not open INBOX: {e}"))?;

        let total = mailbox.exists;
        if total == 0 {
            let _ = session.logout();
            return Ok(Vec::new());
        }

        // Sequence numbers are oldest→newest, so the last `want` are the most recent.
        let want = limit.max(1);
        let start = if total > want { total - want + 1 } else { 1 };
        let seq = format!("{start}:{total}");
        let fetches = session
            .fetch(seq, "(UID ENVELOPE FLAGS)")
            .map_err(|e| format!("fetch failed: {e}"))?;

        let mut out: Vec<MailHeader> = Vec::with_capacity(fetches.len());
        for msg in fetches.iter() {
            let seen = msg.flags().iter().any(|f| matches!(f, imap::types::Flag::Seen));
            let env = msg.envelope();
            let subject = env
                .and_then(|e| e.subject)
                .map(|b| String::from_utf8_lossy(b).trim().to_string())
                .unwrap_or_default();
            let date = env
                .and_then(|e| e.date)
                .map(|b| String::from_utf8_lossy(b).to_string())
                .unwrap_or_default();
            let (from_name, from_email) = env
                .and_then(|e| e.from.as_ref())
                .and_then(|v| v.first())
                .map(|a| {
                    let name = a.name.map(|b| String::from_utf8_lossy(b).trim().to_string()).unwrap_or_default();
                    let mbox = a.mailbox.map(|b| String::from_utf8_lossy(b).to_string()).unwrap_or_default();
                    let h = a.host.map(|b| String::from_utf8_lossy(b).to_string()).unwrap_or_default();
                    let em = if mbox.is_empty() || h.is_empty() { String::new() } else { format!("{mbox}@{h}") };
                    (name, em)
                })
                .unwrap_or_default();
            out.push(MailHeader {
                uid: msg.uid.unwrap_or(0),
                from_name,
                from_email,
                subject,
                date,
                seen,
            });
        }
        let _ = session.logout();
        out.reverse(); // newest first
        Ok(out)
    })
    .await
    .map_err(|e| format!("mail task failed: {e}"))?
}

/// Parsed body + the header fields a reply needs.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailBody {
    from_name: String,
    from_email: String,
    to: Vec<String>,
    cc: Vec<String>,
    subject: String,
    message_id: String,
    text: String,
    html: String,
}

/// Collect the email addresses out of a parsed address header (To/Cc/From).
fn addr_emails(addr: Option<&mail_parser::Address>) -> Vec<String> {
    addr
        .map(|a| a.iter().filter_map(|x| x.address().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

/// Fetch and parse one message's body by UID. `mail-parser` handles MIME/multipart/encoding,
/// so `text` is the decoded plain-text part and `html` the HTML part (either may be empty).
#[tauri::command]
pub async fn mail_fetch_body(
    provider: String,
    email: String,
    password: String,
    uid: u32,
) -> Result<MailBody, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<MailBody, String> {
        let (host, port) = imap_endpoint(&provider)?;
        let tls = native_tls::TlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS init failed: {e}"))?;
        let client = imap::connect((host, port), host, &tls)
            .map_err(|e| format!("could not reach {host}:{port}: {e}"))?;
        let mut session = client
            .login(&email, &password)
            .map_err(|(e, _client)| format!("login rejected: {e}"))?;
        session.select("INBOX").map_err(|e| format!("could not open INBOX: {e}"))?;

        let fetches = session
            .uid_fetch(uid.to_string(), "(RFC822)")
            .map_err(|e| format!("fetch failed: {e}"))?;
        let msg = fetches.iter().next().ok_or_else(|| "message not found".to_string())?;
        let raw = msg.body().ok_or_else(|| "no body returned".to_string())?;

        let parsed = mail_parser::MessageParser::default()
            .parse(raw)
            .ok_or_else(|| "could not parse message".to_string())?;
        let text = parsed.body_text(0).map(|c| c.to_string()).unwrap_or_default();
        let html = parsed.body_html(0).map(|c| c.to_string()).unwrap_or_default();
        let from = parsed.from().and_then(|a| a.first());
        let from_name = from.and_then(|a| a.name()).unwrap_or_default().to_string();
        let from_email = from.and_then(|a| a.address()).unwrap_or_default().to_string();
        let to = addr_emails(parsed.to());
        let cc = addr_emails(parsed.cc());
        let subject = parsed.subject().unwrap_or_default().to_string();
        let message_id = parsed.message_id().unwrap_or_default().to_string();

        let _ = session.logout();
        Ok(MailBody { from_name, from_email, to, cc, subject, message_id, text, html })
    })
    .await
    .map_err(|e| format!("mail task failed: {e}"))?
}

/// Set or clear the \Seen flag on a message (mark read / unread).
#[tauri::command]
pub async fn mail_set_seen(
    provider: String,
    email: String,
    password: String,
    uid: u32,
    seen: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let (host, port) = imap_endpoint(&provider)?;
        let tls = native_tls::TlsConnector::builder().build().map_err(|e| format!("TLS init failed: {e}"))?;
        let client = imap::connect((host, port), host, &tls).map_err(|e| format!("could not reach {host}:{port}: {e}"))?;
        let mut session = client.login(&email, &password).map_err(|(e, _c)| format!("login rejected: {e}"))?;
        session.select("INBOX").map_err(|e| format!("could not open INBOX: {e}"))?;
        let query = if seen { "+FLAGS (\\Seen)" } else { "-FLAGS (\\Seen)" };
        session.uid_store(uid.to_string(), query).map_err(|e| format!("store failed: {e}"))?;
        let _ = session.logout();
        Ok(())
    })
    .await
    .map_err(|e| format!("mail task failed: {e}"))?
}

/// Delete a message — move it to the provider's Trash, falling back to \Deleted + expunge.
#[tauri::command]
pub async fn mail_delete(
    provider: String,
    email: String,
    password: String,
    uid: u32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let (host, port) = imap_endpoint(&provider)?;
        let tls = native_tls::TlsConnector::builder().build().map_err(|e| format!("TLS init failed: {e}"))?;
        let client = imap::connect((host, port), host, &tls).map_err(|e| format!("could not reach {host}:{port}: {e}"))?;
        let mut session = client.login(&email, &password).map_err(|(e, _c)| format!("login rejected: {e}"))?;
        session.select("INBOX").map_err(|e| format!("could not open INBOX: {e}"))?;
        let trash = match provider.to_ascii_lowercase().as_str() {
            "gmail" | "google" => "[Gmail]/Trash",
            _ => "Deleted Messages", // iCloud
        };
        let uid_s = uid.to_string();
        if session.uid_mv(&uid_s, trash).is_err() {
            // Fallback: flag deleted in INBOX and expunge.
            session.uid_store(&uid_s, "+FLAGS (\\Deleted)").map_err(|e| format!("delete-flag failed: {e}"))?;
            session.expunge().map_err(|e| format!("expunge failed: {e}"))?;
        }
        let _ = session.logout();
        Ok(())
    })
    .await
    .map_err(|e| format!("mail task failed: {e}"))?
}

/// SMTP endpoint: (host, use_starttls). Gmail uses implicit TLS on 465; iCloud uses STARTTLS on 587.
fn smtp_endpoint(provider: &str) -> Result<(&'static str, bool), String> {
    match provider.to_ascii_lowercase().as_str() {
        "gmail" | "google" => Ok(("smtp.gmail.com", false)),
        "icloud" | "apple" | "me" => Ok(("smtp.mail.me.com", true)),
        other => Err(format!("unknown mail provider '{other}'")),
    }
}

/// Send a message (new / reply / reply-all) via SMTP using the stored app password.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_send(
    provider: String,
    email: String,
    password: String,
    to: Vec<String>,
    cc: Vec<String>,
    subject: String,
    body: String,
    in_reply_to: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        use lettre::message::Mailbox;
        use lettre::transport::smtp::authentication::Credentials;
        use lettre::{Message, SmtpTransport, Transport};

        if to.is_empty() {
            return Err("no recipients".to_string());
        }
        let from_mbox: Mailbox = email.parse().map_err(|e| format!("bad from address: {e}"))?;
        let mut builder = Message::builder().from(from_mbox).subject(subject);
        for t in &to {
            builder = builder.to(t.parse::<Mailbox>().map_err(|e| format!("bad recipient '{t}': {e}"))?);
        }
        for c in &cc {
            if c.trim().is_empty() {
                continue;
            }
            builder = builder.cc(c.parse::<Mailbox>().map_err(|e| format!("bad cc '{c}': {e}"))?);
        }
        if let Some(id) = in_reply_to.filter(|s| !s.is_empty()) {
            // RFC wants the message-id in angle brackets; mail-parser strips them.
            let id = if id.starts_with('<') { id } else { format!("<{id}>") };
            builder = builder.in_reply_to(id.clone()).references(id);
        }
        let message = builder.body(body).map_err(|e| format!("could not build message: {e}"))?;

        let (host, starttls) = smtp_endpoint(&provider)?;
        let creds = Credentials::new(email.clone(), password.clone());
        let mailer = if starttls {
            SmtpTransport::starttls_relay(host).map_err(|e| format!("smtp setup: {e}"))?.credentials(creds).build()
        } else {
            SmtpTransport::relay(host).map_err(|e| format!("smtp setup: {e}"))?.credentials(creds).build()
        };
        mailer.send(&message).map_err(|e| format!("send failed: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("mail task failed: {e}"))?
}
