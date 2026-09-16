//! The apps strip: what's actually installed on this Mac, and opening it.
//!
//! "Add app" needs a list of real applications, and clicking one needs to launch the real thing.
//! Both are deliberately dumb — this module knows nothing about reading an app's contents, which
//! is the accessibility layer's job and requires a permission this one never needs.
//!
//! THAT SEPARATION IS THE POINT. Launching an app costs no TCC grant at all, so adding something
//! to the strip can always succeed. Reading from it is a separate, later, optional ask. A user who
//! declines the read permission still gets a working launcher instead of a dead button — which
//! keeps "not now" genuinely free, and macOS prompts are one-shot, so free matters.

use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct InstalledApp {
    pub name: String,
    pub bundle_id: String,
    pub path: String,
}

/// Directories macOS keeps applications in. `~/Applications` is included because plenty of tools
/// install per-user and would otherwise be invisible in the picker for no good reason.
#[cfg(target_os = "macos")]
fn app_dirs() -> Vec<std::path::PathBuf> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    vec![
        std::path::PathBuf::from("/Applications"),
        std::path::PathBuf::from("/System/Applications"),
        std::path::PathBuf::from("/System/Applications/Utilities"),
        std::path::PathBuf::from(&home).join("Applications"),
    ]
}

/// The display name for a bundle: `CFBundleDisplayName`, else `CFBundleName`, else the folder.
///
/// Falling back to the folder name matters — some bundles declare neither key, and a picker row
/// reading "(unknown)" is worse than one reading "Numbers".
pub fn display_name(plist: &str, fallback_file_stem: &str) -> String {
    for key in ["CFBundleDisplayName", "CFBundleName"] {
        if let Some(v) = plist_string(plist, key) {
            if !v.trim().is_empty() {
                return v;
            }
        }
    }
    fallback_file_stem.to_string()
}

/// Pull one `<key>…</key><string>…</string>` pair out of an XML plist.
///
/// Deliberately not a full plist parser: two keys are needed and many Info.plists are BINARY, which
/// no amount of XML parsing will read. Those fall back to the folder name, which is almost always
/// the app's name anyway — `Google Chrome.app` really is Google Chrome.
pub fn plist_string(plist: &str, key: &str) -> Option<String> {
    let needle = format!("<key>{key}</key>");
    let start = plist.find(&needle)? + needle.len();
    let rest = &plist[start..];
    let open = rest.find("<string>")? + "<string>".len();
    let close = rest.find("</string>")?;
    if close < open {
        return None;
    }
    let raw = rest[open..close].trim();
    if raw.is_empty() {
        return None;
    }
    Some(
        raw.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'"),
    )
}

/// Should this bundle appear in the picker?
///
/// Filters the things nobody adds to a strip: our own app, and the helper bundles Apple ships that
/// are technically applications but are really installers and agents.
pub fn is_pickable(name: &str, bundle_id: &str) -> bool {
    if bundle_id == "com.gitlayton.agentforge" {
        return false; // adding Docent to Docent
    }
    const NOISE: [&str; 6] = [
        "Migration Assistant",
        "Boot Camp Assistant",
        "Feedback Assistant",
        "VoiceOver Utility",
        "Screen Sharing",
        "Print Center",
    ];
    !NOISE.contains(&name) && !name.is_empty()
}

