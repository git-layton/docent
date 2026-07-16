use std::sync::{Arc, Mutex};
use notify::Watcher;
use std::path::{Component, Path, PathBuf};
use sysinfo::{System, CpuRefreshKind, RefreshKind};
use tauri::{Emitter, Manager};
use futures_util::StreamExt;

mod mail;
mod imessage;
mod calendar;
mod notes;
mod music;
mod permissions;
mod pty;
mod screenshot;
mod input;
pub mod jobs;

// ─── App State ───────────────────────────────────────────────────────────────

struct LlamaState {
    pid: Mutex<Option<u32>>,
}

struct DownloadState {
    cancels: Mutex<std::collections::HashMap<String, bool>>,
    active: Mutex<std::collections::HashSet<String>>,
}
impl Default for DownloadState {
    fn default() -> Self {
        Self {
            cancels: Mutex::new(std::collections::HashMap::new()),
            active: Mutex::new(std::collections::HashSet::new()),
        }
    }
}

// Removes a filename from DownloadState.active when a download_model call returns,
// by any path (success, error, or cancel), so a slot can never get stuck "active".
struct ActiveGuard<'a> {
    set: &'a Mutex<std::collections::HashSet<String>>,
    name: String,
}
impl Drop for ActiveGuard<'_> {
    fn drop(&mut self) {
        self.set.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.name);
    }
}

// ─── Network Discovery State ─────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
struct NetworkPeer {
    id: String,
    name: String,
    ip: String,
}

struct PeerEntry {
    peer: NetworkPeer,
    last_seen_secs: u64,
}

struct NetworkState {
    active: bool,
    instance_id: String,
    display_name: String,
    stop_flag: Option<Arc<std::sync::atomic::AtomicBool>>,
    peers: Arc<Mutex<Vec<PeerEntry>>>,
}

impl Default for NetworkState {
    fn default() -> Self {
        Self {
            active: false,
            instance_id: String::new(),
            display_name: String::new(),
            stop_flag: None,
            peers: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

fn net_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// Caches the active tab captured BEFORE the spotlight window steals OS focus
#[derive(Default)]
struct TabCache(Mutex<Option<serde_json::Value>>);

// Persists a sysinfo System instance between CPU polls so delta is meaningful
struct SysState(Mutex<System>);

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn knowledge_core_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home).join("AgentForge")
}

fn models_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = std::path::PathBuf::from(home).join("AgentForge").join("models");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn is_safe_gguf_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && name.ends_with(".gguf")
        && name != ".gguf"
}

fn normalize_path_lexically(path: PathBuf) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(std::path::MAIN_SEPARATOR.to_string()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    normalized
}

pub(crate) fn knowledge_root() -> PathBuf {
    normalize_path_lexically(knowledge_core_path())
}

/// SEC-SYMLINK: defend the lexical jail against symlink escapes — an in-jail symlink pointing outside
/// the root must not let a read/write follow it out. The lexical `starts_with` check runs first; this
/// then canonicalizes the deepest EXISTING ancestor of the candidate (the leaf may not exist yet for a
/// write) and requires its REAL path to stay under canonicalize(root). If the root isn't materialized
/// yet there's nothing to resolve, so the lexical check stands.
fn assert_no_symlink_escape(root: &Path, candidate: &Path) -> Result<(), String> {
    let canon_root = match std::fs::canonicalize(root) {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };
    let mut anc = candidate;
    while !anc.exists() {
        match anc.parent() {
            Some(p) if p != anc => anc = p,
            _ => return Ok(()), // no existing ancestor to resolve — lexical check already passed
        }
    }
    match std::fs::canonicalize(anc) {
        Ok(real) if real.starts_with(&canon_root) => Ok(()),
        Ok(_) => Err("Path escapes the allowed root via a symlink".to_string()),
        Err(_) => Ok(()),
    }
}

fn knowledge_path_from_input(input: &str) -> Result<PathBuf, String> {
    let root = knowledge_root();
    let raw = PathBuf::from(input);
    let joined = if raw.is_absolute() { raw } else { root.join(raw) };
    let normalized = normalize_path_lexically(joined);
    if !normalized.starts_with(&root) {
        return Err("Path is outside the Knowledge Core".to_string());
    }
    assert_no_symlink_escape(&root, &normalized)?;
    Ok(normalized)
}

// ─── Agent workspace (the agent's own desk) ───────────────────────────────────
// `~/AgentForge/workspace` is the agent's free read/write area. It lives *inside* the git-backed
// Knowledge Core root, so every workspace write is versioned (an undo tape) for free — but it has its
// OWN, narrower jail so the agent's scratch files can never clobber the curated `memory/`/`library/`.
fn workspace_root() -> PathBuf {
    let root = normalize_path_lexically(knowledge_core_path().join("workspace"));
    let _ = std::fs::create_dir_all(&root);
    root
}

fn workspace_path_from_input(input: &str) -> Result<PathBuf, String> {
    let root = workspace_root();
    let raw = PathBuf::from(input);
    let joined = if raw.is_absolute() { raw } else { root.join(raw) };
    let normalized = normalize_path_lexically(joined);
    if !normalized.starts_with(&root) {
        return Err("Path is outside the agent workspace".to_string());
    }
    assert_no_symlink_escape(&root, &normalized)?;
    Ok(normalized)
}

/// Path relative to the workspace root, for display / events.
fn workspace_rel(path: &Path) -> String {
    path.strip_prefix(workspace_root())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string_lossy().to_string())
}

fn git_rel_path(path: &Path, root: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map_err(|_| "Path is outside the Knowledge Core".to_string())
        .map(|p| p.to_string_lossy().to_string())
}

fn is_safe_agent_id(agent_id: &str) -> bool {
    !agent_id.is_empty()
        && !agent_id.contains('/')
        && !agent_id.contains('\\')
        && agent_id != "."
        && agent_id != ".."
}

fn run_git(args: &[&str], cwd: &std::path::Path) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        // Non-interactive: never let a git child block on a credential prompt or an interactive
        // pager — a hung child would wedge GIT_LOCK and stall every Knowledge-Core writer.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// SSRF guard for backend-initiated HTTP downloads (download_model, browser_download_url): require
/// http(s) and reject hosts that are loopback / private / link-local / unspecified IP literals (and
/// "localhost"). NOTE: this does NOT resolve DNS and reqwest follows redirects, so a domain that
/// resolves to a private IP isn't caught here — full resolve-and-pin SSRF hardening is tracked for the
/// egress pass. This closes the obvious http://127.0.0.1 / http://169.254.169.254 (metadata) vectors.
fn is_blocked_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast()
        }
        std::net::IpAddr::V6(v6) => {
            // An IPv4-mapped address (e.g. ::ffff:127.0.0.1) must be judged by its V4 rules — V6
            // is_loopback() is false for it, so it would otherwise slip past as a public host.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(std::net::IpAddr::V4(v4));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // unique-local fc00::/7
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
        }
    }
}

fn egress_host_allowed(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "invalid URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("scheme '{}' not allowed", parsed.scheme()));
    }
    let host = parsed.host_str().ok_or_else(|| "URL has no host".to_string())?;
    if host.eq_ignore_ascii_case("localhost") {
        return Err("downloads from localhost are not allowed".to_string());
    }
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = bare.parse::<std::net::IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("downloads from loopback/private/link-local addresses are not allowed".to_string());
        }
    }
    Ok(())
}

fn parse_deletions(diff_stat: &str) -> u32 {
    // Match patterns like "3 deletions(-)" in git diff --stat output
    let mut last_n: Option<u32> = None;
    for (i, token) in diff_stat.split_whitespace().enumerate() {
        if let Ok(n) = token.parse::<u32>() {
            last_n = Some((i as u32, n)).map(|(_, v)| v);
            // peek at next token
            let tokens: Vec<&str> = diff_stat.split_whitespace().collect();
            if let Some(next) = tokens.get(i + 1) {
                if next.starts_with("deletion") {
                    return n;
                }
            }
        }
    }
    let _ = last_n; // suppress warning
    0
}

fn kill_llama(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-CONT", &pid.to_string()])
        .output();
    let _ = std::process::Command::new("kill")
        .args(["-KILL", &pid.to_string()])
        .output();
}

// ─── 1.1 RAM HUD ─────────────────────────────────────────────────────────────

// sysinfo's used_memory() on macOS counts reclaimable cache/inactive memory as
// "used" (and available_memory() returns 0), so `total - used` reports near-zero
// free memory and the HUD shows red even on a near-idle Mac. Parse `vm_stat` for
// the genuinely available pages instead — free + inactive + speculative + purgeable
// — which matches what Activity Monitor considers available.
fn real_available_mb(total_mb: u64) -> u64 {
    let out = match std::process::Command::new("vm_stat").output() {
        Ok(o) if o.status.success() => o,
        _ => return total_mb / 2, // unknown → assume half-free rather than fake "maxed"
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut page_size: u64 = 16384;
    let mut free = 0u64;
    let mut inactive = 0u64;
    let mut speculative = 0u64;
    let mut purgeable = 0u64;
    let pages = |line: &str| -> u64 {
        line.rsplit(':').next().unwrap_or("").trim().trim_end_matches('.').replace(',', "").parse().unwrap_or(0)
    };
    for line in text.lines() {
        if let Some(i) = line.find("page size of ") {
            if let Some(tok) = line[i + 13..].split_whitespace().next() {
                if let Ok(v) = tok.parse::<u64>() { page_size = v; }
            }
        } else if line.starts_with("Pages free:") { free = pages(line); }
        else if line.starts_with("Pages inactive:") { inactive = pages(line); }
        else if line.starts_with("Pages speculative:") { speculative = pages(line); }
        else if line.starts_with("Pages purgeable:") { purgeable = pages(line); }
    }
    let avail = (free + inactive + speculative + purgeable).saturating_mul(page_size) / 1024 / 1024;
    avail.min(total_mb)
}

#[tauri::command]
fn get_ram_stats() -> serde_json::Value {
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total_mb = sys.total_memory() / 1024 / 1024;
    let available_mb = real_available_mb(total_mb);
    let used_mb = total_mb.saturating_sub(available_mb);
    serde_json::json!({
        "total_mb": total_mb,
        "used_mb": used_mb,
        "available_mb": available_mb
    })
}

#[derive(serde::Serialize)]
struct HardwareSummary {
    total_mb: u64,
    chip: String,            // human label, e.g. "Apple M3 Pro" or the Intel brand string
    is_apple_silicon: bool,  // gates the bundled (arm64-only) llama-server engine
    arch: String,            // "aarch64" | "x86_64" | …
    cpu_count: usize,
}

// Chip + RAM in one shot. `is_apple_silicon` decides whether the bundled
// `llama-server` (arm64-only) can run — on Intel we must steer users to cloud.
#[tauri::command]
fn get_hardware_summary() -> HardwareSummary {
    let mut sys = System::new_all();
    sys.refresh_memory();
    sys.refresh_cpu_specifics(CpuRefreshKind::everything());

    let total_mb = sys.total_memory() / 1024 / 1024;
    let arch = std::env::consts::ARCH.to_string();
    let is_apple_silicon = cfg!(target_arch = "aarch64");
    let cpu_count = sys.cpus().len();

    let brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_default();
    let chip = if brand.is_empty() {
        if is_apple_silicon { "Apple Silicon".to_string() } else { arch.clone() }
    } else {
        brand
    };

    HardwareSummary { total_mb, chip, is_apple_silicon, arch, cpu_count }
}

// ─── 1.2 System Stats (CPU + RAM + Network) ──────────────────────────────────

#[tauri::command]
fn get_system_stats(state: tauri::State<SysState>) -> serde_json::Value {
    let mut sys = state.0.lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_cpu_specifics(CpuRefreshKind::everything());
    sys.refresh_memory();

    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let total_mb = sys.total_memory() / 1024 / 1024;
    let available_mb = real_available_mb(total_mb);
    let used_mb = total_mb.saturating_sub(available_mb);

    // Quick internet reachability: TCP connect to Cloudflare DNS with 800ms timeout
    let internet_ok = std::net::TcpStream::connect_timeout(
        &"1.1.1.1:53".parse().unwrap(),
        std::time::Duration::from_millis(800),
    ).is_ok();

    serde_json::json!({
        "cpu_pct": (cpu_usage * 10.0).round() / 10.0,
        "total_mb": total_mb,
        "used_mb": used_mb,
        "available_mb": available_mb,
        "internet": internet_ok,
    })
}

#[derive(serde::Serialize)]
struct HardwareProfile {
    total_mb: u64,
    critical_mb: u64,
    cooldown_mb: u64,
    recovery_mb: u64,
    hud_show_mb: u64,
    hud_warn_mb: u64,
    rag_results: usize,
    rag_snippet_chars: usize,
}

// ─── Dream Cycle Data Structures ─────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct DreamItem {
    pub id: String,
    pub r#type: String,              // "merged" | "updated" | "pruned"
    pub description: String,
    pub archive_paths: Vec<String>,
    pub original_paths: Vec<String>, // parallel to archive_paths — where to restore
    pub target_file: Option<String>,
    pub git_commits: Vec<String>,
    pub undone: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct DreamLog {
    pub timestamp: String,
    pub dismissed: bool,
    pub tokens_saved: u32,
    pub items_count: u32,
    pub items: Vec<DreamItem>,
}

#[tauri::command]
fn get_hardware_profile() -> HardwareProfile {
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total_mb = sys.total_memory() / 1024 / 1024;
    let total_gb = total_mb as f64 / 1024.0;

    // Safety valve scales proportionally: ~10% of total RAM is the critical floor
    let critical_mb = ((total_mb as f64 * 0.10) as u64).max(800);
    let cooldown_mb = (critical_mb as f64 * 1.875) as u64;
    let recovery_mb = (critical_mb as f64 * 3.125) as u64;

    HardwareProfile {
        total_mb,
        critical_mb,
        cooldown_mb,
        recovery_mb,
        hud_show_mb: (critical_mb as f64 * 2.5) as u64,
        hud_warn_mb: (critical_mb as f64 * 1.5) as u64,
        rag_results: (total_gb / 2.0).clamp(5.0, 12.0) as usize,
        rag_snippet_chars: (total_gb * 25.0).clamp(400.0, 1000.0) as usize,
    }
}

#[tauri::command]
fn spawn_llama_server(
    args: Vec<String>,
    state: tauri::State<LlamaState>,
) -> Result<serde_json::Value, String> {
    let binary = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("no parent dir")?
        .join("bin/llama-server");

    let child = std::process::Command::new(binary)
        .args(&args)
        .spawn()
        .map_err(|e| e.to_string())?;

    let pid = child.id();
    *state.pid.lock().unwrap_or_else(|e| e.into_inner()) = Some(pid);
    Ok(serde_json::json!({ "pid": pid }))
}

#[tauri::command]
fn sigstop_llama_server(state: tauri::State<LlamaState>) -> serde_json::Value {
    let pid = *state.pid.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(pid) = pid {
        let _ = std::process::Command::new("kill")
            .args(["-STOP", &pid.to_string()])
            .output();
        serde_json::json!({ "ok": true, "method": "pid", "pid": pid })
    } else {
        serde_json::json!({ "ok": false, "error": "No Agent Forge llama-server process is registered" })
    }
}

#[tauri::command]
fn sigcont_llama_server(state: tauri::State<LlamaState>) -> serde_json::Value {
    let pid = *state.pid.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(pid) = pid {
        let _ = std::process::Command::new("kill")
            .args(["-CONT", &pid.to_string()])
            .output();
        serde_json::json!({ "ok": true, "method": "pid", "pid": pid })
    } else {
        serde_json::json!({ "ok": false, "error": "No Agent Forge llama-server process is registered" })
    }
}

// ─── 1.2 Nuke Shield ─────────────────────────────────────────────────────────

/// Process-wide serialization for ALL Knowledge-Core git mutations. The agent workspace lives inside
/// the same repo (see `commit_workspace`), and the background Dream Cycle issues write/archive calls
/// concurrently with foreground writes — without this lock their `git stash`/`add`/`commit`/`pop`
/// sequences interleave and can corrupt or lose memory. Poison-tolerant: a panic mid-mutation must not
/// wedge every subsequent write. NON-reentrant — never acquire it twice on one call stack.
static GIT_LOCK: Mutex<()> = Mutex::new(());
fn git_guard() -> std::sync::MutexGuard<'static, ()> {
    GIT_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[tauri::command]
fn safe_write_file(path: String, content: String) -> serde_json::Value {
    let _git = git_guard();
    safe_write_file_inner(path, content)
}

/// Body of `safe_write_file`. The caller MUST already hold `GIT_LOCK` — `write_memory` calls this
/// directly while holding the guard, so it must not re-acquire (the lock is non-reentrant).
fn safe_write_file_inner(path: String, content: String) -> serde_json::Value {
    let repo_root = knowledge_root();
    let file_path = match knowledge_path_from_input(&path) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "blocked": true, "error": e }),
    };

    let existed_before = file_path.exists();
    let previous_content = if existed_before {
        std::fs::read_to_string(&file_path).ok()
    } else {
        None
    };
    let existing_lines = previous_content
        .as_deref()
            .map(|s| s.lines().count() as u32)
        .unwrap_or(0);

    if let Some(parent) = file_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&file_path, &content) {
        return serde_json::json!({ "blocked": false, "error": e.to_string() });
    }

    let diff_stat = run_git(&["diff", "--stat", "HEAD"], &repo_root).unwrap_or_default();
    let deletions = parse_deletions(&diff_stat);

    let threshold = (existing_lines as f32 * 0.4).max(5.0) as u32;
    let blocked = deletions > threshold || (existing_lines > 0 && deletions >= existing_lines);

    if blocked {
        if existed_before {
            if let Some(previous) = previous_content {
                let _ = std::fs::write(&file_path, previous);
            } else if let Ok(rel) = git_rel_path(&file_path, &repo_root) {
                let _ = run_git(&["checkout", "HEAD", "--", &rel], &repo_root);
            }
        } else {
            let _ = std::fs::remove_file(&file_path);
        }
    }

    serde_json::json!({
        "blocked": blocked,
        "deletions": deletions,
        "existing_lines": existing_lines,
        "diff_stat": diff_stat.trim(),
        "path": file_path.to_string_lossy()
    })
}

