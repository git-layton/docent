# Image Library & Gallery — Design

Status: **implemented** · Author: pairing session · Date: 2026-06-16
Scope: a searchable, timestamped, **scope-aware** home for every image the user generates or attaches.
The guiding idea: **a gallery is a *view* over a scope-aware search index, not a separate system.**
That dissolves the "own section vs. space-scoped" question — the same index powers a global Home
gallery and a per-Space/DM gallery; *where* you open it decides what it shows.

> Built on top of the Image Understanding (vision) feature — see [vision-understanding-design.md](vision-understanding-design.md).
> That feature's `describeImage` is the **indexer**: every image's caption/OCR becomes its search text.

---

## 1. Goals / non-goals

**Goals**
- G1 — *Universal capture*: every image the user **generates** or **attaches** to a chat is saved
  automatically (owner decision: auto-save, opt-out, local-only).
- G2 — *Findable by content*: images are searchable by **what's in them** (caption + OCR), not just a
  filename — via the existing omni-bar search, globally and per-Space.
- G3 — *Browsable by time*: a Gallery surface to scroll a Space's (or all) images newest-first.
- G4 — *Scope-aware, one implementation*: the same Gallery works in any Space/DM (that Space's
  images) and on global Home (everything). No duplicated surfaces.
- G5 — *Quiet*: no clutter — the Gallery affordance appears only where there are images to show.

**Non-goals (for now)**
- No semantic/embedding image search — v1 is lexical over the description text. (The Rust semantic
  index is a separate effort; do not touch it — see [[project_search_handoff]].)
