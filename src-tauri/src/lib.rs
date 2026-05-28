use std::sync::Mutex;
use std::collections::{HashMap, HashSet};
use notify::Watcher;
use std::path::{Component, Path, PathBuf};
use sysinfo::System;
use tauri::Manager;

// ─── App State ───────────────────────────────────────────────────────────────

struct LlamaState {
    pid: Mutex<Option<u32>>,
}

// Caches the active tab captured BEFORE the spotlight window steals OS focus
#[derive(Default)]
struct TabCache(Mutex<Option<serde_json::Value>>);

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn knowledge_core_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home).join("AgentForge")
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

fn knowledge_root() -> PathBuf {
    normalize_path_lexically(knowledge_core_path())
}

fn knowledge_path_from_input(input: &str) -> Result<PathBuf, String> {
    let root = knowledge_root();
    let raw = PathBuf::from(input);
    let joined = if raw.is_absolute() { raw } else { root.join(raw) };
    let normalized = normalize_path_lexically(joined);
    if !normalized.starts_with(&root) {
        return Err("Path is outside the Knowledge Core".to_string());
    }
    Ok(normalized)
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

fn is_safe_capture_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 120
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        && id != "."
        && id != ".."
}

fn sanitize_file_stem(input: &str, fallback: &str) -> String {
    let mut out = input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else if c.is_whitespace() {
                '-'
            } else {
                '_'
            }
        })
        .collect::<String>();
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    let trimmed = out.trim_matches(&['-', '_', '.'][..]).to_string();
    let safe = if trimmed.is_empty() { fallback.to_string() } else { trimmed };
    safe.chars().take(96).collect()
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        let b2 = if i + 2 < bytes.len() { bytes[i + 2] } else { 0 };
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if i + 1 < bytes.len() {
            out.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < bytes.len() {
            out.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut block = [0u8; 4];
    let mut block_len = 0usize;
    let mut padding = 0usize;

    for ch in input.chars().filter(|c| !c.is_whitespace()) {
        let value = match ch {
            'A'..='Z' => ch as u8 - b'A',
            'a'..='z' => ch as u8 - b'a' + 26,
            '0'..='9' => ch as u8 - b'0' + 52,
            '+' => 62,
            '/' => 63,
            '=' => {
                padding += 1;
                0
            }
            _ => return Err("Attachment data is not valid base64".to_string()),
        };

        block[block_len] = value;
        block_len += 1;
        if block_len == 4 {
            out.push((block[0] << 2) | (block[1] >> 4));
            if padding < 2 {
                out.push((block[1] << 4) | (block[2] >> 2));
            }
            if padding < 1 {
                out.push((block[2] << 6) | block[3]);
            }
            block = [0u8; 4];
            block_len = 0;
            padding = 0;
        }
    }

    if block_len != 0 {
        if block_len == 1 {
            return Err("Attachment base64 data is incomplete".to_string());
        }
        while block_len < 4 {
            block[block_len] = 0;
            block_len += 1;
            padding += 1;
        }
        out.push((block[0] << 2) | (block[1] >> 4));
        if padding < 2 {
            out.push((block[1] << 4) | (block[2] >> 2));
        }
        if padding < 1 {
            out.push((block[2] << 6) | block[3]);
        }
    }

    Ok(out)
}

fn ensure_gitignore_line(root: &Path, line: &str) {
    let path = root.join(".gitignore");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if !existing.lines().any(|l| l.trim() == line.trim()) {
        let mut next = existing;
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str(line);
        next.push('\n');
        let _ = std::fs::write(path, next);
    }
}

fn ensure_inbox_dirs(root: &Path) {
    for subdir in &[
        "inbox",
        "inbox/raw",
        "inbox/raw/primary",
        "inbox/raw/shared",
        "inbox/processed",
        "inbox/tmp",
    ] {
        let _ = std::fs::create_dir_all(root.join(subdir));
    }
    ensure_gitignore_line(root, "inbox/raw/");
    ensure_gitignore_line(root, "inbox/tmp/");
}

fn run_git(args: &[&str], cwd: &std::path::Path) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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

#[tauri::command]
fn get_ram_stats() -> serde_json::Value {
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total_mb = sys.total_memory() / 1024 / 1024;
    let used_mb = sys.used_memory() / 1024 / 1024;
    // available_memory() returns 0 on macOS in sysinfo v0.30; derive it instead
    let available_mb = total_mb.saturating_sub(used_mb);
    serde_json::json!({
        "total_mb": total_mb,
        "used_mb": used_mb,
        "available_mb": available_mb
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
    *state.pid.lock().unwrap() = Some(pid);
    Ok(serde_json::json!({ "pid": pid }))
}

#[tauri::command]
fn sigstop_llama_server(state: tauri::State<LlamaState>) -> serde_json::Value {
    let pid = *state.pid.lock().unwrap();
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
    let pid = *state.pid.lock().unwrap();
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

#[tauri::command]
fn safe_write_file(path: String, content: String) -> serde_json::Value {
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
    for subdir in &["memory/goals", "memory/decisions", "memory/metrics", "memory/research", "memory/memos", "memory/channels", "library"] {
        let _ = std::fs::create_dir_all(root.join(subdir));
    }
    ensure_inbox_dirs(&root);

    if root.join(".git").exists() {
        return serde_json::json!({ "initialized": false, "path": root.to_string_lossy() });
    }

    let _ = std::fs::write(
        root.join(".gitignore"),
        ".DS_Store\n*.tmp\n.obsidian/workspace\n.obsidian/workspace.json\n.index.db\n.lancedb/\n.models/\nworkspace/.dream_logs/\ninbox/raw/\ninbox/tmp/\n",
    );

    let _ = std::fs::write(
        root.join("index.md"),
        "---\ntags: [index, agent-forge]\n---\n# Agent Forge — Knowledge Index\n\n\
## Goals\n- [[memory/goals/goals]]\n\n\
## Decisions\n- [[memory/decisions/decisions]]\n\n\
## Metrics\n- [[memory/metrics/metrics]]\n\n\
## Research\n- [[memory/research/research]]\n",
    );

    let _ = run_git(&["init"], &root);
    let _ = run_git(&["config", "user.email", "agent-forge@local"], &root);
    let _ = run_git(&["config", "user.name", "Agent Forge"], &root);
    let _ = run_git(&["add", "-A"], &root);
    let _ = run_git(&["commit", "-m", "init: Knowledge Core initialized"], &root);

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

    let write_result = safe_write_file(file_path.to_string_lossy().to_string(), content.clone());
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

    if let Ok(conn) = open_index_db() {
        let _ = queue_file_for_index(&conn, &file_path.to_string_lossy());
        let _ = index_semantic_file(&conn, &file_path);
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
        for line in content.lines() {
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

#[tauri::command]
fn search_knowledge(query: String, extra_path: Option<String>, agent_id: Option<String>, channel_id: Option<String>, max_results: Option<usize>, snippet_chars: Option<usize>) -> serde_json::Value {
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
    if let Some(ref cid) = channel_id {
        if !is_safe_agent_id(cid) {
            return serde_json::json!({ "results": [], "error": "Invalid channel id" });
        }
        dirs_to_search.push(root.join("memory").join("channels").join(cid));
    }
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

            let score: usize = keywords.iter()
                .map(|kw| body_lower.matches(*kw).count())
                .sum();

            if score == 0 { continue; }

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

    results.sort_by(|a, b| b["score"].as_u64().cmp(&a["score"].as_u64()));
    results.truncate(max_results);

    serde_json::json!({ "results": results })
}

// ─── 2.1 Memmo Engine ────────────────────────────────────────────────────────

#[tauri::command]
fn append_task(text: String, agent_id: Option<String>) -> serde_json::Value {
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

    if let Ok(conn) = open_index_db() {
        let p = tasks_path.to_string_lossy().to_string();
        let _ = queue_file_for_index(&conn, &p);
        let _ = index_semantic_file(&conn, &tasks_path);
    }

    serde_json::json!({ "commit": commit_hash })
}

#[tauri::command]
fn complete_task(
    title: String,
    details: String,
    due_date: String,
    completed_at: String,
) -> serde_json::Value {
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

    if let Ok(conn) = open_index_db() {
        let p = path.to_string_lossy().to_string();
        let _ = queue_file_for_index(&conn, &p);
        let _ = index_semantic_file(&conn, &path);
    }

    serde_json::json!({ "ok": true })
}

#[tauri::command]
fn revert_memory_commit(commit_hash: String) -> serde_json::Value {
    let repo_root = knowledge_root();
    let result = run_git(&["revert", "--no-edit", &commit_hash], &repo_root);
    serde_json::json!({ "ok": result.is_ok(), "output": result.unwrap_or_default() })
}

// ─── 4.0 File Watcher + Index Queue ──────────────────────────────────────────

use std::sync::atomic::{AtomicBool, Ordering};

static WATCHER_RUNNING: AtomicBool = AtomicBool::new(false);

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
            last_modified INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bv_file ON brain_vectors(file_path);
        CREATE TABLE IF NOT EXISTS semantic_documents (
            file_path      TEXT PRIMARY KEY,
            title          TEXT NOT NULL,
            scope          TEXT NOT NULL,
            memory_type    TEXT NOT NULL,
            agent_id       TEXT,
            channel_id     TEXT,
            source_kind    TEXT,
            evidence_state TEXT,
            verification   TEXT,
            confidence     TEXT,
            tags           TEXT,
            source_urls    TEXT,
            source_paths   TEXT,
            raw_path       TEXT,
            created        TEXT,
            last_modified  INTEGER NOT NULL,
            indexed_at     INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS semantic_entities (
            entity_key     TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            normalized     TEXT NOT NULL,
            kind           TEXT NOT NULL,
            file_path      TEXT NOT NULL,
            title          TEXT NOT NULL,
            scope          TEXT NOT NULL,
            evidence_state TEXT,
            confidence     TEXT,
            last_modified  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS semantic_facts (
            fact_key       TEXT PRIMARY KEY,
            fact           TEXT NOT NULL,
            subject        TEXT,
            predicate      TEXT,
            object         TEXT,
            file_path      TEXT NOT NULL,
            title          TEXT NOT NULL,
            scope          TEXT NOT NULL,
            agent_id       TEXT,
            channel_id     TEXT,
            source_kind    TEXT,
            evidence_state TEXT,
            verification   TEXT,
            confidence     TEXT,
            source_urls    TEXT,
            raw_path       TEXT,
            last_modified  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS semantic_relations (
            relation_key   TEXT PRIMARY KEY,
            source         TEXT NOT NULL,
            relation       TEXT NOT NULL,
            target         TEXT NOT NULL,
            file_path      TEXT NOT NULL,
            title          TEXT NOT NULL,
            scope          TEXT NOT NULL,
            evidence_state TEXT,
            confidence     TEXT,
            last_modified  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sem_doc_scope ON semantic_documents(scope, agent_id, channel_id);
        CREATE INDEX IF NOT EXISTS idx_sem_entity_norm ON semantic_entities(normalized);
        CREATE INDEX IF NOT EXISTS idx_sem_fact_path ON semantic_facts(file_path);
        CREATE INDEX IF NOT EXISTS idx_sem_relation_path ON semantic_relations(file_path);",
    ).map_err(|e| e.to_string())?;
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

#[derive(Clone)]
struct SemanticEntity {
    name: String,
    kind: String,
}

#[derive(Clone)]
struct SemanticFact {
    fact: String,
    subject: String,
    predicate: String,
    object: String,
}

fn now_secs_i64() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn split_frontmatter(content: &str) -> (HashMap<String, String>, String) {
    if !content.starts_with("---") {
        return (HashMap::new(), content.to_string());
    }
    let rest = &content[3..];
    let Some(end) = rest.find("\n---") else {
        return (HashMap::new(), content.to_string());
    };
    let frontmatter = &rest[..end];
    let body = rest[end + 4..].trim_start().to_string();
    let mut map = HashMap::new();
    for line in frontmatter.lines() {
        let Some((key, value)) = line.split_once(':') else { continue };
        let clean_value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        map.insert(key.trim().to_lowercase(), clean_value);
    }
    (map, body)
}

fn metadata_value(meta: &HashMap<String, String>, key: &str, fallback: &str) -> String {
    meta.get(&key.to_lowercase())
        .map(|v| v.trim().trim_matches('"').to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn parse_arrayish(value: &str) -> Vec<String> {
    let trimmed = value.trim().trim_matches('[').trim_matches(']');
    trimmed
        .split(',')
        .map(|v| v.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|v| !v.is_empty())
        .collect()
}

fn normalize_semantic_name(input: &str) -> String {
    input
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn clean_semantic_value(input: &str) -> String {
    input
        .trim()
        .trim_start_matches("- ")
        .trim_start_matches("* ")
        .trim_start_matches(char::is_numeric)
        .trim_start_matches('.')
        .trim()
        .trim_matches('"')
        .trim_matches('`')
        .to_string()
}

fn push_entity(entities: &mut Vec<SemanticEntity>, seen: &mut HashSet<String>, name: &str, kind: &str) {
    let clean = clean_semantic_value(name);
    if clean.len() < 2 || clean.len() > 120 { return; }
    let normalized = normalize_semantic_name(&clean);
    if normalized.is_empty() { return; }
    let key = format!("{}:{}", kind.to_lowercase(), normalized);
    if seen.insert(key) {
        entities.push(SemanticEntity { name: clean, kind: kind.to_lowercase() });
    }
}

fn split_entity_values(value: &str) -> Vec<String> {
    value
        .split(&[',', ';'][..])
        .flat_map(|part| part.split(" and "))
        .map(clean_semantic_value)
        .filter(|v| v.len() >= 2 && v.len() <= 120)
        .take(8)
        .collect()
}

fn is_semantic_label(label: &str) -> Option<&'static str> {
    match label.trim().to_lowercase().as_str() {
        "person" | "people" | "owner" => Some("person"),
        "project" | "app" | "product" => Some("project"),
        "deck" | "build" | "strategy" => Some("strategy"),
        "document" | "file" | "source" => Some("document"),
        "trip" | "place" | "location" => Some("place"),
        "organization" | "org" | "company" => Some("organization"),
        "game" => Some("game"),
        "agent" | "assistant" => Some("agent"),
        "channel" => Some("channel"),
        "tool" | "provider" | "model" => Some("tool"),
        "topic" | "entity" => Some("topic"),
        "preference" | "prefers" => Some("preference"),
        "decision" | "goal" | "task" | "problem" | "outcome" | "failure" | "success" => Some("fact"),
        _ => None,
    }
}

fn is_capitalish_word(word: &str) -> bool {
    let clean = word.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-');
    if clean.len() < 2 { return false; }
    let upper_count = clean.chars().filter(|c| c.is_ascii_uppercase()).count();
    clean.chars().next().map(|c| c.is_ascii_uppercase()).unwrap_or(false) || upper_count >= 2
}

fn extract_capitalized_entities(text: &str) -> Vec<String> {
    let stop = HashSet::from([
        "The", "This", "That", "These", "Those", "When", "Where", "What", "Why", "How",
        "Agent", "Forge", "Grounding", "Summary", "Question", "Answer", "Sources",
    ]);
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for line in text.lines().take(240) {
        let words: Vec<&str> = line.split_whitespace().collect();
        let mut i = 0usize;
        while i < words.len() {
            if !is_capitalish_word(words[i]) {
                i += 1;
                continue;
            }
            let mut phrase = Vec::new();
            let mut j = i;
            while j < words.len() && phrase.len() < 5 {
                let w = words[j].trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-');
                let connector = matches!(w, "of" | "the" | "and" | "for" | "in");
                if is_capitalish_word(w) || (connector && !phrase.is_empty()) {
                    phrase.push(w);
                    j += 1;
                } else {
                    break;
                }
            }
            if phrase.len() >= 2 {
                let candidate = phrase.join(" ");
                let first = phrase.first().copied().unwrap_or("");
                let normalized = normalize_semantic_name(&candidate);
                if !stop.contains(first) && normalized.len() > 3 && seen.insert(normalized) {
                    out.push(candidate);
                    if out.len() >= 30 { return out; }
                }
            }
            i = j.max(i + 1);
        }
    }
    out
}

fn extract_semantic_entities(title: &str, body: &str, meta: &HashMap<String, String>) -> Vec<SemanticEntity> {
    let mut entities = Vec::new();
    let mut seen = HashSet::new();
    push_entity(&mut entities, &mut seen, title, "topic");

    for tag in parse_arrayish(meta.get("tags").map(String::as_str).unwrap_or("")) {
        push_entity(&mut entities, &mut seen, &tag, "tag");
    }

    for line in body.lines() {
        let clean = clean_semantic_value(line);
        let Some((label, value)) = clean.split_once(':') else { continue };
        if let Some(kind) = is_semantic_label(label) {
            for item in split_entity_values(value) {
                push_entity(&mut entities, &mut seen, &item, kind);
            }
        }
        if entities.len() >= 80 { break; }
    }

    for phrase in extract_capitalized_entities(body) {
        push_entity(&mut entities, &mut seen, &phrase, "mention");
        if entities.len() >= 100 { break; }
    }

    entities
}

fn is_fact_heading(heading: &str) -> bool {
    let h = heading.to_lowercase();
    ["fact", "decision", "preference", "failure", "outcome", "problem", "learned", "tried", "task", "summary", "note"]
        .iter()
        .any(|needle| h.contains(needle))
}

fn should_keep_fact_line(heading: &str, line: &str) -> bool {
    let lower = line.to_lowercase();
    is_fact_heading(heading)
        || [" tried ", " failed ", " because ", " prefers ", " decided ", " wants ", " needs ", " learned ", " works ", " does not "]
            .iter()
            .any(|needle| lower.contains(needle))
}

fn relation_from_fact(title: &str, fact: &str) -> Option<(String, String, String)> {
    let clean = clean_semantic_value(fact);
    if let Some(parts) = clean.split_once("->") {
        let subject = clean_semantic_value(parts.0);
        let rest = clean_semantic_value(parts.1);
        if let Some((predicate, object)) = rest.split_once("->") {
            return Some((subject, normalize_semantic_name(predicate).replace(' ', "_"), clean_semantic_value(object)));
        }
    }
    if let Some((label, value)) = clean.split_once(':') {
        if let Some(kind) = is_semantic_label(label) {
            return Some((title.to_string(), kind.to_string(), clean_semantic_value(value)));
        }
    }
    let lower = clean.to_lowercase();
    for (needle, relation) in [
        (" failed because ", "failed_because"),
        (" because ", "because"),
        (" prefers ", "prefers"),
        (" decided ", "decided"),
        (" wants ", "wants"),
        (" needs ", "needs"),
        (" tried ", "tried"),
    ] {
        if let Some(idx) = lower.find(needle) {
            let subject = clean_semantic_value(&clean[..idx]);
            let object = clean_semantic_value(&clean[idx + needle.len()..]);
            if !subject.is_empty() && !object.is_empty() {
                return Some((subject, relation.to_string(), object));
            }
        }
    }
    None
}

fn extract_semantic_facts(title: &str, body: &str) -> Vec<SemanticFact> {
    let mut facts = Vec::new();
    let mut seen = HashSet::new();
    let mut heading = String::new();

    for raw_line in body.lines() {
        let line = raw_line.trim();
        if let Some(h) = line.strip_prefix("## ") {
            heading = h.trim().to_string();
            continue;
        }
        if heading.eq_ignore_ascii_case("Grounding") || heading.eq_ignore_ascii_case("Learning Status") {
            continue;
        }
        let clean = clean_semantic_value(line);
        if clean.len() < 8 || clean.len() > 500 { continue; }
        let is_bullet = line.starts_with("- ") || line.starts_with("* ");
        let labelled = clean.split_once(':').and_then(|(label, _)| is_semantic_label(label)).is_some();
        if !is_bullet && !labelled && !should_keep_fact_line(&heading, &clean) { continue; }
        if !seen.insert(clean.to_lowercase()) { continue; }

        let (subject, predicate, object) = relation_from_fact(title, &clean)
            .unwrap_or_else(|| (title.to_string(), "mentions".to_string(), clean.clone()));
        facts.push(SemanticFact { fact: clean, subject, predicate, object });
        if facts.len() >= 60 { break; }
    }

    facts
}

fn infer_semantic_scope(path: &Path, meta: &HashMap<String, String>) -> (String, Option<String>, Option<String>) {
    let root = knowledge_root();
    let rel = path.strip_prefix(&root).unwrap_or(path);
    let parts: Vec<String> = rel.components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    let mut scope = metadata_value(meta, "scope", "");
    let mut agent_id = meta.get("agent_id").cloned();
    let mut channel_id = meta.get("channel_id").cloned();

    if parts.first().map(String::as_str) == Some("library") {
        scope = if scope.is_empty() { "library".to_string() } else { scope };
    } else if parts.first().map(String::as_str) == Some("memory") {
        if parts.get(1).map(String::as_str) == Some("channels") {
            scope = if scope.is_empty() { "channel".to_string() } else { scope };
            if channel_id.as_deref().unwrap_or("").is_empty() {
                channel_id = parts.get(2).cloned();
            }
        } else if let Some(second) = parts.get(1) {
            let reserved = ["goals", "decisions", "metrics", "research", "memos", "tasks.md", "completed_tasks.md", "agent-forge-guide.md"];
            if !reserved.contains(&second.as_str()) && !second.starts_with('.') {
                scope = if scope.is_empty() { "agent".to_string() } else { scope };
                if agent_id.as_deref().unwrap_or("").is_empty() {
                    agent_id = Some(second.clone());
                }
            } else {
                scope = if scope.is_empty() { "global".to_string() } else { scope };
            }
        }
    }

    if scope.is_empty() { scope = "global".to_string(); }
    (scope, agent_id.filter(|v| !v.is_empty()), channel_id.filter(|v| !v.is_empty()))
}

fn delete_semantic_for_file(conn: &rusqlite::Connection, file_path: &str) {
    let _ = conn.execute("DELETE FROM semantic_documents WHERE file_path = ?1", rusqlite::params![file_path]);
    let _ = conn.execute("DELETE FROM semantic_entities WHERE file_path = ?1", rusqlite::params![file_path]);
    let _ = conn.execute("DELETE FROM semantic_facts WHERE file_path = ?1", rusqlite::params![file_path]);
    let _ = conn.execute("DELETE FROM semantic_relations WHERE file_path = ?1", rusqlite::params![file_path]);
}

fn index_semantic_file(conn: &rusqlite::Connection, path: &Path) -> Result<u32, String> {
    if path.components().any(|c| c.as_os_str() == ".archive") { return Ok(0); }
    if !matches!(path.extension().and_then(|e| e.to_str()), Some("md") | Some("txt")) { return Ok(0); }
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().to_string();
    let (meta, body) = split_frontmatter(&content);
    let title = metadata_value(&meta, "title", &extract_title(&content, path));
    let memory_type = metadata_value(&meta, "type", "note");
    let source_kind = metadata_value(&meta, "source_kind", "");
    let evidence_state = metadata_value(&meta, "evidence_state", "unverified");
    let verification = metadata_value(&meta, "verification", "needs_verification");
    let confidence = metadata_value(&meta, "confidence", "unknown");
    let tags = meta.get("tags").cloned().unwrap_or_default();
    let source_urls = meta.get("source_urls").cloned().unwrap_or_default();
    let source_paths = meta.get("source_paths").cloned().unwrap_or_default();
    let raw_path = metadata_value(&meta, "raw_path", "");
    let created = metadata_value(&meta, "created", "");
    let (scope, agent_id, channel_id) = infer_semantic_scope(path, &meta);
    let mtime = std::fs::metadata(path).ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let indexed_at = now_secs_i64();

    delete_semantic_for_file(conn, &path_str);
    conn.execute(
        "INSERT OR REPLACE INTO semantic_documents
         (file_path,title,scope,memory_type,agent_id,channel_id,source_kind,evidence_state,verification,confidence,tags,source_urls,source_paths,raw_path,created,last_modified,indexed_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
        rusqlite::params![
            &path_str, &title, &scope, &memory_type, agent_id.as_deref(), channel_id.as_deref(),
            &source_kind, &evidence_state, &verification, &confidence, &tags, &source_urls, &source_paths,
            &raw_path, &created, mtime, indexed_at
        ],
    ).map_err(|e| e.to_string())?;

    let entities = extract_semantic_entities(&title, &body, &meta);
    for entity in &entities {
        let normalized = normalize_semantic_name(&entity.name);
        if normalized.is_empty() { continue; }
        let entity_key = format!("{}::entity::{}::{}", path_str, entity.kind, normalized);
        let _ = conn.execute(
            "INSERT OR REPLACE INTO semantic_entities
             (entity_key,name,normalized,kind,file_path,title,scope,evidence_state,confidence,last_modified)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![entity_key, entity.name, normalized, entity.kind, &path_str, &title, &scope, &evidence_state, &confidence, mtime],
        );
    }

    let facts = extract_semantic_facts(&title, &body);
    for (i, fact) in facts.iter().enumerate() {
        let fact_key = format!("{}::fact::{}", path_str, i);
        let _ = conn.execute(
            "INSERT OR REPLACE INTO semantic_facts
             (fact_key,fact,subject,predicate,object,file_path,title,scope,agent_id,channel_id,source_kind,evidence_state,verification,confidence,source_urls,raw_path,last_modified)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            rusqlite::params![
                fact_key, fact.fact, fact.subject, fact.predicate, fact.object, &path_str, &title, &scope,
                agent_id.as_deref(), channel_id.as_deref(), &source_kind, &evidence_state, &verification,
                &confidence, &source_urls, &raw_path, mtime
            ],
        );
        if fact.predicate != "mentions" && !fact.subject.is_empty() && !fact.object.is_empty() {
            let relation_key = format!("{}::rel::{}", path_str, i);
            let _ = conn.execute(
                "INSERT OR REPLACE INTO semantic_relations
                 (relation_key,source,relation,target,file_path,title,scope,evidence_state,confidence,last_modified)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                rusqlite::params![relation_key, fact.subject, fact.predicate, fact.object, &path_str, &title, &scope, &evidence_state, &confidence, mtime],
            );
        }
    }

    Ok((entities.len() + facts.len()) as u32)
}

fn score_semantic_text(query: &str, terms: &[String], fields: &[&str]) -> i64 {
    let haystack = fields.join(" ").to_lowercase();
    let mut score = 0i64;
    let q = query.to_lowercase();
    if !q.is_empty() && haystack.contains(&q) { score += 12; }
    for term in terms {
        if term.len() < 3 { continue; }
        score += haystack.matches(term).count() as i64 * 3;
    }
    score
}

fn path_allowed(path: &str, agent_id: &Option<String>, channel_id: &Option<String>) -> bool {
    let root = knowledge_root();
    let library_prefix = root.join("library").to_string_lossy().to_string();
    if path.starts_with(&library_prefix) { return true; }
    if let Some(aid) = agent_id {
        let prefix = root.join("memory").join(aid).to_string_lossy().to_string();
        if path.starts_with(&prefix) { return true; }
    } else {
        let prefix = root.join("memory").to_string_lossy().to_string();
        if path.starts_with(&prefix) { return true; }
    }
    if let Some(cid) = channel_id {
        let prefix = root.join("memory").join("channels").join(cid).to_string_lossy().to_string();
        if path.starts_with(&prefix) { return true; }
    }
    false
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

                let _ = conn.execute("DELETE FROM brain_vectors WHERE file_path = ?1", rusqlite::params![&file_path]);

                let chunks = chunk_text(&content);
                if chunks.is_empty() {
                    let _ = conn.execute("UPDATE pending_index SET status='indexed' WHERE file_path=?1", rusqlite::params![&file_path]);
                    continue;
                }

                let texts: Vec<&str> = chunks.iter().map(|s| s.as_str()).collect();
                let embeddings = {
                    let guard = embedder.lock().unwrap();
                    match guard.embed(texts, None) { Ok(e) => e, Err(e) => { eprintln!("[embedder] embed error: {e}"); continue; } }
                };

                for (i, (chunk, vector)) in chunks.iter().zip(embeddings.iter()).enumerate() {
                    let chunk_id = format!("{file_path}#{i}");
                    let blob: Vec<u8> = vector.iter().flat_map(|f| f.to_le_bytes()).collect();
                    let _ = conn.execute(
                        "INSERT OR REPLACE INTO brain_vectors (chunk_id, file_path, chunk_index, content, vector, last_modified) VALUES (?1,?2,?3,?4,?5,?6)",
                        rusqlite::params![chunk_id, &file_path, i as i64, chunk, blob, mtime],
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
                let _ = index_semantic_file(&conn, &path);
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
                    delete_semantic_for_file(&conn, &ps);
                }
                // git rm + commit; fall back to fs::remove_file
                if let Ok(rel) = path.strip_prefix(&purge_root) {
                    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let git_ok = run_git(&["rm", "--force", &rel.to_string_lossy()], &purge_root)
                        .and_then(|_| run_git(&["commit", "-m", &format!("purge: 7-day expiry {name}")], &purge_root))
                        .is_ok();
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
    let mut semantic_indexed = 0u32;
    if let Ok(files) = walk_md_files(&root) {
        for file in files {
            if index_semantic_file(&conn, &file).is_ok() {
                semantic_indexed += 1;
            }
        }
    }
    serde_json::json!({ "ok": true, "queued": queued, "semantic_indexed": semantic_indexed })
}

#[tauri::command]
fn sync_semantic_layer() -> serde_json::Value {
    let root = knowledge_root();
    let conn = match open_index_db() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let files = match walk_md_files(&root) {
        Ok(files) => files,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let mut indexed = 0u32;
    let mut errors = 0u32;
    for file in files {
        match index_semantic_file(&conn, &file) {
            Ok(_) => indexed += 1,
            Err(_) => errors += 1,
        }
    }
    serde_json::json!({ "ok": true, "indexed": indexed, "errors": errors })
}

#[tauri::command]
fn get_semantic_layer_status() -> serde_json::Value {
    let conn = match open_index_db() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "error": e }),
    };
    let documents: i64 = conn.query_row("SELECT COUNT(*) FROM semantic_documents", [], |r| r.get(0)).unwrap_or(0);
    let entities: i64 = conn.query_row("SELECT COUNT(*) FROM semantic_entities", [], |r| r.get(0)).unwrap_or(0);
    let facts: i64 = conn.query_row("SELECT COUNT(*) FROM semantic_facts", [], |r| r.get(0)).unwrap_or(0);
    let relations: i64 = conn.query_row("SELECT COUNT(*) FROM semantic_relations", [], |r| r.get(0)).unwrap_or(0);
    serde_json::json!({ "documents": documents, "entities": entities, "facts": facts, "relations": relations })
}

#[tauri::command]
fn search_semantic_layer(query: String, agent_id: Option<String>, channel_id: Option<String>, max_results: Option<usize>) -> serde_json::Value {
    let max_results = max_results.unwrap_or(8).clamp(1, 20);
    if let Some(ref id) = agent_id {
        if !is_safe_agent_id(id) {
            return serde_json::json!({ "documents": [], "entities": [], "facts": [], "relations": [], "error": "Invalid agent id" });
        }
    }
    if let Some(ref id) = channel_id {
        if !is_safe_agent_id(id) {
            return serde_json::json!({ "documents": [], "entities": [], "facts": [], "relations": [], "error": "Invalid channel id" });
        }
    }
    let conn = match open_index_db() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "documents": [], "entities": [], "facts": [], "relations": [], "error": e }),
    };
    let terms: Vec<String> = query.to_lowercase().split_whitespace().map(|s| s.to_string()).collect();

    let mut documents: Vec<(i64, serde_json::Value)> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT file_path,title,scope,memory_type,agent_id,channel_id,source_kind,evidence_state,verification,confidence,tags,source_urls,raw_path FROM semantic_documents") {
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                row.get::<_, Option<String>>(12)?.unwrap_or_default(),
            ))
        });
        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (path, title, scope, memory_type, aid, cid, source_kind, evidence, verification, confidence, tags, urls, raw_path) = row;
                if !path_allowed(&path, &agent_id, &channel_id) { continue; }
                let score = score_semantic_text(&query, &terms, &[&title, &scope, &memory_type, &aid, &cid, &source_kind, &tags]);
                if score > 0 {
                    documents.push((score, serde_json::json!({
                        "path": path, "title": title, "scope": scope, "type": memory_type,
                        "agentId": aid, "channelId": cid, "sourceKind": source_kind,
                        "evidenceState": evidence, "verification": verification, "confidence": confidence,
                        "tags": tags, "sourceUrls": urls, "rawPath": raw_path, "score": score
                    })));
                }
            }
        }
    }

    let mut entities: Vec<(i64, serde_json::Value)> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT name,normalized,kind,file_path,title,scope,evidence_state,confidence FROM semantic_entities") {
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            ))
        });
        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (name, normalized, kind, path, title, scope, evidence, confidence) = row;
                if !path_allowed(&path, &agent_id, &channel_id) { continue; }
                let score = score_semantic_text(&query, &terms, &[&name, &normalized, &kind, &title]);
                if score > 0 {
                    entities.push((score, serde_json::json!({
                        "name": name, "kind": kind, "path": path, "title": title, "scope": scope,
                        "evidenceState": evidence, "confidence": confidence, "score": score
                    })));
                }
            }
        }
    }

    let mut facts: Vec<(i64, serde_json::Value)> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT fact,subject,predicate,object,file_path,title,scope,agent_id,channel_id,source_kind,evidence_state,verification,confidence,source_urls,raw_path FROM semantic_facts") {
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                row.get::<_, Option<String>>(14)?.unwrap_or_default(),
            ))
        });
        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (fact, subject, predicate, object, path, title, scope, aid, cid, source_kind, evidence, verification, confidence, source_urls, raw_path) = row;
                if !path_allowed(&path, &agent_id, &channel_id) { continue; }
                let score = score_semantic_text(&query, &terms, &[&fact, &subject, &predicate, &object, &title, &source_kind]);
                if score > 0 {
                    facts.push((score, serde_json::json!({
                        "fact": fact, "subject": subject, "predicate": predicate, "object": object,
                        "path": path, "title": title, "scope": scope, "agentId": aid, "channelId": cid,
                        "sourceKind": source_kind, "evidenceState": evidence, "verification": verification,
                        "confidence": confidence, "sourceUrls": source_urls, "rawPath": raw_path, "score": score
                    })));
                }
            }
        }
    }

    let mut relations: Vec<(i64, serde_json::Value)> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT source,relation,target,file_path,title,scope,evidence_state,confidence FROM semantic_relations") {
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            ))
        });
        if let Ok(rows) = rows {
            for row in rows.flatten() {
                let (source, relation, target, path, title, scope, evidence, confidence) = row;
                if !path_allowed(&path, &agent_id, &channel_id) { continue; }
                let score = score_semantic_text(&query, &terms, &[&source, &relation, &target, &title]);
                if score > 0 {
                    relations.push((score, serde_json::json!({
                        "source": source, "relation": relation, "target": target,
                        "path": path, "title": title, "scope": scope,
                        "evidenceState": evidence, "confidence": confidence, "score": score
                    })));
                }
            }
        }
    }

    documents.sort_by(|a, b| b.0.cmp(&a.0));
    entities.sort_by(|a, b| b.0.cmp(&a.0));
    facts.sort_by(|a, b| b.0.cmp(&a.0));
    relations.sort_by(|a, b| b.0.cmp(&a.0));

    serde_json::json!({
        "documents": documents.into_iter().take(max_results).map(|(_, v)| v).collect::<Vec<_>>(),
        "entities": entities.into_iter().take(max_results).map(|(_, v)| v).collect::<Vec<_>>(),
        "facts": facts.into_iter().take(max_results).map(|(_, v)| v).collect::<Vec<_>>(),
        "relations": relations.into_iter().take(max_results).map(|(_, v)| v).collect::<Vec<_>>()
    })
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

