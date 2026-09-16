//! Reading real apps STRUCTURALLY — roles, values, bounds and hierarchy — instead of OCR's
//! flattened picture of them.
//!
//! WHY THIS EXISTS. Docent's screen read is Apple Vision OCR, and measurement (2026-09-13) put its
//! word recall at 98.5-100% — accuracy was never the problem. Structure was. A six-row inbox came
//! back column-major: every sender, then every subject, then every date, with the row associations
//! destroyed and nothing telling the model it was reading columns. That is the shape that produces
//! confident wrong answers ("Sam sent you the billing alert"). OCR also returns text and only text
//! — never a handle you can act on.
//!
//! The accessibility tree is what the app itself publishes: the same data a screen reader uses.
//! Exact strings with no recognition step, each element carrying its role and bounds, and controls
//! addressable rather than merely visible. It is the difference between a photograph of Mail and
//! Mail's own message list.
//!
//! This is the layer that makes "open the real app instead of rebuilding it" actually work.
//!
//! TWO INVARIANTS, both load-bearing:
//!
//! 1. READING NEVER PROMPTS. `accessibility_authorized` checks with the prompt suppressed, so a
//!    capability can discover it lacks access without spending the one macOS prompt the user gets.
//!    Research on permission priming is unambiguous: a plain-language ask BEFORE the system dialog
//!    takes opt-in from ~25-35% to ~65%, and only ~3% then deny at the OS prompt — but that only
//!    works while the OS prompt is still unspent. On macOS a denial is terminal; recovery means
//!    System Settings and usually a relaunch. So the in-app chip owns the ask, and this module
//!    must never trigger it as a side effect of looking.
//!
//! 2. EVERYTHING READ HERE IS UNTRUSTED DATA. It is the content of other people's emails, messages
//!    and web pages. It is never an instruction, whatever it says. Callers fence it the same way
//!    the browser and screen paths already do.
//!
//! Output is bounded by construction (depth, element count, string length). An unbounded tree is a
//! context-overflow waiting to happen, which this codebase has already paid for once.

#[cfg(target_os = "macos")]
use serde::Serialize;

/// One node of an app's accessibility tree, trimmed to what a model can actually use.
#[cfg(target_os = "macos")]
#[derive(Serialize, Debug, Clone, Default)]
pub struct AxNode {
    /// AXButton, AXTextArea, AXRow, AXStaticText…
    pub role: String,
    /// The element's label. Omitted when empty so the JSON stays small.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Its content — a text field's text, a row's string value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// Screen bounds [x, y, w, h]. This is what carries LAYOUT, and layout is the thing OCR loses:
    /// a message bubble's x tells you who sent it; a cell's y tells you which row it belongs to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<[f64; 4]>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<AxNode>,
}

/// Caps. Deliberately conservative: this feeds a prompt, and a 32K local model has ~89k chars of
/// input budget TOTAL for system prompt, history and everything else.
#[cfg(target_os = "macos")]
pub const MAX_ELEMENTS: usize = 400;
#[cfg(target_os = "macos")]
pub const MAX_DEPTH: usize = 12;
#[cfg(target_os = "macos")]
pub const MAX_STRING: usize = 500;

#[cfg(target_os = "macos")]
pub fn truncate(s: String) -> String {
    if s.chars().count() <= MAX_STRING {
        return s;
    }
    let head: String = s.chars().take(MAX_STRING).collect();
    format!("{head}…")
}

/// Does this element say anything ITSELF?
///
/// Note "itself": having children does NOT count. An unlabeled AXGroup wrapping three rows carries
/// no meaning of its own — it is layout scaffolding, and scaffolding is most of a real tree. If
/// holding children were enough to survive, every wrapper would, and the pruning would strip
/// nothing but the leaves nobody was worried about.
#[cfg(target_os = "macos")]
pub fn is_meaningful(node: &AxNode) -> bool {
    node.title.is_some() || node.value.is_some()
}

