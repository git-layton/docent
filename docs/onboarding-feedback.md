# First-Run / Onboarding Feedback

Captured 2026-06-25 from the first real launch of a packaged build (v2.0.x).
**Status: tracked, not yet actioned.** These are observations + desired direction,
to turn into issues/tasks later.

## First-run experience

1. **Setup wizard did not appear on startup.** ✅ **FIXED (v2.0.4).** First launch
   had been deliberately changed to skip the wizard and land on an empty Home. Now
   the app **requires a connected model**: if none exists it opens setup and won't
   let you dismiss it until a model is connected (downloaded, detected, imported
   `.gguf`, or API). The first connected model becomes the default. This also
   recovers the "model downloaded but never connected" dead-end.

2. **Landed on Home with a chat tab already open — confusing.** The mix of the
   Home page *and* an already-open chat tab is disorienting on first run.
   - Desired: the **very first login ever** should drop straight into a **live chat
     with Alexis**.
   - If not chat, then it should be the **Home / new-tab page of your private
     space** — but not both at once.

3. **A Space is pre-created; it shouldn't be.** Default state should just be
   **"your space" with Alexis as the default agent** — no extra/pre-started space.

## Model setup & download

4. **Model picker shows too few options.** Expected the full settings view showing
   **many models with recommendations**; only a limited set appeared.

5. **Download is blocking with no progress feedback.** Got stuck on the download
   screen for a long time, unable to configure anything else meanwhile.
   - Desired: model download should be **non-blocking** and show **progress**
     (e.g. a small popup or an indicator in the top bar) so setup can continue in
     parallel.

6. **BUG — model download failed: `error decoding response body`.** ✅ **FIXED
   (v2.0.3).** A dropped connection mid-stream failed the whole transfer, and a
   retry truncated the `.part` and restarted from zero. `download_model` now
   resumes via a `Range` header and retries transient drops with backoff.

7. **BUG — app re-downloads a model that's already present.** ✅ **FIXED (v2.0.3).**
   A second download started even though the full `.gguf` already existed.
   `download_model` now short-circuits when the file exists and rejects a second
   concurrent fetch of the same file; the UI also guards re-entry.

8. **Wizard should use the Agent Forge icon.** The setup step leads with a generic
   icon; it should wear the Agent Forge mark/logo so first-run feels on-brand.

## Future (nice-to-have, not now)

- **Import an existing model from another folder.** Let the user point at a `.gguf`
  they already have elsewhere instead of only downloading into `~/AgentForge/models`.
  Skipped for now unless it turns out trivial.

## Desired direction (summary)

- First launch → **live chat with Alexis** in the user's default personal space.
- Don't pre-create spaces; default = **personal space + Alexis** only.
- Make model downloads **async + globally visible** (progress in top bar / popup).
- Surface the **full recommended model catalog** in setup.
- Fix the **`error decoding response body`** download failure.