#[tauri::command]
fn search_knowledge_semantic(query: String, agent_id: Option<String>, channel_id: Option<String>, max_results: Option<usize>, snippet_chars: Option<usize>) -> serde_json::Value {
    let max_results = max_results.unwrap_or(5);
    let snippet_chars = snippet_chars.unwrap_or(400);
    if let Some(ref id) = agent_id {
        if !is_safe_agent_id(id) {
            return serde_json::json!({ "results": [], "error": "Invalid agent id" });
        }
    }
    if let Some(ref id) = channel_id {
        if !is_safe_agent_id(id) {
            return serde_json::json!({ "results": [], "error": "Invalid channel id" });
        }
    }

    // Fall back to keyword search if model not loaded yet
    let embedder = match get_or_init_embedder() {
        Ok(e) => e,
        Err(_) => return search_knowledge(query, None, agent_id, channel_id, Some(max_results), Some(snippet_chars)),
    };

    let query_vec: Vec<f32> = {
        let guard = embedder.lock().unwrap();
        match guard.embed(vec![query.as_str()], None) {
            Ok(mut e) if !e.is_empty() => e.remove(0),
            _ => return search_knowledge(query, None, agent_id, channel_id, Some(max_results), Some(snippet_chars)),
        }
    };

    let conn = match open_index_db() {
        Ok(c) => c,
        Err(_) => return search_knowledge(query, None, agent_id, channel_id, Some(max_results), Some(snippet_chars)),
    };

    let root = knowledge_root();
    let memory_prefix = agent_id.as_ref()
        .map(|id| root.join("memory").join(id).to_string_lossy().to_string())
        .unwrap_or_else(|| root.join("memory").to_string_lossy().to_string());
    let library_prefix = root.join("library").to_string_lossy().to_string();
    let channel_prefix = channel_id.as_ref()
        .map(|id| root.join("memory").join("channels").join(id).to_string_lossy().to_string())
        .unwrap_or_else(|| "__no_channel_memory__".to_string());

    let rows: Vec<(String, String, Vec<u8>)> = {
        let mut stmt = match conn.prepare(
            "SELECT file_path, content, vector FROM brain_vectors WHERE file_path LIKE ?1 OR file_path LIKE ?2 OR file_path LIKE ?3"
        ) { Ok(s) => s, Err(_) => return search_knowledge(query, None, agent_id, channel_id, Some(max_results), Some(snippet_chars)) };

        stmt.query_map(
            rusqlite::params![format!("{memory_prefix}%"), format!("{library_prefix}%"), format!("{channel_prefix}%")],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map(|it| it.flatten().collect()).unwrap_or_default()
    };

    if rows.is_empty() {
        return search_knowledge(query, None, agent_id, channel_id, Some(max_results), Some(snippet_chars));
    }

    let mut scored: Vec<(f32, String, String)> = rows.into_iter()
        .filter_map(|(path, content, blob)| {
            let vec: Vec<f32> = blob.chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();
            let score = cosine_similarity(&query_vec, &vec);
            if score > 0.25 { Some((score, path, content)) } else { None }
        })
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // Deduplicate: keep highest-scoring chunk per file
    let mut seen_files = std::collections::HashSet::new();
    scored.retain(|(_, path, _)| seen_files.insert(path.clone()));
    scored.truncate(max_results);

    let results: Vec<serde_json::Value> = scored.into_iter().map(|(score, path, content)| {
        let snippet: String = content.chars().take(snippet_chars).collect();
        let title = extract_title_from_path(&path);
        serde_json::json!({ "path": path, "title": title, "snippet": snippet, "score": score })
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
        delete_semantic_for_file(&conn, &file_path_str);
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
        delete_semantic_for_file(&conn, &file_path_str);
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
        let _ = index_semantic_file(&conn, &dest);
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
fn list_channel_memory_files(channel_id: String) -> serde_json::Value {
    if !is_safe_agent_id(&channel_id) {
        return serde_json::json!({ "files": [], "error": "Invalid channel id" });
    }
    let dir = knowledge_root().join("memory").join("channels").join(channel_id);
    let mut files = Vec::new();
    collect_knowledge_files(&dir, &mut files, true);
    files.sort_by(|a, b| {
        b["name"].as_str().unwrap_or("")
            .cmp(a["name"].as_str().unwrap_or(""))
    });
    serde_json::json!({ "files": files })
}

fn inbox_capture_dir(owner_id: &str, capture_id: &str) -> Result<PathBuf, String> {
    if !is_safe_agent_id(owner_id) {
        return Err("Invalid inbox owner id".to_string());
    }
    if !is_safe_capture_id(capture_id) {
        return Err("Invalid capture id".to_string());
    }
    Ok(knowledge_root().join("inbox").join("raw").join(owner_id).join(capture_id))
}

fn read_inbox_manifest(dir: &Path) -> Option<serde_json::Value> {
    let content = std::fs::read_to_string(dir.join("manifest.json")).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_inbox_manifest(dir: &Path, manifest: &serde_json::Value) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("manifest.json"), content).map_err(|e| e.to_string())
}

fn collect_inbox_owner_dirs(owner_id: Option<String>) -> Vec<(String, PathBuf)> {
    let root = knowledge_root().join("inbox").join("raw");
    if let Some(owner) = owner_id {
        if owner != "all" && is_safe_agent_id(&owner) {
            return vec![(owner.clone(), root.join(owner))];
        }
    }
    let Ok(entries) = std::fs::read_dir(root) else { return Vec::new(); };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() { return None; }
            let owner = entry.file_name().to_string_lossy().to_string();
            if is_safe_agent_id(&owner) { Some((owner, path)) } else { None }
        })
        .collect()
}

#[tauri::command]
fn list_inbox_captures(owner_id: Option<String>) -> serde_json::Value {
    let root = knowledge_root();
    ensure_inbox_dirs(&root);

    let mut captures = Vec::new();
    for (_owner, owner_dir) in collect_inbox_owner_dirs(owner_id) {
        let Ok(entries) = std::fs::read_dir(owner_dir) else { continue; };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() { continue; }
            if let Some(manifest) = read_inbox_manifest(&path) {
                captures.push(manifest);
            }
        }
    }

    captures.sort_by(|a, b| {
        b["createdAt"].as_u64().unwrap_or(0)
            .cmp(&a["createdAt"].as_u64().unwrap_or(0))
    });

    serde_json::json!({ "captures": captures })
}