#[tauri::command]
fn rollback_file(path: String) -> serde_json::Value {
    let _git = git_guard();
    let repo_root = knowledge_root();
    let file_path = match knowledge_path_from_input(&path) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let rel = match git_rel_path(&file_path, &repo_root) {
        Ok(r) => r,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let result = run_git(&["checkout", "HEAD", "--", &rel], &repo_root);
    serde_json::json!({ "ok": result.is_ok(), "output": result.unwrap_or_default() })
}

// ─── 1.3 Knowledge Core ──────────────────────────────────────────────────────

#[tauri::command]
fn init_knowledge_core() -> serde_json::Value {
    let root = knowledge_root();

    // Always ensure subdirectory structure exists (idempotent)
    for subdir in &["memory/goals", "memory/decisions", "memory/metrics", "memory/research", "memory/memos", "library"] {
        let _ = std::fs::create_dir_all(root.join(subdir));
    }

    if root.join(".git").exists() {
        return serde_json::json!({ "initialized": false, "path": root.to_string_lossy() });
    }

    let _ = std::fs::write(
        root.join(".gitignore"),
        ".DS_Store\n*.tmp\n.obsidian/workspace\n.obsidian/workspace.json\n.index.db\n.lancedb/\n.models/\nworkspace/.dream_logs/\n",
    );

    let _ = std::fs::write(
        root.join("index.md"),
        "---\ntags: [index, agent-forge]\n---\n# Agent Forge — Knowledge Index\n\n\
## Goals\n- [[memory/goals/goals]]\n\n\
## Decisions\n- [[memory/decisions/decisions]]\n\n\
## Metrics\n- [[memory/metrics/metrics]]\n\n\
## Research\n- [[memory/research/research]]\n",
    );

    // MAINT-GITRACE: serialize first-init git against any concurrent writer / index thread.
    {
        let _git = git_guard();
        let _ = run_git(&["init"], &root);
        let _ = run_git(&["config", "user.email", "agent-forge@local"], &root);
        let _ = run_git(&["config", "user.name", "Agent Forge"], &root);
        let _ = run_git(&["add", "-A"], &root);
        let _ = run_git(&["commit", "-m", "init: Knowledge Core initialized"], &root);
    }

    serde_json::json!({ "initialized": true, "path": root.to_string_lossy() })
}

#[tauri::command]
fn write_memory(
    path: String,
    content: String,
    commit_message: String,
    agent_id: Option<String>,
    context_tokens: Option<u32>,
    ram_state: Option<String>,
) -> serde_json::Value {
    let _git = git_guard();
    let repo_root = knowledge_root();
    let file_path = match knowledge_path_from_input(&path) {
        Ok(p) => p,
        Err(e) => {
            return serde_json::json!({
                "blocked": true,
                "error": e,
                "conflict": false,
                "commit": null,
                "prune_suggested": false
            });
        }
    };
    let rel_path = match git_rel_path(&file_path, &repo_root) {
        Ok(r) => r,
        Err(e) => {
            return serde_json::json!({
                "blocked": true,
                "error": e,
                "conflict": false,
                "commit": null,
                "prune_suggested": false
            });
        }
    };

    let stash_out = run_git(&["stash", "--include-untracked"], &repo_root)
        .unwrap_or_default();
    let stashed = !stash_out.contains("No local changes");

    let write_result = safe_write_file_inner(file_path.to_string_lossy().to_string(), content.clone());
    if write_result["blocked"].as_bool().unwrap_or(false) {
        if stashed {
            let _ = run_git(&["stash", "pop"], &repo_root);
        }
        return serde_json::json!({
            "blocked": true,
            "deletions": write_result["deletions"],
            "existing_lines": write_result["existing_lines"],
            "diff_stat": write_result["diff_stat"],
            "error": write_result["error"],
            "conflict": false,
            "commit": null,
            "prune_suggested": false
        });
    }

    let full_message = format!(
        "{}\n\nAgent-ID: {}\nContext-Tokens: {}\nM1-RAM-State: {}",
        commit_message,
        agent_id.as_deref().unwrap_or("manual"),
        context_tokens
            .map(|n| n.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        ram_state.as_deref().unwrap_or("unknown")
    );

    let _ = run_git(&["add", &rel_path], &repo_root);
    let commit_out = run_git(&["commit", "-m", &full_message], &repo_root)
        .unwrap_or_default();
    let commit_hash = commit_out
        .lines()
        .find(|l| l.starts_with('['))
        .map(|l| l.to_string());

    let mut conflict = false;
    if stashed {
        let pop_out = run_git(&["stash", "pop"], &repo_root).unwrap_or_default();
        if pop_out.contains("CONFLICT") {
            conflict = true;
        }
    }

    let prune_suggested = rel_path.ends_with("index.md") && content.lines().count() > 200;

    serde_json::json!({
        "blocked": false,
        "conflict": conflict,
        "commit": commit_hash,
        "prune_suggested": prune_suggested
    })
}

// ─── 3.1 Knowledge Retrieval ─────────────────────────────────────────────────

fn walk_md_files(dir: &std::path::Path) -> Result<Vec<std::path::PathBuf>, String> {
    let mut out = Vec::new();
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().map(|n| n == ".archive").unwrap_or(false) { continue; }
            if let Ok(mut sub) = walk_md_files(&path) {
                out.append(&mut sub);
            }
        } else if matches!(path.extension().and_then(|s| s.to_str()), Some("md") | Some("txt")) {
            out.push(path);
        }
    }
    Ok(out)
}

fn strip_frontmatter(content: &str) -> String {
    if content.starts_with("---") {
        if let Some(end) = content[3..].find("---") {
            return content[3 + end + 3..].trim_start().to_string();
        }
    }
    content.to_string()
}

fn extract_title(content: &str, path: &std::path::Path) -> String {
    // Try `title:` in frontmatter
    if content.starts_with("---") {
        let mut lines = content.lines();
        lines.next(); // skip opening ---
        for line in lines {
            if line == "---" { break; }
            if let Some(v) = line.strip_prefix("title:") {
                return v.trim().trim_matches('"').to_string();
            }
        }
    }
    // Try first markdown heading
    for line in content.lines() {
        if let Some(h) = line.strip_prefix("# ") {
            return h.trim().to_string();
        }
    }
    // Fallback: filename stem
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

/// Normalize a keyword match into a [0,1] score comparable to the embedding path's cosine, so the
/// frontend's cosine thresholds (memoryContext 0.35 / semanticDocs 0.3) and the `score × 150`
/// interleaving stay correct when search_knowledge runs as the FALLBACK for search_knowledge_semantic.
/// Coverage (fraction of distinct query terms found) dominates; repetition adds a small saturating
/// bonus. Never exceeds 1.0 — a raw occurrence count must never reach the frontend as a "cosine".
fn keyword_relevance(matched_distinct: usize, total_keywords: usize, total_occurrences: usize) -> f64 {
    if total_keywords == 0 || matched_distinct == 0 { return 0.0; }
    let coverage = matched_distinct as f64 / total_keywords as f64;
    let occ = (total_occurrences as f64 / (total_keywords as f64 * 5.0)).min(1.0);
    (coverage * 0.85 + occ * 0.15).min(1.0)
}

#[tauri::command]
fn search_knowledge(query: String, extra_path: Option<String>, agent_id: Option<String>, max_results: Option<usize>, snippet_chars: Option<usize>) -> serde_json::Value {
    let root = knowledge_root();
    let query_lower = query.to_lowercase();
    let keywords: Vec<&str> = query_lower.split_whitespace().collect();
    let max_results = max_results.unwrap_or(5);
    let snippet_chars = snippet_chars.unwrap_or(400);

    let mut results: Vec<serde_json::Value> = Vec::new();

    let memory_dir = if let Some(ref aid) = agent_id {
        if !is_safe_agent_id(aid) {
            return serde_json::json!({ "results": [], "error": "Invalid agent id" });
        }
        root.join("memory").join(aid)
    } else {
        root.join("memory")
    };

    let mut dirs_to_search: Vec<std::path::PathBuf> = vec![
        root.join("library"),
        memory_dir,
    ];
    if let Some(ref ep) = extra_path {
        if let Ok(p) = knowledge_path_from_input(ep) {
            if p.exists() { dirs_to_search.push(p); }
        }
    }

    for dir in dirs_to_search {
        if !dir.exists() { continue; }
        let Ok(files) = walk_md_files(&dir) else { continue };

        for path in files {
            let Ok(content) = std::fs::read_to_string(&path) else { continue };
            let body = strip_frontmatter(&content);
            let body_lower = body.to_lowercase();

            let mut matched_distinct = 0usize;
            let mut total_occurrences = 0usize;
            for kw in &keywords {
                let c = body_lower.matches(*kw).count();
                if c > 0 { matched_distinct += 1; total_occurrences += c; }
            }
            if matched_distinct == 0 { continue; }
            // [0,1] cosine-comparable score (not a raw count) — see keyword_relevance.
            let score = keyword_relevance(matched_distinct, keywords.len(), total_occurrences);

            let title = extract_title(&content, &path);
            let snippet: String = body.chars().take(snippet_chars).collect();

            results.push(serde_json::json!({
                "path": path.to_string_lossy(),
                "title": title,
                "snippet": snippet,
                "score": score
            }));
        }
    }

    results.sort_by(|a, b| {
        let sa = a["score"].as_f64().unwrap_or(0.0);
        let sb = b["score"].as_f64().unwrap_or(0.0);
        sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(max_results);

    serde_json::json!({ "results": results })
}

// ─── 2.1 Memmo Engine ────────────────────────────────────────────────────────

#[tauri::command]
fn append_task(text: String, agent_id: Option<String>) -> serde_json::Value {
    let _git = git_guard(); // MAINT-GITRACE: serialize with all other Knowledge-Core git mutations
    let repo_root = knowledge_root();
    let tasks_path = if let Some(ref aid) = agent_id {
        if !is_safe_agent_id(aid) {
            return serde_json::json!({ "commit": null, "error": "Invalid agent id" });
        }
        repo_root.join("memory").join(aid).join("tasks.md")
    } else {
        repo_root.join("memory").join("tasks.md")
    };

    if let Some(parent) = tasks_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let existing = std::fs::read_to_string(&tasks_path)
        .unwrap_or_else(|_| "# Tasks\n".to_string());
    let new_content = format!("{}- [ ] {}\n", existing, text);

    if let Err(e) = std::fs::write(&tasks_path, &new_content) {
        return serde_json::json!({ "commit": null, "error": e.to_string() });
    }

    let rel_path = tasks_path.strip_prefix(&repo_root).unwrap_or(&tasks_path);
    let _ = run_git(&["add", &rel_path.to_string_lossy()], &repo_root);
    let short: String = text.chars().take(50).collect();
    let msg = format!("task: {}", short);
    let commit_out = run_git(&["commit", "-m", &msg], &repo_root).unwrap_or_default();
    let commit_hash = commit_out
        .lines()
        .find(|l| l.starts_with('['))
        .map(|l| l.to_string());

    serde_json::json!({ "commit": commit_hash })
}

#[tauri::command]
fn complete_task(
    title: String,
    details: String,
    due_date: String,
    completed_at: String,
) -> serde_json::Value {
    let _git = git_guard(); // MAINT-GITRACE: serialize with all other Knowledge-Core git mutations
    let repo_root = knowledge_root();
    let path = repo_root.join("memory").join("completed_tasks.md");

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let existing = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| "# Completed Tasks\n".to_string());
    let details_str = if details.is_empty() { "—".to_string() } else { details };
    let entry = format!(
        "\n## ✅ {}\n- **Completed**: {}\n- **Due**: {}\n- **Details**: {}\n",
        title, completed_at, due_date, details_str
    );
    let new_content = format!("{}{}", existing, entry);

    if let Err(e) = std::fs::write(&path, &new_content) {
        return serde_json::json!({ "ok": false, "error": e.to_string() });
    }

    let rel_path = path.strip_prefix(&repo_root).unwrap_or(&path);
    let _ = run_git(&["add", &rel_path.to_string_lossy()], &repo_root);
    let short: String = title.chars().take(50).collect();
    let msg = format!("complete: {}", short);
    let _ = run_git(&["commit", "-m", &msg], &repo_root);

    serde_json::json!({ "ok": true })
}

#[tauri::command]
fn revert_memory_commit(commit_hash: String) -> serde_json::Value {
    let _git = git_guard();
    let repo_root = knowledge_root();
    let result = run_git(&["revert", "--no-edit", &commit_hash], &repo_root);
    serde_json::json!({ "ok": result.is_ok(), "output": result.unwrap_or_default() })
}

// ─── 4.0 File Watcher + Index Queue ──────────────────────────────────────────

use std::sync::atomic::{AtomicBool, Ordering};

static WATCHER_RUNNING: AtomicBool = AtomicBool::new(false);

// SEC-RUNCMD: backend mirror of the frontend Developer-Mode toggle. run_command refuses to execute
// unless this is true, so a renderer bug / bypass of CommandActionCard can't reach a shell. Synced
// from the UI via set_developer_mode (an App.tsx effect fires on boot and every toggle).
static DEV_MODE: AtomicBool = AtomicBool::new(false);

// ─── Embedder Singleton ───────────────────────────────────────────────────────

use std::sync::OnceLock;

static EMBEDDER: OnceLock<Mutex<fastembed::TextEmbedding>> = OnceLock::new();

fn get_or_init_embedder() -> Result<&'static Mutex<fastembed::TextEmbedding>, String> {
    if let Some(e) = EMBEDDER.get() { return Ok(e); }
    let model = fastembed::TextEmbedding::try_new(
        fastembed::InitOptions::new(fastembed::EmbeddingModel::AllMiniLML6V2)
            .with_cache_dir(knowledge_root().join(".models")),
    ).map_err(|e| e.to_string())?;
    // Ignore error if another thread already set it
    let _ = EMBEDDER.set(Mutex::new(model));
    Ok(EMBEDDER.get().unwrap())
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() { return 0.0; }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 { 0.0 } else { dot / (na * nb) }
}

/// Memory "importance" in [0.05, 1.0], parsed from the gatekeeper frontmatter so retrieval can
/// prefer higher-confidence, better-sourced memories. A weak signal by design — it only modulates
/// ranking, never the relevance threshold. Mirrors the confidence/evidence labels in memoryGatekeeper.ts.
fn parse_memory_importance(content: &str) -> f32 {
    let head = content.chars().take(1200).collect::<String>().to_lowercase();
    let mut score: f32 = if head.contains("confidence: high") { 1.0 }
        else if head.contains("confidence: low") { 0.3 }
        else { 0.6 }; // medium / unlabeled
    if head.contains("evidence_state: needs_verification") || head.contains("evidence_state: conflicting") {
        score *= 0.6;
    } else if head.contains("evidence_state: inferred") {
        score *= 0.85;
    }
    score.clamp(0.05, 1.0)
}

/// Split document text into embeddable chunks.
fn chunk_text(content: &str) -> Vec<String> {
    let body = strip_frontmatter(content);
    let mut chunks: Vec<String> = Vec::new();

    // Split on ## headings first
    let sections: Vec<&str> = body.split("\n## ").collect();
    for (i, section) in sections.iter().enumerate() {
        let section = if i == 0 { section.to_string() } else { format!("## {section}") };
        if section.len() <= 1200 {
            let trimmed = section.trim().to_string();
            if trimmed.len() >= 60 { chunks.push(trimmed); }
        } else {
            // Split long sections by blank lines
            for para in section.split("\n\n") {
                let trimmed = para.trim().to_string();
                if trimmed.len() >= 60 { chunks.push(trimmed); }
            }
        }
    }
    chunks
}

fn open_index_db() -> Result<rusqlite::Connection, String> {
    let db_path = knowledge_root().join(".index.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS pending_index (
            file_path TEXT PRIMARY KEY,
            queued_at INTEGER NOT NULL,
            status    TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE TABLE IF NOT EXISTS brain_vectors (
            chunk_id      TEXT PRIMARY KEY,
            file_path     TEXT NOT NULL,
            chunk_index   INTEGER NOT NULL,
            content       TEXT NOT NULL,
            vector        BLOB NOT NULL,
            last_modified INTEGER NOT NULL,
            importance    REAL NOT NULL DEFAULT 0.5
        );
        CREATE INDEX IF NOT EXISTS idx_bv_file ON brain_vectors(file_path);",
    ).map_err(|e| e.to_string())?;
    // Migration for indexes created before the importance column existed. Older rows keep the 0.5
    // default until their file is touched and re-indexed; the duplicate-column error is expected on
    // fresh DBs (where CREATE TABLE already added it) and is intentionally ignored.
    let _ = conn.execute("ALTER TABLE brain_vectors ADD COLUMN importance REAL NOT NULL DEFAULT 0.5", []);
    Ok(conn)
}

fn queue_file_for_index(conn: &rusqlite::Connection, file_path: &str) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO pending_index (file_path, queued_at, status) VALUES (?1, ?2, 'pending')
         ON CONFLICT(file_path) DO UPDATE SET queued_at = ?2, status = 'pending'",
        rusqlite::params![file_path, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn walk_and_queue_dir(dir: &std::path::Path, conn: &rusqlite::Connection) -> u32 {
    let entries = match std::fs::read_dir(dir) { Ok(e) => e, Err(_) => return 0 };
    let mut count = 0u32;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        if path.is_dir() {
            if name == ".archive" { continue; }
            count += walk_and_queue_dir(&path, conn);
        } else if matches!(path.extension().and_then(|e| e.to_str()), Some("md") | Some("txt")) {
            if queue_file_for_index(conn, &path.to_string_lossy()).is_ok() {
                count += 1;
            }
        }
    }
    count
}

#[tauri::command]
fn init_file_watcher() {
    // Guard: only one watcher thread ever
    if WATCHER_RUNNING.swap(true, Ordering::SeqCst) { return; }

    // Embedder thread: loads model then drains the pending_index queue
    std::thread::spawn(|| {
        let embedder = match get_or_init_embedder() {
            Ok(e) => e,
            Err(e) => { eprintln!("[embedder] Init failed: {e}"); return; }
        };
        loop {
            let conn = match open_index_db() {
                Ok(c) => c,
                Err(_) => { std::thread::sleep(std::time::Duration::from_secs(10)); continue; }
            };
            let pending: Vec<String> = conn
                .prepare("SELECT file_path FROM pending_index WHERE status = 'pending' LIMIT 10")
                .and_then(|mut s| s.query_map([], |r| r.get(0)).map(|it| it.flatten().collect()))
                .unwrap_or_default();

            if pending.is_empty() {
                std::thread::sleep(std::time::Duration::from_secs(5));
                continue;
            }

            for file_path in pending {
                let content = match std::fs::read_to_string(&file_path) { Ok(c) => c, Err(_) => continue };
                let mtime = std::fs::metadata(&file_path).ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64).unwrap_or(0);
                let importance = parse_memory_importance(&content);

                let _ = conn.execute("DELETE FROM brain_vectors WHERE file_path = ?1", rusqlite::params![&file_path]);

                let chunks = chunk_text(&content);
                if chunks.is_empty() {
                    let _ = conn.execute("UPDATE pending_index SET status='indexed' WHERE file_path=?1", rusqlite::params![&file_path]);
                    continue;
                }

                let texts: Vec<&str> = chunks.iter().map(|s| s.as_str()).collect();
                let embeddings = {
                    let guard = embedder.lock().unwrap_or_else(|e| e.into_inner());
                    match guard.embed(texts, None) { Ok(e) => e, Err(e) => { eprintln!("[embedder] embed error: {e}"); continue; } }
                };

                for (i, (chunk, vector)) in chunks.iter().zip(embeddings.iter()).enumerate() {
                    let chunk_id = format!("{file_path}#{i}");
                    let blob: Vec<u8> = vector.iter().flat_map(|f| f.to_le_bytes()).collect();
                    let _ = conn.execute(
                        "INSERT OR REPLACE INTO brain_vectors (chunk_id, file_path, chunk_index, content, vector, last_modified, importance) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                        rusqlite::params![chunk_id, &file_path, i as i64, chunk, blob, mtime, importance as f64],
                    );
                }
                let _ = conn.execute("UPDATE pending_index SET status='indexed' WHERE file_path=?1", rusqlite::params![&file_path]);
            }
        }
    });

    std::thread::spawn(|| {
        let watch_path = knowledge_root();
        if !watch_path.exists() {
            WATCHER_RUNNING.store(false, Ordering::SeqCst);
            return;
        }

        let conn = match open_index_db() {
            Ok(c) => c,
            Err(e) => { eprintln!("[watcher] DB init failed: {e}"); WATCHER_RUNNING.store(false, Ordering::SeqCst); return; }
        };

        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher: notify::RecommendedWatcher = match notify::RecommendedWatcher::new(
            move |event| { let _ = tx.send(event); },
            notify::Config::default(),
        ) {
            Ok(w) => w,
            Err(e) => { eprintln!("[watcher] Create failed: {e}"); WATCHER_RUNNING.store(false, Ordering::SeqCst); return; }
        };

        if let Err(e) = watcher.watch(&watch_path, notify::RecursiveMode::Recursive) {
            eprintln!("[watcher] Watch failed: {e}");
            WATCHER_RUNNING.store(false, Ordering::SeqCst);
            return;
        }

        let mut debounce: std::collections::HashMap<std::path::PathBuf, std::time::Instant> = std::collections::HashMap::new();
        let debounce_dur = std::time::Duration::from_secs(2);

        loop {
            match rx.recv_timeout(std::time::Duration::from_millis(400)) {
                Ok(Ok(event)) => {
                    let now = std::time::Instant::now();
                    for path in event.paths {
                        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                        if name.starts_with('.') { continue; }
                        // Skip files inside .archive/ — soft-deleted, not for indexing
                        if path.components().any(|c| c.as_os_str() == ".archive") { continue; }
                        if matches!(path.extension().and_then(|e| e.to_str()), Some("md") | Some("txt")) {
                            debounce.insert(path, now);
                        }
                    }
                }
                Ok(Err(e)) => eprintln!("[watcher] Event error: {e}"),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }

            // Flush paths whose last event is older than debounce_dur
            let ready: Vec<std::path::PathBuf> = debounce
                .iter()
                .filter(|(_, t)| t.elapsed() >= debounce_dur)
                .map(|(p, _)| p.clone())
                .collect();

            for path in ready {
                debounce.remove(&path);
                let _ = queue_file_for_index(&conn, &path.to_string_lossy());
            }
        }
    });

    // 7-day archive purge thread: hard-deletes files in .archive/ older than 7 days
    let purge_root = knowledge_root();
    std::thread::spawn(move || {
        let seven_days = std::time::Duration::from_secs(7 * 24 * 60 * 60);
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3600));
            let archive_dir = purge_root.join("memory").join(".archive");
            if !archive_dir.exists() { continue; }
            let Ok(entries) = std::fs::read_dir(&archive_dir) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() { continue; }
                let Ok(meta) = path.metadata() else { continue };
                let Ok(modified) = meta.modified() else { continue };
                if modified.elapsed().unwrap_or_default() < seven_days { continue; }
                // Remove from vector index
                if let Ok(conn) = open_index_db() {
                    let ps = path.to_string_lossy().to_string();
                    let _ = conn.execute("DELETE FROM brain_vectors WHERE file_path=?1", rusqlite::params![&ps]);
                    let _ = conn.execute("DELETE FROM pending_index WHERE file_path=?1", rusqlite::params![&ps]);
                }
                // git rm + commit; fall back to fs::remove_file
                if let Ok(rel) = path.strip_prefix(&purge_root) {
                    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    // MAINT-GITRACE: hold GIT_LOCK only around the git mutation — never across the
                    // hourly sleep — so the unattended purge can't interleave with a foreground write.
                    let git_ok = {
                        let _git = git_guard();
                        run_git(&["rm", "--force", &rel.to_string_lossy()], &purge_root)
                            .and_then(|_| run_git(&["commit", "-m", &format!("purge: 7-day expiry {name}")], &purge_root))
                            .is_ok()
                    };
                    if !git_ok { let _ = std::fs::remove_file(&path); }
                }
            }
        }
    });
}