/// Drop scaffolding, keeping anything underneath it.
///
/// An unlabeled AXGroup holding three labeled rows must not take its rows down with it — so a
/// pruned node is REPLACED BY its surviving children rather than deleted outright. Flattening the
/// wrapper keeps the rows and loses only the empty box they sat in.
#[cfg(target_os = "macos")]
pub fn prune(node: AxNode) -> Vec<AxNode> {
    // Destructured rather than `..node`: taking `children` by value partially moves `node`, and
    // the keep/dissolve decision still needs to read its title and value afterwards.
    let AxNode { role, title, value, bounds, children } = node;
    let kept: Vec<AxNode> = children.into_iter().flat_map(prune).collect();
    if title.is_some() || value.is_some() {
        vec![AxNode { role, title, value, bounds, children: kept }]
    } else {
        // Say nothing ourselves: dissolve, and let whatever survived underneath take our place.
        // Returning Vec (not Option) is what makes this possible — a node is REPLACED BY its
        // survivors, so a wrapper vanishes while its rows move up a level intact. An empty vec
        // falls out naturally when there was nothing underneath either.
        kept
    }
}

/// Count nodes in a tree — used to enforce MAX_ELEMENTS after pruning.
#[cfg(target_os = "macos")]
pub fn count(nodes: &[AxNode]) -> usize {
    nodes.iter().map(|n| 1 + count(&n.children)).sum()
}

#[cfg(test)]
#[cfg(target_os = "macos")]
mod tests {
    use super::*;

    fn node(role: &str, title: Option<&str>, children: Vec<AxNode>) -> AxNode {
        AxNode {
            role: role.into(),
            title: title.map(str::to_string),
            children,
            ..Default::default()
        }
    }

    #[test]
    fn scaffolding_is_dropped_but_never_takes_its_contents_with_it() {
        // The shape a real window actually has: meaningful rows buried under unlabeled groups.
        let tree = node(
            "AXGroup",
            None,
            vec![node(
                "AXGroup",
                None,
                vec![
                    node("AXStaticText", Some("Breaking Points"), vec![]),
                    node("AXGroup", None, vec![]), // pure scaffolding, nothing below
                ],
            )],
        );

        let out = prune(tree);
        // The wrappers are gone…
        assert_eq!(count(&out), 1, "empty groups should not survive");
        // …but the row inside them did NOT go with them.
        assert_eq!(out[0].title.as_deref(), Some("Breaking Points"));
    }

    #[test]
    fn an_empty_leaf_disappears() {
        assert!(prune(node("AXGroup", None, vec![])).is_empty());
    }

    #[test]
    fn a_labeled_container_keeps_its_own_identity_and_its_children() {
        let tree = node(
            "AXTable",
            Some("Messages"),
            vec![node("AXRow", Some("row one"), vec![])],
        );
        let out = prune(tree);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title.as_deref(), Some("Messages"));
        assert_eq!(out[0].children.len(), 1);
    }

    #[test]
    fn a_node_with_a_value_but_no_title_survives() {
        // Text fields routinely have no title and all of the meaning.
        let n = AxNode { role: "AXTextArea".into(), value: Some("hello".into()), ..Default::default() };
        assert!(is_meaningful(&n));
        assert_eq!(prune(n).len(), 1);
    }

    #[test]
    fn long_strings_are_capped_rather_than_dropped() {
        // A 200KB text area must not be able to blow the prompt — but truncating to nothing would
        // lose the one element that mattered.
        let out = truncate("x".repeat(MAX_STRING * 3));
        assert!(out.chars().count() <= MAX_STRING + 1);
        assert!(out.ends_with('…'), "truncation should be visible, not silent");
    }

    #[test]
    fn short_strings_are_left_exactly_alone() {
        assert_eq!(truncate("Breaking Points".into()), "Breaking Points");
    }
}

// ─── The live read ────────────────────────────────────────────────────────────
// Everything above is pure and unit-tested. Everything below talks to the window server.

#[cfg(target_os = "macos")]
use core_foundation::base::{CFType, TCFType};
#[cfg(target_os = "macos")]
use core_foundation::string::CFString;

// Permission state is NOT re-implemented here. `permissions.rs` already owns
// `accessibility_authorized` (the non-prompting AXIsProcessTrusted) and
// `accessibility_request_access` (the prompting one), and already keeps them separate — which is
// exactly the invariant this module depends on: looking must never spend the one macOS prompt.

#[cfg(target_os = "macos")]
fn attr_string(el: accessibility_sys::AXUIElementRef, name: &str) -> Option<String> {
    let key = CFString::new(name);
    let mut raw: core_foundation::base::CFTypeRef = std::ptr::null();
    // SAFETY: `el` is a live AXUIElementRef owned by the caller; `key` outlives the call; `raw` is
    // only read when the call reports success.
    let err = unsafe {
        accessibility_sys::AXUIElementCopyAttributeValue(el, key.as_concrete_TypeRef(), &mut raw)
    };
    if err != accessibility_sys::kAXErrorSuccess || raw.is_null() {
        return None;
    }
    // SAFETY: a successful copy returns a +1 reference we now own.
    let value = unsafe { CFType::wrap_under_create_rule(raw) };
    value
        .downcast::<CFString>()
        .map(|s| truncate(s.to_string()))
        .filter(|s| !s.trim().is_empty())
}

