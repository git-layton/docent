# Releasing & auto-update

Docent updates itself in place. On launch it polls a public `latest.json`, and when a newer version
exists it offers a one-click **Install & restart**. You ship by pushing a git tag.

**Read the next section before you cut anything.** Releasing spans three repos, and pushing a tag to
the obvious one silently does nothing.

---

## The three-repo layout

| Repo | Visibility | Role | Has runner? | Has secrets? |
| --- | --- | --- | --- | --- |
| `git-layton/docent` | public | **Development.** All code + CI lives here. | ❌ none | ❌ none |
| `git-layton/agent-forge` | private | **The release machine.** Builds, signs, notarizes, publishes. | ✅ `AgentForge-MacRunner` | ✅ all 9 |
| `git-layton/docent-releases` | public | **The updater feed.** Installed copies poll it. Assets only, no source. | — | — |

```
  you: npm run release -- patch
        │
        ├─► push main + tag ──► docent          (CI: typecheck/lint/test/build on macos-latest)
        │
        └─► push tag ────────► agent-forge      (Release: self-hosted runner on your Mac)
                                    │
                                    │  build → Developer ID sign → notarize → updater-sign
                                    ▼
                              docent-releases    ──►  latest.json  ──►  installed copies
```

The split is deliberate: `agent-forge` is the frozen repo that still holds the self-hosted runner
registration and every signing secret. `ci.yml` is guarded with
`if: github.repository == 'git-layton/docent'` so pushes to `agent-forge` never run (or email) CI.

### ⚠️ The trap: a tag on `docent` queues forever and never errors

`release.yml` is `runs-on: self-hosted`. The only runner is registered to **`agent-forge`**, so a
`v*` tag pushed to `docent` creates a Release job that sits **queued indefinitely** — it never starts,
never fails, never notifies. Meanwhile `docent`'s CI goes green and everything *looks* fine.

> **Green CI on `docent` does not mean a release shipped.** It only means the code compiles.

This is not hypothetical: on 2026-07-21, `v2.11.0` sat queued 2h18m and `v2.11.1` 1h11m before anyone
noticed. Neither ever built. Always confirm the run on **`agent-forge`**, and confirm the release
actually appears in `docent-releases`.

`scripts/release.mjs` handles this for you (fixed 2026-07-21): it pushes code to the dev remote,
then pushes `main` **and** the tag to `agent-forge`. It finds that remote by URL rather than by name
— it's `origin` on one machine and `agent-forge` on another — and hard-fails with instructions if no
remote points there, rather than "succeeding" into a build that never happens.

Before that fix the script ran a bare `git push --follow-tags`, which follows `main`'s upstream to
`docent` only. That is exactly how v2.11.0 and v2.11.1 got stranded.

---

## Cutting a release

```sh
# 1. Verify green locally first — the build takes ~4-14 min on the runner, so fail fast here.
npm run release:check          # typecheck && lint && test && build

# 2. Bump + commit + tag + push (to BOTH remotes — the script does this).
npm run release -- patch       # or: minor | major | 2.12.0 | patch --dry-run

# 3. Watch the run that matters — on agent-forge, not docent.
gh run watch $(gh run list --repo git-layton/agent-forge --workflow=release.yml \
  -L1 --json databaseId --jq '.[0].databaseId') --repo git-layton/agent-forge --exit-status

# 4. Confirm the artifact is really live. Never skip this — a green run is not a shipped release.
gh release list --repo git-layton/docent-releases --limit 3
curl -sL https://github.com/git-layton/docent-releases/releases/latest/download/latest.json
```

Check your working tree before releasing. This repo sometimes has more than one agent session editing
it at once, and `npm run release` commits **only** the five version manifests — so unrelated
in-flight edits are silently left out of the build. On 2026-07-21 two real fixes (a Spotlight glass
fallback and the duplicate-`alexis`-assistant fix) were uncommitted when v2.11.1 was cut, and
therefore did not ship.

`npm run release` guards that you're on `main` with nothing staged and the tag doesn't already exist,
then rewrites the version in **five** manifests in lockstep and commits as `release: vX.Y.Z`:

- `package.json`, `package-lock.json`
- `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`

They must stay identical: the updater compares the *installed* version (from `tauri.conf.json` /
`Cargo.toml`) against `latest.json`. If the manifests drift, the update is **silently never offered**.
That's why you bump via the script rather than by hand.

---

## What the Release workflow does

`.github/workflows/release.yml`, triggered on `push: tags: v*`, targeting `aarch64-apple-darwin`
(**Apple Silicon only** — no Intel build is produced):

1. **Pre-signs `src-tauri/bin/llama-libs/*.dylib`** with the Developer ID identity. The bundled
   llama-server dylibs must be signed individually or the app crashes at model load. See
   `docs/` notes on llama-server packaging — the historical "model too large" SIGABRT was really a
   missing/unsigned dylib.
2. **Builds, signs, and notarizes** via `tauri-action` using the `APPLE_*` secrets, then **signs the
   update artifact** with the Tauri updater key.