#[tauri::command]
fn sync_knowledge_core_index() -> serde_json::Value {
    let root = knowledge_root();
    let conn = match open_index_db() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let queued = walk_and_queue_dir(&root, &conn);
    serde_json::json!({ "ok": true, "queued": queued })
}

#[tauri::command]
fn get_index_status() -> serde_json::Value {
    let conn = match open_index_db() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "error": e }),
    };
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM pending_index", [], |r| r.get(0)).unwrap_or(0);
    let indexed: i64 = conn.query_row("SELECT COUNT(*) FROM pending_index WHERE status = 'indexed'", [], |r| r.get(0)).unwrap_or(0);
    let pending: i64 = conn.query_row("SELECT COUNT(*) FROM pending_index WHERE status = 'pending'", [], |r| r.get(0)).unwrap_or(0);
    let vectors: i64 = conn.query_row("SELECT COUNT(DISTINCT file_path) FROM brain_vectors", [], |r| r.get(0)).unwrap_or(0);
    serde_json::json!({
        "total_files": total,
        "indexed": indexed,
        "pending": pending,
        "vector_files": vectors,
        "model_ready": EMBEDDER.get().is_some()
    })
}

/// Embed one short text on-device (same AllMiniLM-L6-v2 the knowledge index uses) — powers the
/// frontend's topic-shift detection. Returns the raw vector; the rolling-centroid math lives in
/// TS (services/topicShift.ts) where the per-chat state is.
#[tauri::command]
fn embed_text(text: String) -> Result<Vec<f32>, String> {
    let embedder = get_or_init_embedder()?;
    let guard = embedder.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .embed(vec![text.as_str()], None)
        .map_err(|e| format!("embed failed: {e}"))?
        .pop()
        .ok_or_else(|| "embed returned nothing".into())
}

#[tauri::command]
fn search_knowledge_semantic(query: String, agent_id: Option<String>, max_results: Option<usize>, snippet_chars: Option<usize>) -> serde_json::Value {
    let max_results = max_results.unwrap_or(5);
    let snippet_chars = snippet_chars.unwrap_or(400);
    if let Some(ref id) = agent_id {
        if !is_safe_agent_id(id) {
            return serde_json::json!({ "results": [], "error": "Invalid agent id" });
        }
    }

    // Fall back to keyword search if model not loaded yet
    let embedder = match get_or_init_embedder() {
        Ok(e) => e,
        Err(_) => return search_knowledge(query, None, agent_id, Some(max_results), Some(snippet_chars)),
    };

    let query_vec: Vec<f32> = {
        let guard = embedder.lock().unwrap_or_else(|e| e.into_inner());
        match guard.embed(vec![query.as_str()], None) {
            Ok(mut e) if !e.is_empty() => e.remove(0),
            _ => return search_knowledge(query, None, agent_id, Some(max_results), Some(snippet_chars)),
        }
    };

    let conn = match open_index_db() {
        Ok(c) => c,
        Err(_) => return search_knowledge(query, None, agent_id, Some(max_results), Some(snippet_chars)),
    };

    let root = knowledge_root();
    let memory_prefix = agent_id.as_ref()
        .map(|id| root.join("memory").join(id).to_string_lossy().to_string())
        .unwrap_or_else(|| root.join("memory").to_string_lossy().to_string());
    let library_prefix = root.join("library").to_string_lossy().to_string();

    let rows: Vec<(String, String, Vec<u8>, i64, f64)> = {
        let mut stmt = match conn.prepare(
            "SELECT file_path, content, vector, last_modified, importance FROM brain_vectors WHERE file_path LIKE ?1 OR file_path LIKE ?2"
        ) { Ok(s) => s, Err(_) => return search_knowledge(query, None, agent_id, Some(max_results), Some(snippet_chars)) };

        stmt.query_map(
            rusqlite::params![format!("{memory_prefix}%"), format!("{library_prefix}%")],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).map(|it| it.flatten().collect()).unwrap_or_default()
    };

    if rows.is_empty() {
        return search_knowledge(query, None, agent_id, Some(max_results), Some(snippet_chars));
    }

    // Re-rank like the Generative-Agents retrieval score: relevance (cosine) stays dominant, but at
    // comparable similarity a recent, higher-confidence memory beats a stale, weak one. Recency and
    // importance only MODULATE order (±20%); the cosine pre-filter (>0.25) and the returned `score`
    // remain raw cosine, so the frontend relevance thresholds keep their exact meaning.
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64).unwrap_or(0);
    const HALF_LIFE_SECS: f64 = 30.0 * 24.0 * 60.0 * 60.0; // ~half weight at 30 days old

    let mut scored: Vec<(f32, f32, String, String)> = rows.into_iter()
        .filter_map(|(path, content, blob, last_modified, importance)| {
            let vec: Vec<f32> = blob.chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();
            let cosine = cosine_similarity(&query_vec, &vec);
            if cosine <= 0.25 { return None; }
            let age = (now_secs - last_modified).max(0) as f64;
            let recency = (-std::f64::consts::LN_2 * age / HALF_LIFE_SECS).exp() as f32; // 1.0 fresh → 0.5 @30d
            let rank = cosine * (0.80 + 0.15 * recency + 0.05 * importance as f32);
            Some((cosine, rank, path, content))
        })
        .collect();

    // SELECTION is by raw cosine (relevance), so recency/importance can never evict a more-relevant
    // memory from the returned window — the frontend filters on the cosine we return, so the kept set
    // must be the top-by-cosine set (no recall regression). We only REORDER within it by the blend.
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    // Deduplicate: keep the highest-cosine chunk per file.
    let mut seen_files = std::collections::HashSet::new();
    scored.retain(|(_, _, path, _)| seen_files.insert(path.clone()));
    scored.truncate(max_results);
    // Now order the kept (most-relevant) set by the blended rank: a fresh, higher-confidence memory
    // surfaces above a stale, weak one at comparable similarity, without dropping anything relevant.
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let results: Vec<serde_json::Value> = scored.into_iter().map(|(cosine, _rank, path, content)| {
        let snippet: String = content.chars().take(snippet_chars).collect();
        let title = extract_title_from_path(&path);
        serde_json::json!({ "path": path, "title": title, "snippet": snippet, "score": cosine })
    }).collect();

    serde_json::json!({ "results": results })
}

fn extract_title_from_path(path: &str) -> String {
    // Try to read the file to get a proper title; fall back to filename stem
    if let Ok(content) = std::fs::read_to_string(path) {
        let t = extract_title(&content, std::path::Path::new(path));
        if t != "Untitled" { return t; }
    }
    std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

// ─── 5.0 Knowledge File Management ───────────────────────────────────────────

#[tauri::command]
fn delete_memory_file(path: String) -> serde_json::Value {
    let _git = git_guard();
    let repo_root = knowledge_root();
    let file_path = match knowledge_path_from_input(&path) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let file_path_str = file_path.to_string_lossy().to_string();

    // Remove from vector index tables (ignore errors — file might not be indexed yet)
    if let Ok(conn) = open_index_db() {
        let _ = conn.execute("DELETE FROM brain_vectors WHERE file_path = ?1", rusqlite::params![&file_path_str]);
        let _ = conn.execute("DELETE FROM pending_index WHERE file_path = ?1", rusqlite::params![&file_path_str]);
    }

    // Try git rm + commit to maintain audit trail
    if let Ok(rel) = git_rel_path(&file_path, &repo_root) {
        let git_ok = run_git(&["rm", "--force", &rel], &repo_root)
            .and_then(|_| {
                let name = file_path.file_name().unwrap_or_default().to_string_lossy().to_string();
                run_git(&["commit", "-m", &format!("chore: delete {name}")], &repo_root)
            }).is_ok();

        if git_ok {
            return serde_json::json!({ "ok": true, "method": "git" });
        }
    }

    // Fallback: direct filesystem deletion
    if file_path.exists() {
        if let Err(e) = std::fs::remove_file(file_path) {
            return serde_json::json!({ "ok": false, "error": e.to_string() });
        }
    }

    serde_json::json!({ "ok": true, "method": "fs" })
}

// ─── 5.1 Dream Cycle: Archive / Restore / Log ────────────────────────────────

#[tauri::command]
fn archive_memory_file(path: String) -> serde_json::Value {
    let _git = git_guard();
    let repo_root = knowledge_root();
    let file_path = match knowledge_path_from_input(&path) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let file_path_str = file_path.to_string_lossy().to_string();

    let archive_dir = repo_root.join("memory").join(".archive");
    let _ = std::fs::create_dir_all(&archive_dir);

    let stem = file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = file_path.extension().and_then(|s| s.to_str()).unwrap_or("md");
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let archive_name = format!("{}-{}.{}", stem, secs, ext);
    let archive_path = archive_dir.join(&archive_name);

    // Remove from vector index
    if let Ok(conn) = open_index_db() {
        let _ = conn.execute("DELETE FROM brain_vectors WHERE file_path = ?1", rusqlite::params![&file_path_str]);
        let _ = conn.execute("DELETE FROM pending_index WHERE file_path = ?1", rusqlite::params![&file_path_str]);
    }

    if std::fs::rename(&file_path, &archive_path).is_err() {
        // Cross-device fallback
        if let Err(e) = std::fs::copy(&file_path, &archive_path) {
            return serde_json::json!({ "ok": false, "error": e.to_string() });
        }
        let _ = std::fs::remove_file(&file_path);
    }

    let archive_str = archive_path.to_string_lossy().to_string();
    let _ = run_git(&["add", "-A"], &repo_root);
    let name = file_path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let commit_out = run_git(&["commit", "-m", &format!("archive: {name}")], &repo_root)
        .unwrap_or_default();
    let commit_hash = commit_out.lines().find(|l| l.starts_with('[')).map(|l| l.to_string());

    serde_json::json!({ "ok": true, "archive_path": archive_str, "commit": commit_hash })
}

#[tauri::command]
fn restore_archived_file(archive_path: String, original_path: String) -> serde_json::Value {
    let _git = git_guard();
    let repo_root = knowledge_root();
    let src = match knowledge_path_from_input(&archive_path) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };

    let dest = if original_path.is_empty() {
        // Fallback: strip timestamp suffix, restore to memos/
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("restored");
        let clean_stem = stem.rsplit_once('-').map(|(s, _)| s).unwrap_or(stem);
        repo_root.join("memory").join("memos").join(format!("{}.md", clean_stem))
    } else {
        match knowledge_path_from_input(&original_path) {
            Ok(p) => p,
            Err(e) => return serde_json::json!({ "ok": false, "error": e }),
        }
    };

    let _ = std::fs::create_dir_all(dest.parent().unwrap_or(&repo_root));

    if std::fs::rename(&src, &dest).is_err() {
        if let Err(e) = std::fs::copy(&src, &dest) {
            return serde_json::json!({ "ok": false, "error": e.to_string() });
        }
        let _ = std::fs::remove_file(&src);
    }

    // Re-queue for indexing
    if let Ok(conn) = open_index_db() {
        let p = dest.to_string_lossy().to_string();
        let _ = queue_file_for_index(&conn, &p);
    }

    let _ = run_git(&["add", "-A"], &repo_root);
    let name = dest.file_name().unwrap_or_default().to_string_lossy().to_string();
    let commit_out = run_git(&["commit", "-m", &format!("restore: {name}")], &repo_root)
        .unwrap_or_default();
    let commit_hash = commit_out.lines().find(|l| l.starts_with('[')).map(|l| l.to_string());

    serde_json::json!({ "ok": true, "restored_path": dest.to_string_lossy(), "commit": commit_hash })
}

#[tauri::command]
fn read_dream_log() -> serde_json::Value {
    let log_path = knowledge_root()
        .join("workspace").join(".dream_logs").join("latest.json");
    if !log_path.exists() { return serde_json::json!({ "exists": false }); }
    match std::fs::read_to_string(&log_path) {
        Ok(s) => match serde_json::from_str::<serde_json::Value>(&s) {
            Ok(v) => serde_json::json!({ "exists": true, "log": v }),
            Err(_) => serde_json::json!({ "exists": false }),
        },
        Err(_) => serde_json::json!({ "exists": false }),
    }
}

#[tauri::command]
fn write_dream_log(log: serde_json::Value) -> serde_json::Value {
    let log_dir = knowledge_root().join("workspace").join(".dream_logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("latest.json");
    match std::fs::write(&log_path, serde_json::to_string_pretty(&log).unwrap_or_default()) {
        Ok(_) => serde_json::json!({ "ok": true }),
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn list_archive_files() -> serde_json::Value {
    let archive_dir = knowledge_root().join("memory").join(".archive");
    if !archive_dir.exists() { return serde_json::json!({ "files": [] }); }

    let mut files: Vec<serde_json::Value> = match std::fs::read_dir(&archive_dir) {
        Ok(entries) => entries.flatten().filter_map(|e| {
            let path = e.path();
            if !path.is_file() { return None; }
            let name = path.file_name()?.to_string_lossy().to_string();
            let modified_secs = path.metadata().ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()).unwrap_or(0);
            Some(serde_json::json!({
                "name": name,
                "path": path.to_string_lossy(),
                "modified_secs": modified_secs
            }))
        }).collect(),
        Err(_) => vec![],
    };

    files.sort_by(|a, b| {
        b["modified_secs"].as_u64().unwrap_or(0)
            .cmp(&a["modified_secs"].as_u64().unwrap_or(0))
    });

    serde_json::json!({ "files": files })
}

fn collect_knowledge_files(dir: &Path, files: &mut Vec<serde_json::Value>, skip_tasks: bool) {
    let Ok(entries) = std::fs::read_dir(dir) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        if path.is_dir() {
            if name == ".archive" { continue; }
            collect_knowledge_files(&path, files, skip_tasks);
        } else if matches!(path.extension().and_then(|s| s.to_str()), Some("md") | Some("txt")) {
            if skip_tasks && name == "tasks.md" { continue; }
            let display_name = path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&name)
                .to_string();
            files.push(serde_json::json!({
                "name": display_name,
                "path": path.to_string_lossy()
            }));
        }
    }
}

#[tauri::command]
fn list_agent_memory_files(agent_id: String) -> serde_json::Value {
    if !is_safe_agent_id(&agent_id) {
        return serde_json::json!({ "files": [], "error": "Invalid agent id" });
    }
    let dir = knowledge_root().join("memory").join(agent_id);
    let mut files = Vec::new();
    collect_knowledge_files(&dir, &mut files, true);
    files.sort_by(|a, b| {
        b["name"].as_str().unwrap_or("")
            .cmp(a["name"].as_str().unwrap_or(""))
    });
    serde_json::json!({ "files": files })
}

#[tauri::command]
fn list_library_files() -> serde_json::Value {
    let dir = knowledge_root().join("library");
    let mut files = Vec::new();
    collect_knowledge_files(&dir, &mut files, false);
    files.sort_by(|a, b| {
        b["name"].as_str().unwrap_or("")
            .cmp(a["name"].as_str().unwrap_or(""))
    });
    serde_json::json!({ "files": files })
}

#[tauri::command]
fn read_knowledge_file(path: String) -> serde_json::Value {
    let file_path = match knowledge_path_from_input(&path) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e, "content": "" }),
    };
    match std::fs::read_to_string(&file_path) {
        Ok(content) => serde_json::json!({ "ok": true, "content": content }),
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string(), "content": "" }),
    }
}

// ─── File Access (Workshop model) ─────────────────────────────────────────────
// Phase 1 — the agent's workspace: full rwx, jailed to ~/AgentForge/workspace, git-backed undo.
// Phase 2 — fs_import / fs_probe_context: bring the user's files in (consent in the frontend).
// Phase 3 — fs_*_external: real-filesystem ops, gated by the frontend consent service + remembered
//           grants, and denied to the browser-panel webview by the ACL (see the isolation test).
// Phase 4 — run_command: opt-in (Developer Mode) shell execution behind the command-approval card.
// SECURITY: every command here is on the remote-isolation DENIED list — a prompt-injected page in the
// browser panel must never reach the filesystem or a shell. Untrusted page text is data, not a grant.

fn entry_json(entry: &std::fs::DirEntry, root: &Path) -> serde_json::Value {
    let meta = entry.metadata().ok();
    let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let name = entry.file_name().to_string_lossy().to_string();
    let rel = entry
        .path()
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| name.clone());
    serde_json::json!({ "name": name, "path": rel, "isDir": is_dir, "size": size })
}

fn read_dir_sorted(dir: &Path, rel_root: &Path) -> Result<Vec<serde_json::Value>, String> {
    let mut entries: Vec<serde_json::Value> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| entry_json(&e, rel_root))
        .collect();
    entries.sort_by(|a, b| {
        let (ad, bd) = (a["isDir"].as_bool().unwrap_or(false), b["isDir"].as_bool().unwrap_or(false));
        bd.cmp(&ad).then_with(|| {
            a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
        })
    });
    Ok(entries)
}

/// Commit the current state of the Knowledge Core repo with a message (workspace lives inside it).
fn commit_workspace(message: &str) {
    let _git = git_guard();
    let root = knowledge_root();
    let _ = run_git(&["add", "-A"], &root);
    let _ = run_git(&["commit", "-m", message], &root);
}

#[tauri::command]
fn fs_list(path: Option<String>) -> serde_json::Value {
    let dir = match workspace_path_from_input(path.as_deref().unwrap_or("")) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e, "entries": [] }),
    };
    match read_dir_sorted(&dir, &workspace_root()) {
        Ok(entries) => serde_json::json!({ "ok": true, "entries": entries, "root": workspace_root().to_string_lossy() }),
        Err(e) => serde_json::json!({ "ok": false, "error": e, "entries": [] }),
    }
}

#[tauri::command]
fn fs_read(path: String) -> serde_json::Value {
    let file_path = match workspace_path_from_input(&path) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e, "content": "" }),
    };
    match std::fs::read_to_string(&file_path) {
        Ok(content) => serde_json::json!({ "ok": true, "content": content }),
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string(), "content": "" }),
    }
}

#[tauri::command]
fn fs_write(path: String, content: String) -> serde_json::Value {
    let file_path = match workspace_path_from_input(&path) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    if let Some(parent) = file_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&file_path, &content) {
        return serde_json::json!({ "ok": false, "error": e.to_string() });
    }
    let rel = workspace_rel(&file_path);
    commit_workspace(&format!("workspace: write {}", rel));
    serde_json::json!({ "ok": true, "path": rel })
}

