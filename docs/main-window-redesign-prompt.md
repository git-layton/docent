# Main-window IA redesign — design-session prompt

Status: **ready to run** · Date: 2026-07-14
Origin: July 14 IA discussion (left-sidebar roster, right-panel identity, space scoping).
Paste everything below the line into a fresh design session in this repo, or reference this file.

---

Redesign the main-window information architecture of Agent Forge to match the
single-assistant doctrine. This is a design task first — produce the IA and
mockups before touching code.

## Read first

- docs/alexis-sidecar-spec.md — especially §1–§4. The doctrine is binding:
  ONE private assistant (Alexis), no user-facing agent roster, receipts for
  everything, context chips on the composer, local-first. The ctrl+F sidecar
  overlay is BUILT (`dock_spotlight_right` in src-tauri/src/lib.rs); the main
  window has not caught up to it.
- src/types/omniTab.ts — Space/OmniTab data model. Space owns `tabIds`,
  `chatId`, `agentGoals`; `SpaceKind` is `'dm' | 'space'`; OmniTabType
  includes `'space-log'`.
- src/components/AppSidebar.tsx, OmniTabBar.tsx, ChatPanel.tsx,
  DockedAgentRail.tsx, StartPage.tsx, SpotlightBar.tsx — the surfaces being
  redesigned.
- docs/settings-ia-audit.md — how we've handled IA cleanup before.

## The problem

The main window still uses a Slack metaphor the doctrine rejected:

1. Alexis appears three ways at once: as a selectable "member" in the left
   sidebar's AGENTS section, as a docked chat panel on the right, and as the
   answerer behind the Home tab's ask bar. It is never clear which one is
   "the" conversation.
2. The left sidebar is organized as PEOPLE / AGENTS / SPACES — a roster view
   of a workspace that has one human and one agent. PEOPLE has one entry
   (you).
3. Spaces read as channels but behave as contexts. Unclear what a Space
   scopes: knowledge? the agent? tabs? all three?
4. The right panel's identity is unclear, and it coexists awkwardly with the
   left nav (e.g. the sidebar hamburger and the right panel collapse
   independently, with no model for why).

## Research grounding (justifies the committed decisions below)

- **Mental models**: CHI 2024 "Design Principles for Generative AI
  Applications" (Weisz et al.) — design for mental models and appropriate
  trust. Follow-up work on multi-agent tools (arXiv 2510.06224) finds users
  struggle to form coherent mental models when agency is distributed across
  multiple visible agents. A single named assistant with visible context is
  the strongest mental-model choice. The current triple-surface Alexis
  violates this even with one agent.
- **Conversation types**: NN/g's analysis of 425 assistant interactions found
  distinct conversation types (quick precise asks vs extended co-working)
  that want DIFFERENT surfaces. This is why "one conversation, two mounts"
  is legitimate: the overlay serves quick asks anywhere, a docked view
  serves long co-working sessions — same thread, different ergonomics.
  Industry has converged on the same shape (ChatGPT desktop's hotkey
  mini-overlay synced with the main app; Copilot/Claude docked companions).
- **Workspace switching**: Arc's Spaces show the pattern done right — a
  switch swaps the ENTIRE context (sidebar, pinned tabs, theme) instantly,
  with per-space color for orientation. Slack's Unified Grid re-architecture
  is the cautionary tale: hard walls between workspaces created painful
  context-switching once users lived in several, and Slack had to unify.
  Lesson: spaces switch totally, but search and Alexis's memory must reach
  ACROSS spaces (escape hatches over walls).
- **Transparency → trust**: NN/g trust patterns + the sidecar spec's own
  receipts doctrine. "What can she see right now" must be visible state
  (context chips), never implicit.

## Committed decisions (design within these; do not relitigate)

- **The roster dies.** No PEOPLE section, no AGENTS section. Alexis is not a
  "member" of anything; she is ambient. Do not design multiplayer — if real
  human collaborators ever arrive, note in one paragraph how the IA would
  stretch, but spend no layout on it.
- **Space becomes a context switcher, not a sidebar list.** Like switching
  Slack workspaces or Arc spaces: a switcher at the top or bottom of the
  window. Switching swaps the whole context — tabs, knowledge scope,
  standing goals, conversation thread. Propose what the left sidebar shows
  INSTEAD, organized around the user's work (current context's tabs,
  favorites, recent threads, knowledge), not around entities.