- No capture of browser screenshots / external images yet (future; see §7).
- No albums, tagging, editing, or bulk export. No dedicated top-level nav section (it's a tab/app).

---

## 2. The arc (how the pieces compose)

```
generate / attach an image
        │
        ▼
 saveImageToLibrary()  ──►  savedApps  (persisted, timestamped, space-tagged)
        │                        │
        │ (background)           │
        ▼                        ▼
 describeImage()          buildSearchCorpus()  ──►  omni-bar search  (global + per-Space, thumbnails)
   = the description              │
   = the search text              ▼
                            GalleryPanel  (browse-by-time, scope-aware grid + lightbox)
```

Index first; search and gallery are both **views** over the same `savedApps` image records.

---

## 3. Data model

Image records live in `savedApps` (`useUIStore`, already persisted via `hydrateSavedApps`/
`persistSavedApps`). An image entry:

```ts
{
  id: string;
  type: 'image';
  content: string;        // data URL (the image itself)
  title: string;          // 'Generated Image' | 'Attached Image' | name
  name?: string;
  source: 'generated' | 'attached';
  spaceId?: string;       // the Space it was created/attached in (drives scoping)
  description: string;    // vision caption + OCR — the SEARCH TEXT (filled in async, best-effort)
  updatedAt: number;      // ms epoch — timeline ordering
}
```

Reusing `savedApps` (rather than a new collection) means images inherit persistence, the existing
`type:'image'` canvas rendering, and the recent-docs surfaces for free.

---

## 4. Auto-save (G1) — `saveImageToLibrary(src, meta?)` in `App.tsx`

- **Generated images** call it (as before) with `source:'generated'`.
- **Attached images** are captured in the chat send handler: after the user message is built, each
  image attachment is saved with `source:'attached'` + its filename/mime.
- **De-duped by content** — identical `content` is not saved twice (so the same image riding along
  multiple chat turns doesn't pile up).
- **Space-tagged** — `spaceId = activeSpaceId` at save time.
- **Description is best-effort & backgrounded** — after saving, a fire-and-forget task resolves a
  Vision Provider (`resolveVisionRoute`) and runs `describeImage`, then patches `description` into the
  record. No vision provider ⇒ the image is still saved and openable, just searchable by title only.
  `describeImage` is content-hash cached, so a description computed during a chat send is reused here.

---

## 5. Search (G2) — `searchCorpus.ts` + `universalSearch.ts` + `OmniSearch.tsx`

- `SearchDoc` gained `kind: 'Image'` and an optional `image?: string` (thumbnail src; displayed,
  never matched).
- `buildSearchCorpus` emits each image as an `Image` doc: `body = description` (the searchable text),
  `image = content` (thumbnail), `sub = 'Attached image' | 'Generated image'`, `timestamp`.
  - **Scope**: images surface in **global** scope (all) and in **Space** scope when
    `image.spaceId === scope.spaceId`.
  - **Bug fixed**: images are excluded from the generic `Doc` loop, which previously dumped the
    **base64 blob into the searchable body** — useless noise that now never happens.
- `OmniSearch` renders the thumbnail in the result row (falling back to an `Image` icon); clicking an
  image hit opens it (`StartPage.runSearchDoc` → `openDoc`, which handles `type:'image'`).

---

## 6. Gallery surface (G3, G4, G5) — `GalleryPanel.tsx` as an "app"

- A new **OmniTab tool tab**: `ToolTabId` gained `'gallery'`; `App.tsx` renders
  `<GalleryPanel spaceId={tab.spaceId} />`; `OmniTabBar` shows an Images icon.
- **One component, scope by where it's opened**: `spaceId` of `space-home` (or none) ⇒ **global**
  (all images); a real Space ⇒ that Space's images. Opening the Gallery app inside a Space tags the
  tab with that Space (via `launch`), so the per-Space and global galleries are the same code.
- **Auto-shown when images exist (G5)**: the StartPage launcher computes `hasImagesInScope` and
  filters the Gallery tile out of `visibleApps` unless the current scope has images. Empty Spaces
  don't show a Gallery tile. (It remains reachable via omni-bar search regardless.)
- UI: newest-first responsive grid of thumbnails; click opens a lightbox showing the full image, its
  source, and its description (or a nudge to enable Image Understanding if none yet).

---

## 7. Privacy & deferred work

- **Privacy**: local-only. Auto-save is on by default (owner choice) and opt-out. A description is
  only fetched if a Vision Provider is configured; per the vision doctrine, `'auto'` uses an
  already-connected key and never invents credentials.
- **Deferred / future**:
  - Capture **browser screenshots / preview screenshots** into the library (ties into the
    preview-observation loop — a screenshot is just another image source for `saveImageToLibrary`).
  - **Semantic** image search once the Rust embedder effort lands (compose, don't replace, the lexical
    layer).
  - Scale: content-hash de-dupe (instead of full-string compare) and grid virtualization if libraries
    grow large.
  - Gallery niceties: delete-from-gallery, "open in canvas", filter by source, date headers.

---

## 8. Decisions (resolved)

1. **Capture scope** — auto-save **attached + generated** (owner, 2026-06-16).
2. **Surface** — Gallery is an **openable app/tool tab**, **auto-shown when the scope has images**
   (owner). Not a pinned-everywhere tab; not a dedicated top-level section.
3. **One implementation** — gallery = a scope-aware view; global vs. per-Space is decided by the tab's
   `spaceId`, not by separate components.
4. **Search backend** — lexical over the **description** for v1; base64 never enters the search body.
5. **Storage** — reuse `savedApps` (`type:'image'`) rather than a new store.

---

## 9. Touch points (files)

- `src/App.tsx` — `saveImageToLibrary` (capture + background describe), attached-image capture in the
  send handler, Gallery tool-tab render branch.
- `src/components/GalleryPanel.tsx` — the surface (grid + lightbox).
- `src/services/searchCorpus.ts` — `Image` corpus entries (description as body, thumbnail, scope).
- `src/services/universalSearch.ts` — `SearchKind` `'Image'` + `SearchDoc.image`.
- `src/components/OmniSearch.tsx` — thumbnail in results + `Image` icon.
- `src/components/StartPage.tsx` — Gallery launcher app + `hasImagesInScope` gating + `Image` result case.
- `src/components/OmniTabBar.tsx` — gallery tab icon.
- `src/types/omniTab.ts` — `ToolTabId` `'gallery'`.
- Tests: `src/tests/services/searchCorpusImages.test.ts`.