#[tauri::command]
fn fs_mkdir(path: String) -> serde_json::Value {
    match workspace_path_from_input(&path) {
        Ok(dir) => match std::fs::create_dir_all(&dir) {
            Ok(_) => serde_json::json!({ "ok": true, "path": workspace_rel(&dir) }),
            Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
        },
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
fn fs_delete(path: String) -> serde_json::Value {
    let file_path = match workspace_path_from_input(&path) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let result = if file_path.is_dir() {
        std::fs::remove_dir_all(&file_path)
    } else {
        std::fs::remove_file(&file_path)
    };
    match result {
        Ok(_) => {
            commit_workspace(&format!("workspace: delete {}", workspace_rel(&file_path)));
            serde_json::json!({ "ok": true })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn fs_move(from: String, to: String) -> serde_json::Value {
    let src = match workspace_path_from_input(&from) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let dst = match workspace_path_from_input(&to) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::rename(&src, &dst) {
        Ok(_) => {
            commit_workspace(&format!("workspace: move {} -> {}", workspace_rel(&src), workspace_rel(&dst)));
            serde_json::json!({ "ok": true, "path": workspace_rel(&dst) })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
    }
}

/// Copy a user-picked external file INTO the workspace (import-by-copy). The source path is supplied
/// by an explicit user gesture (OS picker / drag-drop), which is the consent for reading it.
#[tauri::command]
fn fs_import(source_path: String, dest_name: String) -> serde_json::Value {
    let dst = match workspace_path_from_input(&dest_name) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::copy(&source_path, &dst) {
        Ok(_) => {
            let rel = workspace_rel(&dst);
            commit_workspace(&format!("workspace: import {}", rel));
            serde_json::json!({ "ok": true, "path": rel, "source": source_path })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
    }
}

/// Probe whether a path lives inside a git repo / project (walks up looking for markers). Used by the
/// consent service to recommend "edit in place" for repo files vs "import a copy" for loose docs.
#[tauri::command]
fn fs_probe_context(path: String) -> serde_json::Value {
    let p = PathBuf::from(&path);
    let mut dir = if p.is_dir() {
        p.clone()
    } else {
        p.parent().map(|x| x.to_path_buf()).unwrap_or_else(|| p.clone())
    };
    const MARKERS: [&str; 7] = [".git", "package.json", "Cargo.toml", "pyproject.toml", "go.mod", ".hg", ".svn"];
    loop {
        for marker in MARKERS.iter() {
            if dir.join(marker).exists() {
                let is_repo = matches!(*marker, ".git" | ".hg" | ".svn");
                return serde_json::json!({
                    "inProject": true,
                    "isRepo": is_repo,
                    "marker": marker,
                    "root": dir.to_string_lossy(),
                });
            }
        }
        match dir.parent() {
            Some(parent) if parent != dir => dir = parent.to_path_buf(),
            _ => break,
        }
    }
    serde_json::json!({ "inProject": false })
}

// ── Phase 3: real-filesystem ops (consent enforced in the frontend; ACL keeps remote out) ──

#[tauri::command]
fn fs_read_external(webview: tauri::Webview, path: String) -> serde_json::Value {
    if let Err(e) = ensure_trusted_caller(&webview) {
        return serde_json::json!({ "ok": false, "error": e, "content": "" });
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::json!({ "ok": true, "content": content }),
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string(), "content": "" }),
    }
}

#[tauri::command]
fn fs_list_external(webview: tauri::Webview, path: String) -> serde_json::Value {
    if let Err(e) = ensure_trusted_caller(&webview) {
        return serde_json::json!({ "ok": false, "error": e, "entries": [] });
    }
    let dir = PathBuf::from(&path);
    match read_dir_sorted(&dir, &dir) {
        Ok(entries) => serde_json::json!({ "ok": true, "entries": entries, "root": path }),
        Err(e) => serde_json::json!({ "ok": false, "error": e, "entries": [] }),
    }
}

#[tauri::command]
fn fs_write_external(webview: tauri::Webview, path: String, content: String) -> serde_json::Value {
    if let Err(e) = ensure_trusted_caller(&webview) {
        return serde_json::json!({ "ok": false, "error": e });
    }
    if let Some(parent) = PathBuf::from(&path).parent() {
        // Propagate the failure instead of silently leaving a partial mkdir -p tree on disk.
        if let Err(e) = std::fs::create_dir_all(parent) {
            return serde_json::json!({ "ok": false, "error": format!("could not create parent directory: {e}") });
        }
    }
    match std::fs::write(&path, content) {
        Ok(_) => serde_json::json!({ "ok": true }),
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn fs_delete_external(webview: tauri::Webview, path: String) -> serde_json::Value {
    if let Err(e) = ensure_trusted_caller(&webview) {
        return serde_json::json!({ "ok": false, "error": e });
    }
    let p = PathBuf::from(&path);
    let result = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
    match result {
        Ok(_) => serde_json::json!({ "ok": true }),
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
    }
}

/// Reveal a file/folder in Finder (selects it in its enclosing folder). Powers AgentForge Code's
/// "Open original" / reveal actions. The opener plugin can't reveal-in-Finder, so we shell `open -R`
/// (same reason as the System Settings openers). Read-only: it shows a path, never mutates anything —
/// but it's still on the remote-isolation DENIED list so a web page can't probe the local filesystem.
#[tauri::command]
fn fs_reveal(webview: tauri::Webview, path: String) -> serde_json::Value {
    if let Err(e) = ensure_trusted_caller(&webview) {
        return serde_json::json!({ "ok": false, "error": e });
    }
    match std::process::Command::new("open").arg("-R").arg(&path).spawn() {
        Ok(_) => serde_json::json!({ "ok": true }),
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
    }
}

// ── Phase 4: command execution (opt-in via Developer Mode; behind the command-approval card) ──
// Runs through the user's login shell so PATH/aliases match their terminal. Git commands borrow the
// OS's already-configured credentials (Keychain helper / SSH agent) — no separate auth to manage.
#[tauri::command]
fn run_command(webview: tauri::Webview, command: String, cwd: String) -> serde_json::Value {
    if let Err(e) = ensure_trusted_caller(&webview) {
        return serde_json::json!({ "ok": false, "error": e, "stdout": "", "stderr": "" });
    }
    // SEC-RUNCMD: the shell only runs when Developer Mode is enabled in the BACKEND — the frontend
    // CommandActionCard gate is now belt-and-suspenders, not the sole control.
    if !DEV_MODE.load(Ordering::Relaxed) {
        return serde_json::json!({ "ok": false, "error": "Developer Mode is disabled", "stdout": "", "stderr": "" });
    }
    // cwd must be an existing directory — never run in an attacker-arbitrary or nonexistent path.
    if cwd.trim().is_empty() || !std::path::Path::new(&cwd).is_dir() {
        return serde_json::json!({ "ok": false, "error": "invalid working directory", "stdout": "", "stderr": "" });
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    match std::process::Command::new(&shell)
        .arg("-lc")
        .arg(&command)
        .current_dir(&cwd)
        .output()
    {
        Ok(out) => serde_json::json!({
            "ok": out.status.success(),
            "code": out.status.code(),
            "stdout": String::from_utf8_lossy(&out.stdout),
            "stderr": String::from_utf8_lossy(&out.stderr),
        }),
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string(), "stdout": "", "stderr": "" }),
    }
}

/// SEC-RUNCMD: mirror the frontend Developer-Mode toggle into the backend (DEV_MODE) so run_command's
/// gate is enforced server-side. Trusted local windows only.
#[tauri::command]
fn set_developer_mode(webview: tauri::Webview, on: bool) -> serde_json::Value {
    if let Err(e) = ensure_trusted_caller(&webview) {
        return serde_json::json!({ "ok": false, "error": e });
    }
    DEV_MODE.store(on, Ordering::Relaxed);
    serde_json::json!({ "ok": true })
}

// ─── Legacy ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Open System Settings → Accessibility → Spoken Content, where the user downloads the
/// high-quality Premium/Enhanced voices used for reading messages aloud.
///
/// Uses the macOS `open` CLI because the webview's opener plugin silently ignores the
/// `x-apple.systempreferences:` URL scheme (same reason as `imessage_open_fda_settings`).
#[tauri::command]
fn open_spoken_content_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.universalaccess?Speech")
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open System Settings: {e}"))
}

// ─── Spotlight Commands ───────────────────────────────────────────────────────

fn run_osascript(script: &str) -> Option<String> {
    let output = std::process::Command::new("osascript")
        .args(["-e", script])
        .output()
        .ok()?;
    if !output.status.success() { return None; }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Strips HTML tags and normalises whitespace for LLM consumption.
/// Removes entire <style>, <script>, <noscript>, and <svg> blocks first so
/// CSS and JS content is not included in the output text.
fn strip_html(html: &str) -> String {
    let mut work = html.to_string();
    for tag in &["style", "script", "noscript", "svg"] {
        let open_pat = format!("<{}", tag);
        let close_pat = format!("</{}>", tag);
        loop {
            let lower = work.to_lowercase();
            match lower.find(&open_pat) {
                None => break,
                Some(start) => match lower[start..].find(&close_pat) {
                    None => { work.replace_range(start.., ""); break; }
                    Some(rel_end) => {
                        let end = start + rel_end + close_pat.len();
                        work.replace_range(start..end, " ");
                    }
                }
            }
        }
    }
    let mut out = String::new();
    let mut in_tag = false;
    for c in work.chars() {
        match c {
            '<' => in_tag = true,
            '>' => { in_tag = false; out.push(' '); }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let decoded = out
        .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Returns true if the stripped text looks like a bot-protection challenge page.
fn is_challenge_page(text: &str) -> bool {
    let lower = text.to_lowercase();
    // Cloudflare, Amazon WAF, generic bot-detection markers
    let markers = [
        "just a moment", "checking your browser", "enable javascript and cookies",
        "ddos protection by cloudflare", "ray id:", "please verify you are a human",
        "access denied", "403 forbidden", "attention required!", "sorry, you have been blocked",
        "your request has been blocked", "security check", "prove you are human",
        "cf-ray", "cloudflare to restrict access",
    ];
    markers.iter().any(|m| lower.contains(m))
}

/// Fetches a URL with curl and returns stripped plain text.
/// Used as fallback when browser JS extraction is unavailable.
fn fetch_url_text(url: &str) -> Option<String> {
    if !url.starts_with("http") { return None; }
    let output = std::process::Command::new("curl")
        .args([
            "-s", "-L",
            "--max-time", "8",
            "--user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "-H", "Accept-Language: en-US,en;q=0.9",
            url,
        ])
        .output()
        .ok()?;
    if !output.status.success() { return None; }
    let html = String::from_utf8_lossy(&output.stdout);
    let text = strip_html(&html);
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() { return None; }
    // Detect bot-protection challenge pages — return a note instead of garbage
    if is_challenge_page(&trimmed) {
        return Some("[This page is protected by a bot-detection challenge (e.g. Cloudflare). Page content could not be read automatically. To enable content reading from protected pages, go to Chrome → View → Developer → Allow JavaScript from Apple Events.]".to_string());
    }
    // Limit to ~12k chars
    Some(trimmed.chars().take(12000).collect())
}

/// Try to get tab info from Chrome. Returns (title, url, text, "chrome") or None.
fn try_chrome() -> Option<serde_json::Value> {
    let chrome_info = r#"tell application "Google Chrome"
    set t to title of active tab of front window
    set u to URL of active tab of front window
end tell
return t & "|||URL|||" & u"#;
    let raw = run_osascript(chrome_info)?;
    let (title, url) = raw.split_once("|||URL|||")?;
    let url = url.trim().to_string();
    if url.is_empty() { return None; }
    let title = title.trim().to_string();
    let chrome_text = r#"tell application "Google Chrome"
    set txt to execute active tab of front window javascript "(function(){var s=document.querySelector('article')||document.querySelector('[role=\"main\"]')||document.querySelector('main')||document.querySelector('#main-content')||document.body;return s.innerText.substring(0,12000);})()"
end tell
return txt"#;
    let text = run_osascript(chrome_text)
        .filter(|t| !t.is_empty())
        .or_else(|| fetch_url_text(&url))
        .unwrap_or_default();
    Some(serde_json::json!({ "title": title, "url": url, "text": text, "browser": "chrome" }))
}

/// Try to get tab info from Safari. Returns json with browser:"safari" or None.
fn try_safari() -> Option<serde_json::Value> {
    let safari_info = r#"tell application "Safari"
    set t to name of current tab of front window
    set u to URL of current tab of front window
end tell
return t & "|||URL|||" & u"#;
    let raw = run_osascript(safari_info)?;
    let (title, url) = raw.split_once("|||URL|||")?;
    let url = url.trim().to_string();
    if url.is_empty() { return None; }
    let title = title.trim().to_string();
    let safari_js = r#"tell application "Safari"
    set txt to do JavaScript "(function(){var s=document.querySelector('article')||document.querySelector('[role=\"main\"]')||document.querySelector('main')||document.querySelector('#main-content')||document.body;return s.innerText.substring(0,12000);})()" in current tab of front window
end tell
return txt"#;
    let text = run_osascript(safari_js)
        .filter(|t| !t.is_empty())
        .or_else(|| {
            let safari_source = r#"tell application "Safari"
    set src to source of current tab of front window
end tell
return src"#;
            run_osascript(safari_source)
                .filter(|s| !s.is_empty())
                .map(|html| {
                    let stripped = strip_html(&html);
                    stripped.chars().take(12000).collect::<String>()
                })
                .filter(|t| !t.is_empty())
        })
        .or_else(|| fetch_url_text(&url))
        .unwrap_or_default();
    Some(serde_json::json!({ "title": title, "url": url, "text": text, "browser": "safari" }))
}

/// Detects the active browser tab. `preferred` can be "chrome", "safari", or "auto"/None.
/// Called before the spotlight window is shown so the browser still has OS focus.
fn detect_active_tab_preferred(preferred: Option<&str>) -> serde_json::Value {
    match preferred.unwrap_or("auto") {
        "chrome" => try_chrome()
            .unwrap_or_else(|| serde_json::json!({ "title": "", "url": "", "text": "", "browser": "", "error": "Chrome tab not read — if Chrome is open with a tab, grant Automation for Chrome in Settings → Connect your apps → Mac permissions (it's Automation, not Accessibility)" })),
        "safari" => try_safari()
            .unwrap_or_else(|| serde_json::json!({ "title": "", "url": "", "text": "", "browser": "", "error": "Safari tab not read — if Safari is open with a tab, grant Automation for Safari in Settings → Connect your apps → Mac permissions (it's Automation, not Accessibility)" })),
        _ => try_chrome()
            .or_else(try_safari)
            .unwrap_or_else(|| serde_json::json!({ "title": "", "url": "", "text": "", "browser": "", "error": "no browser tab read — open Chrome or Safari, and grant Automation in Settings → Connect your apps → Mac permissions" })),
    }
}

#[tauri::command]
fn get_active_tab(cache: tauri::State<TabCache>, preferred: Option<String>) -> serde_json::Value {
    // Return pre-fetched value from shortcut handler (captured before focus steal),
    // but only if it matches the preferred browser (or no preference set)
    if let Some(cached) = cache.0.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let cached_browser = cached.get("browser").and_then(|b| b.as_str()).unwrap_or("");
        let pref = preferred.as_deref().unwrap_or("auto");
        if pref == "auto" || pref.is_empty() || cached_browser == pref || cached_browser.is_empty() {
            return cached;
        }
    }
    // Fallback: live detection (manual refresh or preference mismatch)
    detect_active_tab_preferred(preferred.as_deref())
}

/// Dock the spotlight window to the right edge of the current monitor's WORK AREA — the "sidecar"
/// panel layout. The work area is the OS-reported region minus the menu bar and the Dock (wherever
/// it's pinned, whatever its size), so the panel's bottom — the input box — is never hidden behind
/// the Dock. Called on every show so it re-docks to whichever display it's currently on and adapts
/// to resolution/Dock changes.
fn dock_spotlight_right(w: &tauri::WebviewWindow) {
    if let Ok(Some(m)) = w.current_monitor() {
        let scale = m.scale_factor();
        let area = m.work_area();
        let work_w = area.size.width as f64 / scale;
        let work_h = area.size.height as f64 / scale;
        let work_x = area.position.x as f64 / scale;
        let work_y = area.position.y as f64 / scale;
        let panel_w = 400.0_f64;
        let _ = w.set_size(tauri::LogicalSize::new(panel_w, work_h.max(320.0)));
        let _ = w.set_position(tauri::LogicalPosition::new(work_x + work_w - panel_w, work_y));
    }
}

#[tauri::command]
fn show_spotlight(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("spotlight") {
        dock_spotlight_right(&w);
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn hide_spotlight(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("spotlight") {
        let _ = w.hide();
    }
    // Return focus to main window so it doesn't fall behind other apps
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
}

// ─── Relay Setup ─────────────────────────────────────────────────────────────

fn relay_env_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home).join(".agent-forge-relay.env")
}

fn relay_plist_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home)
        .join("Library").join("LaunchAgents")
        .join("com.agentforge.relay.plist")
}

fn gen_token() -> String {
    // 24 random bytes from /dev/urandom → 48-char hex
    let mut buf = [0u8; 24];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read_exact(&mut buf);
    } else {
        // Fallback: xorshift seeded from time + pid
        let mut seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        seed ^= std::process::id() as u64 * 0x9e3779b97f4a7c15;
        for chunk in buf.chunks_mut(8) {
            seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17;
            let bytes = seed.to_le_bytes();
            for (i, b) in chunk.iter_mut().enumerate() { *b = bytes[i % 8]; }
        }
    }
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn sanitize_instance_id(s: &str) -> String {
    let lower = s.to_lowercase();
    let replaced: String = lower.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    let trimmed = replaced.trim_matches('-').to_string();
    if trimmed.is_empty() { "agent-forge-local".to_string() } else { trimmed[..trimmed.len().min(80)].to_string() }
}

fn find_node_bin() -> Option<String> {
    let candidates = [
        "node",
        "/usr/local/bin/node",
        "/opt/homebrew/bin/node",
        "/opt/homebrew/opt/node/bin/node",
        "/usr/bin/node",
    ];
    for candidate in &candidates {
        let output = std::process::Command::new("sh").args(["-c", &format!("command -v {}", candidate)]).output();
        if let Ok(out) = output {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() { return Some(path); }
            }
        }
        if std::path::Path::new(candidate).exists() { return Some(candidate.to_string()); }
    }
    None
}

/// Parse owner/token lines from the env file.
/// Returns Vec<(ownerId, ownerLabel, token, instanceId, shareId)>
fn parse_relay_tokens(env_content: &str) -> Vec<(String, String, String, String, String)> {
    for line in env_content.lines() {
        let line = line.trim();
        if line.starts_with("FORGE_RELAY_TOKENS=") {
            let val = &line["FORGE_RELAY_TOKENS=".len()..];
            return val.split(',')
                .filter_map(|entry| {
                    let parts: Vec<&str> = entry.splitn(5, ':').collect();
                    if parts.len() >= 3 {
                        let owner_id = parts[0].trim().to_string();
                        let owner_label = parts[1].trim().to_string();
                        let token = parts[2].trim().to_string();
                        let instance_id = parts.get(3).unwrap_or(&"").trim().to_string();
                        let share_id = parts.get(4).unwrap_or(&"").trim().to_string();
                        if !owner_id.is_empty() && !token.is_empty() {
                            Some((owner_id, owner_label, token, instance_id, share_id))
                        } else { None }
                    } else { None }
                })
                .collect();
        }
    }
    vec![]
}

fn parse_env_value<'a>(env_content: &'a str, key: &str) -> Option<&'a str> {
    for line in env_content.lines() {
        let line = line.trim();
        if line.starts_with(key) && line[key.len()..].starts_with('=') {
            return Some(&line[key.len() + 1..]);
        }
    }
    None
}

#[tauri::command]
fn setup_relay(app: tauri::AppHandle) -> serde_json::Value {
    // Find node
    let node_bin = match find_node_bin() {
        Some(n) => n,
        None => return serde_json::json!({ "ok": false, "error": "Node.js not found. Please install Node.js from https://nodejs.org and try again." }),
    };

    // Find relay script — try resource dir (production), then walk up from exe (dev mode)
    let relay_script = {
        let from_resource = app.path().resource_dir()
            .ok()
            .map(|d| d.join("forge-relay.mjs"))
            .filter(|p| p.exists());

        let from_exe = std::env::current_exe().ok().and_then(|exe| {
            // dev: exe is at src-tauri/target/debug/agent-forge → go up 3 to project root
            let root = exe.parent()?.parent()?.parent()?.parent()?;
            let candidate = root.join("scripts").join("forge-relay.mjs");
            if candidate.exists() { Some(candidate) } else { None }
        });

        match from_resource.or(from_exe) {
            Some(p) => p,
            None => return serde_json::json!({ "ok": false, "error": "Could not locate forge-relay.mjs. Make sure the app was built correctly." }),
        }
    };

    let env_path = relay_env_path();
    let plist_path = relay_plist_path();
    let log_dir = {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        std::path::PathBuf::from(home).join("Library").join("Logs").join("AgentForge")
    };

    // Generate env file if it doesn't exist
    let (personal_token, team_token, admin_token, instance_id) = if !env_path.exists() {
        let pt = gen_token();
        let tt = gen_token();
        let at = gen_token();
        let hostname = std::process::Command::new("hostname").output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|_| "local".to_string());
        let iid = sanitize_instance_id(&format!("agent-forge-{}", hostname));
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let content = format!(
            "FORGE_RELAY_HOST=0.0.0.0\nFORGE_RELAY_PORT=8765\nFORGE_RELAY_ROOT={home}/AgentForge\nFORGE_RELAY_INSTANCE_ID={iid}\n# Token routes: ownerId:Owner Label:token:instanceId:shareId\nFORGE_RELAY_TOKENS=personal:Personal:{pt}:{iid}:personal-shortcut,team:Team:{tt}:{iid}:team-shortcut\nFORGE_RELAY_ADMIN_TOKEN={at}\n",
            home = home, iid = iid, pt = pt, tt = tt, at = at
        );
        if let Err(e) = std::fs::write(&env_path, &content) {
            return serde_json::json!({ "ok": false, "error": format!("Could not write env file: {}", e) });
        }
        // chmod 600
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&env_path, std::fs::Permissions::from_mode(0o600));
        (pt, tt, at, iid)
    } else {
        // Read existing
        let content = std::fs::read_to_string(&env_path).unwrap_or_default();
        let owners = parse_relay_tokens(&content);
        let pt = owners.first().map(|o| o.2.clone()).unwrap_or_default();
        let tt = owners.get(1).map(|o| o.2.clone()).unwrap_or_default();
        let at = parse_env_value(&content, "FORGE_RELAY_ADMIN_TOKEN").unwrap_or("").to_string();
        let iid = parse_env_value(&content, "FORGE_RELAY_INSTANCE_ID").unwrap_or("agent-forge-local").to_string();
        (pt, tt, at, iid)
    };

    // Ensure log dir exists
    let _ = std::fs::create_dir_all(&log_dir);
    // Ensure LaunchAgents dir exists
    if let Some(parent) = plist_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Read env file for plist env vars
    let env_content = std::fs::read_to_string(&env_path).unwrap_or_default();
    let mut env_pairs = String::new();
    for line in env_content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        if let Some(eq_pos) = line.find('=') {
            let key = &line[..eq_pos];
            let val = &line[eq_pos + 1..];
            env_pairs.push_str(&format!(
                "    <key>{}</key>\n    <string>{}</string>\n",
                xml_escape(key), xml_escape(val)
            ));
        }
    }

    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agentforge.relay</string>
  <key>ProgramArguments</key>
  <array>
    <string>{node}</string>
    <string>{script}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
{env_pairs}  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{log_out}</string>
  <key>StandardErrorPath</key>
  <string>{log_err}</string>
</dict>
</plist>"#,
        node = xml_escape(&node_bin),
        script = xml_escape(&relay_script.to_string_lossy()),
        env_pairs = env_pairs,
        log_out = xml_escape(&log_dir.join("forge-relay.out.log").to_string_lossy()),
        log_err = xml_escape(&log_dir.join("forge-relay.err.log").to_string_lossy()),
    );

    if let Err(e) = std::fs::write(&plist_path, &plist) {
        return serde_json::json!({ "ok": false, "error": format!("Could not write plist: {}", e) });
    }

    // launchctl unload (ignore error) then load
    let _ = std::process::Command::new("launchctl")
        .args(["unload", &plist_path.to_string_lossy()])
        .output();
    let load_result = std::process::Command::new("launchctl")
        .args(["load", &plist_path.to_string_lossy()])
        .output();
    if let Ok(out) = load_result {
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).to_string();
            return serde_json::json!({ "ok": false, "error": format!("launchctl load failed: {}", err) });
        }
    }

    serde_json::json!({
        "ok": true,
        "instanceId": instance_id,
        "personalToken": personal_token,
        "teamToken": team_token,
        "adminToken": admin_token,
        "owners": [
            { "id": "personal", "label": "Personal", "token": personal_token, "shareId": format!("personal-shortcut") },
            { "id": "team", "label": "Team", "token": team_token, "shareId": format!("team-shortcut") },
        ]
    })
}

