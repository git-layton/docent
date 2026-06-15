# Vision / Image Understanding — Design

Status: **draft for review** · Author: pairing session · Date: 2026-06-14
Scope: a new **Image Understanding** setting — the mirror of the existing **Image Engine** — that you
configure once with a **vision model** (cloud *or* local). After that, attaching an **image** (photo,
screenshot, receipt, chart) Just Works on **any** chat model, even text-only local GGUFs. Vision is a
**capability/service you configure in settings**, decoupled from the chat model — not a per-agent
on/off toggle (a toggle would be a no-op on a text-only model).

**Resolved with owner (2026-06-14):**
- **v1 ships cloud + local together.** Cloud (Gemini default) is JS-only; local (multimodal Gemma 3 +
  `--mmproj`) needs Rust. Treated as two workstreams behind one shared setting, not sequential phases.
- **Native-first routing.** If the active chat model can already see (e.g. GPT-4o), send the image
  straight to it (full fidelity). The configured Image Understanding model is the **fallback for
  text-only chat models** only.

> Grounded in the current code. The cloud workstream is small (mirrors the Image Engine); the local
> workstream is the real lift (Rust `--mmproj` + projector download). Both land into the same panel.

---

## 1. Goals / non-goals

**Goals**
- G1 — *Universal*: a user can attach an image to **any** chat model (incl. text-only local GGUFs)
  and get a useful answer.
- G2 — *Full fidelity when possible*: if the active model can natively see (cloud vision model, or a
  local server launched with a projector), send the **actual pixels** — don't downgrade to a caption.
- G3 — *Zero-config default*: works out of the box for users who already have a Google/OpenAI key
  (the Image Engine already nudges for one), with no provider form to fill in first.
- G4 — *Private option*: a fully-local, free, offline path that never sends the image off-device.
- G5 — *Honest UI*: never show an affordance that silently fails; the composer reflects what will
  actually happen.

**Non-goals (for now)**
- Not image *generation* — that already exists (`appSettings.imageProvider`, `mode==='image'`); this
  is image *understanding*. They're siblings, configured the same way.
- Not video/audio.
- Not a per-agent permission toggle for vision (see rationale in §3).

---

## 2. Current state (what we build on)

| Concern | Today | File |
|---|---|---|
| Attach images | `handleChatFileUpload` → `attachedDocs[{isImage,content:dataURL}]` | `src/App.tsx:890` |
| Native vision formatting | `formatMessage()` emits Google `inlineData` / Anthropic `image` / OpenAI `image_url` parts | `src/services/llm.ts:378` |
| Vision detection | `supportsVision(modelId)` substring heuristic; `modelSupportsVision(model)` wrapper | `src/services/llm.ts:28` |
| Hard gate today | throws *"does not have vision capabilities"* if images + non-vision model | `src/services/llm.ts:364` |
| Composer gating | docs-only `accept` + tooltip + Eye badge on non-vision models | `src/components/ChatInputBar.tsx` |
| **Image-gen provider (the template)** | `appSettings.imageProvider/imageModelId/imageEndpoint`; key resolved from `integrations`/`models`; branch in `generateTextResponse`; settings UI | `useSettingsStore.ts:41`, `llm.ts:320`, `ProfileSettingsModal.tsx:534` |
| Local engine | `start_local_model(model_path, port)` spawns bundled `llama-server` (llama.cpp, arm64-only) with **fixed args, no `--mmproj`** | `src-tauri/src/lib.rs:2649` |
| Model download | `download_model(url, filename)` — **one** GGUF, HTTPS-only, `is_safe_gguf_name` guard | `src-tauri/src/lib.rs:2588` |
| Catalog | text `-it` GGUFs; **Gemma 3 12B/27B are natively multimodal** (we ship the text projector-less build today) | `src/data/modelCatalog.ts` |

**Key reuse wins:** the Image Engine is a complete, working template for "a media provider configured
in settings, keyed off existing integrations, branched inside `generateTextResponse`." Native cloud
vision *already works* via `formatMessage` — we only need the **text-only fallback** and the
**routing** around it. The local engine is llama.cpp, which *does* support vision; we just don't pass
the projector yet.

---

## 3. The core decision: vision is a *capability*, not a *permission*

Your existing tools (browser, web_search, calendar) are **permissions** — actions the agent chooses to
invoke, gated for trust/scope. Toggling them per-agent is meaningful. **Vision is different**: it's
whether a model can *perceive* a modality. A toggle on a text-only model is a lie — flip it on, nothing
happens. So vision is modeled as a **service the app provides**, auto-applied, not an agent toggle.

