# First-Run / Onboarding Feedback

Captured 2026-06-25 from the first real launch of a packaged build (v2.0.x).
**Status: tracked, not yet actioned.** These are observations + desired direction,
to turn into issues/tasks later.

## First-run experience

1. **Setup wizard did not appear on startup.** Expected an onboarding wizard on
   first launch; it never showed. (Possible regression or first-run detection not
   triggering on a fresh install.)

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

6. **BUG — model download failed: `error decoding response body`.** After a long
   wait, downloading **Llama 3.3 70B** (General, 41.5 GB) failed with
   `error decoding response body`.
   - Needs investigation — likely an HTTP/streaming or response-parsing issue in
     the model-download path (timeout, chunked/partial body, or a non-JSON error
     response being parsed as JSON). The size + long wait suggests a timeout or
     dropped connection mid-stream.

## Desired direction (summary)

- First launch → **live chat with Alexis** in the user's default personal space.
- Don't pre-create spaces; default = **personal space + Alexis** only.
- Make model downloads **async + globally visible** (progress in top bar / popup).
- Surface the **full recommended model catalog** in setup.
- Fix the **`error decoding response body`** download failure.