#[tauri::command]
fn get_relay_status() -> serde_json::Value {
    let env_path = relay_env_path();
    let installed = env_path.exists();
    let mut instance_id = String::new();
    let mut admin_token = String::new();
    let mut owners: Vec<serde_json::Value> = vec![];

    if installed {
        if let Ok(content) = std::fs::read_to_string(&env_path) {
            instance_id = parse_env_value(&content, "FORGE_RELAY_INSTANCE_ID").unwrap_or("").to_string();
            admin_token = parse_env_value(&content, "FORGE_RELAY_ADMIN_TOKEN").unwrap_or("").to_string();
            for (oid, olabel, token, iid, sid) in parse_relay_tokens(&content) {
                owners.push(serde_json::json!({ "id": oid, "label": olabel, "token": token, "instanceId": iid, "shareId": sid }));
            }
        }
    }

    // Check healthz with a short timeout — use std::net::TcpStream as a quick port check,
    // then do a simple HTTP GET if port is open
    let running = check_relay_health();

    // Detect Tailscale hostname
    let tailscale_hostname = get_tailscale_hostname();

    // mDNS name (<LocalHostName>.local) — resolvable by iPhones on the same Wi-Fi.
    let local_hostname = std::process::Command::new("scutil")
        .args(["--get", "LocalHostName"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| format!("{}.local", String::from_utf8_lossy(&o.stdout).trim()));

    serde_json::json!({
        "installed": installed,
        "running": running,
        "instanceId": instance_id,
        "owners": owners,
        "adminToken": admin_token,
        "tailscaleHostname": tailscale_hostname,
        "localHostname": local_hostname,
        "error": null
    })
}

fn check_relay_health() -> bool {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;
    let Ok(mut stream) = TcpStream::connect_timeout(
        &"127.0.0.1:8765".parse().unwrap(),
        Duration::from_secs(1),
    ) else { return false; };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = write!(stream, "GET /healthz HTTP/1.0\r\nHost: localhost\r\n\r\n");
    let mut buf = [0u8; 256];
    if let Ok(n) = stream.read(&mut buf) {
        let resp = String::from_utf8_lossy(&buf[..n]);
        return resp.contains("\"ok\":true") || resp.contains("\"ok\": true");
    }
    false
}

fn get_tailscale_hostname() -> Option<String> {
    // Try `tailscale status --json` to get MagicDNS hostname
    let output = std::process::Command::new("tailscale")
        .args(["status", "--json"])
        .output()
        .or_else(|_| std::process::Command::new("/usr/local/bin/tailscale").args(["status", "--json"]).output())
        .or_else(|_| std::process::Command::new("/opt/homebrew/bin/tailscale").args(["status", "--json"]).output());
    if let Ok(out) = output {
        if out.status.success() {
            let json_str = String::from_utf8_lossy(&out.stdout);
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json_str) {
                // Try Self.DNSName first (MagicDNS)
                if let Some(dns) = v.pointer("/Self/DNSName").and_then(|v| v.as_str()) {
                    let trimmed = dns.trim_end_matches('.');
                    if !trimmed.is_empty() { return Some(trimmed.to_string()); }
                }
                // Fall back to Self.TailscaleIPs[0]
                if let Some(ip) = v.pointer("/Self/TailscaleIPs/0").and_then(|v| v.as_str()) {
                    return Some(ip.to_string());
                }
            }
        }
    }
    None
}

// ─── Inbox Captures ──────────────────────────────────────────────────────────

fn inbox_raw_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home).join("AgentForge").join("inbox").join("raw")
}

fn is_safe_capture_component(s: &str) -> bool {
    !s.is_empty()
        && !s.contains('/')
        && !s.contains('\\')
        && !s.contains("..")
        && s != "."
}

#[tauri::command]
fn list_inbox_captures(owner_id: String) -> serde_json::Value {
    let base = inbox_raw_path();
    if !base.exists() {
        return serde_json::json!({ "captures": [], "error": null });
    }
    let mut captures: Vec<serde_json::Value> = Vec::new();
    let owner_dirs: Vec<_> = match std::fs::read_dir(&base) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect(),
        Err(e) => return serde_json::json!({ "captures": [], "error": e.to_string() }),
    };
    for owner_entry in owner_dirs {
        let owner_name = owner_entry.file_name().to_string_lossy().to_string();
        if owner_id != "all" && owner_name != owner_id {
            continue;
        }
        let capture_dirs = match std::fs::read_dir(owner_entry.path()) {
            Ok(rd) => rd.filter_map(|e| e.ok()).collect::<Vec<_>>(),
            Err(_) => continue,
        };
        for capture_entry in capture_dirs {
            let manifest_path = capture_entry.path().join("manifest.json");
            if !manifest_path.exists() {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(&manifest_path) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    captures.push(val);
                }
            }
        }
    }
    // Sort newest first by createdAt
    captures.sort_by(|a, b| {
        let ta = a.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0);
        let tb = b.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0);
        tb.cmp(&ta)
    });
    serde_json::json!({ "captures": captures, "error": null })
}

#[tauri::command]
fn create_inbox_capture(payload: serde_json::Value) -> serde_json::Value {
    let owner_id = match payload.get("ownerId").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({ "ok": false, "error": "ownerId is required" }),
    };
    if !is_safe_capture_component(&owner_id) {
        return serde_json::json!({ "ok": false, "error": "invalid ownerId" });
    }
    // Use provided id or generate one from timestamp + random suffix
    let capture_id = match payload.get("id").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        Some(id) => id.to_string(),
        None => {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            // Simple unique suffix from address of a stack variable
            let suffix: u64 = ts as u64 ^ (std::process::id() as u64 * 0x9e3779b97f4a7c15);
            format!("cap-{}-{:x}", ts, suffix & 0xffffff)
        }
    };
    if !is_safe_capture_component(&capture_id) {
        return serde_json::json!({ "ok": false, "error": "invalid capture id" });
    }
    let capture_dir = inbox_raw_path().join(&owner_id).join(&capture_id);
    if let Err(e) = std::fs::create_dir_all(&capture_dir) {
        return serde_json::json!({ "ok": false, "error": e.to_string() });
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let raw_path = capture_dir.to_string_lossy().to_string();
    let mut manifest = payload.clone();
    let obj = match manifest.as_object_mut() {
        Some(o) => o,
        None => return serde_json::json!({ "ok": false, "error": "payload must be an object" }),
    };
    obj.insert("id".to_string(), serde_json::json!(capture_id));
    obj.insert("ownerId".to_string(), serde_json::json!(owner_id));
    obj.entry("createdAt").or_insert(serde_json::json!(now_ms));
    obj.insert("updatedAt".to_string(), serde_json::json!(now_ms));
    obj.entry("status").or_insert(serde_json::json!("received"));
    obj.entry("attachments").or_insert(serde_json::json!([]));
    obj.entry("urls").or_insert(serde_json::json!([]));
    obj.entry("tags").or_insert(serde_json::json!([]));
    obj.entry("processedPaths").or_insert(serde_json::json!([]));
    obj.entry("error").or_insert(serde_json::json!(""));
    obj.insert("rawPath".to_string(), serde_json::json!(raw_path));
    let manifest_path = capture_dir.join("manifest.json");
    match serde_json::to_string_pretty(&manifest) {
        Ok(text) => {
            if let Err(e) = std::fs::write(&manifest_path, text) {
                return serde_json::json!({ "ok": false, "error": e.to_string() });
            }
        }
        Err(e) => return serde_json::json!({ "ok": false, "error": e.to_string() }),
    }
    serde_json::json!({ "ok": true, "capture": manifest })
}

#[tauri::command]
fn update_inbox_capture(owner_id: String, capture_id: String, patch: serde_json::Value) -> serde_json::Value {
    if !is_safe_capture_component(&owner_id) || !is_safe_capture_component(&capture_id) {
        return serde_json::json!({ "ok": false, "error": "invalid owner or capture id" });
    }
    let manifest_path = inbox_raw_path().join(&owner_id).join(&capture_id).join("manifest.json");
    if !manifest_path.exists() {
        return serde_json::json!({ "ok": false, "error": "capture not found" });
    }
    let text = match std::fs::read_to_string(&manifest_path) {
        Ok(t) => t,
        Err(e) => return serde_json::json!({ "ok": false, "error": e.to_string() }),
    };
    let mut manifest: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => return serde_json::json!({ "ok": false, "error": e.to_string() }),
    };
    if let (Some(base), Some(updates)) = (manifest.as_object_mut(), patch.as_object()) {
        for (k, v) in updates {
            base.insert(k.clone(), v.clone());
        }
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        base.insert("updatedAt".to_string(), serde_json::json!(now_ms));
    } else {
        return serde_json::json!({ "ok": false, "error": "patch must be an object" });
    }
    match serde_json::to_string_pretty(&manifest) {
        Ok(t) => {
            if let Err(e) = std::fs::write(&manifest_path, t) {
                return serde_json::json!({ "ok": false, "error": e.to_string() });
            }
        }
        Err(e) => return serde_json::json!({ "ok": false, "error": e.to_string() }),
    }
    serde_json::json!({ "ok": true, "capture": manifest })
}

#[tauri::command]
fn read_inbox_attachment(owner_id: String, capture_id: String, filename: String) -> serde_json::Value {
    if !is_safe_capture_component(&owner_id)
        || !is_safe_capture_component(&capture_id)
        || !is_safe_capture_component(&filename)
    {
        return serde_json::json!({ "data": null, "error": "invalid path component" });
    }
    let path = inbox_raw_path()
        .join(&owner_id)
        .join(&capture_id)
        .join("attachments")
        .join(&filename);
    match std::fs::read(&path) {
        Ok(bytes) => {
            // Determine a basic mime type from extension
            let mime = match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
                "jpg" | "jpeg" => "image/jpeg",
                "png" => "image/png",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "pdf" => "application/pdf",
                "txt" => "text/plain",
                "mp3" => "audio/mpeg",
                "mp4" => "video/mp4",
                "m4a" => "audio/mp4",
                _ => "application/octet-stream",
            };
            serde_json::json!({ "data": bytes, "mimeType": mime, "error": null })
        }
        Err(e) => serde_json::json!({ "data": null, "error": e.to_string() }),
    }
}

// ─── Network Discovery Commands ──────────────────────────────────────────────

#[tauri::command]
fn set_network_active(
    state: tauri::State<Mutex<NetworkState>>,
    active: bool,
    name: String,
    instance_id: String,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    let mut ns = state.lock().unwrap_or_else(|e| e.into_inner());

    // Stop existing threads if any
    if let Some(flag) = ns.stop_flag.take() {
        flag.store(true, Ordering::SeqCst);
    }

    if !active {
        // Send one "bye" packet
        if !ns.instance_id.is_empty() {
            let bye = format!(r#"{{"type":"bye","id":"{}"}}"#, ns.instance_id);
            let _ = std::net::UdpSocket::bind("0.0.0.0:0").and_then(|s| {
                s.set_broadcast(true)?;
                s.send_to(bye.as_bytes(), "255.255.255.255:47321")
            });
        }
        ns.active = false;
        ns.peers.lock().unwrap_or_else(|e| e.into_inner()).clear();
        return Ok(());
    }

    // Same instance already active — nothing to do
    if ns.active && ns.instance_id == instance_id {
        return Ok(());
    }

    ns.active = true;
    ns.display_name = name.clone();
    ns.instance_id = instance_id.clone();

    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    ns.stop_flag = Some(stop.clone());
    let peer_store = Arc::clone(&ns.peers);

    // Broadcast thread: sends heartbeat every 15s
    let stop_b = stop.clone();
    let iid_b = instance_id.clone();
    let name_b = name.clone();
    std::thread::spawn(move || {
        let hb = format!(
            r#"{{"type":"heartbeat","id":"{}","name":"{}","port":8765,"v":1}}"#,
            iid_b, name_b
        );
        loop {
            if stop_b.load(Ordering::SeqCst) { return; }
            let _ = std::net::UdpSocket::bind("0.0.0.0:0").and_then(|s| {
                s.set_broadcast(true)?;
                s.send_to(hb.as_bytes(), "255.255.255.255:47321")
            });
            // Sleep 15s in 100ms increments to stay responsive to stop signal
            for _ in 0..150 {
                if stop_b.load(Ordering::SeqCst) { return; }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    });

    // Listen thread: receives heartbeats from peers
    let stop_l = stop.clone();
    let iid_l = instance_id.clone();
    let peers_l = Arc::clone(&peer_store);
    std::thread::spawn(move || {
        let sock = match std::net::UdpSocket::bind("0.0.0.0:47321") {
            Ok(s) => s,
            Err(_) => return,
        };
        let _ = sock.set_read_timeout(Some(std::time::Duration::from_millis(500)));
        let mut buf = [0u8; 1024];
        while !stop_l.load(Ordering::SeqCst) {
            let (n, addr) = match sock.recv_from(&mut buf) {
                Ok(r) => r,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => continue,
                Err(_) => continue,
            };
            let msg = String::from_utf8_lossy(&buf[..n]);
            let v: serde_json::Value = match serde_json::from_str(&msg) {
                Ok(v) => v, Err(_) => continue,
            };
            let id = v["id"].as_str().unwrap_or("").to_string();
            if id.is_empty() || id == iid_l { continue; }
            let typ = v["type"].as_str().unwrap_or("");
            let ip = addr.ip().to_string();
            let now = net_now_secs();
            let mut peers = peers_l.lock().unwrap_or_else(|e| e.into_inner());
            if typ == "bye" {
                peers.retain(|p| p.peer.id != id);
            } else if typ == "heartbeat" {
                let name = v["name"].as_str().unwrap_or("Unknown").to_string();
                if let Some(e) = peers.iter_mut().find(|p| p.peer.id == id) {
                    e.peer.name = name; e.peer.ip = ip; e.last_seen_secs = now;
                } else {
                    peers.push(PeerEntry { peer: NetworkPeer { id, name, ip }, last_seen_secs: now });
                }
            }
            // Expire peers older than 45s
            let cutoff = now.saturating_sub(45);
            peers.retain(|p| p.last_seen_secs >= cutoff);
        }
    });

    Ok(())
}

#[tauri::command]
fn get_network_peers(state: tauri::State<Mutex<NetworkState>>) -> Vec<NetworkPeer> {
    let ns = state.lock().unwrap_or_else(|e| e.into_inner());
    if !ns.active { return vec![]; }
    let cutoff = net_now_secs().saturating_sub(45);
    let result: Vec<NetworkPeer> = ns.peers.lock().unwrap_or_else(|e| e.into_inner())
        .iter()
        .filter(|p| p.last_seen_secs >= cutoff)
        .map(|p| p.peer.clone())
        .collect();
    result
}

// ─── Local Model Store ───────────────────────────────────────────────────────

#[tauri::command]
fn get_models_dir() -> Result<String, String> {
    models_dir()
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path".to_string())
}

#[derive(serde::Serialize)]
struct GgufModel {
    filename: String,
    size_mb: u64,
}

#[tauri::command]
fn list_gguf_models() -> Vec<GgufModel> {
    let dir = models_dir();
    let mut result = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".gguf") {
                let size_mb = entry.metadata().map(|m| m.len() / (1024 * 1024)).unwrap_or(0);
                result.push(GgufModel { filename: name, size_mb });
            }
        }
    }
    result
}

/// Delete a downloaded model from disk: the .gguf, any leftover .part, and an
/// optional vision projector (mmproj). Frees the (often many-GB) file.
#[tauri::command]
fn delete_model(filename: String, mmproj: Option<String>) -> Result<(), String> {
    if !is_safe_gguf_name(&filename) {
        return Err("Invalid filename".to_string());
    }
    let dir = models_dir();
    std::fs::remove_file(dir.join(&filename)).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(dir.join(format!("{}.part", filename)));
    if let Some(mm) = mmproj {
        if is_safe_gguf_name(&mm) {
            let _ = std::fs::remove_file(dir.join(&mm));
        }
    }
    Ok(())
}

#[tauri::command]
async fn download_model(
    url: String,
    filename: String,
    app: tauri::AppHandle,
    dl_state: tauri::State<'_, DownloadState>,
) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("Only HTTPS downloads are allowed".to_string());
    }
    egress_host_allowed(&url)?; // SSRF: block loopback/private/link-local hosts even over https
    if !is_safe_gguf_name(&filename) {
        return Err("Invalid filename".to_string());
    }

    let dir = models_dir();
    let part_path = dir.join(format!("{}.part", filename));
    let final_path = dir.join(&filename);

    // Already downloaded — hand back the existing file instead of fetching it again.
    if final_path.exists() {
        return final_path.to_str().map(|s| s.to_string()).ok_or_else(|| "Path error".to_string());
    }

    // Refuse to start a second concurrent download of the same file.
    {
        let mut active = dl_state.active.lock().unwrap_or_else(|e| e.into_inner());
        if !active.insert(filename.clone()) {
            return Err("A download for this model is already in progress".to_string());
        }
    }
    // Frees the active slot on every return path below.
    let _active_guard = ActiveGuard { set: &dl_state.active, name: filename.clone() };

    // Clear any stale cancel flag
    { dl_state.cancels.lock().unwrap_or_else(|e| e.into_inner()).insert(filename.clone(), false); }

    let client = reqwest::Client::builder()
        .user_agent("AgentForge")
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    // Resumable, retrying download. A multi-GB GGUF runs for a long time, and any
    // dropped connection previously failed the whole transfer ("error decoding
    // response body"). We keep the .part file and, on each attempt, request a byte
    // Range so we resume from whatever is already on disk instead of restarting.
    const MAX_ATTEMPTS: u32 = 8;
    let mut attempt: u32 = 0;

    loop {
        attempt += 1;
        if *dl_state.cancels.lock().unwrap_or_else(|e| e.into_inner()).get(&filename).unwrap_or(&false) {
            let _ = std::fs::remove_file(&part_path);
            return Err("cancelled".to_string());
        }

        let resume_from = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
        let mut req = client.get(&url);
        if resume_from > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={}-", resume_from));
        }

        let response = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                if attempt < MAX_ATTEMPTS {
                    tokio::time::sleep(std::time::Duration::from_secs(3 * attempt as u64)).await;
                    continue;
                }
                return Err(e.to_string());
            }
        };

        let status = response.status();
        // The .part already holds the whole file (Range starts at/after EOF).
        if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && resume_from > 0 {
            std::fs::rename(&part_path, &final_path).map_err(|e| e.to_string())?;
            return final_path.to_str().map(|s| s.to_string()).ok_or_else(|| "Path error".to_string());
        }
        if !status.is_success() {
            return Err(format!("HTTP {}", status));
        }

        // 206 => the server honored the Range and we append; otherwise (e.g. 200)
        // it ignored it, so start the file fresh.
        let resuming = resume_from > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
        let body_len = response.content_length().unwrap_or(0);
        let total = if resuming { resume_from + body_len } else { body_len };
        let mut downloaded: u64 = if resuming { resume_from } else { 0 };

        let mut file = if resuming {
            std::fs::OpenOptions::new().append(true).open(&part_path).map_err(|e| e.to_string())?
        } else {
            std::fs::File::create(&part_path).map_err(|e| e.to_string())?
        };

        let mut stream = response.bytes_stream();
        let mut interrupted = false;

        while let Some(chunk) = stream.next().await {
            if *dl_state.cancels.lock().unwrap_or_else(|e| e.into_inner()).get(&filename).unwrap_or(&false) {
                drop(file);
                let _ = std::fs::remove_file(&part_path);
                return Err("cancelled".to_string());
            }
            let chunk = match chunk {
                Ok(c) => c,
                Err(_) => { interrupted = true; break; } // connection dropped; resume next attempt
            };
            use std::io::Write;
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;
            let pct = if total > 0 { (downloaded * 100 / total) as f64 } else { 0.0 };
            let _ = app.emit("download-progress", serde_json::json!({
                "filename": filename,
                "pct": pct,
                "downloaded_mb": downloaded as f64 / 1_048_576.0,
                "total_mb": total as f64 / 1_048_576.0,
            }));
        }

        drop(file);

        if interrupted {
            if attempt < MAX_ATTEMPTS
                && !*dl_state.cancels.lock().unwrap_or_else(|e| e.into_inner()).get(&filename).unwrap_or(&false)
            {
                tokio::time::sleep(std::time::Duration::from_secs(3 * attempt as u64)).await;
                continue; // resume from the bytes just written
            }
            return Err("download interrupted (network error after multiple retries)".to_string());
        }

        std::fs::rename(&part_path, &final_path).map_err(|e| e.to_string())?;
        return final_path.to_str().map(|s| s.to_string()).ok_or_else(|| "Path error".to_string());
    }
}

