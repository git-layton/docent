use std::sync::Mutex;
use notify::Watcher;
use sysinfo::System;
use tauri::Manager;

// ─── App State ───────────────────────────────────────────────────────────────

struct LlamaState {
    pid: Mutex<Option<u32>>,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn knowledge_core_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home).join("AgentForge")
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
        let _ = std::process::Command::new("pkill")
            .args(["-STOP", "llama-server"])
            .output();
        serde_json::json!({ "ok": true, "method": "pkill" })
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
        let _ = std::process::Command::new("pkill")
            .args(["-CONT", "llama-server"])
            .output();
        serde_json::json!({ "ok": true, "method": "pkill" })
    }
}

// ─── 1.2 Nuke Shield ─────────────────────────────────────────────────────────

#[tauri::command]
fn safe_write_file(path: String, content: String) -> serde_json::Value {
    let file_path = std::path::Path::new(&path);
    let repo_root = knowledge_core_path();

    let existing_lines = if file_path.exists() {
        std::fs::read_to_string(file_path)
            .map(|s| s.lines().count() as u32)
            .unwrap_or(0)
    } else {
        0
    };

    if let Some(parent) = file_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(file_path, &content) {
        return serde_json::json!({ "blocked": false, "error": e.to_string() });
    }

    let diff_stat = run_git(&["diff", "--stat", "HEAD"], &repo_root).unwrap_or_default();
    let deletions = parse_deletions(&diff_stat);

    let threshold = (existing_lines as f32 * 0.4).max(5.0) as u32;
    let blocked = deletions > threshold || (existing_lines > 0 && deletions >= existing_lines);

    serde_json::json!({
        "blocked": blocked,
        "deletions": deletions,
        "existing_lines": existing_lines,
        "diff_stat": diff_stat.trim()
    })
}

#[tauri::command]
fn rollback_file(path: String) -> serde_json::Value {
    let repo_root = knowledge_core_path();
    let result = run_git(&["checkout", "HEAD", "--", &path], &repo_root);
    serde_json::json!({ "ok": result.is_ok(), "output": result.unwrap_or_default() })
}

// ─── 1.3 Knowledge Core ──────────────────────────────────────────────────────