#[cfg(target_os = "macos")]
fn children_of(el: accessibility_sys::AXUIElementRef) -> Vec<accessibility_sys::AXUIElementRef> {
    use core_foundation::array::{CFArrayGetCount, CFArrayGetValueAtIndex, CFArrayRef};
    use core_foundation::base::CFRelease;

    let key = CFString::new("AXChildren");
    let mut raw: core_foundation::base::CFTypeRef = std::ptr::null();
    let err = unsafe {
        accessibility_sys::AXUIElementCopyAttributeValue(el, key.as_concrete_TypeRef(), &mut raw)
    };
    if err != accessibility_sys::kAXErrorSuccess || raw.is_null() {
        return Vec::new();
    }

    // Read through the C array API rather than CFArray<T>: the typed wrapper requires its element
    // type to implement core-foundation's conversion traits, and AXUIElementRef is a raw pointer
    // from a different crate, so it cannot.
    //
    // SAFETY: a successful copy hands us a +1 CFArrayRef of AXUIElementRef (what
    // kAXChildrenAttribute is defined to return). The child refs stay valid for the walk because
    // the array owns them and each child is retained by its parent element; we release only the
    // array, which is the reference we own.
    let mut out = Vec::new();
    unsafe {
        let arr = raw as CFArrayRef;
        let n = CFArrayGetCount(arr);
        for i in 0..n {
            let child = CFArrayGetValueAtIndex(arr, i) as accessibility_sys::AXUIElementRef;
            if !child.is_null() {
                out.push(child);
            }
        }
        CFRelease(raw);
    }
    out
}

/// Walk one element into an AxNode, bounded on BOTH depth and total element count.
///
/// `budget` is shared across the whole walk, not per-branch: a window with one pathological subtree
/// would otherwise pass a per-branch cap and still return tens of thousands of nodes. It feeds a
/// prompt, and this codebase has already shipped one context overflow.
#[cfg(target_os = "macos")]
fn walk(el: accessibility_sys::AXUIElementRef, depth: usize, budget: &mut usize) -> Option<AxNode> {
    if depth > MAX_DEPTH || *budget == 0 {
        return None;
    }
    *budget -= 1;

    let node = AxNode {
        role: attr_string(el, "AXRole").unwrap_or_else(|| "AXUnknown".into()),
        title: attr_string(el, "AXTitle").or_else(|| attr_string(el, "AXDescription")),
        value: attr_string(el, "AXValue"),
        bounds: None, // positions are a second round-trip per element; added when a caller needs them
        children: children_of(el)
            .into_iter()
            .filter_map(|c| walk(c, depth + 1, budget))
            .collect(),
    };
    Some(node)
}

/// Walk + prune one app into nodes. The shared core: the Tauri command serialises this, and
/// `structured_text` renders it. Returns empty when the grant is missing or the pid is gone —
/// both are ordinary outcomes, not errors.
#[cfg(target_os = "macos")]
pub fn tree_for(pid: i32) -> Vec<AxNode> {
    if !crate::permissions::accessibility_authorized() {
        return Vec::new();
    }
    // SAFETY: returns a +1 AXUIElementRef for the app, or null for a pid that isn't running.
    let app = unsafe { accessibility_sys::AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return Vec::new();
    }
    let mut budget = MAX_ELEMENTS;
    walk(app, 0, &mut budget).map(prune).unwrap_or_default()
}

/// Read a running app's accessibility tree as structured JSON.
///
/// UNTRUSTED: this is the content of other people's mail, messages and web pages. Callers fence it
/// as data — never as instructions, whatever it happens to say.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn read_app_tree(pid: i32) -> Result<serde_json::Value, String> {
    if !crate::permissions::accessibility_authorized() {
        // A plain, checkable signal rather than an error string the UI has to pattern-match. The
        // soft-ask chip turns this into an offer; nothing here prompts.
        return Ok(serde_json::json!({ "authorized": false, "nodes": [] }));
    }
    let pruned = tree_for(pid);
    Ok(serde_json::json!({
        "authorized": true,
        "elements": count(&pruned),
        "nodes": pruned,
    }))
}