There are two physical ways to understand an image; the design uses **both**, preferring fidelity:

1. **Native passthrough (full fidelity, G2)** — the active chat model sees the pixels. Works today for
   cloud vision models; works locally once the server has a projector (Phase 2).
2. **Describe-and-inject (universal fallback, G1)** — a configured **Vision Provider** turns the image
   into rich text (caption + OCR + layout notes); that text is injected into the chat model's context.
   Makes images work with *every* model, at the cost of fidelity (the chat model reads a description,
   not pixels).

---

## 4. The Vision Provider (mirrors the Image Engine)

New `appSettings` fields, shaped exactly like the image-gen ones:

```ts
// useSettingsStore.ts — appSettings
visionProvider: 'auto' | 'none' | 'google' | 'openai' | 'local' | 'custom';  // default 'auto'
visionModelId: string;     // 'gemini-2.5-flash' | 'gpt-4o-mini' | local model id
visionEndpoint: string;    // for 'local' (127.0.0.1:port) / 'custom'
```

Key resolution reuses the Image Engine logic verbatim (Google/OpenAI key from `integrations` or any
matching `models[].apiKey`). No new credential storage.

**`describeImage()` — new in `llm.ts`, modeled on the `mode==='image'` branch:**

```ts
export async function describeImage({
  dataUrl, mimeType, provider, modelId, endpoint, apiKey, prompt, signal,
}: DescribeImageArgs): Promise<string> {
  // google  → generativelanguage …:generateContent with inlineData (same shape as formatMessage)
  // openai/custom/local → POST {endpoint}/chat/completions with an image_url content part
  // returns plain text: a caption + any OCR'd text + salient layout, bounded to ~a few hundred tokens
}
```

The default `prompt` asks for: a one-line caption, a verbatim transcription of any text (OCR), and
notable structure (tables/UI/chart axes) — tuned so the injected text is maximally useful to a blind
chat model.

---

## 5. Auto-routing (the "easy default", G3)

A single resolver decides, per send, what happens to attached images — keyed off the **active chat
model** and the configured provider:

```
resolveVision(activeModel, appSettings, integrations):
  if modelSupportsVision(activeModel)                  → 'native'    // G2: send pixels, no extra call
  if visionProvider == 'none'                          → 'blocked'   // today's graceful gate
  if visionProvider == 'auto':
      if a Google key exists  → 'google'  (gemini-2.5-flash, free tier)   // zero-config default
      elif an OpenAI key      → 'openai'  (gpt-4o-mini)
      elif a local vision model is installed → 'local'
      else                    → 'offer-setup'           // one-tap: connect Gemini / download local
  else                                                 → that explicit provider
```

- **Native** → unchanged passthrough in `formatMessage` (full fidelity).
- **google/openai/local/custom** → for each attached image, `describeImage(...)`, then fold the result
  into the existing `attachedContext` as `[IMAGE: <name>]\n<description>` so it flows to *any* model.
  Replaces the hard `throw` at `llm.ts:364`.