- **One conversation identity.** The thread, the composer component
  (ChatPanel mode="inline" + ChatInputBar), and the context model are ONE
  system regardless of where they render. The sidecar spec's live-sync
  contract (`chats-updated` broadcast, merge-on-persist, shared
  `activeChatId`) is a prerequisite.
- **Context chips are the visibility model.** In a space, a `Space` chip
  (tabs + knowledge, structured access) auto-attaches; over other apps, the
  `Screen` chip (OCR, perceptual). Chips are visible, additive, individually
  dismissible — they are how the user always knows what Alexis can see.
- **In-workspace reading is a tab.** Each Space's thread renders as a
  `space-log` tab in the center area — scrollback, receipts, artifacts from
  the same single conversation. It is the record, not a second chat.

## Decisions the session MUST make

- **Thread routing.** Every Space owns its own `chatId` (deliberate — no
  message bleed). When the user hits ctrl+F over Excel, which thread does
  the message land in? Recommended starting point: the sidecar opens in the
  shared active thread; the context chip doubles as the router (shows
  "→ Home", tap to switch space). Resolve the tension between "one
  conversation" and "per-space threads" explicitly.
- **Knowledge scoping.** Per-space with global fallback, or global with
  per-space pinning? Where does the user SEE the scope? (Cross-space recall
  must exist — see the Slack lesson above.)
- **`kind:'dm'` migration.** DM spaces likely collapse into "the
  conversation with Alexis." Say what migrates where, including
  `agentGoals` (currently keyed by agent id — a multi-agent vestige).
- **Home ask-bar routing.** It must not be a third chat. It may open the
  conversation pre-filled, or become pure search — pick one.

## Explicitly deferred (do NOT decide; design so either outcome works)

- **Mount count.** Whether the main window keeps a docked mount of the one
  conversation, or the ctrl+F sidecar overlay is the ONLY composer in the
  system (main window = pure workspace). This is gated on dogfooding: a
  week using only the sidecar (even inside the app) vs the docked panel.
  Deliver the design with the docked mount as a REMOVABLE module: the
  layout must not break if it is deleted.

## Constraints

- Consistency beats novelty: existing design language (dark theme, current
  chrome), existing components (ChatPanel mode="inline", ChatInputBar,
  OmniTabBar) — one chat UI to maintain, per the sidecar spec.
- Home/StartPage stays as the landing surface but must fit the new IA.
- One metaphor word. No "projects" AND "spaces" AND "contexts" — pick one
  and use it everywhere, including in code names for new components.
- Local-first; receipts for everything Alexis reads or does.

## Deliverables

1. Before/after IA map: every current left-sidebar and right-panel element →
   where it lives in the new design, or explicitly killed.
2. The navigation model in one paragraph: what the switcher switches, what
   persists across switches, where the single conversation lives, how
   cross-space search/recall works.
3. Annotated wireframe mockups: main window default state, the space
   switcher open, the sidecar summoned OVER the main window (chips visible),
   and the collapsed/minimal state. Match the existing visual style.
4. Component-level migration plan mapped to real files (AppSidebar,
   DockedAgentRail, StartPage, omniTab.ts model changes), ordered so each
   step ships alone, with the sidecar live-sync fix sequenced first.
5. Open product questions you could NOT resolve from the docs, each with a
   recommended answer.

## References

- Weisz et al., "Design Principles for Generative AI Applications," CHI 2024
  — https://dl.acm.org/doi/full/10.1145/3613904.3642466
- "Exploring Human-AI Collaboration Using Mental Models of Early Adopters of
  Multi-Agent Generative AI Tools" — https://arxiv.org/html/2510.06224v1
- Sharang Sharma, "Where should AI sit in your UI?" UX Collective —
  https://uxdesign.cc/where-should-ai-sit-in-your-ui-1710a258390e
- Slack Engineering, "Unified Grid: How We Re-Architected Slack for Our
  Largest Customers" —
  https://slack.engineering/unified-grid-how-we-re-architected-slack-for-our-largest-customers/
- Arc's spaces model overview — https://blakecrosley.com/guides/design/arc
- NN/g articles index (assistant conversation types; AI trust patterns) —
  https://www.nngroup.com/articles/