#[cfg(all(test, target_os = "macos"))]
mod live_probe {
    /// DIAGNOSTIC — reads a REAL running app's tree so the structure claim can be checked against
    /// something other than a hand-built fixture. #[ignore]d; needs a live window and the
    /// Accessibility grant, neither of which exists in CI.
    ///
    ///   DOCENT_AX_PID=<pid> cargo test --lib live_probe -- --ignored --nocapture
    #[test]
    #[ignore]
    fn dump_live_tree() {
        let Ok(pid) = std::env::var("DOCENT_AX_PID") else {
            eprintln!("set DOCENT_AX_PID=<pid>");
            return;
        };
        let pid: i32 = pid.trim().parse().expect("pid should be a number");

        if !crate::permissions::accessibility_authorized() {
            eprintln!(
                "[ax] this process is NOT trusted for Accessibility — the grant belongs to whichever \
                 binary runs the call, so a cargo-test binary having none says nothing about the app."
            );
            return;
        }

        let out = super::read_app_tree(pid).expect("read should not error");
        let elements = out["elements"].as_u64().unwrap_or(0);
        eprintln!("[ax] pid {pid}: {elements} meaningful elements, truncated={}", out["truncated"]);

        // Roles only — the shape is the claim under test, and the values are someone's private mail.
        fn roles(v: &serde_json::Value, depth: usize, acc: &mut Vec<String>) {
            if let Some(arr) = v.as_array() {
                for n in arr {
                    let role = n["role"].as_str().unwrap_or("?");
                    let titled = n.get("title").is_some() || n.get("value").is_some();
                    acc.push(format!("{}{role}{}", "  ".repeat(depth), if titled { " •" } else { "" }));
                    if let Some(c) = n.get("children") { roles(c, depth + 1, acc); }
                }
            }
        }
        let mut acc = Vec::new();
        roles(&out["nodes"], 0, &mut acc);
        for line in acc.iter().take(30) { eprintln!("  {line}"); }
        eprintln!("[ax] (• = carries a title or value of its own)");
    }
}


// Non-macOS stub. The command is registered unconditionally — the ACL codegen reads the
// `generate_handler!` list line by line, so a `#[cfg]` attribute in there drops every command
// after it from the generated local allow-list. That failure is invisible at compile time and
// surfaces as a security test failing somewhere unrelated ("local main must reach keychain_get").
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn read_app_tree(_pid: i32) -> Result<serde_json::Value, String> {
    Err("reading an app's accessibility tree is only available on macOS".into())
}

/// Render a pruned tree as indented text a model can read.
///
/// Indentation is doing real work here, not decoration: it is the structure OCR destroys. A mail
/// row and the cells beneath it stay visibly one group, so "who sent the billing alert" is
/// answerable from the shape rather than from counting columns and hoping the counts line up.
#[cfg(target_os = "macos")]
pub fn render(nodes: &[AxNode], depth: usize, out: &mut String) {
    for n in nodes {
        // Role alone says nothing to a reader — skip rows that carry no text of their own, but
        // keep walking, because their children usually carry all of it.
        let label = match (&n.title, &n.value) {
            (Some(t), Some(v)) if t != v => format!("{t}: {v}"),
            (Some(t), None) => t.clone(),
            (None, Some(v)) => v.clone(),
            (Some(t), Some(_)) => t.clone(),
            (None, None) => String::new(),
        };
        if !label.trim().is_empty() {
            out.push_str(&"  ".repeat(depth));
            out.push_str(&label);
            out.push('\n');
            render(&n.children, depth + 1, out);
        } else {
            // Unlabeled but non-empty: don't spend a line on it, don't lose what's underneath.
            render(&n.children, depth, out);
        }
    }
}

/// The frontmost app's content as structured text, or None when AX can't supply it.
///
/// None is a normal outcome, not a failure: no Accessibility grant, a canvas-drawn app that
/// publishes no tree, a window whose contents are an image. Callers fall back to OCR — which reads
/// words accurately and only loses the shape.
#[cfg(target_os = "macos")]
pub fn structured_text(pid: i32) -> Option<String> {
    if !crate::permissions::accessibility_authorized() {
        return None;
    }
    let parsed = tree_for(pid);
    if parsed.is_empty() {
        return None;
    }
    let mut out = String::new();
    render(&parsed, 0, &mut out);
    // A couple of stray labels is worse than nothing — it reads as "I looked and saw almost
    // nothing", which is a misleading thing for the model to believe about a full window.
    if out.trim().chars().count() < 40 {
        return None;
    }
    Some(out)
}