#[tauri::command]
fn init_knowledge_core() -> serde_json::Value {
    let root = knowledge_core_path();

    // Always ensure subdirectory structure exists (idempotent)
    for subdir in &["memory/goals", "memory/decisions", "memory/metrics", "memory/research", "memory/memos", "library"] {
        let _ = std::fs::create_dir_all(root.join(subdir));
    }

    if root.join(".git").exists() {
        return serde_json::json!({ "initialized": false, "path": root.to_string_lossy() });
    }

    let _ = std::fs::write(
        root.join(".gitignore"),
        ".DS_Store\n*.tmp\n.obsidian/workspace\n.obsidian/workspace.json\n.index.db\n.lancedb/\n.models/\n",
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
    let repo_root = knowledge_core_path();

    let stash_out = run_git(&["stash", "--include-untracked"], &repo_root)
        .unwrap_or_default();
    let stashed = !stash_out.contains("No local changes");

    let write_result = safe_write_file(path.clone(), content.clone());
    if write_result["blocked"].as_bool().unwrap_or(false) {
        if stashed {
            let _ = run_git(&["stash", "pop"], &repo_root);
        }
        return serde_json::json!({
            "blocked": true,
            "deletions": write_result["deletions"],
            "existing_lines": write_result["existing_lines"],
            "diff_stat": write_result["diff_stat"],
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

    let _ = run_git(&["add", &path], &repo_root);
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

    let prune_suggested = path.ends_with("index.md") && content.lines().count() > 200;

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
fn search_knowledge(query: String, extra_path: Option<String>, agent_id: Option<String>, max_results: Option<usize>, snippet_chars: Option<usize>) -> serde_json::Value {
    let root = knowledge_core_path();
    let query_lower = query.to_lowercase();
    let keywords: Vec<&str> = query_lower.split_whitespace().collect();
    let max_results = max_results.unwrap_or(5);
    let snippet_chars = snippet_chars.unwrap_or(400);

    let mut results: Vec<serde_json::Value> = Vec::new();

    let memory_dir = if let Some(ref aid) = agent_id {
        root.join("memory").join(aid)
    } else {
        root.join("memory")
    };

    let mut dirs_to_search: Vec<std::path::PathBuf> = vec![
        root.join("library"),
        memory_dir,
    ];
    if let Some(ref ep) = extra_path {
        let p = std::path::PathBuf::from(ep);
        if p.exists() { dirs_to_search.push(p); }
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
    let repo_root = knowledge_core_path();
    let tasks_path = if let Some(ref aid) = agent_id {
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
    let short = &text[..text.len().min(50)];
    let msg = format!("task: {}", short);
    let commit_out = run_git(&["commit", "-m", &msg], &repo_root).unwrap_or_default();
    let commit_hash = commit_out
        .lines()
        .find(|l| l.starts_with('['))
        .map(|l| l.to_string());

    serde_json::json!({ "commit": commit_hash })
}

#[tauri::command]
fn revert_memory_commit(commit_hash: String) -> serde_json::Value {
    let repo_root = knowledge_core_path();
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
            .with_cache_dir(knowledge_core_path().join(".models")),
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
    let db_path = knowledge_core_path().join(".index.db");
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
        CREATE INDEX IF NOT EXISTS idx_bv_file ON brain_vectors(file_path);",
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
        let watch_path = knowledge_core_path();
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
}

#[tauri::command]
fn sync_knowledge_core_index() -> serde_json::Value {
    let root = knowledge_core_path();
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

#[tauri::command]
fn search_knowledge_semantic(query: String, agent_id: Option<String>, max_results: Option<usize>, snippet_chars: Option<usize>) -> serde_json::Value {
    let max_results = max_results.unwrap_or(5);
    let snippet_chars = snippet_chars.unwrap_or(400);

    // Fall back to keyword search if model not loaded yet
    let embedder = match get_or_init_embedder() {
        Ok(e) => e,
        Err(_) => return search_knowledge(query, None, agent_id, Some(max_results), Some(snippet_chars)),
    };

    let query_vec: Vec<f32> = {
        let guard = embedder.lock().unwrap();
        match guard.embed(vec![query.as_str()], None) {
            Ok(mut e) if !e.is_empty() => e.remove(0),
            _ => return search_knowledge(query, None, agent_id, Some(max_results), Some(snippet_chars)),
        }
    };

    let conn = match open_index_db() {
        Ok(c) => c,
        Err(_) => return search_knowledge(query, None, agent_id, Some(max_results), Some(snippet_chars)),
    };

    let root = knowledge_core_path();
    let memory_prefix = agent_id.as_ref()
        .map(|id| root.join("memory").join(id).to_string_lossy().to_string())
        .unwrap_or_else(|| root.join("memory").to_string_lossy().to_string());
    let library_prefix = root.join("library").to_string_lossy().to_string();

    let rows: Vec<(String, String, Vec<u8>)> = {
        let mut stmt = match conn.prepare(
            "SELECT file_path, content, vector FROM brain_vectors WHERE file_path LIKE ?1 OR file_path LIKE ?2"
        ) { Ok(s) => s, Err(_) => return search_knowledge(query, None, agent_id, Some(max_results), Some(snippet_chars)) };

        stmt.query_map(
            rusqlite::params![format!("{memory_prefix}%"), format!("{library_prefix}%")],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map(|it| it.flatten().collect()).unwrap_or_default()
    };

    if rows.is_empty() {
        return search_knowledge(query, None, agent_id, Some(max_results), Some(snippet_chars));
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
    let file_path = std::path::Path::new(&path);
    let repo_root = knowledge_core_path();

    // Safety: must be inside ~/AgentForge/
    if !file_path.starts_with(&repo_root) {
        return serde_json::json!({ "ok": false, "error": "Path is outside the Knowledge Core" });
    }

    // Remove from vector index tables (ignore errors — file might not be indexed yet)
    if let Ok(conn) = open_index_db() {
        let _ = conn.execute("DELETE FROM brain_vectors WHERE file_path = ?1", rusqlite::params![&path]);
        let _ = conn.execute("DELETE FROM pending_index WHERE file_path = ?1", rusqlite::params![&path]);
    }

    // Try git rm + commit to maintain audit trail
    if let Ok(rel) = file_path.strip_prefix(&repo_root) {
        let git_ok = run_git(&["rm", "--force", &rel.to_string_lossy()], &repo_root)
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

// ─── Legacy ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LlamaState {
            pid: Mutex::new(None),
        })
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            revert_memory_commit,
            search_knowledge,
            get_hardware_profile,
            init_file_watcher,
            sync_knowledge_core_index,
            get_index_status,
            search_knowledge_semantic,
            delete_memory_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
