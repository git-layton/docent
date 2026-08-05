import re

with open("src-tauri/src/lib.rs", "r") as f:
    content = f.read()

# search_knowledge
old_sk = """fn search_knowledge(
    query: String,
    extra_path: Option<String>,
    agent_id: Option<String>,
    max_results: Option<usize>,
    snippet_chars: Option<usize>,
) -> serde_json::Value {"""
new_sk = """fn search_knowledge(
    query: String,
    extra_path: Option<String>,
    agent_id: Option<String>,
    space_id: Option<String>,
    max_results: Option<usize>,
    snippet_chars: Option<usize>,
) -> serde_json::Value {"""
content = content.replace(old_sk, new_sk)

old_sk_logic = """    let memory_dir = if let Some(ref aid) = agent_id {
        if !is_safe_agent_id(aid) {
            return serde_json::json!({ "results": [], "error": "Invalid agent id" });
        }
        root.join("memory").join(aid)
    } else {
        root.join("memory")
    };

    let mut dirs_to_search: Vec<std::path::PathBuf> = vec![root.join("library"), memory_dir];"""
new_sk_logic = """    let mut dirs_to_search: Vec<std::path::PathBuf> = vec![root.join("library")];
    if let Some(ref sid) = space_id {
        if !is_safe_agent_id(sid) {
            return serde_json::json!({ "results": [], "error": "Invalid space id" });
        }
        dirs_to_search.push(root.join("memory").join("spaces").join(sid));
        dirs_to_search.push(root.join("memory").join("spaces").join("space-home"));
    } else if let Some(ref aid) = agent_id {
        if !is_safe_agent_id(aid) {
            return serde_json::json!({ "results": [], "error": "Invalid agent id" });
        }
        dirs_to_search.push(root.join("memory").join(aid));
    } else {
        dirs_to_search.push(root.join("memory"));
    }"""
content = content.replace(old_sk_logic, new_sk_logic)

# search_knowledge_semantic
old_sks = """fn search_knowledge_semantic(
    query: String,
    agent_id: Option<String>,
    max_results: Option<usize>,
    snippet_chars: Option<usize>,
) -> serde_json::Value {"""
new_sks = """fn search_knowledge_semantic(
    query: String,
    agent_id: Option<String>,
    space_id: Option<String>,
    max_results: Option<usize>,
    snippet_chars: Option<usize>,
) -> serde_json::Value {"""
content = content.replace(old_sks, new_sks)

old_sks_fallback = """            return search_knowledge(
                query,
                None,
                agent_id,
                Some(max_results),
                Some(snippet_chars),
            )"""
new_sks_fallback = """            return search_knowledge(
                query,
                None,
                agent_id.clone(),
                space_id.clone(),
                Some(max_results),
                Some(snippet_chars),
            )"""
content = content.replace(old_sks_fallback, new_sks_fallback)

old_sks_prefix = """    let root = knowledge_root();
    let memory_prefix = agent_id
        .as_ref()
        .map(|id| root.join("memory").join(id).to_string_lossy().to_string())
        .unwrap_or_else(|| root.join("memory").to_string_lossy().to_string());
    let library_prefix = root.join("library").to_string_lossy().to_string();

    let rows: Vec<(String, String, Vec<u8>, i64, f64)> = {
        let mut stmt = match conn.prepare(
            "SELECT file_path, content, vector, last_modified, importance FROM brain_vectors WHERE file_path LIKE ?1 OR file_path LIKE ?2"
        ) { Ok(s) => s, Err(_) => return search_knowledge(query, None, agent_id, Some(max_results), Some(snippet_chars)) };

        stmt.query_map(
            rusqlite::params![format!("{memory_prefix}%"), format!("{library_prefix}%")],"""

new_sks_prefix = """    let root = knowledge_root();
    let library_prefix = root.join("library").to_string_lossy().to_string();
    
    let rows: Vec<(String, String, Vec<u8>, i64, f64)> = {
        if let Some(ref sid) = space_id {
            let space_prefix = root.join("memory").join("spaces").join(sid).to_string_lossy().to_string();
            let global_prefix = root.join("memory").join("spaces").join("space-home").to_string_lossy().to_string();
            let mut stmt = match conn.prepare(
                "SELECT file_path, content, vector, last_modified, importance FROM brain_vectors WHERE file_path LIKE ?1 OR file_path LIKE ?2 OR file_path LIKE ?3"
            ) { Ok(s) => s, Err(_) => return search_knowledge(query, None, agent_id.clone(), space_id.clone(), Some(max_results), Some(snippet_chars)) };
            
            stmt.query_map(
                rusqlite::params![format!("{space_prefix}%"), format!("{global_prefix}%"), format!("{library_prefix}%")],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            ).map(|it| it.flatten().collect()).unwrap_or_default()
        } else {
            let memory_prefix = agent_id
                .as_ref()
                .map(|id| root.join("memory").join(id).to_string_lossy().to_string())
                .unwrap_or_else(|| root.join("memory").to_string_lossy().to_string());
            let mut stmt = match conn.prepare(
                "SELECT file_path, content, vector, last_modified, importance FROM brain_vectors WHERE file_path LIKE ?1 OR file_path LIKE ?2"
            ) { Ok(s) => s, Err(_) => return search_knowledge(query, None, agent_id.clone(), space_id.clone(), Some(max_results), Some(snippet_chars)) };

            stmt.query_map(
                rusqlite::params![format!("{memory_prefix}%"), format!("{library_prefix}%")],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            ).map(|it| it.flatten().collect()).unwrap_or_default()
        }
    };"""