/// Every application installed on this Mac, sorted by name.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn list_installed_apps() -> Result<Vec<InstalledApp>, String> {
    let mut out: Vec<InstalledApp> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for dir in app_dirs() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue; // a directory that doesn't exist is normal, not an error
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("app") {
                continue;
            }
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();

            let plist = std::fs::read_to_string(path.join("Contents/Info.plist")).unwrap_or_default();
            let bundle_id = match plist_string(&plist, "CFBundleIdentifier") {
                Some(id) => id,
                // Without a bundle id there is nothing stable to launch or remember it by.
                None => continue,
            };
            let name = display_name(&plist, &stem);

            if !is_pickable(&name, &bundle_id) || !seen.insert(bundle_id.clone()) {
                continue;
            }
            out.push(InstalledApp {
                name,
                bundle_id,
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Launch an app by bundle id.
///
/// Costs no permission — this is the same thing double-clicking it in Finder does. Deliberately
/// takes a bundle id rather than a path: paths move when an app updates, bundle ids don't.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn launch_app(bundle_id: String) -> Result<(), String> {
    if bundle_id.trim().is_empty() {
        return Err("no application given".into());
    }
    let status = std::process::Command::new("open")
        .args(["-b", bundle_id.trim()])
        .status()
        .map_err(|e| format!("could not launch: {e}"))?;
    if !status.success() {
        return Err(format!("{bundle_id} could not be opened — it may have been moved or removed"));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn list_installed_apps() -> Result<Vec<InstalledApp>, String> {
    Err("listing applications is only available on macOS".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn launch_app(_bundle_id: String) -> Result<(), String> {
    Err("launching applications is only available on macOS".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLIST: &str = r#"<?xml version="1.0"?><plist><dict>
        <key>CFBundleName</key><string>Notes</string>
        <key>CFBundleIdentifier</key><string>com.apple.Notes</string>
    </dict></plist>"#;

    #[test]
    fn reads_the_keys_it_needs() {
        assert_eq!(plist_string(PLIST, "CFBundleIdentifier").as_deref(), Some("com.apple.Notes"));
        assert_eq!(plist_string(PLIST, "CFBundleName").as_deref(), Some("Notes"));
    }

    #[test]
    fn a_missing_key_is_none_rather_than_a_wrong_value() {
        // Reading the NEXT key's string when one is absent would silently mislabel apps.
        assert_eq!(plist_string(PLIST, "CFBundleDisplayName"), None);
    }

    #[test]
    fn prefers_the_display_name_when_an_app_has_one() {
        let p = r#"<key>CFBundleDisplayName</key><string>Google Chrome</string>
                   <key>CFBundleName</key><string>Chrome</string>"#;
        assert_eq!(display_name(p, "Google Chrome"), "Google Chrome");
    }

    #[test]
    fn falls_back_to_the_folder_name_for_a_binary_plist() {
        // Many Info.plists are binary, so the XML scan finds nothing. The folder name is almost
        // always right, and is certainly better than "(unknown)".
        assert_eq!(display_name("\u{0}bplist00garbage", "Numbers"), "Numbers");
    }

    #[test]
    fn decodes_escaped_entities() {
        let p = r#"<key>CFBundleName</key><string>Rock &amp; Roll</string>"#;
        assert_eq!(plist_string(p, "CFBundleName").as_deref(), Some("Rock & Roll"));
    }

    #[test]
    fn never_offers_docent_itself() {
        assert!(!is_pickable("Docent", "com.gitlayton.agentforge"));
        assert!(is_pickable("Notes", "com.apple.Notes"));
    }

    #[test]
    fn filters_helper_bundles_nobody_would_add() {
        assert!(!is_pickable("Migration Assistant", "com.apple.MigrateAssistant"));
        assert!(!is_pickable("", "com.example.nameless"));
    }

    #[test]
    fn malformed_plists_do_not_panic() {
        for junk in ["", "<key>CFBundleName</key>", "<string>orphan</string>", "<key>CFBundleName</key><string>"] {
            let _ = plist_string(junk, "CFBundleName");
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod live {
    /// DIAGNOSTIC — proves the scan finds real applications on this Mac. #[ignore]d: it depends on
    /// what is installed, which is not a thing to assert in CI.
    #[test]
    #[ignore]
    fn lists_what_is_installed() {
        let apps = super::list_installed_apps().expect("scan should not error");
        eprintln!("[apps] {} applications found", apps.len());
        for a in apps.iter().take(12) {
            eprintln!("  {:<28} {}", a.name, a.bundle_id);
        }
        assert!(apps.len() > 5, "a Mac should have more than a handful of apps");
        assert!(apps.iter().all(|a| a.bundle_id != "com.gitlayton.agentforge"));
    }
}