- **offer-setup** → composer shows a one-tap chip ("📷 Enable image understanding — Gemini (free) or
  local"), falling back to today's docs-only gate until configured.

**Wiring point:** resolve at **send time** inside `generateTextResponse` (the model is known there, and
a conversation can switch models). Cache descriptions by image content hash so re-describing doesn't
happen on every turn of a multi-turn chat.

---

## 6. The local path (G4) — multimodal Gemma 3, not a second model

llama.cpp's `llama-server` does vision via `--mmproj <projector.gguf>` (libmtmd) and then accepts
OpenAI-style `image_url` parts on `/v1/chat/completions`. The elegant local win: **Gemma 3 (4B/12B/27B)
is natively multimodal** — the catalog already recommends Gemma 3 12B/27B as text models. Adding the
CLIP **mmproj projector** for the model the user already downloaded upgrades that *same* model to see —
**no second model, no RAM doubling**, native fidelity locally.

Required changes (Rust + catalog):
1. **`start_local_model`** ([lib.rs:2649](../src-tauri/src/lib.rs)) — accept an optional `mmproj_path`
   and append `["--mmproj", path]` when present. Small, backward-compatible.
2. **Download the projector** — `download_model` is already generic (HTTPS + `.gguf` name guard); just
   fetch the `*-mmproj-*.gguf` alongside the model. Add `mmprojFilename`/`mmprojUrl` to `CatalogModel`.
3. **Catalog** — add `vision?: boolean` + `mmprojUrl?`/`mmprojFilename?` to the Gemma 3 entries (and
   optionally add a small dedicated VLM like Qwen2.5-VL-3B for low-RAM users). `supportsVision` then
   lights them up by id automatically.
4. A `Model` gets `mmprojPath?`; when present, the app launches with the projector and the model is
   `native` in §5's resolver.

Lifecycle note: running a *separate* local VLM alongside the chat model risks RAM exhaustion (there's
already a hibernation/SIGSTOP system). Preferring a **natively-multimodal chat model** sidesteps this
entirely. If a separate VLM is used, spin it up on demand and SIGSTOP it when idle.

---

## 7. Trust / privacy (aligns with the capabilities doc §3)

- A composer-attached image is **`trusted-local`** (user-provided); its description is trusted-local.
- An image originating from **untrusted-external** content (e.g. pulled from a web page in the browser
  panel) keeps that tier — its description is untrusted data, never instructions, wrapped in the
  untrusted delimiter when injected.
- **Cost/privacy governance** (same doctrine as passive memory): the **foreground, user-initiated**
  image attach may use the configured cloud provider — it's visible and expected. But `'auto'` only
  *silently* picks a cloud provider if the user **already** has that key; otherwise it offers setup
  rather than reaching out. A privacy-first user picks `'local'` and nothing leaves the device.
- Surface the choice plainly: when a cloud provider will see the image, the composer/attachment shows a
  small "described via Gemini" note so it's never a silent exfiltration.

---

## 8. Build plan — v1 = both workstreams behind one setting

v1 delivers the **Image Understanding** panel with **both** cloud and local backends. They're two
workstreams of very different size; natural build order is A → B, but both ship in v1.

**Shared (the visible feature):**
- `visionProvider/visionModelId/visionEndpoint` in `appSettings` (clone of `imageProvider/*`).
- **Image Understanding** settings panel, cloned from the Image Engine UI in `ProfileSettingsModal`.
- The §5 resolver (native-first) + `describeImage()` + replace the `llm.ts:364` throw with the
  describe-and-inject fallback + description caching by image hash (load-bearing — avoids
  re-describing every turn).

**Workstream A — Cloud (JS only, small).** Wire `describeImage()` for Google/OpenAI/custom, keyed off
existing integration keys; Gemini `2.5-flash` default. This alone makes images work on every model for
anyone with a key. Mostly mirrors the existing `mode==='image'` branch.

**Workstream B — Local (Rust, the real lift).** `--mmproj` arg in `start_local_model`
([lib.rs:2649](../src-tauri/src/lib.rs)); fetch the projector via the existing `download_model`; add
`vision`/`mmprojUrl`/`mmprojFilename` to the Gemma 3 catalog entries; `Model.mmprojPath`. Delivers the
private, offline, on-device path the owner picked — reusing the *same* recommended model (no second
model, no RAM doubling).

**Deferred (post-v1 polish):** per-model manual vision override (for VLMs the heuristic misses);
one-tap "enable image understanding" setup chip; "read via &lt;model&gt;" provenance note on cloud
reads; spin-up/down lifecycle if a *separate* (non-Gemma) VLM is ever added.

Each workstream is independently reviewable/revertable. A is the quick unlock; B is the differentiator.

---

## 9. Decisions

**Resolved (2026-06-14):**
1. **Backends in v1** — **cloud + local together** (owner).
2. **Native vs configured model** — **native-first**: a vision-capable chat model sees the image
   directly; the Image Understanding model is the fallback for text-only chat models only (owner).
3. **Default cloud model** — `gemini-2.5-flash` (cheap, strong OCR, free tier).
4. **Local: ship vs download the projector** — **download-on-use**, mirroring model downloads (avoids
   app bloat).
5. **Local model** — **multimodal Gemma 3** (reuse the model already downloaded; no second process, no
   RAM doubling). Stay Gemma-only for v1; revisit a tiny dedicated VLM (e.g. Qwen2.5-VL-3B) only if
   low-RAM demand appears.
6. **Where the description is injected** — `[IMAGE: …]` block in `attachedContext` for v1.

**Still open:**
- Naming of the user-facing panel: "Image Understanding" (symmetric with "Image Engine") vs "Vision".
- `'auto'` provider behavior: silently use an *existing* cloud key, or always require an explicit
  pick in the panel? (Privacy doctrine in §7 leans toward: only silent if a key already exists.)
```