content = content.replace(old_sks_prefix, new_sks_prefix)

old_sks_fallback_rows = """        return search_knowledge(
            query,
            None,
            agent_id,
            Some(max_results),
            Some(snippet_chars),
        );"""
new_sks_fallback_rows = """        return search_knowledge(
            query,
            None,
            agent_id,
            space_id,
            Some(max_results),
            Some(snippet_chars),
        );"""
content = content.replace(old_sks_fallback_rows, new_sks_fallback_rows)


# list_agent_memory_files
old_lamf = """fn list_agent_memory_files(agent_id: String) -> serde_json::Value {
    if !is_safe_agent_id(&agent_id) {
        return serde_json::json!({ "files": [], "error": "Invalid agent id" });
    }
    let dir = knowledge_root().join("memory").join(agent_id);
    let mut files = Vec::new();
    collect_knowledge_files(&dir, &mut files, true);"""

new_lamf = """fn list_agent_memory_files(agent_id: String, space_id: Option<String>) -> serde_json::Value {
    let mut files = Vec::new();
    if let Some(sid) = space_id {
        if !is_safe_agent_id(&sid) {
            return serde_json::json!({ "files": [], "error": "Invalid space id" });
        }
        let space_dir = knowledge_root().join("memory").join("spaces").join(&sid);
        let global_dir = knowledge_root().join("memory").join("spaces").join("space-home");
        collect_knowledge_files(&space_dir, &mut files, true);
        collect_knowledge_files(&global_dir, &mut files, true);
    } else {
        if !is_safe_agent_id(&agent_id) {
            return serde_json::json!({ "files": [], "error": "Invalid agent id" });
        }
        let dir = knowledge_root().join("memory").join(agent_id);
        collect_knowledge_files(&dir, &mut files, true);
    }"""
content = content.replace(old_lamf, new_lamf)

# Migration function
migration_fn = """
#[tauri::command]
fn migrate_memory_to_global() -> serde_json::Value {
    let root = knowledge_root();
    let memory_dir = root.join("memory");
    let global_dir = root.join("memory").join("spaces").join("space-home");
    
    if !memory_dir.exists() {
        return serde_json::json!({ "ok": true, "migrated": 0 });
    }
    
    let mut migrated_count = 0;
    
    // We only migrate files under memory/<agent_id>/... if they are md files.
    // To avoid moving spaces/ or .archive/, we skip them.
    if let Ok(entries) = std::fs::read_dir(&memory_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() { continue; }
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if name == "spaces" || name == ".archive" || name.starts_with('.') { continue; }
            
            // It's an agent memory directory. Find all md files inside.
            if let Ok(agent_files) = walk_md_files(&path) {
                for file_path in agent_files {
                    if let Ok(content) = std::fs::read_to_string(&file_path) {
                        // Inject scope: "global" if not present
                        let mut new_content = content.clone();
                        if content.starts_with("---") {
                            if !content.contains("scope: ") {
                                new_content = content.replacen("---", "---\\nscope: \"global\"", 1);
                            }
                        } else {
                            new_content = format!("---\\nscope: \"global\"\\n---\\n\\n{}", content);
                        }
                        
                        // Construct new path in global_dir
                        let rel_path = file_path.strip_prefix(&path).unwrap_or(&file_path);
                        let new_path = global_dir.join(rel_path);
                        
                        if let Some(parent) = new_path.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        
                        // Write new file
                        if std::fs::write(&new_path, new_content).is_ok() {
                            // Remove old file
                            let _ = std::fs::remove_file(&file_path);
                            migrated_count += 1;
                        }
                    }
                }
            }
            // Try to clean up empty directories
            let _ = std::fs::remove_dir_all(&path);
        }
    }
    
    // Re-queue everything for indexing if migration happened
    if migrated_count > 0 {
        if let Ok(conn) = open_index_db() {
            let _ = conn.execute("DELETE FROM brain_vectors", []);
            let _ = conn.execute("DELETE FROM pending_index", []);
            let _ = queue_directory_for_index(&conn, &root.join("memory"));
            let _ = queue_directory_for_index(&conn, &root.join("library"));
        }
    }
    
    serde_json::json!({ "ok": true, "migrated": migrated_count })
}
"""

if "migrate_memory_to_global" not in content:
    content = content.replace("fn delete_memory_file", migration_fn + "\nfn delete_memory_file")

content = content.replace("            list_agent_memory_files,\n", "            list_agent_memory_files,\n            migrate_memory_to_global,\n")

with open("src-tauri/src/lib.rs", "w") as f:
    f.write(content)
