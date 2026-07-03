# Alexis Sidecar — Product Spec v1

Status: **v1.1 — post expert-review (UX / design / a11y / AI-systems)** · Date: 2026-07-02
Consolidates the July 1–2 design sessions. §12 records the review board's findings and how v1.1
resolves them; sections above are amended inline where a finding is P0/CRITICAL. Mockups referenced by name live in the session transcript;
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
  overlay window.
- **ONE conversation, live-synced both ways** (owner requirement — the whole point of "one surface").
  Current state: overlay (`SpotlightBar`) and main app (`useChatStore`) ALREADY persist to the same
  db keys (`chats`/`messages`/`activeChatId`), but do NOT live-sync. Three concrete bugs to fix:
  (a) **No live reload** — main window ignores the overlay's `spotlight-chat-updated`; neither emits
  a reciprocal event. Fix: a single `chats-updated` broadcast both windows emit-on-write and
  listen-to → reload from db (debounced). (b) **Clobbering** — `useChatStore.persist()` full-
  overwrites from stale in-memory state, can wipe overlay-written messages. Fix: merge-on-persist
  everywhere (the overlay's byId merge is the model), or route both through one owner. (c) **Drift/
  new-chat-on-summon** — overlay jumps to most-recent (`storedChats[0]`) instead of the shared
  `activeChatId`, and sends with no active chat spawn a fresh one. Fix: overlay honors shared
  `activeChatId`; "New chat" is explicit-only. Net: chat in the popup, see it in the main window,
  and back — same thread, no dupes.
- Hard prerequisite for the shared `<ChatPanel>` mount, but the sync fix (above) is valuable and
  shippable on its own, before the full component share.
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

---

## 12. Expert review board (July 2) — findings & resolutions

Four specialists audited v1 against the code. Converged action list:

### Security & correctness (CRITICAL — some affect SHIPPED v2.0.15)
- **S1. Fence screen OCR as untrusted.** Shipped screen-read injects OCR unfenced with "use it to
  answer"; the frontmost window can be a webpage/DM → prompt-injection→action chain (`forge:action`
  auto-apply). Add `'screen'`→`untrusted-external` in `trust.ts`; fence like mail/web; strip
  auto-apply from any turn containing untrusted context + annotate the chip "prompted by on-screen
  content". Same for MCP tool results → route saves through the gatekeeper quarantine path. *(task #10)*
- **S2. Annotation grounding.** OCR bboxes are valid only at capture time. Before drawing any
  highlight: re-OCR the target crop + fuzzy-match the line; threshold on Vision per-observation
  confidence and refuse (say so) below it; auto-expire ≤5s; kill on frontmost-app/window-move
  (NSWorkspace notifications). Wrong deixis is worse than none. Also: Alexis can't see the strip
  behind her own panel — she must say "I can't see the area behind me."

### Local-model alignment (from AI-systems review)
- **A1. Never let the local LLM route or parse slashes.** Slash verbs parse deterministically in
  the composer before the LLM; gatekeeper regex does implicit routing; LLM only extracts args.
- **A2. Constrained decoding.** Emit ALL actions via GBNF/json_schema through llama-server → ~100%
  parse on 32B/70B. ~1 day, huge reliability win.
- **A3. `/find` = zero-LLM.** Render grouped results as structured UI straight from the search
  layer; LLM enters only on "Ask about this" (one pinned result). Faster, deterministic, better demo.
- **A4. Token budget, not char budget.** Enforce §9 with real `/tokenize` counts + priority hard-drop
  list + per-turn telemetry. Tool-RAG MCP tools (top-k per turn) from day one, not all servers at once.

### UX (evidence-based)
- **U1. Slash discoverability.** `/` opens inline autocomplete w/ descriptions; natural language
  maps to the same verbs ("remind me…" → `/remind`, identical chip); rotating ghost-text hints.