#[tauri::command]
fn read_inbox_capture(owner_id: String, capture_id: String) -> serde_json::Value {
    let dir = match inbox_capture_dir(&owner_id, &capture_id) {
        Ok(d) => d,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    match read_inbox_manifest(&dir) {
        Some(capture) => serde_json::json!({ "ok": true, "capture": capture }),
        None => serde_json::json!({ "ok": false, "error": "Capture not found" }),
    }
}

#[tauri::command]
fn create_inbox_capture(payload: serde_json::Value) -> serde_json::Value {
    let root = knowledge_root();
    ensure_inbox_dirs(&root);

    let raw_owner = payload["ownerId"].as_str().unwrap_or("primary").to_lowercase();
    let owner_id = sanitize_file_stem(&raw_owner, "primary").to_lowercase();
    if !is_safe_agent_id(&owner_id) {
        return serde_json::json!({ "ok": false, "error": "Invalid inbox owner id" });
    }

    let requested_id = payload["id"].as_str().unwrap_or("");
    let capture_id = if is_safe_capture_id(requested_id) {
        requested_id.to_string()
    } else {
        format!("cap-{}", now_millis())
    };

    let dir = match inbox_capture_dir(&owner_id, &capture_id) {
        Ok(d) => d,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };

    if dir.join("manifest.json").exists() {
        if let Some(capture) = read_inbox_manifest(&dir) {
            return serde_json::json!({ "ok": true, "duplicate": true, "capture": capture });
        }
    }

    let mut saved_attachments = Vec::new();
    let mut total_bytes = 0usize;
    if let Some(attachments) = payload["attachments"].as_array() {
        let attachments_dir = dir.join("attachments");
        if let Err(e) = std::fs::create_dir_all(&attachments_dir) {
            return serde_json::json!({ "ok": false, "error": e.to_string() });
        }
        for (idx, attachment) in attachments.iter().take(25).enumerate() {
            let name = attachment["name"].as_str().unwrap_or("attachment");
            let mime_type = attachment["mimeType"].as_str()
                .or_else(|| attachment["type"].as_str())
                .unwrap_or("application/octet-stream");
            let data_raw = attachment["dataBase64"].as_str()
                .or_else(|| attachment["data"].as_str())
                .or_else(|| attachment["dataUrl"].as_str())
                .unwrap_or("");
            if data_raw.trim().is_empty() { continue; }
            let base64_data = data_raw
                .split_once(',')
                .map(|(_, data)| data)
                .unwrap_or(data_raw)
                .trim();
            let bytes = match base64_decode(base64_data) {
                Ok(bytes) => bytes,
                Err(e) => return serde_json::json!({ "ok": false, "error": e }),
            };
            let byte_count = bytes.len();
            total_bytes += byte_count;
            if total_bytes > 50 * 1024 * 1024 {
                return serde_json::json!({ "ok": false, "error": "Capture attachments exceed 50MB limit" });
            }
            let attachment_id = format!("att-{}-{}", idx + 1, now_millis());
            let file_name = format!("{}-{}", idx + 1, sanitize_file_stem(name, "attachment"));
            let file_path = attachments_dir.join(file_name);
            if let Err(e) = std::fs::write(&file_path, bytes) {
                return serde_json::json!({ "ok": false, "error": e.to_string() });
            }
            saved_attachments.push(serde_json::json!({
                "id": attachment_id,
                "name": name,
                "mimeType": mime_type,
                "size": byte_count,
                "path": file_path.to_string_lossy()
            }));
        }
    }

    let now = now_millis() as u64;
    let urls = payload["urls"].as_array().cloned().unwrap_or_default();
    let manifest = serde_json::json!({
        "id": capture_id,
        "ownerId": owner_id,
        "ownerLabel": payload["ownerLabel"].as_str().unwrap_or(""),
        "instanceId": payload["instanceId"].as_str().unwrap_or(""),
        "shareId": payload["shareId"].as_str().unwrap_or(""),
        "deviceName": payload["deviceName"].as_str().unwrap_or(""),
        "source": payload["source"].as_str().unwrap_or("desktop_drop"),
        "kind": payload["kind"].as_str().unwrap_or("mixed"),
        "status": payload["status"].as_str().unwrap_or("received"),
        "createdAt": payload["createdAt"].as_u64().unwrap_or(now),
        "updatedAt": now,
        "title": payload["title"].as_str().unwrap_or("Untitled capture"),
        "bodyText": payload["bodyText"].as_str().unwrap_or(""),
        "urls": urls,
        "attachments": saved_attachments,
        "note": payload["note"].as_str().unwrap_or(""),
        "channelHint": payload["channelHint"].as_str().unwrap_or(""),
        "channelId": payload["channelId"].as_str().unwrap_or(""),
        "agentId": payload["agentId"].as_str().unwrap_or(""),
        "targetKind": payload["targetKind"].as_str().unwrap_or(""),
        "tags": payload["tags"].as_array().cloned().unwrap_or_default(),
        "rawPath": dir.to_string_lossy(),
        "processedPaths": [],
        "error": ""
    });

    match write_inbox_manifest(&dir, &manifest) {
        Ok(_) => serde_json::json!({ "ok": true, "duplicate": false, "capture": manifest }),
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
fn update_inbox_capture(owner_id: String, capture_id: String, patch: serde_json::Value) -> serde_json::Value {
    let dir = match inbox_capture_dir(&owner_id, &capture_id) {
        Ok(d) => d,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let Some(mut manifest) = read_inbox_manifest(&dir) else {
        return serde_json::json!({ "ok": false, "error": "Capture not found" });
    };

    let allowed = [
        "status",
        "ownerLabel",
        "instanceId",
        "shareId",
        "deviceName",
        "title",
        "bodyText",
        "note",
        "channelHint",
        "channelId",
        "agentId",
        "targetKind",
        "tags",
        "processedPaths",
        "summary",
        "error",
    ];
    for key in allowed {
        if let Some(value) = patch.get(key) {
            manifest[key] = value.clone();
        }
    }
    manifest["updatedAt"] = serde_json::json!(now_millis() as u64);

    match write_inbox_manifest(&dir, &manifest) {
        Ok(_) => serde_json::json!({ "ok": true, "capture": manifest }),
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
fn read_inbox_attachment(owner_id: String, capture_id: String, attachment_id: String) -> serde_json::Value {
    let dir = match inbox_capture_dir(&owner_id, &capture_id) {
        Ok(d) => d,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let Some(manifest) = read_inbox_manifest(&dir) else {
        return serde_json::json!({ "ok": false, "error": "Capture not found" });
    };
    let Some(attachments) = manifest["attachments"].as_array() else {
        return serde_json::json!({ "ok": false, "error": "Attachment not found" });
    };
    let Some(attachment) = attachments.iter().find(|a| a["id"].as_str() == Some(attachment_id.as_str())) else {
        return serde_json::json!({ "ok": false, "error": "Attachment not found" });
    };
    let mime_type = attachment["mimeType"].as_str().unwrap_or("application/octet-stream");
    if let Some(data_url) = attachment["dataUrl"].as_str() {
        return serde_json::json!({
            "ok": true,
            "name": attachment["name"].as_str().unwrap_or("attachment"),
            "mimeType": mime_type,
            "dataUrl": data_url
        });
    }
    let Some(path) = attachment["path"].as_str() else {
        return serde_json::json!({ "ok": false, "error": "Attachment path missing" });
    };
    if path.trim().is_empty() {
        return serde_json::json!({ "ok": false, "error": "Attachment data missing" });
    }
    let file_path = match knowledge_path_from_input(path) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let bytes = match std::fs::read(file_path) {
        Ok(b) => b,
        Err(e) => return serde_json::json!({ "ok": false, "error": e.to_string() }),
    };
    let encoded = base64_encode(&bytes);
    serde_json::json!({
        "ok": true,
        "name": attachment["name"].as_str().unwrap_or("attachment"),
        "mimeType": mime_type,
        "dataUrl": format!("data:{};base64,{}", mime_type, encoded)
    })
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

// ─── Legacy ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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

#[tauri::command]
fn read_url_text(url: String) -> serde_json::Value {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return serde_json::json!({ "ok": false, "error": "Only http(s) URLs can be read", "text": "" });
    }
    match fetch_url_text(&url) {
        Some(text) => serde_json::json!({ "ok": true, "url": url, "text": text }),
        None => serde_json::json!({ "ok": false, "url": url, "error": "Could not read URL text", "text": "" }),
    }
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
            .unwrap_or_else(|| serde_json::json!({ "title": "", "url": "", "text": "", "browser": "", "error": "Chrome tab not found" })),
        "safari" => try_safari()
            .unwrap_or_else(|| serde_json::json!({ "title": "", "url": "", "text": "", "browser": "", "error": "Safari tab not found" })),
        _ => try_chrome()
            .or_else(try_safari)
            .unwrap_or_else(|| serde_json::json!({ "title": "", "url": "", "text": "", "browser": "", "error": "no supported browser found" })),
    }
}

#[tauri::command]
fn get_active_tab(cache: tauri::State<TabCache>, preferred: Option<String>) -> serde_json::Value {
    // Return pre-fetched value from shortcut handler (captured before focus steal),
    // but only if it matches the preferred browser (or no preference set)
    if let Some(cached) = cache.0.lock().unwrap().take() {
        let cached_browser = cached.get("browser").and_then(|b| b.as_str()).unwrap_or("");
        let pref = preferred.as_deref().unwrap_or("auto");
        if pref == "auto" || pref.is_empty() || cached_browser == pref || cached_browser.is_empty() {
            return cached;
        }
    }
    // Fallback: live detection (manual refresh or preference mismatch)
    detect_active_tab_preferred(preferred.as_deref())
}

#[tauri::command]
fn show_spotlight(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("spotlight") {
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

// ─── Entry Point ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LlamaState {
            pid: Mutex::new(None),
        })
        .manage(TabCache::default())
        .setup(|app| {
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
                .inner_size(560.0, 400.0)
                .min_inner_size(360.0, 200.0)
                .resizable(true)
                .build()?;

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
                                *handle.state::<TabCache>().0.lock().unwrap() = Some(tab);
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
        // Clean Exit hook: SIGCONT + SIGKILL the llama sidecar on window destroy
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                let state = app.state::<LlamaState>();
                let pid = *state.pid.lock().unwrap();
                if let Some(pid) = pid {
                    kill_llama(pid);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_ram_stats,
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
            sync_semantic_layer,
            get_index_status,
            get_semantic_layer_status,
            search_knowledge_semantic,
            search_semantic_layer,
            delete_memory_file,
            archive_memory_file,
            restore_archived_file,
            read_dream_log,
            write_dream_log,
            list_archive_files,
            list_agent_memory_files,
            list_channel_memory_files,
            list_inbox_captures,
            read_inbox_capture,
            create_inbox_capture,
            update_inbox_capture,
            read_inbox_attachment,
            list_library_files,
            read_knowledge_file,
            read_url_text,
            get_active_tab,
            show_spotlight,
            hide_spotlight,
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

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct TestHome {
        old_home: Option<String>,
        home: PathBuf,
    }

    impl Drop for TestHome {
        fn drop(&mut self) {
            if let Some(old_home) = &self.old_home {
                std::env::set_var("HOME", old_home);
            } else {
                std::env::remove_var("HOME");
            }
            let _ = std::fs::remove_dir_all(&self.home);
        }
    }

    fn unique_test_home(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "agent-forge-{name}-{}-{}",
            std::process::id(),
            now_millis()
        ))
    }

    fn set_test_home(name: &str) -> TestHome {
        let old_home = std::env::var("HOME").ok();
        let home = unique_test_home(name);
        std::fs::create_dir_all(&home).unwrap();
        std::env::set_var("HOME", &home);
        TestHome { old_home, home }
    }

    #[test]
    fn semantic_layer_indexes_grounded_facts_and_relations() {
        let _home_lock = TEST_HOME_LOCK.lock().unwrap();
        let _home = set_test_home("semantic-layer");

        let kc = init_knowledge_core();
        assert_eq!(kc["initialized"].as_bool(), Some(true));
        let root = knowledge_root();
        let memory_path = root
            .join("memory")
            .join("f-starwars")
            .join("memos")
            .join("vader-isb-test.md");
        let content = r#"---
title: "Vader ISB deck test"
type: "manual-memmo"
scope: "agent"
agent_id: "f-starwars"
source_kind: "manual_entry"
evidence_state: "user_provided"
verification: "verified"
confidence: "high"
tags: ["star-wars-ccg", "deck-test"]
---

# Vader ISB deck test

## Summary
- Vader/ISB failed because early force generation was weak.
- Decision: Do not rebuild Vader/ISB unless early force generation is solved.
"#;

        let write = write_memory(
            memory_path.to_string_lossy().to_string(),
            content.to_string(),
            "test: semantic deck memory".to_string(),
            Some("f-starwars".to_string()),
            None,
            None,
        );
        assert_eq!(write["blocked"].as_bool(), Some(false));

        let sync = sync_semantic_layer();
        assert_eq!(sync["ok"].as_bool(), Some(true));
        assert!(sync["indexed"].as_u64().unwrap_or(0) >= 1);

        let status = get_semantic_layer_status();
        assert!(status["documents"].as_i64().unwrap_or(0) >= 1);
        assert!(status["facts"].as_i64().unwrap_or(0) >= 1);
        assert!(status["relations"].as_i64().unwrap_or(0) >= 1);

        let result = search_semantic_layer(
            "Vader ISB early force generation".to_string(),
            Some("f-starwars".to_string()),
            None,
            Some(8),
        );
        let facts = result["facts"].as_array().cloned().unwrap_or_default();
        let relations = result["relations"].as_array().cloned().unwrap_or_default();
        assert!(
            facts.iter().any(|fact| fact["fact"].as_str().unwrap_or("").contains("early force generation")),
            "expected semantic fact about early force generation, got {facts:?}"
        );
        assert!(
            relations.iter().any(|rel| rel["relation"].as_str() == Some("failed_because")),
            "expected failed_because relation, got {relations:?}"
        );
    }

    #[test]
    fn inbox_capture_writes_attachments_as_raw_files() {
        let _home_lock = TEST_HOME_LOCK.lock().unwrap();
        let _home = set_test_home("inbox-attachments");

        let kc = init_knowledge_core();
        assert_eq!(kc["initialized"].as_bool(), Some(true));

        let payload = serde_json::json!({
            "ownerId": "primary",
            "id": "cap-attachment-test",
            "source": "desktop_drop",
            "kind": "file",
            "title": "Attachment test",
            "bodyText": "Keep the original attachment out of manifest JSON.",
            "attachments": [{
                "name": "note.txt",
                "mimeType": "text/plain",
                "dataBase64": "aGVsbG8gZm9yZ2U="
            }]
        });

        let created = create_inbox_capture(payload);
        assert_eq!(created["ok"].as_bool(), Some(true));
        assert_eq!(created["duplicate"].as_bool(), Some(false));

        let capture = &created["capture"];
        let attachments = capture["attachments"].as_array().unwrap();
        assert_eq!(attachments.len(), 1);
        assert!(attachments[0]["dataUrl"].is_null());
        let path = attachments[0]["path"].as_str().unwrap();
        assert!(Path::new(path).exists(), "attachment path should exist: {path}");
        assert_eq!(std::fs::read(path).unwrap(), b"hello forge");

        let read = read_inbox_attachment(
            "primary".to_string(),
            "cap-attachment-test".to_string(),
            attachments[0]["id"].as_str().unwrap().to_string(),
        );
        assert_eq!(read["ok"].as_bool(), Some(true));
        assert_eq!(read["name"].as_str(), Some("note.txt"));
        assert_eq!(read["dataUrl"].as_str(), Some("data:text/plain;base64,aGVsbG8gZm9yZ2U="));

        let duplicate = create_inbox_capture(serde_json::json!({
            "ownerId": "primary",
            "id": "cap-attachment-test"
        }));
        assert_eq!(duplicate["ok"].as_bool(), Some(true));
        assert_eq!(duplicate["duplicate"].as_bool(), Some(true));
    }
}
