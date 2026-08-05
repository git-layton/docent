import re

with open("src-tauri/src/lib.rs", "r") as f:
    content = f.read()

# Fix the 16-space indentation fallback
content = content.replace(
"""                return search_knowledge(
                    query,
                    None,
                    agent_id,
                    Some(max_results),
                    Some(snippet_chars),
                )""",
"""                return search_knowledge(
                    query,
                    None,
                    agent_id.clone(),
                    space_id.clone(),
                    Some(max_results),
                    Some(snippet_chars),
                )""")

# Fix the 12-space indentation fallback if it failed too (wait, it succeeded for 2 of them but maybe they all had 16 spaces?)
# Just to be safe, I'll do a regex replace for any search_knowledge( query, None, agent_id, Some(max_results), Some(snippet_chars) )
content = re.sub(
    r"search_knowledge\(\s*query,\s*None,\s*agent_id,\s*Some\(max_results\),\s*Some\(snippet_chars\)\s*\)",
    r"search_knowledge(query, None, agent_id.clone(), space_id.clone(), Some(max_results), Some(snippet_chars))",
    content
)
content = re.sub(
    r"search_knowledge\(\s*query,\s*None,\s*agent_id.clone\(\),\s*Some\(max_results\),\s*Some\(snippet_chars\)\s*\)",
    r"search_knowledge(query, None, agent_id.clone(), space_id.clone(), Some(max_results), Some(snippet_chars))",
    content
)

# Remove the queue_directory_for_index lines since they don't exist
content = content.replace("let _ = queue_directory_for_index(&conn, &root.join(\"memory\"));", "")
content = content.replace("let _ = queue_directory_for_index(&conn, &root.join(\"library\"));", "")

with open("src-tauri/src/lib.rs", "w") as f:
    f.write(content)
