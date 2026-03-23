use std::sync::Mutex;
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
    Ok(String::from_utf8_lossy(&output.stdout).to_string()
        + &String::from_utf8_lossy(&output.stderr))
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
        ".DS_Store\n*.tmp\n.obsidian/workspace\n.obsidian/workspace.json\n",
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
        } else if path.extension().and_then(|s| s.to_str()) == Some("md") {
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
fn search_knowledge(query: String, extra_path: Option<String>) -> serde_json::Value {
    let root = knowledge_core_path();
    let query_lower = query.to_lowercase();
    let keywords: Vec<&str> = query_lower.split_whitespace().collect();

    let mut results: Vec<serde_json::Value> = Vec::new();

    let mut dirs_to_search: Vec<std::path::PathBuf> = vec![
        root.join("library"),
        root.join("memory"),
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
            let snippet: String = body.chars().take(400).collect();

            results.push(serde_json::json!({
                "path": path.to_string_lossy(),
                "title": title,
                "snippet": snippet,
                "score": score
            }));
        }
    }

    results.sort_by(|a, b| b["score"].as_u64().cmp(&a["score"].as_u64()));
    results.truncate(5);

    serde_json::json!({ "results": results })
}

// ─── 2.1 Memmo Engine ────────────────────────────────────────────────────────

#[tauri::command]
fn append_task(text: String) -> serde_json::Value {
    let repo_root = knowledge_core_path();
    let tasks_path = repo_root.join("memory/tasks.md");

    let existing = std::fs::read_to_string(&tasks_path)
        .unwrap_or_else(|_| "# Tasks\n".to_string());
    let new_content = format!("{}- [ ] {}\n", existing, text);

    if let Err(e) = std::fs::write(&tasks_path, &new_content) {
        return serde_json::json!({ "commit": null, "error": e.to_string() });
    }

    let _ = run_git(&["add", "memory/tasks.md"], &repo_root);
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