#[tauri::command]
fn cancel_download(filename: String, dl_state: tauri::State<'_, DownloadState>) {
    dl_state.cancels.lock().unwrap_or_else(|e| e.into_inner()).insert(filename, true);
}

#[tauri::command]
async fn start_local_model(
    model_path: String,
    port: u16,
    mmproj_path: Option<String>,
    ctx_tokens: Option<u32>,
    kv8bit: Option<bool>,
    llama_state: tauri::State<'_, LlamaState>,
) -> Result<String, String> {
    // The frontend computes the largest context that fits this Mac's memory budget
    // (fitOnMac in modelCatalog.ts) and passes it here, so a model that only fits at a
    // reduced context is launched at that context instead of OOM-ing at the old
    // hardcoded 32768. Callers that don't know the model size omit it.
    let ctx_tokens = ctx_tokens.unwrap_or(32768).clamp(4096, 32768);
    // llama-server is a thin launcher that dlopens libllama / libggml / libmtmd. Those
    // dylibs ship in the app Resources (bundle.resources → bin/llama-libs); the binary
    // finds them via an added @loader_path/../Resources/bin/llama-libs rpath, and the
    // app is signed with `disable-library-validation` so hardened runtime allows them.
    // Without all three, llama-server dyld-crashes on EVERY model (which used to look
    // like the misleading "model too large").
    // Kill any running server first (drop lock before await)
    let existing_pid = { *llama_state.pid.lock().unwrap_or_else(|e| e.into_inner()) };
    if let Some(pid) = existing_pid {
        kill_llama(pid);
        { *llama_state.pid.lock().unwrap_or_else(|e| e.into_inner()) = None; }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    let sidecar_path = {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        exe.parent()
            .ok_or("No parent dir")?
            .join("llama-server")
    };

    // Remember what we launched (on disk, so it survives app restarts): the engine can die
    // underneath us — OOM, crash, external kill — and `revive_local_model` uses this record to
    // bring it back without the user having to re-pick the model in the store.
    let _ = std::fs::write(
        llama_last_launch_path(),
        serde_json::json!({
            "modelPath": &model_path,
            "port": port,
            "mmprojPath": mmproj_path.clone().unwrap_or_default(),
            "ctxTokens": ctx_tokens,
            "kv8bit": kv8bit.unwrap_or(false),
        })
        .to_string(),
    );

    let mut server_args: Vec<String> = vec![
        "-m".into(), model_path,
        "--port".into(), port.to_string(),
        "-c".into(), ctx_tokens.to_string(),
        "--threads".into(), "4".into(),
        "--host".into(), "127.0.0.1".into(),
    ];
    if kv8bit.unwrap_or(false) {
        server_args.push("-ctk".into());
        server_args.push("q8_0".into());
        server_args.push("-ctv".into());
        server_args.push("q8_0".into());
    }
    // Multimodal: load the CLIP projector so the model can see images (llama.cpp libmtmd / MTMD).
    // Only passed when present, so text-only models are unaffected.
    if let Some(mmproj) = mmproj_path.filter(|p| !p.is_empty()) {
        server_args.push("--mmproj".into());
        server_args.push(mmproj);
    }

    let mut child = std::process::Command::new(&sidecar_path)
        .args(&server_args)
        .spawn()
        .map_err(|e| format!("Failed to spawn llama-server: {}", e))?;

    let pid = child.id();
    *llama_state.pid.lock().unwrap_or_else(|e| e.into_inner()) = Some(pid);

    // Poll the health endpoint until the server is ready. A big model (a 40GB 70B can
    // take minutes to map into memory) needs a generous window — the old 30s cap made
    // large models impossible to load. We bail out immediately if the engine process
    // dies (e.g. it ran out of memory) so we don't wait the full window on a failure.
    let health_url = format!("http://127.0.0.1:{}/health", port);
    let client = reqwest::Client::new();
    for _ in 0..1200 { // up to ~10 minutes (1200 × 500ms)
        if let Ok(Some(status)) = child.try_wait() {
            *llama_state.pid.lock().unwrap_or_else(|e| e.into_inner()) = None;
            return Err(format!(
                "The model engine quit while loading ({status}). The model may be too large for this Mac's memory — try a smaller one."
            ));
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Ok(resp) = client.get(&health_url).send().await {
            if resp.status().is_success() {
                return Ok(format!("http://127.0.0.1:{}/v1", port));
            }
        }
    }
    Err("The model didn't finish loading in time. If it's a very large model, this Mac may not have enough memory — try a smaller one.".to_string())
}

/// Where the last local-engine launch is recorded (same dotfile convention as the relay env).
fn llama_last_launch_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home).join(".agent-forge-llama-last.json")
}

/// Self-heal for the bundled local engine: if the last-launched llama-server is healthy this is a
/// no-op; if it died (OOM, crash, external kill) it respawns it with the recorded model/port and
/// waits for health. Called by the frontend at startup and automatically when a local request
/// hits a dead port — a dead engine is OURS to restart, never the user's problem to diagnose.
#[tauri::command]
async fn revive_local_model(llama_state: tauri::State<'_, LlamaState>) -> Result<String, String> {
    let raw = std::fs::read_to_string(llama_last_launch_path())
        .map_err(|_| "no local engine has been started on this Mac yet".to_string())?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("bad engine record: {e}"))?;
    let model_path = v["modelPath"].as_str().unwrap_or_default().to_string();
    let port = v["port"].as_u64().unwrap_or(8080) as u16;
    let mmproj = v["mmprojPath"].as_str().map(str::to_string).filter(|s| !s.is_empty());
    // Records from before ctxTokens existed launched at 32768 — reviving at the same
    // value keeps behavior identical for them.
    let ctx_tokens = v["ctxTokens"].as_u64().map(|c| c as u32);
    let kv8bit = v["kv8bit"].as_bool();

    // Already healthy → idempotent no-op (this is also the cheap "is it up?" probe).
    let health_url = format!("http://127.0.0.1:{port}/health");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    if let Ok(resp) = client.get(&health_url).send().await {
        if resp.status().is_success() {
            return Ok(format!("http://127.0.0.1:{port}/v1"));
        }
    }

    if model_path.is_empty() || !std::path::Path::new(&model_path).exists() {
        return Err(format!(
            "the last local model file is missing ({model_path}) — re-load a model from the Model Store"
        ));
    }
    start_local_model(model_path, port, mmproj, ctx_tokens, kv8bit, llama_state).await
}

// ─── Browser Co-pilot Commands ───────────────────────────────────────────────

/// Extracts clean readable text from raw HTML passed in from the frontend.
/// Strips script/style/nav/footer/header/aside elements first, then returns
/// plain text joined by spaces, trimmed to 50,000 chars.
#[tauri::command]
fn extract_page_text(html: String, url: String, title: String) -> Result<String, String> {
    use scraper::{Html, Selector};

    let document = Html::parse_document(&html);

    // Selector for elements whose entire subtree should be excluded
    let noise_sel = Selector::parse("script,style,noscript,nav,footer,header,aside,svg")
        .map_err(|e| format!("selector parse error: {e:?}"))?;

    // Collect all noise element IDs (ego_tree NodeId) so we can quickly test ancestry
    let noise_ids: std::collections::HashSet<_> = document
        .select(&noise_sel)
        .map(|el| el.id())
        .collect();

    // Walk every node; emit text only when none of its ancestors is a noise element
    let mut text_parts: Vec<String> = Vec::new();
    for node in document.root_element().descendants() {
        let text_val = match node.value().as_text() {
            Some(t) => t,
            None => continue,
        };

        // Check ancestors: if any ancestor node-id is in the noise set, skip
        let in_noise = node.ancestors().any(|a| noise_ids.contains(&a.id()));
        if in_noise {
            continue;
        }

        let piece = text_val.trim();
        if !piece.is_empty() {
            text_parts.push(piece.to_string());
        }
    }

    // Decode common HTML entities and collapse whitespace
    let joined = text_parts.join(" ");
    let decoded = joined
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");

    // Collapse runs of whitespace
    let clean: String = decoded.split_whitespace().collect::<Vec<_>>().join(" ");

    // Prepend title/URL context so the LLM always knows what page this is
    let with_meta = if title.is_empty() && url.is_empty() {
        clean
    } else {
        format!("[Page: {} | {}]\n\n{}", title, url, clean)
    };

    // Hard cap at 50,000 chars
    let result: String = with_meta.chars().take(50_000).collect();
    Ok(result)
}

/// Heuristic check: returns true if the page looks private / auth-gated.
/// Quick and intentionally conservative — false positives are acceptable.
#[tauri::command]
fn check_page_is_private(html: String, url: String) -> bool {
    // URL-based signals
    let url_lower = url.to_lowercase();
    let private_url_patterns = [
        "login", "signin", "sign-in", "auth", "/account", "/dashboard",
        "/admin", "checkout", "/cart",
    ];
    if private_url_patterns.iter().any(|p| url_lower.contains(p)) {
        return true;
    }

    // HTML-based signals: robots noindex meta tag
    let html_lower = html.to_lowercase();
    // <meta name="robots" content="noindex..."> (various spacings / attribute orders)
    if html_lower.contains("noindex") {
        return true;
    }

    // Common auth-wall indicators in the markup
    let auth_markers = [
        "login-form", "signin-form", "id=\"login\"", "id=\"signin\"",
        "class=\"login\"", "class=\"signin\"", "action=\"/login\"",
        "action=\"/signin\"", "action=\"/auth\"",
    ];
    if auth_markers.iter().any(|m| html_lower.contains(m)) {
        return true;
    }

    false
}

// ─── Browser Panel Navigation Commands ───────────────────────────────────────

// Document-start mask that makes the embedded WKWebView present as genuine desktop Safari.
//
// To bypass Google's strict blocks on embedded webviews (which trigger the "this browser may not be
// secure" error on sign-in), we spoof a modern Google Chrome identity. This requires both a Chrome
// User-Agent string (set in JS) and a `window.chrome` object injected before page load. Google's
// detection JS checks for `window.chrome` if the UA says Chrome. We define a minimal believable
// `window.chrome` here so the environment is internally consistent with the spoofed UA.
//
// Runs via `initialization_script_for_all_frames` (document-start, every frame) so the mask is in
// place before Google's detection JS — our older post-load `browser_eval` injection fires far too
// late. Defensive: only defines what's missing, wrapped in try/catch, so it can't break other sites.
const BROWSER_MASK_SCRIPT: &str = r#"
(function () {
  try {
    if (!('chrome' in window)) {
      window.chrome = {
        runtime: {},
        loadTimes: function() { return {}; },
        csi: function() { return {}; },
        app: {}
      };
    }
  } catch (e) {}

  // Event-driven navigation signal (top frame only). Patch the History API and listen for
  // popstate/hashchange/load, pinging the app so it re-reads the authoritative URL — no more polling,
  // and SPA route changes (Gmail folders/threads) are caught instantly. Runs at document-start for
  // every document, so it re-arms after full-page navigations too. Reports NOTHING but the ping.
  try {
    if (window.top === window && !window.__agfNavHook) {
      window.__agfNavHook = true;
      var ping = function () {
        try { var T = window.__TAURI_INTERNALS__; if (T) T.invoke('browser_report_nav'); } catch (e) {}
      };
      var wrap = function (name) {
        var orig = history[name];
        if (typeof orig === 'function') {
          history[name] = function () { var r = orig.apply(this, arguments); ping(); return r; };
        }
      };
      wrap('pushState');
      wrap('replaceState');
      window.addEventListener('popstate', ping);
      window.addEventListener('hashchange', ping);
      window.addEventListener('load', ping);
      document.addEventListener('DOMContentLoaded', ping);
    }
  } catch (e) {}
})();
"#;

