# Canvas vs Code — IA design pass

**Status:** design / not yet built (July 2026)
**Problem owner:** the two "build software with Codey" surfaces are redundant and users can't tell which to pick.

---

## 1. The problem, in the code

The Home app grid (`StartPage.tsx` `apps[]`, ~L146–174) has **two tiles that both build software with Codey**:

| Tile | id | opens | copy |
|---|---|---|---|
| **Canvas** | `canvas` | `launch({ type: 'code-canvas', label: 'Untitled Canvas' })` | "Build apps & prototypes" |
| **Code** | `agentforge-code` | `useSpaceStore.openCodeCanvas()` | "Build with Codey" |

Both land on a Codey coding surface. The names don't tell you that **Canvas = generate a single sandboxed artifact** and **Code = work a real folder with files + commands**. That's the redundancy. Worse, "Canvas" is jargon — the user's own read was *"when I go to Canvas it's like create a new app."* That instinct is the fix.

## 2. What each surface actually is today

- **Canvas** (`CanvasPanel.tsx`) — a generative *artifact* surface. Codey emits HTML/JS; it renders live in a **null-origin sandboxed iframe** with a network-blocking CSP (`previewCsp`). Output persists to `useUIStore.savedApps` (db-backed) as `{ id, title, content, language, type: 'code', isStandalone, history[], updatedAt }`. Re-openable via `openDoc → launch({ type:'code-canvas', canvasContentId })`. **This is already 80% an "app factory"** — it just isn't named or surfaced like one.
- **Code** (`AgentForgeCodePanel.tsx` + `openCodeCanvas`) — a real **developer workspace**: open a folder, Codey reads/writes files, runs commands, researches the web; carries the coder-model nudge. High ceiling, developer-facing.

They aren't duplicates in *capability* — they're duplicates in *presentation*. One is a low-ceremony app generator; the other is a project IDE.

## 3. Target model

Reframe by **outcome**, not by surface name:

| | **Create app** (was "Canvas") | **Code** (unchanged role) |
|---|---|---|
| Question it answers | "Make me a thing that runs" | "Help me build this project" |
| Ceremony | None — describe it, get a running prototype | Open/attach a real folder |
| Output | A **saved, reopenable app** (sandboxed HTML) | Files on disk, git-tracked |
| Persistence | `savedApps` → first-class tile on Home | The folder is the source of truth |
| Audience | Everyone | Developers |
| Model nudge | — | Coder-model nudge (already built) |

Boundary rule of thumb for copy: **"Create app" makes something to *use*; "Code" is where you *develop*.**

## 4. What "first-class app" means — and what already exists

The user's ask: created apps should "work with all the DB and app logic we built previously and standalone tab/window logic, so it shows up as an app on the home landing page."

Almost all the plumbing exists:

- ✅ **Persistence** — `savedApps` in `useUIStore` (`db.set('savedApps')`, `loadSavedApps`/`persistSavedApps`).
- ✅ **Reopen-as-tab** — `launch({ type:'code-canvas', canvasContentId })` already rehydrates a saved artifact into its own Omni tab.
- ✅ **Standalone marker** — items already carry `isStandalone`; Codey's canvas is a standalone tab, not tied to a space.
- ⚠️ **Missing:** a saved app is only surfaced as a *count* ("N drafts" under the Canvas tile, `StartPage.tsx:400`) and in "Pick up where you left off." It is **not** a named, icon'd tile in the grid.

So "first-class" is mostly a **surfacing + naming** change, not new infrastructure.

## 5. IA changes

1. **Replace the "Canvas" tile with a "+ Create app" entry** — dashed-border "+" affordance, placed **first** in the grid (create actions lead). Same `code-canvas` launch, but the panel opens on a "What do you want to build?" prompt rather than a blank "Untitled Canvas."
2. **Add a "Your apps" section** to Home — render `savedApps.filter(type==='code')` as tiles, each reopening its app via the existing `canvasContentId` path. A saved app gets an optional `icon`/`emoji` and a real `name` (reuse the existing Save modal `saveAppData.title`).
3. **Sharpen the "Code" tile copy** → "Real development — open a folder, write & run code," icon stays `FolderGit2`. Now unambiguous next to "Create app."
4. **Retire the "Canvas" vocabulary** in user-facing copy (keep `type:'code-canvas'` internally to avoid a data migration).

## 6. Phased plan

**Phase 1 — de-redundant the grid (low risk, ~1 file).** In `StartPage.tsx apps[]`: rename `canvas` → "Create app" (`sub`, icon, "+" treatment, move to front); rewrite `agentforge-code` sub to "Real development…". No data/schema change. Immediately kills the "which do I pick?" confusion. *This is the slice to ship first.*

**Phase 2 — apps as first-class tiles.** Add `name`/`emoji` to the saved-app item (default from title). Add a "Your apps" `Section` on Home rendering saved `type:'code'` items as reopenable tiles (reuse `openDoc`). Add rename/delete affordances (delete already exists for savedApps).

**Phase 3 — the "Create app" opening.** Give `CanvasPanel` an empty-state prompt ("Describe the app you want…") that seeds Codey; on first successful generate, auto-open the Save-as-app step so it lands in "Your apps" without a manual save. Optional: a starter-template row.

**Phase 4 — boundary polish.** From "Create app," if Codey detects the user really wants a multi-file project ("needs a backend / real files"), offer a one-tap "Open this in Code" hand-off — the two surfaces reinforce instead of compete.

## 7. Open questions

- **One "+" or a picker?** Does "+ Create app" go straight to the generative canvas, or a tiny picker (App / Document / …)? Recommendation: straight to canvas; Document already has its own tile.
- **Do apps get their own OS window?** Today "standalone" = own Omni tab. True pop-out (`WebviewWindow`) isn't built. Tabs satisfy the ask now; native windows are a later option.
- **Naming:** "Create app" vs "New app" vs "Build" — leaning "Create app" (matches the user's language).

---

### Appendix — key references
- Grid tiles: `src/components/StartPage.tsx` `apps[]` (~L146–174), `live.sub` (L397–404), `openDoc` (L433).
- Canvas surface + sandbox CSP: `src/components/CanvasPanel.tsx` (`previewCsp`, `withPreviewCsp`).
- Saved-app store: `src/store/useUIStore.ts` (`savedApps`, `saveAppData`, `loadSavedApps`, `persistSavedApps`).
- Saved-app item creation: `src/App.tsx` (~L1297 create, ~L1316 save).
- Code surface: `src/components/AgentForgeCodePanel.tsx`; `src/store/useSpaceStore.ts` `openCodeCanvas` (~L307).