- **U2. Generation latency design.** Staged status (read → thinking → writing), stream from first
  token, tok/s-based estimate, always-visible Stop, collapse-and-notify for long runs.
- **U3. "Seeing ●" mis-signals surveillance.** Default "idle / eyes closed"; pulse only during
  capture; chip label "Screen — reads when you send." (Also a designer + a11y concern.)
- **U4. Receipt habituation + jargon.** Tiered salience (quiet for routine, emphasized for
  first-time/new-scope); plain language; never the word "receipt" in UI. `/find` shows per-source
  status incl. "not searched — grant access" (no silent dropout).
- **U5. Just-in-time permissions**, one concept per session; "What can Alexis see?" page.

### Design (push-forward)
- **D1. Bet on pointing** — bind highlights to streaming token timing (<300ms), re-flash on hover
  of the phrase in the panel, numbered 1-2-3 real-screen walkthroughs, one-key export of the
  annotated frame (self-marketing).
- **D2. Ship the Ledger** — persist every receipt into a browsable, `/find`-able, git-committed
  audit log ("everything Alexis has seen and done, forever"). Doctrine → headline feature.
- **D3. Glow on a budget** — full perimeter glow only first-run/new-app/sensitive; steady state =
  header dot + whisper. **Reserved color: ember = eyes, purple = hands.** One ambient signal at a time.
- **D4. Demote smug copy** — "notice I'm not in it" is first-run only; steady caption is terse
  metadata. Ember mark stays static, with rare meaningful motion (travels panel→highlight to show
  causality); never idles/emotes.

### Accessibility (P0 = v1 blockers)
- **X1. Text-mirror every annotation** into an `aria-live="polite"` region ("Pointing at: 'before
  6pm' — Mail"). The OCR line you box IS the accessible text. *(1.1.1, 1.3.3)*
- **X2. Status live region** (`role="status"`) for receipts/capture/save; emoji `aria-hidden` +
  text alt. *(4.1.3)*
- **X3. Focus contract vs VoiceOver.** Non-activating panel won't appear in Cmd-Tab/VO chooser →
  hotkey summon IS the entry point (must focus composer), Esc returns focus to prior app, hotkey
  remappable (⌘⇧F collides). Copy Spotlight.app. *(2.4.3, 3.2.1)*
- **X4. Full keyboard operability** — hover-only action row needs `focus-within`; dropdowns need
  roles + arrow-nav; slash menu = combobox; icon buttons need `aria-label`. *(2.1.1, 4.1.2)*
- **X5. `prefers-reduced-motion`** (WKWebView honors macOS Reduce Motion in every window incl. the
  glow) → static border, no breathing/bounce/pulse. Plus `prefers-reduced-transparency`/`-contrast`
  → solid panel + high-contrast annotation variant. Target size ≥24px; type floor ≥11px; audit
  `#8a8a92`-class contrast on non-base washes. *(2.3.3, 1.4.11, 2.5.8)*

### Amendments to sections above
- §3 header: replace persistent "seeing ●" with idle-default eye state (U3/X-trust).
- §4: add slash autocomplete + NL-mapping + `+` menu parity (U1/A1/X4).
- §6: add grounding verification + expiry + text-mirror + reduced-motion (S2/X1/X5); pointing
  sharpened per D1.
- §7: MCP results fenced untrusted (S1); receipts tiered + Ledger (U4/D2).
- §8: `/find` zero-LLM structured render + per-source status (A3/U4).
- §9: token-based enforcement + telemetry (A4).
- §10 build order insert: **0.5 security fencing (S1) before any new screen work**; a11y baseline
  (X1–X5) is acceptance criteria for each surface, not a later pass.

### Confirmed sound (no change)
- §11 rejections match research consensus (clicking-as-backbone, agent roster) — AI review concurs.
- Local-first thesis, receipts-as-grammar, and Hands>Eyes>Fingers doctrine validated by all four.