// Create the browser-panel webview as a child of the given window, with the Safari UA and the
// document-start mask baked in. Replaces the JS-side `new Webview(...)` because the JS WebviewOptions
// API (Tauri 2.10) exposes `userAgent` but no initialization-script hook — and the mask MUST be a
// real document-start script to land before page JS.
// NOTE: must be `async` so Tauri runs it off the main thread. `add_child` schedules the webview
// build onto the main thread and blocks until it completes — a sync command (which Tauri runs on
// the main thread) would deadlock waiting on itself and freeze the app.
#[tauri::command]
async fn browser_create(
    app: tauri::AppHandle,
    window_label: String,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    user_agent: String,
) -> Result<(), String> {
    // Already exists (e.g. re-entrant mount) — leave it; the JS side closes stale ones first.
    if app.get_webview(&label).is_some() {
        return Ok(());
    }
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    let window = app
        .get_window(&window_label)
        .ok_or_else(|| format!("window '{}' not found", window_label))?;
    let builder = tauri::webview::WebviewBuilder::new(&label, tauri::WebviewUrl::External(parsed))
        .user_agent(&user_agent)
        .initialization_script_for_all_frames(BROWSER_MASK_SCRIPT);
    window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn browser_navigate(caller: tauri::Webview, app: tauri::AppHandle, label: String, url: String) -> Result<(), String> {
    ensure_trusted_caller(&caller)?;
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    let webview = app.get_webview(&label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;
    webview.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
fn browser_reload(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let webview = app.get_webview(&label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;
    webview.reload().map_err(|e| e.to_string())
}

#[tauri::command]
fn browser_go_back(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let webview = app.get_webview(&label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;
    webview.eval("history.back()").map_err(|e| e.to_string())
}

#[tauri::command]
fn browser_go_forward(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let webview = app.get_webview(&label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;
    webview.eval("history.forward()").map_err(|e| e.to_string())
}

#[tauri::command]
fn browser_get_url(app: tauri::AppHandle, label: String) -> Result<String, String> {
    let webview = app.get_webview(&label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;
    webview.url().map(|u| u.to_string()).map_err(|e| e.to_string())
}

// ─── Caller-origin guard (defense in depth) ──────────────────────────────────
// The capability ACL (capabilities/*.json + permissions/app.toml) is the PRIMARY gate that
// keeps remote pages in the `browser-panel` webview away from privileged commands. This is a
// belt-and-suspenders second check inside the most dangerous commands, so a future ACL
// misconfiguration can't silently re-open credential theft / JS injection.
//
// App commands aren't given the caller origin, but they CAN be handed the calling `Webview`,
// and we trust its label: only "main" (the app UI, which hosts the browser chrome) and
// "spotlight" are app-controlled. The `browser-panel` webview — the one that loads untrusted
// remote content — is never on this allowlist.
fn ensure_trusted_caller(webview: &tauri::Webview) -> Result<(), String> {
    match webview.label() {
        "main" | "spotlight" => Ok(()),
        other => Err(format!("command not permitted from webview '{}'", other)),
    }
}

// ─── macOS Keychain ──────────────────────────────────────────────────────────
#[cfg(target_os = "macos")]
pub(crate) mod keychain_impl {
    const SERVICE: &str = "AgentForgeBrowser";

    // Store credentials as a JSON blob keyed by hostname so we can round-trip both username and password.
    pub fn save(host: &str, username: &str, password: &str) -> Result<(), String> {
        use std::process::Command;
        let data = serde_json::json!({ "username": username, "password": password }).to_string();
        let out = Command::new("security")
            .args(["add-generic-password", "-s", SERVICE, "-a", host, "-w", &data, "-U"])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(if err.is_empty() { format!("exit {}", out.status.code().unwrap_or(-1)) } else { err })
        }
    }

    pub fn get(host: &str) -> Option<(String, String)> {
        use std::process::Command;
        let out = Command::new("security")
            .args(["find-generic-password", "-s", SERVICE, "-a", host, "-w"])
            .output().ok()?;
        if !out.status.success() { return None; }
        let data = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let val: serde_json::Value = serde_json::from_str(&data).ok()?;
        Some((val["username"].as_str()?.to_string(), val["password"].as_str()?.to_string()))
    }

    pub fn delete(host: &str) -> Result<(), String> {
        use std::process::Command;
        let _ = Command::new("security")
            .args(["delete-generic-password", "-s", SERVICE, "-a", host])
            .output();
        Ok(())
    }
}

#[tauri::command]
fn keychain_save(webview: tauri::Webview, host: String, username: String, password: String) -> serde_json::Value {
    if let Err(e) = ensure_trusted_caller(&webview) {
        return serde_json::json!({ "ok": false, "error": e });
    }
    #[cfg(target_os = "macos")]
    {
        match keychain_impl::save(&host, &username, &password) {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }
    #[cfg(not(target_os = "macos"))]
    { serde_json::json!({ "ok": false, "error": "macOS only" }) }
}

#[tauri::command]
fn keychain_get(webview: tauri::Webview, host: String) -> serde_json::Value {
    if let Err(e) = ensure_trusted_caller(&webview) {
        return serde_json::json!({ "ok": false, "error": e });
    }
    #[cfg(target_os = "macos")]
    {
        // SEC-KEYCHAIN: mail passwords are resolved inside Rust (mail.rs `mail_password`) and must
        // never be returned to the renderer — a `mail:` lookup yields presence/username only. Other
        // hosts (browser autofill, model/integration keys) still round-trip until those paths move
        // server-side too.
        if host.starts_with("mail:") {
            return match keychain_impl::get(&host) {
                Some((username, _password)) => serde_json::json!({ "ok": true, "username": username }),
                None => serde_json::json!({ "ok": false }),
            };
        }
        match keychain_impl::get(&host) {
            Some((username, password)) => serde_json::json!({ "ok": true, "username": username, "password": password }),
            None => serde_json::json!({ "ok": false }),
        }
    }
    #[cfg(not(target_os = "macos"))]
    { serde_json::json!({ "ok": false }) }
}

#[tauri::command]
fn keychain_delete(webview: tauri::Webview, host: String) -> serde_json::Value {
    if let Err(e) = ensure_trusted_caller(&webview) {
        return serde_json::json!({ "ok": false, "error": e });
    }
    #[cfg(target_os = "macos")]
    {
        match keychain_impl::delete(&host) {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }
    #[cfg(not(target_os = "macos"))]
    { serde_json::json!({ "ok": true }) }
}

#[tauri::command]
fn browser_open_tab(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.emit("browser:open-tab", serde_json::json!({ "url": url }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn browser_password_event(
    app: tauri::AppHandle,
    event_type: String,
    host: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    app.emit("browser:password-event", serde_json::json!({
        "type": event_type,
        "host": host,
        "username": username,
        "password": password,
    })).map_err(|e| e.to_string())
}

// Return channel for the agentic browse loop. `browser_eval` is fire-and-forget — it can't hand a
// value back to the orchestrator — so the annotator script injected into the page calls this command
// (via __TAURI_INTERNALS__.invoke, the same path the password detector uses) and we re-emit the
// payload to the main window as `browser-agent:observation`. The orchestrator matches on the
// `requestId` it embedded in the script to ignore stale observations from earlier steps.
#[tauri::command]
fn browser_agent_report(app: tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    app.emit("browser-agent:observation", payload)
        .map_err(|e| e.to_string())
}

// Event-driven navigation signal, replacing the old 800ms URL poll. A document-start hook in the
// panel (BROWSER_MASK_SCRIPT) pings this on pushState/replaceState/popstate/hashchange/load so the app
// learns about in-page (SPA) route changes instantly instead of polling.
//
// SPOOFING GUARD: this carries NO url — it is a pure "something navigated, re-read me" trigger. The
// address bar is ALWAYS refreshed from the authoritative `browser_get_url` (the real WKWebView URL),
// never from a value the untrusted page supplies, so a remote page can't fake the displayed address.
// That is also why this is safe to expose to remote origins (allow-browser-remote): it grants no
// authority and reveals nothing.
#[tauri::command]
fn browser_report_nav(app: tauri::AppHandle) -> Result<(), String> {
    app.emit("browser:nav-changed", ()).map_err(|e| e.to_string())
}

// ─── Additional Browser Commands ─────────────────────────────────────────────

#[tauri::command]
fn browser_eval(caller: tauri::Webview, app: tauri::AppHandle, label: String, script: String) -> Result<(), String> {
    ensure_trusted_caller(&caller)?;
    let webview = app.get_webview(&label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;
    webview.eval(&script).map_err(|e| e.to_string())
}

#[tauri::command]
fn browser_find(app: tauri::AppHandle, label: String, query: String, forward: bool) -> Result<(), String> {
    let webview = app.get_webview(&label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;
    let escaped = query.replace('\\', "\\\\").replace('\'', "\\'");
    let direction = if forward { "false" } else { "true" };
    webview.eval(&format!("window.find('{}', false, {}, false)", escaped, direction))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn browser_set_zoom(app: tauri::AppHandle, label: String, factor: f64) -> Result<(), String> {
    let webview = app.get_webview(&label)
        .ok_or_else(|| format!("webview '{}' not found", label))?;
    let clamped = factor.clamp(0.25, 5.0);
    webview.set_zoom(clamped).map_err(|e| e.to_string())
}

#[tauri::command]
async fn browser_download_url(_app: tauri::AppHandle, url: String, filename: String) -> Result<String, String> {
    // SSRF: reject loopback/private/link-local hosts — this command is reachable from the remote
    // browser-panel, so a page must not be able to make the backend fetch internal endpoints.
    egress_host_allowed(&url)?;
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    // Stream with a hard size cap so a remote-triggered download can't exhaust memory (the previous
    // .bytes() buffered the entire body unbounded).
    const MAX_DOWNLOAD: u64 = 256 * 1024 * 1024; // 256 MB
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if let Some(len) = resp.content_length() {
        if len > MAX_DOWNLOAD {
            return Err("file exceeds the 256 MB download limit".to_string());
        }
    }
    let mut downloaded: u64 = 0;
    let mut buf: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded > MAX_DOWNLOAD {
            return Err("file exceeds the 256 MB download limit".to_string());
        }
        buf.extend_from_slice(&chunk);
    }
    let bytes = buf;
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let downloads = std::path::PathBuf::from(home).join("Downloads");
    let _ = std::fs::create_dir_all(&downloads);
    let safe_name: String = filename.chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_' || *c == ' ')
        .collect();
    let name = if safe_name.trim().is_empty() { "download".to_string() } else { safe_name.trim().to_string() };
    let dest = downloads.join(&name);
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

// ─── Knowledge Graph ──────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
struct GraphNode {
    id: String,
    node_type: String,
    label: String,
    source_url: Option<String>,
    source_path: Option<String>,
    metadata_json: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct GraphEdge {
    id: String,
    source_id: String,
    target_id: String,
    relation: String,
    weight: f64,
    metadata_json: String,
    created_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct GraphSubgraph {
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct GraphStats {
    node_count: i64,
    edge_count: i64,
    most_connected: Vec<(String, String, i64)>, // (id, label, degree)
}

fn open_graph_db() -> Result<rusqlite::Connection, String> {
    let db_path = knowledge_root().join(".index.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS graph_nodes (
            id            TEXT PRIMARY KEY,
            node_type     TEXT NOT NULL,
            label         TEXT NOT NULL,
            source_url    TEXT,
            source_path   TEXT,
            metadata_json TEXT DEFAULT '{}',
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS graph_edges (
            id            TEXT PRIMARY KEY,
            source_id     TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
            target_id     TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
            relation      TEXT NOT NULL,
            weight        REAL DEFAULT 1.0,
            metadata_json TEXT DEFAULT '{}',
            created_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);
        CREATE INDEX IF NOT EXISTS idx_graph_nodes_type   ON graph_nodes(node_type);",
    ).map_err(|e| e.to_string())?;
    // Enable cascade deletes via foreign keys
    conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
    Ok(conn)
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[tauri::command]
fn upsert_graph_node(
    id: String,
    node_type: String,
    label: String,
    source_url: Option<String>,
    source_path: Option<String>,
    metadata_json: String,
) -> Result<(), String> {
    let conn = open_graph_db()?;
    let now = now_secs();
    conn.execute(
        "INSERT INTO graph_nodes (id, node_type, label, source_url, source_path, metadata_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(id) DO UPDATE SET
             node_type     = excluded.node_type,
             label         = excluded.label,
             source_url    = excluded.source_url,
             source_path   = excluded.source_path,
             metadata_json = excluded.metadata_json,
             updated_at    = excluded.updated_at",
        rusqlite::params![id, node_type, label, source_url, source_path, metadata_json, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn upsert_graph_edge(
    id: String,
    source_id: String,
    target_id: String,
    relation: String,
    weight: f64,
    metadata_json: String,
) -> Result<(), String> {
    let conn = open_graph_db()?;
    let now = now_secs();
    conn.execute(
        "INSERT INTO graph_edges (id, source_id, target_id, relation, weight, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
             source_id     = excluded.source_id,
             target_id     = excluded.target_id,
             relation      = excluded.relation,
             weight        = excluded.weight,
             metadata_json = excluded.metadata_json",
        rusqlite::params![id, source_id, target_id, relation, weight, metadata_json, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_graph_neighbors(node_id: String, max_depth: u32) -> Result<GraphSubgraph, String> {
    let depth = max_depth.min(3);
    let conn = open_graph_db()?;

    let mut visited_nodes: std::collections::HashSet<String> = std::collections::HashSet::new();
    visited_nodes.insert(node_id.clone());
    let mut frontier: Vec<String> = vec![node_id];

    for _ in 0..depth {
        if frontier.is_empty() {
            break;
        }
        let mut next_frontier: Vec<String> = Vec::new();
        for nid in &frontier {
            let mut stmt = conn.prepare(
                "SELECT source_id, target_id FROM graph_edges WHERE source_id = ?1 OR target_id = ?1",
            ).map_err(|e| e.to_string())?;
            let neighbors: Vec<String> = stmt
                .query_map(rusqlite::params![nid], |row| {
                    let src: String = row.get(0)?;
                    let tgt: String = row.get(1)?;
                    Ok((src, tgt))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .flat_map(|(src, tgt)| {
                    let n = nid.clone();
                    let mut v = Vec::new();
                    if src != n { v.push(src); }
                    if tgt != n { v.push(tgt); }
                    v
                })
                .collect();
            for neighbor in neighbors {
                if visited_nodes.insert(neighbor.clone()) {
                    next_frontier.push(neighbor);
                }
            }
        }
        frontier = next_frontier;
    }

    // Fetch all nodes in the visited set
    let node_ids: Vec<String> = visited_nodes.into_iter().collect();
    let ph: String = (1..=node_ids.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");

    let node_sql = format!(
        "SELECT id, node_type, label, source_url, source_path, metadata_json, created_at, updated_at
         FROM graph_nodes WHERE id IN ({ph})"
    );
    let mut stmt = conn.prepare(&node_sql).map_err(|e| e.to_string())?;
    let nodes: Vec<GraphNode> = stmt
        .query_map(rusqlite::params_from_iter(node_ids.iter()), |row| {
            Ok(GraphNode {
                id:            row.get(0)?,
                node_type:     row.get(1)?,
                label:         row.get(2)?,
                source_url:    row.get(3)?,
                source_path:   row.get(4)?,
                metadata_json: row.get(5)?,
                created_at:    row.get(6)?,
                updated_at:    row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Fetch edges where both endpoints are in the visited set
    // Build two copies of the placeholder list (source_id IN (...) AND target_id IN (...))
    let ph2: String = (node_ids.len() + 1..=node_ids.len() * 2)
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let edge_sql = format!(
        "SELECT id, source_id, target_id, relation, weight, metadata_json, created_at
         FROM graph_edges WHERE source_id IN ({ph}) AND target_id IN ({ph2})"
    );
    let combined_ids: Vec<String> = node_ids.iter().cloned().chain(node_ids.iter().cloned()).collect();
    let mut stmt2 = conn.prepare(&edge_sql).map_err(|e| e.to_string())?;
    let edges: Vec<GraphEdge> = stmt2
        .query_map(rusqlite::params_from_iter(combined_ids.iter()), |row| {
            Ok(GraphEdge {
                id:            row.get(0)?,
                source_id:     row.get(1)?,
                target_id:     row.get(2)?,
                relation:      row.get(3)?,
                weight:        row.get(4)?,
                metadata_json: row.get(5)?,
                created_at:    row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(GraphSubgraph { nodes, edges })
}

/// Return the ENTIRE knowledge graph (all nodes + edges) for the Knowledge Graph panel. An empty
/// result simply means nothing has been captured yet — the UI shows an empty state, never mock data.
#[tauri::command]
fn get_graph_full() -> Result<GraphSubgraph, String> {
    let conn = open_graph_db()?;

    let mut stmt = conn.prepare(
        "SELECT id, node_type, label, source_url, source_path, metadata_json, created_at, updated_at
         FROM graph_nodes",
    ).map_err(|e| e.to_string())?;
    let nodes: Vec<GraphNode> = stmt
        .query_map([], |row| {
            Ok(GraphNode {
                id:            row.get(0)?,
                node_type:     row.get(1)?,
                label:         row.get(2)?,
                source_url:    row.get(3)?,
                source_path:   row.get(4)?,
                metadata_json: row.get(5)?,
                created_at:    row.get(6)?,
                updated_at:    row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut stmt2 = conn.prepare(
        "SELECT id, source_id, target_id, relation, weight, metadata_json, created_at
         FROM graph_edges",
    ).map_err(|e| e.to_string())?;
    let edges: Vec<GraphEdge> = stmt2
        .query_map([], |row| {
            Ok(GraphEdge {
                id:            row.get(0)?,
                source_id:     row.get(1)?,
                target_id:     row.get(2)?,
                relation:      row.get(3)?,
                weight:        row.get(4)?,
                metadata_json: row.get(5)?,
                created_at:    row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(GraphSubgraph { nodes, edges })
}

#[tauri::command]
fn get_graph_stats() -> Result<GraphStats, String> {
    let conn = open_graph_db()?;

    let node_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM graph_nodes", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let edge_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM graph_edges", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT n.id, n.label,
                (SELECT COUNT(*) FROM graph_edges
                 WHERE source_id = n.id OR target_id = n.id) AS degree
         FROM graph_nodes n
         ORDER BY degree DESC
         LIMIT 10",
    ).map_err(|e| e.to_string())?;

    let most_connected: Vec<(String, String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(GraphStats { node_count, edge_count, most_connected })
}

#[tauri::command]
fn delete_graph_node(id: String) -> Result<(), String> {
    let conn = open_graph_db()?;
    conn.execute("DELETE FROM graph_nodes WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Batched, transactional graph write. Extraction produces many entities + edges at once; doing them
// as one connection + one transaction (nodes before edges, so the edge FKs resolve) replaces dozens
// of separate `upsert_graph_*` IPC round-trips — each of which otherwise opens its own SQLite
// connection and contends for the write lock. Per-row failures are swallowed (best-effort mirror);
// only a failure to open the DB or commit surfaces.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphNodeInput {
    id: String,
    node_type: String,
    label: String,
    source_url: Option<String>,
    source_path: Option<String>,
    #[serde(default)]
    metadata_json: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphEdgeInput {
    id: String,
    source_id: String,
    target_id: String,
    relation: String,
    #[serde(default)]
    weight: Option<f64>,
    #[serde(default)]
    metadata_json: Option<String>,
}

#[tauri::command]
fn upsert_graph_batch(nodes: Vec<GraphNodeInput>, edges: Vec<GraphEdgeInput>) -> Result<(), String> {
    let mut conn = open_graph_db()?;
    let now = now_secs();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for n in &nodes {
        // Ignore a single malformed row rather than sinking the whole batch. A constraint error
        // leaves the transaction usable for the remaining statements.
        let _ = tx.execute(
            "INSERT INTO graph_nodes (id, node_type, label, source_url, source_path, metadata_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(id) DO UPDATE SET
                 node_type     = excluded.node_type,
                 label         = excluded.label,
                 source_url    = excluded.source_url,
                 source_path   = excluded.source_path,
                 metadata_json = excluded.metadata_json,
                 updated_at    = excluded.updated_at",
            rusqlite::params![
                n.id, n.node_type, n.label, n.source_url, n.source_path,
                n.metadata_json.clone().unwrap_or_else(|| "{}".to_string()), now
            ],
        );
    }
    for e in &edges {
        let _ = tx.execute(
            "INSERT INTO graph_edges (id, source_id, target_id, relation, weight, metadata_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                 source_id     = excluded.source_id,
                 target_id     = excluded.target_id,
                 relation      = excluded.relation,
                 weight        = excluded.weight,
                 metadata_json = excluded.metadata_json",
            rusqlite::params![
                e.id, e.source_id, e.target_id, e.relation,
                e.weight.unwrap_or(1.0),
                e.metadata_json.clone().unwrap_or_else(|| "{}".to_string()), now
            ],
        );
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LlamaState {
            pid: Mutex::new(None),
        })
        .manage(DownloadState::default())
        .manage(pty::PtyState::default())
        .manage(TabCache::default())
        .manage(Mutex::new(NetworkState::default()))
        .manage(SysState(Mutex::new(System::new_with_specifics(
            RefreshKind::new().with_cpu(CpuRefreshKind::everything()),
        ))))
        .setup(|app| {
            jobs::check_interrupted_jobs();
            // ── Spotlight window ──────────────────────────────────────────────
            let spotlight_url = if cfg!(debug_assertions) {
                tauri::WebviewUrl::External(
                    "http://localhost:1420/?window=spotlight".parse().unwrap(),
                )
            } else {
                tauri::WebviewUrl::App("/?window=spotlight".into())
            };
            tauri::WebviewWindowBuilder::new(app, "spotlight", spotlight_url)
                .title("Forge Spotlight")
                .transparent(true)
                .decorations(false)
                .always_on_top(true)
                .visible(false)
                .skip_taskbar(true)
                .center()
                .inner_size(640.0, 340.0)
                .min_inner_size(360.0, 200.0)
                .resizable(true)
                .build()?;

            // The perception glow rides above everything but must never eat a click.
            // (Not expressible in tauri.conf.json — cursor passthrough is runtime-only API.)
            if let Some(glow) = app.get_webview_window("glow") {
                let _ = glow.set_ignore_cursor_events(true);
            }

            // ── Global shortcut: Cmd+Shift+F ──────────────────────────────────
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+F",
                move |_app, _sc, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() == ShortcutState::Pressed {
                        if let Some(w) = handle.get_webview_window("spotlight") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                                // Return focus to main window when spotlight closes
                                if let Some(main) = handle.get_webview_window("main") {
                                    let _ = main.set_focus();
                                }
                            } else {
                                // Capture active tab NOW — browser still has focus at this point
                                let tab = detect_active_tab_preferred(None);
                                *handle.state::<TabCache>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some(tab);
                                dock_spotlight_right(&w);
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                },
            )?;
            Ok(())
        })
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Clean Exit hook: SIGCONT + SIGKILL the llama sidecar on window destroy, and reap every
        // live PTY session so no zombie shells / dev-servers outlive the app.
        .on_window_event(|window, event| {
            // Closing the MAIN window means "quit the app" — not the macOS default of lingering
            // window-less in the Dock. Tear down the child processes we own (the local model
            // engine + any PTY sessions) and exit for real, so the red X fully closes Agent Forge.
            // Spotlight/glow are hidden (never destroyed), so this only fires for main.
            let is_main = window.label() == "main";
            let should_teardown = matches!(event, tauri::WindowEvent::Destroyed)
                || matches!(event, tauri::WindowEvent::CloseRequested { .. });
            if is_main && should_teardown {
                let app = window.app_handle();
                let state = app.state::<LlamaState>();
                let pid = *state.pid.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(pid) = pid {
                    kill_llama(pid);
                }
                pty::kill_all_sessions(app);
                app.exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            jobs::get_active_jobs,
            jobs::start_job,
            jobs::update_job,
            jobs::cancel_job,
            greet,
            open_spoken_content_settings,
            get_ram_stats,
            get_hardware_summary,
            get_system_stats,
            spawn_llama_server,
            sigstop_llama_server,
            sigcont_llama_server,
            safe_write_file,
            rollback_file,
            init_knowledge_core,
            write_memory,
            append_task,
            complete_task,
            revert_memory_commit,
            search_knowledge,
            get_hardware_profile,
            init_file_watcher,
            sync_knowledge_core_index,
            get_index_status,
            search_knowledge_semantic,
            embed_text,
            delete_memory_file,
            archive_memory_file,
            restore_archived_file,
            read_dream_log,
            write_dream_log,
            list_archive_files,
            list_agent_memory_files,
            list_library_files,
            read_knowledge_file,
            fs_list,
            fs_read,
            fs_write,
            fs_mkdir,
            fs_delete,
            fs_move,
            fs_import,
            fs_probe_context,
            fs_read_external,
            fs_list_external,
            fs_write_external,
            fs_delete_external,
            fs_reveal,
            run_command,
            set_developer_mode,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            screenshot::webview_screenshot,
            screenshot::browser_snapshot,
            screenshot::browser_snapshot_text,
            screenshot::capture_screen,
            screenshot::capture_screen_text,
            screenshot::preview_screen_thumb,
            screenshot::screen_capture_authorized,
            screenshot::request_screen_capture_access,
            screenshot::open_screen_recording_settings,
            permissions::automation_grant,
            permissions::open_privacy_settings,
            permissions::notify_user,
            permissions::accessibility_authorized,
            permissions::accessibility_request_access,
            input::inject_click,
            get_active_tab,
            show_spotlight,
            hide_spotlight,
            setup_relay,
            get_relay_status,
            list_inbox_captures,
            create_inbox_capture,
            update_inbox_capture,
            read_inbox_attachment,
            set_network_active,
            get_network_peers,
            get_models_dir,
            list_gguf_models,
            delete_model,
            download_model,
            cancel_download,
            start_local_model,
            revive_local_model,
            extract_page_text,
            check_page_is_private,
            mail::mail_test_connection,
            mail::mail_fetch_recent,
            mail::mail_search,
            mail::mail_fetch_sent,
            mail::mail_fetch_body,
            mail::mail_set_seen,
            mail::mail_set_flagged,
            mail::mail_unread_count,
            mail::mail_delete,
            mail::mail_send,
            imessage::imessage_check_access,
            imessage::imessage_open_fda_settings,
            imessage::imessage_unread_count,
            imessage::imessage_list_chats,
            imessage::imessage_fetch_messages,
            imessage::imessage_send,
            imessage::imessage_send_new,
            calendar::eventkit_authorization_status,
            calendar::eventkit_request_access,
            calendar::eventkit_list_calendars,
            calendar::eventkit_list_events,
            calendar::eventkit_save_event,
            calendar::eventkit_update_event,
            calendar::eventkit_delete_event,
            calendar::eventkit_list_reminders,
            calendar::eventkit_save_reminder,
            calendar::eventkit_set_reminder_completed,
            calendar::eventkit_delete_reminder,
            calendar::eventkit_update_reminder,
            notes::notes_list_folders,
            notes::notes_list,
            notes::notes_read,
            notes::notes_create,
            notes::notes_update,
            notes::notes_delete,
            music::music_play,
            music::music_pause,
            music::music_create_playlist,
            music::music_add_track_to_playlist,
            browser_create,
            browser_navigate,
            browser_reload,
            browser_go_back,
            browser_go_forward,
            browser_get_url,
            browser_eval,
            browser_find,
            browser_set_zoom,
            browser_download_url,
            keychain_save,
            keychain_get,
            keychain_delete,
            browser_open_tab,
            browser_password_event,
            browser_agent_report,
            browser_report_nav,
            upsert_graph_node,
            upsert_graph_edge,
            upsert_graph_batch,
            get_graph_neighbors,
            get_graph_full,
            get_graph_stats,
            delete_graph_node,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app_handle, event| {
            // Dock icon click on macOS — restore main window if nothing visible
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(w) = app_handle.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
        });
}

// ─── Unit Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // ── SEC-SYMLINK: in-jail symlink can't escape the root ────────────────────
    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        let base = std::env::temp_dir().join(format!("af-symtest-{}", std::process::id()));
        let root = base.join("root");
        let outside = base.join("outside");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "x").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        // A path through the in-jail symlink resolves OUTSIDE the root → rejected.
        assert!(assert_no_symlink_escape(&root, &root.join("link").join("secret.txt")).is_err());
        // A genuine in-root path (existing leaf) is allowed.
        std::fs::write(root.join("ok.txt"), "y").unwrap();
        assert!(assert_no_symlink_escape(&root, &root.join("ok.txt")).is_ok());
        // A not-yet-existing leaf whose real parent is in-root is allowed (the write case).
        assert!(assert_no_symlink_escape(&root, &root.join("new.txt")).is_ok());
        let _ = std::fs::remove_dir_all(&base);
    }

    // ── Retrieval importance weighting ────────────────────────────────────────
    #[test]
    fn parse_memory_importance_reads_confidence_and_evidence() {
        // High confidence, first-party → top importance.
        let hi = parse_memory_importance("---\nconfidence: high\nevidence_state: first_party\n---\n# x");
        assert!((hi - 1.0).abs() < 1e-6, "high/first_party should be 1.0, got {hi}");
        // Low confidence → low importance.
        let lo = parse_memory_importance("---\nconfidence: low\n---\n");
        assert!((lo - 0.3).abs() < 1e-6, "low should be 0.3, got {lo}");
        // Unlabeled (no frontmatter) → medium default.
        assert!((parse_memory_importance("# just a note") - 0.6).abs() < 1e-6);
        // needs_verification discounts even high confidence (1.0 * 0.6 = 0.6).
        let nv = parse_memory_importance("confidence: high\nevidence_state: needs_verification");
        assert!(nv > 0.55 && nv < 0.65, "needs_verification should discount high→~0.6, got {nv}");
        // Output always stays within bounds.
        let f = parse_memory_importance("confidence: low\nevidence_state: conflicting");
        assert!((0.05..=1.0).contains(&f), "importance must stay in [0.05,1.0], got {f}");
    }

    // ── Keyword-fallback score normalization ──────────────────────────────────
    #[test]
    fn keyword_relevance_is_cosine_comparable() {
        // No query terms / no match → 0 (never leaks as a passing "cosine").
        assert_eq!(keyword_relevance(0, 0, 0), 0.0);
        assert_eq!(keyword_relevance(0, 3, 0), 0.0);
        // Full coverage scores high but never exceeds 1.0, even with heavy repetition.
        let full = keyword_relevance(3, 3, 3);
        assert!((0.85..=1.0).contains(&full), "full coverage should be >=0.85, got {full}");
        assert!(keyword_relevance(2, 2, 1000) <= 1.0, "repetition must not exceed 1.0");
        // More coverage ranks above less.
        assert!(keyword_relevance(1, 3, 1) < full);
        // A single term out of many stays below the frontend's 0.35/0.3 cosine gates — so weak
        // keyword hits no longer trivially pass (the bug being fixed).
        assert!(keyword_relevance(1, 4, 1) < 0.3, "weak partial match should be gated");
    }

    // ── Capability ACL gating ─────────────────────────────────────────────────
    // Faithful, automated proof of the remote-isolation fix. We load the EXACT files
    // `tauri::generate_context!` consumes (gen/schemas/{acl-manifests,capabilities}.json),
    // run the EXACT resolver tauri's IPC layer runs (`Resolved::resolve` +
    // `RuntimeAuthority::resolve_access`, tauri-2.10.3), and assert who can reach what.
    //
    // Gated on debug_assertions because `RuntimeAuthority::new` takes an extra `acl` arg under
    // `any(feature = "dynamic-acl", debug_assertions)` — which is exactly the `cargo test` build.
    #[cfg(debug_assertions)]
    #[test]
    fn remote_origin_is_locked_out_of_privileged_commands() {
        use std::collections::BTreeMap;
        use tauri::ipc::{Origin, RuntimeAuthority};
        use tauri::utils::acl::{capability::Capability, manifest::Manifest, resolved::Resolved};
        use tauri::utils::platform::Target;

        let acl: BTreeMap<String, Manifest> = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/gen/schemas/acl-manifests.json"
            ))
            .expect("read acl-manifests.json"),
        )
        .expect("parse acl-manifests.json");

        let capabilities: BTreeMap<String, Capability> = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/gen/schemas/capabilities.json"
            ))
            .expect("read capabilities.json"),
        )
        .expect("parse capabilities.json");

        let resolved = Resolved::resolve(&acl, capabilities, Target::MacOS).expect("resolve ACL");

        // The whole fix hinges on this: with an app ACL manifest present, tauri enforces the ACL
        // for app commands too (webview/mod.rs ~L1804: `plugin_command.is_some() || has_app_acl_manifest`).
        assert!(
            resolved.has_app_acl,
            "app ACL manifest missing — app commands would bypass the ACL entirely"
        );

        let authority = RuntimeAuthority::new(acl, resolved);

        // The main window's primary webview is labelled "main"; the untrusted browser is the
        // "browser-panel" child webview *inside* the "main" window.
        let local = Origin::Local;
        let remote = Origin::Remote {
            url: tauri::Url::parse("https://attacker.example/login").expect("url"),
        };
        let allowed = |cmd: &str, win: &str, wv: &str, o: &Origin| {
            authority.resolve_access(cmd, win, wv, o).is_some()
        };

        // (a) Local app UI keeps full access to everything it uses.
        for cmd in [
            "keychain_get", "keychain_save", "keychain_delete", "browser_eval", "browser_navigate",
            "browser_create", "write_memory", "mail_test_connection", "start_local_model",
            "browser_agent_report", "browser_download_url",
        ] {
            assert!(allowed(cmd, "main", "main", &local), "local main must reach {cmd}");
        }
        // Spotlight (separate local window) keeps the access it needs.
        assert!(allowed("write_memory", "spotlight", "spotlight", &local), "spotlight write_memory");

        // (b) A remote page in browser-panel may reach ONLY the fire-and-forget reporters.
        for cmd in [
            "browser_agent_report", "browser_open_tab", "browser_password_event", "browser_download_url",
            "browser_report_nav",
        ] {
            assert!(allowed(cmd, "main", "browser-panel", &remote), "remote must reach safe cmd {cmd}");
        }

        // ...and is denied everything dangerous — credential theft, JS injection, navigation,
        // mail, fs, model, and graph commands.
        for cmd in [
            "keychain_get", "keychain_save", "keychain_delete", "browser_eval", "browser_navigate",
            "browser_create", "browser_reload", "mail_test_connection", "mail_fetch_recent", "mail_fetch_sent",
            "imessage_check_access", "imessage_open_fda_settings", "imessage_unread_count", "imessage_list_chats", "imessage_fetch_messages", "imessage_send",
            "eventkit_authorization_status", "eventkit_request_access", "eventkit_list_calendars", "eventkit_list_events", "eventkit_save_event", "eventkit_update_event", "eventkit_delete_event",
            "eventkit_list_reminders", "eventkit_save_reminder", "eventkit_set_reminder_completed", "eventkit_delete_reminder", "eventkit_update_reminder",
            "notes_list_folders", "notes_list", "notes_read", "notes_create", "notes_update", "notes_delete",
            "music_play", "music_pause", "music_create_playlist", "music_add_track_to_playlist",
            "write_memory", "safe_write_file", "read_knowledge_file", "start_local_model",
            "download_model", "upsert_graph_node", "upsert_graph_batch", "get_graph_stats", "get_graph_full", "setup_relay",
            // File access (Workshop model) — the filesystem and shell are NEVER reachable from a
            // remote page in the browser panel, even read-only or workspace-scoped.
            "fs_list", "fs_read", "fs_write", "fs_mkdir", "fs_delete", "fs_move", "fs_import",
            "fs_probe_context", "fs_read_external", "fs_list_external", "fs_write_external",
            "fs_delete_external", "fs_reveal", "run_command",
            // Interactive terminal (PTY) — a remote page must NEVER reach an interactive shell with
            // the user's real credentials. These run the login shell; treat as maximally privileged.
            "pty_spawn", "pty_write", "pty_resize", "pty_kill",
            // Screen capture — a remote page must NEVER snapshot the user's app window, nor the
            // browser panel it is rendered in (that would let it screenshot itself and exfiltrate).
            "webview_screenshot", "browser_snapshot", "browser_snapshot_text",
        ] {
            assert!(
                !allowed(cmd, "main", "browser-panel", &remote),
                "SECURITY: remote page reached privileged command {cmd}"
            );
        }

        // The browser-panel webview must not inherit the full local surface even for a (hypothetical)
        // local-origin page — `default` is scoped to the "main" webview, not the whole window.
        assert!(
            !allowed("keychain_get", "main", "browser-panel", &local),
            "browser-panel webview should not inherit the local keychain command"
        );
    }

    // Flexibility guard: build.rs auto-generates `allow-app-local` from `generate_handler!`, so
    // every registered command (incl. anything newly built) is callable by the local UI/agents
    // without hand-editing the ACL. This test fails loudly if that sync ever drifts — e.g. a
    // command got registered but the generated allow-list wasn't refreshed.
    #[test]
    fn allow_app_local_covers_every_registered_command() {
        // Commands registered in the single generate_handler![ ... ] block.
        let src = include_str!("lib.rs");
        const ANCHOR: &str = "generate_handler![";
        let start = src.find(ANCHOR).expect("generate_handler![ present") + ANCHOR.len();
        let len = src[start..].find(']').expect("handler closes");
        let registered: std::collections::BTreeSet<String> = src[start..start + len]
            .split(',')
            .filter_map(|raw| {
                let token = raw.split("//").next().unwrap_or("").trim();
                let name = token.rsplit("::").next().unwrap_or("").trim();
                let mut b = name.bytes();
                let ok = match b.next() {
                    Some(c) => {
                        (c.is_ascii_alphabetic() || c == b'_')
                            && b.all(|c| c.is_ascii_alphanumeric() || c == b'_')
                    }
                    None => false,
                };
                ok.then(|| name.to_string())
            })
            .collect();
        assert!(registered.len() > 50, "parsed too few commands ({})", registered.len());

        // Commands the generated `allow-app-local` permission grants (read from the built manifest).
        let acl: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/gen/schemas/acl-manifests.json"
            ))
            .expect("read acl-manifests.json"),
        )
        .expect("parse acl-manifests.json");
        let allowed: std::collections::BTreeSet<String> = acl["__app-acl__"]["permissions"]
            ["allow-app-local"]["commands"]["allow"]
            .as_array()
            .expect("allow-app-local.commands.allow is an array")
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();

        let missing: Vec<&String> = registered.difference(&allowed).collect();
        assert!(
            missing.is_empty(),
            "these registered commands are not in allow-app-local — rebuild to regenerate \
             permissions/app_local.gen.toml (build.rs codegen): {missing:?}"
        );
    }

    // ── normalize_path_lexically ──────────────────────────────────────────────

    #[test]
    fn test_normalize_path_removes_cur_dir() {
        let input = PathBuf::from("/foo/./bar");
        let result = normalize_path_lexically(input);
        assert_eq!(result, PathBuf::from("/foo/bar"));
    }

    #[test]
    fn test_normalize_path_removes_parent_dir() {
        let input = PathBuf::from("/foo/../bar");
        let result = normalize_path_lexically(input);
        assert_eq!(result, PathBuf::from("/bar"));
    }

    #[test]
    fn test_normalize_path_multiple_parent_dirs() {
        let input = PathBuf::from("/a/b/c/../..");
        let result = normalize_path_lexically(input);
        assert_eq!(result, PathBuf::from("/a"));
    }

    #[test]
    fn test_normalize_path_already_clean() {
        let input = PathBuf::from("/foo/bar/baz");
        let result = normalize_path_lexically(input.clone());
        assert_eq!(result, input);
    }

    #[test]
    fn test_normalize_path_mixed_dots() {
        let input = PathBuf::from("/a/./b/../c");
        let result = normalize_path_lexically(input);
        assert_eq!(result, PathBuf::from("/a/c"));
    }

    #[test]
    fn test_normalize_path_relative() {
        let input = PathBuf::from("foo/./bar/../baz");
        let result = normalize_path_lexically(input);
        assert_eq!(result, PathBuf::from("foo/baz"));
    }

    // ── knowledge_path_from_input ─────────────────────────────────────────────

    #[test]
    fn test_knowledge_path_valid_subpath() {
        // Set a known HOME so knowledge_root() is deterministic in tests
        std::env::set_var("HOME", "/tmp/test_home");
        let result = knowledge_path_from_input("memory/goals.md");
        assert!(result.is_ok(), "Expected Ok for valid sub-path, got: {:?}", result);
        let path = result.unwrap();
        assert!(path.starts_with("/tmp/test_home/AgentForge"));
    }

    #[test]
    fn test_knowledge_path_traversal_attack() {
        std::env::set_var("HOME", "/tmp/test_home");
        let result = knowledge_path_from_input("../../../etc/passwd");
        assert!(result.is_err(), "Expected Err for traversal attack");
        assert!(result.unwrap_err().contains("outside"));
    }

    #[test]
    fn test_knowledge_path_absolute_outside_root() {
        std::env::set_var("HOME", "/tmp/test_home");
        let result = knowledge_path_from_input("/etc/passwd");
        assert!(result.is_err(), "Expected Err for absolute path outside root");
    }

    #[test]
    fn test_knowledge_path_nested_traversal() {
        std::env::set_var("HOME", "/tmp/test_home");
        let result = knowledge_path_from_input("memory/../../etc/hosts");
        assert!(result.is_err(), "Expected Err for nested traversal");
    }

    #[test]
    fn test_knowledge_path_root_itself() {
        std::env::set_var("HOME", "/tmp/test_home");
        // Empty string → PathBuf::from("") → relative empty → joined to root → equals root
        let result = knowledge_path_from_input("");
        assert!(result.is_ok(), "Expected Ok for empty string (root itself), got: {:?}", result);
    }

    // ── is_safe_agent_id ──────────────────────────────────────────────────────

    #[test]
    fn test_is_safe_agent_id_valid_with_hyphen_and_underscore() {
        assert!(is_safe_agent_id("my-agent_1"));
    }

    #[test]
    fn test_is_safe_agent_id_alphanumeric() {
        assert!(is_safe_agent_id("valid123"));
    }

    #[test]
    fn test_is_safe_agent_id_slash_rejected() {
        assert!(!is_safe_agent_id("bad/agent"));
    }

    #[test]
    fn test_is_safe_agent_id_backslash_rejected() {
        assert!(!is_safe_agent_id("bad\\agent"));
    }

    #[test]
    fn test_is_safe_agent_id_single_dot_rejected() {
        assert!(!is_safe_agent_id("."));
    }

    #[test]
    fn test_is_safe_agent_id_double_dot_rejected() {
        assert!(!is_safe_agent_id(".."));
    }

    #[test]
    fn test_is_safe_agent_id_empty_rejected() {
        assert!(!is_safe_agent_id(""));
    }

    #[test]
    fn test_is_safe_agent_id_space_allowed() {
        // The current implementation does NOT block spaces — only /, \, ".", ".."
        // This test documents the actual behavior of the function.
        assert!(is_safe_agent_id("has space"));
    }

    // ── parse_deletions ───────────────────────────────────────────────────────

    #[test]
    fn test_parse_deletions_with_deletions() {
        let stat = "3 files changed, 12 insertions(+), 7 deletions(-)";
        assert_eq!(parse_deletions(stat), 7);
    }

    #[test]
    fn test_parse_deletions_no_deletions() {
        let stat = "1 file changed, 1 insertion(+)";
        assert_eq!(parse_deletions(stat), 0);
    }

    #[test]
    fn test_parse_deletions_empty_string() {
        assert_eq!(parse_deletions(""), 0);
    }

    #[test]
    fn test_parse_deletions_only_deletions() {
        let stat = "1 file changed, 5 deletions(-)";
        assert_eq!(parse_deletions(stat), 5);
    }

    #[test]
    fn test_parse_deletions_single_deletion() {
        let stat = "1 file changed, 1 deletion(-)";
        assert_eq!(parse_deletions(stat), 1);
    }

    // ── cosine_similarity ─────────────────────────────────────────────────────

    #[test]
    fn test_cosine_similarity_identical_vectors() {
        let v = vec![1.0_f32, 2.0, 3.0];
        let sim = cosine_similarity(&v, &v);
        assert!(
            (sim - 1.0).abs() < 1e-6,
            "Identical vectors should have similarity ~1.0, got {}",
            sim
        );
    }

    #[test]
    fn test_cosine_similarity_orthogonal_vectors() {
        let a = vec![1.0_f32, 0.0];
        let b = vec![0.0_f32, 1.0];
        let sim = cosine_similarity(&a, &b);
        assert!(
            (sim - 0.0).abs() < 1e-6,
            "Orthogonal vectors should have similarity ~0.0, got {}",
            sim
        );
    }

    #[test]
    fn test_cosine_similarity_known_pair() {
        // [1, 1] and [1, 0]: dot=1, |a|=sqrt(2), |b|=1 → sim = 1/sqrt(2) ≈ 0.7071
        let a = vec![1.0_f32, 1.0];
        let b = vec![1.0_f32, 0.0];
        let sim = cosine_similarity(&a, &b);
        let expected = 1.0_f32 / 2.0_f32.sqrt();
        assert!(
            (sim - expected).abs() < 1e-5,
            "Expected ~{}, got {}",
            expected,
            sim
        );
    }

    #[test]
    fn test_cosine_similarity_length_mismatch_returns_zero() {
        let a = vec![1.0_f32, 2.0, 3.0];
        let b = vec![1.0_f32, 2.0];
        let sim = cosine_similarity(&a, &b);
        assert_eq!(sim, 0.0, "Mismatched lengths should return 0.0");
    }

    #[test]
    fn test_cosine_similarity_zero_vector_returns_zero() {
        let a = vec![0.0_f32, 0.0, 0.0];
        let b = vec![1.0_f32, 2.0, 3.0];
        let sim = cosine_similarity(&a, &b);
        assert_eq!(sim, 0.0, "Zero vector should return 0.0");
    }

    // ── strip_frontmatter ─────────────────────────────────────────────────────

    #[test]
    fn test_strip_frontmatter_removes_yaml_block() {
        let content = "---\nfoo: bar\n---\nHello world";
        let result = strip_frontmatter(content);
        assert_eq!(result, "Hello world");
    }

    #[test]
    fn test_strip_frontmatter_no_frontmatter() {
        let content = "# Title\n\nSome content here.";
        let result = strip_frontmatter(content);
        assert_eq!(result, content);
    }

    #[test]
    fn test_strip_frontmatter_empty_frontmatter() {
        let content = "---\n---\nBody text";
        let result = strip_frontmatter(content);
        assert_eq!(result, "Body text");
    }

    #[test]
    fn test_strip_frontmatter_empty_string() {
        let result = strip_frontmatter("");
        assert_eq!(result, "");
    }

    // ── extract_title ─────────────────────────────────────────────────────────

    #[test]
    fn test_extract_title_from_frontmatter_title_field() {
        let content = "---\ntitle: My Document\ntags: [foo]\n---\n# Ignored heading";
        let path = std::path::Path::new("/some/path/file.md");
        let title = extract_title(content, path);
        assert_eq!(title, "My Document");
    }

    #[test]
    fn test_extract_title_from_h1_heading() {
        let content = "# Main Heading\n\nSome body text.";
        let path = std::path::Path::new("/some/path/file.md");
        let title = extract_title(content, path);
        assert_eq!(title, "Main Heading");
    }

    #[test]
    fn test_extract_title_fallback_to_filename() {
        let content = "Just plain text, no heading.";
        let path = std::path::Path::new("/some/path/my-document.md");
        let title = extract_title(content, path);
        assert_eq!(title, "my-document");
    }

    // ── chunk_text ────────────────────────────────────────────────────────────

    #[test]
    fn test_chunk_text_skips_short_content() {
        // Content shorter than 60 chars per chunk should produce no chunks
        let content = "---\ntags: [test]\n---\nShort.";
        let chunks = chunk_text(content);
        assert!(chunks.is_empty(), "Short content should produce no chunks");
    }

    #[test]
    fn test_chunk_text_produces_chunks_for_long_content() {
        let section = "A".repeat(100);
        let content = format!("# Title\n\n{}", section);
        let chunks = chunk_text(&content);
        assert!(!chunks.is_empty(), "Long content should produce at least one chunk");
    }

    #[test]
    fn test_chunk_text_splits_on_h2_headings() {
        let body = format!(
            "## Section One\n{}\n\n## Section Two\n{}",
            "x".repeat(80),
            "y".repeat(80)
        );
        let chunks = chunk_text(&body);
        assert!(
            chunks.len() >= 2,
            "Should produce at least 2 chunks for 2 sections, got {}",
            chunks.len()
        );
    }
}
