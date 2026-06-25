# Releasing & auto-update

Agent Forge updates itself in place. On launch it polls GitHub Releases, and when a newer
version exists it offers a one-click **Install & restart**. You ship a new version by pushing
a git tag — CI builds, signs, and publishes everything.

```
Local: bump version + git tag  ─►  GitHub Actions (release.yml)  ─►  GitHub Release + latest.json
                                                                          │
                              every installed copy polls latest.json ◄────┘  →  "Update available"
```

## One-time setup

The auto-updater verifies each download against a signing key. The **public** key is committed
in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The **private** key lives only on
your machine at `~/.tauri/agentforge-updater.key` and as a GitHub secret — **never commit it.**

1. Copy the private key to your clipboard:
   ```sh
   cat ~/.tauri/agentforge-updater.key | pbcopy
   ```
2. In the repo on GitHub → **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `TAURI_SIGNING_PRIVATE_KEY`
   - Value: paste (⌘V)
3. That's it. The key has no password, so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is intentionally
   left unset — the workflow supplies an empty string.

> ⚠️ If you ever lose `~/.tauri/agentforge-updater.key`, you cannot sign updates that existing
> installs will accept. Back it up somewhere safe (password manager / encrypted drive).

The repo must be **public** for installed copies to fetch releases over plain HTTPS. (Private-repo
release assets require auth, which we don't bake into the app.)

## Cutting a release

The running app compares its own version to `latest.json`, so the version must be bumped in all
three manifests and the tag must match.

1. Bump the version in **`package.json`**, **`src-tauri/tauri.conf.json`** (`version`), and
   **`src-tauri/Cargo.toml`** (`package.version`) — keep them identical (e.g. `2.0.1`).
2. Commit, tag, and push:
   ```sh
   git commit -am "release: v2.0.1"
   git tag v2.0.1
   git push --follow-tags
   ```
3. The **Release** workflow builds for `aarch64-apple-darwin` (Apple Silicon), signs the update,
   and publishes a GitHub Release plus `latest.json`. Your other Macs pick it up on next launch.

## First install on a new Mac (until notarized — see below)

Without Apple notarization the build is unsigned, so Gatekeeper blocks the first launch. Once per
machine: **right-click the app → Open → Open**, or run
`xattr -dr com.apple.quarantine "/Applications/Agent Forge.app"`. Subsequent auto-updates do not
re-trigger this.

## Turning on Apple notarization (recommended once you have the $99 account)

This removes the Gatekeeper warning **and** keeps the app's code-signing identity stable across
updates — which matters here because API keys are stored in the macOS Keychain, and an unsigned
build's identity changes every release (forcing Keychain re-prompts after each update). A stable
Developer ID identity makes Keychain access persist silently.

Add these repo secrets (from your Apple Developer account), then just push a new tag — no workflow
edit needed (they're already referenced in `release.yml`):

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of your exported **Developer ID Application** `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | an **app-specific password** (appleid.apple.com → Sign-In & Security) |
| `APPLE_TEAM_ID` | your 10-char Team ID |

Until you have an Apple account, the `APPLE_*` env vars in `release.yml` are **commented out** (not
wired to empty secrets) so CI ships an unsigned build — an empty `APPLE_CERTIFICATE` makes the
bundler attempt and fail a keychain import. To turn signing on: add the secrets above **and**
uncomment those env lines, then re-tag.

## Manual "Check for updates"

`checkForUpdates({ silent: false })` in `src/services/updater.ts` does an on-demand check with
feedback either way — wire it to a Settings button whenever you want one. The silent startup
check (`checkForUpdatesOnStartup`) already runs from `App.tsx`.
