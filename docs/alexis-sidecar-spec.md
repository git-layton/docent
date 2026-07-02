# Alexis Sidecar — Product Spec v1

Status: **agreed with owner, ready to build** · Date: 2026-07-02
Consolidates the July 1–2 design sessions. Mockups referenced by name live in the session transcript;
the four core ones: `alexis_sidecar_annotation_mockup`, `alexis_sidecar_full_composer_mockup`,
`overlay_v2_perception_glow_preview`, `overlay_v2_unified_composer_mockup`.

> Grounded in current code. The Sidecar is built FROM existing components (`DockedAgentRail`,
> `ChatPanel mode="inline"`, `ChatInputBar`), not alongside them — one chat UI to maintain.

---

## 1. The one-line thesis

**One private assistant (Alexis) that sees what you see, points at what she means, finds anything
you've touched, acts through reliable bridges, and proves everything with receipts — running on
your own hardware.**

## 2. Doctrine (governs every routing/design call)

- **One agent, task-scoped context.** No user-facing agent roster. Specialization lives internally
  (slash verbs, routing, future subagents). Single agent ≠ single giant prompt — see §9 Context diet.
- **Hands > Eyes > Fingers.**
  - **Hands** = structured bridges (AppleScript/SQL/IMAP/EventKit today, MCP servers tomorrow).
    Backbone: corpus access, background operation, milliseconds, token-free, local.
  - **Eyes** = screen perception (OCR + bounding boxes). Universal fallback + deictic asks
    ("help with THIS") + the annotation layer.
  - **Fingers** = synthetic clicking. Long-tail only, human-confirmed, added LAST (not in v1).
- **Never sneaky.** Hands act invisibly but report visibly — every read/action emits a receipt chip
  ("🔍 searched your Notes · 3 matched", "🖥 read your screen · on-device · 1,204 chars").
- **Local-first is the wedge.** Apple will ship context; they won't ship your auditable history.
  Memory + `/find` is the moat; clicking-first would force cloud-first and is rejected.

## 3. Surface: the Sidecar panel

- **Docked right-edge overlay panel** (not a tiling panel — never resizes the user's windows),
  with a **collapse-to-rail** slim state. Replaces the centered Spotlight card.
- Built by mounting `ChatPanel (mode="inline")` inside `DockedAgentRail`-style chrome in the
  overlay window. Hard prerequisite: store hydration/sync across windows
  (seed: existing `spotlight-chat-updated` event bus).
- **Capture crops out the panel strip** — kills the hide-during-capture blink permanently.
- **Focus contract:** closing/collapsing returns focus to the PREVIOUS app — never raises the
  Agent Forge main window (current behavior is a bug).
- Header: ember + Alexis · "seeing ●" live status · history · collapse.

## 4. Composer (full options, compressed)

- Slash commands ABSORB tool toggles: `/remind` `/task` `/note` `/files` `/find` (+ think/web
  behind `+` overflow). Visible essentials only: `+` · attach · mic · compact model pill · send.
- **Stackable context chips** on the composer (replaces the Chrome/Safari/Screen mode toggle):
  `Screen ●` / tab / file / memory — always visible, individually dismissible, additive.
- Replies keep the complete option set: action pills (confirmed actions) + quiet icon row
  (copy · speak · task · note · regenerate).
- File review flow (attachedDocs) preserved by construction via `ChatInputBar`; also reachable
  via `/files`.

## 5. Perception (Eyes)

- On-demand only. OCR via Apple Vision (`capture_screen_text`), frontmost-window crop (12k → ~2-3k
  chars). Returns `{text, thumb}`.
- **Ember edge glow** while reading (transparent, click-through, always-on-top window) +
  "Alexis is reading your screen" whisper pill.
- **Preview receipt** in the panel: collapsible thumbnail of the exact captured frame, captioned
  "the exact frame I read" + "read on-device · N chars · nothing left your Mac".
- **Cursor context at ask-time**: capture cursor position + nearby OCR text so "what's this?"
  resolves. Always-on mouse/click tracking REJECTED (privacy/permission cost).

## 6. Annotation layer (the pointing feature)

- Vision OCR already returns per-line bounding boxes → Alexis highlights regions on the REAL
  screen via the glow window: ember box + small tag ("this one — before 6pm").
- No synthetic input. Pointing without a mouse. This is the signature demo.

## 7. Actions (Hands) + receipts

- v1 verbs: Save to memory (git-committed, shipped), Save to Notes (shipped), `/remind`, `/task`,
  `/find`. All action chips are explicit-tap, structured-bridge, reversible.
- Every integration read/action emits a receipt chip inline in the conversation.
- **MCP client** (owner-approved): consume MCP servers as additional Hands.
  - Implementation: official TypeScript SDK; stdio servers spawned/managed from the Rust side
    (same pattern as llama-server/pty). Each server = one "hand" with an explicit grant in
    Settings; its tools flow into the existing capability registry.
  - Honest sizing: ~1–2 days for a solid client + settings UI. Not trivial, but multiplied by an
    ecosystem of hundreds of ready-made servers (GitHub, Slack, Drive, Linear…).
- Fingers (computer-use) explicitly OUT of v1.

## 8. `/find` — search as the memory demo

- One query fans out across: memory (semantic index), files/library, Mail, Messages, Notes.
- Results grouped by source with snippets; receipt chip shows what was searched, all on-device.
- Result actions: Open · Ask about this · pin to context (becomes a context chip).
- This is the user-facing payoff of the memory moat ("find that PDF Mom sent about the lease").

## 9. Context diet (local-model priority; independent of signing)

- Problem: `buildSystemPrompt` stacks ~15 sections ≈ 8–13k tokens pre-history; 32k local models
  are always full.
- Fix: relevance-gated sections (reuse gatekeeper intent) · global token budget from
  `contextLimit` (~30% system / 50% history / 20% headroom) · just-in-time retrieval over
  front-loading · frontmost-window OCR crop · rolling history compaction via `contextEvaluator`.

## 10. Build order

0. **Code signing** (self-signed cert in Tauri config, or Apple Developer ID $99/yr) — TCC grants
   currently die on every ad-hoc rebuild; prerequisite for verifying all screen work.
1. Sidecar shell: panel window + ChatPanel mount + store sync + focus contract + capture crop.
2. Perception feedback: glow window + preview receipt + frontmost crop.
3. Annotation layer (OCR bboxes → highlights).
4. Context chips + slash verbs (`/find` first — it sells the moat).
5. MCP client + Eyes & Hands settings page.
6. Context diet (parallel track — no signing dependency, measurable by token counts).

## 11. Rejected, with reasons (do not re-litigate)

- User-facing specialized-agent roster (industry-proven failure; specialization goes internal).
- Always-on mouse/click tracking (surveillance cost > value; ask-time cursor context instead).
- Interactive click-through preview (hall of mirrors; the real screen is the canvas).
- Clicking as backbone (physics: exclusivity, speed, compounding errors, viewport wall, forces cloud).
- Screen-in-app mirroring, Steam-style (hall of mirrors on one machine).