3. **Publishes to `docent-releases`** — uploads the `.dmg`, `.tar.gz`, `.tar.gz.sig`, and a generated
   `latest.json`.

Two hard-won details are load-bearing in that last step:

- **`--latest` is pinned explicitly.** GitHub resolves "latest" by release *creation date*, not
  version order. `v2.7.1` was published five minutes after `v2.8.0` and captured the pointer — every
  installed copy was served 2.7.1 and 2.8.0 was invisible to the updater.
- **Re-running a tag is idempotent.** `gh release create` is not, so the workflow checks for an
  existing release and re-uploads with `--clobber` instead of failing after a long build.

The asset URL in `latest.json` replaces spaces with dots, matching how GitHub renames assets.

---

## Signing assets — what exists and what to back up

### Updater key (verified 2026-07-21)

The public key is committed in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The matching
private key is **`~/.tauri/agent-forge`** — verified by matching it against `~/.tauri/agent-forge.pub`,
which is byte-identical to the committed pubkey.

> ⚠️ **Back up `~/.tauri/agent-forge`.** `~/.tauri/agentforge-updater.key` is an *older, unused* key —
> earlier revisions of this doc named it, so a backup made by following those instructions protects
> the wrong file. Lose `agent-forge` and you can never again sign an update that existing installs
> will accept; every user would need to reinstall by hand.

### Repository secrets (all on `agent-forge` only)

| Secret | What it is |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/agent-forge` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | empty — the key has no password |
| `APPLE_CERTIFICATE` | base64 of the exported **Developer ID Application** `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Alexander Layton (57R6U422C4)` |
| `APPLE_ID` / `APPLE_PASSWORD` | Apple ID + an **app-specific** password |
| `APPLE_TEAM_ID` | 10-char Team ID |

GitHub secrets are **write-only** — they cannot be read back out, not even by an admin. There is no
way to copy these to another repo programmatically; migrating means re-supplying every value from the
original source (the `.p12`, `~/.tauri/agent-forge`, a fresh PAT).

`RELEASES_REPO_TOKEN` is a separate PAT with write access to `docent-releases`, used by the publish
step. If releases start failing with a 403 on upload, check whether it expired.

### The self-hosted runner

`AgentForge-MacRunner` — a launch daemon on Alex's Mac at `~/actions-runner`, labels
`self-hosted, macOS, ARM64`, registered to `git-layton/agent-forge`.

**Releases only build while that Mac is awake and the runner process is up.** Check it:

```sh
gh api repos/git-layton/agent-forge/actions/runners --jq '.runners[] | {name,status,busy}'
ps aux | grep '[R]unner.Listener'
```

Notarization is Apple-side and dominates wall-clock time: builds have ranged 3m48s to ~14m.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Release job stuck `queued` for many minutes | Tag went to `docent`, or the runner is offline/asleep | Push the tag to `agent-forge`; confirm runner `status: online` |
| CI green but nothing in `docent-releases` | Only `ci.yml` ran; the Release job never executed | Check runs on `agent-forge`, not `docent` |
| App never offers an update | Manifest versions drifted, or `--latest` points at an older release | Confirm all five manifests match the tag; check which release is flagged Latest |
| Users get served an *older* version | Out-of-order publish captured the `latest` pointer | `gh release edit vX.Y.Z --repo git-layton/docent-releases --latest` |
| Upload step fails 403 | `RELEASES_REPO_TOKEN` expired | Mint a new PAT with write on `docent-releases` |
| Gatekeeper blocks first launch | Build wasn't notarized | Confirm the `APPLE_*` secrets are set and the sign step succeeded |

To retry a failed release, re-push the same tag — the publish step clobbers existing assets rather
than failing.

---

## Moving the release home to `docent` (not done yet)

If you ever want `docent` to build its own releases, copying secrets is **not** sufficient — the
runner must also be re-registered:

1. Re-register `~/actions-runner` against `https://github.com/git-layton/docent`
   (`./config.sh remove`, then `./config.sh --url … --token …`). Note this **removes** it from
   `agent-forge`, breaking that path — do one or the other, not a half-migration.
2. Re-supply all nine secrets on `docent` from their original sources.
3. Drop the `agent-forge` push from step 3 above, and fix `scripts/release.mjs`.

Until all of that is done, `agent-forge` remains the only repo that can ship.

---

## Auto-update mechanics

Installed copies poll
`https://github.com/git-layton/docent-releases/releases/latest/download/latest.json`
(`plugins.updater.endpoints` in `src-tauri/tauri.conf.json`). `docent-releases` must stay **public** —
private release assets require auth, which the app doesn't carry.

`checkForUpdatesOnStartup` runs from `App.tsx`; `checkForUpdates({ silent: false })` in
`src/services/updater.ts` is the on-demand version that reports either outcome.

A stable Developer ID identity also matters beyond Gatekeeper: API keys live in the macOS Keychain,
and an ad-hoc-signed build's identity changes every release, forcing a re-prompt after each update.
Signing with the same Developer ID keeps Keychain access silent across updates.
