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
