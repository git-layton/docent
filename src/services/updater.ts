// In-app auto-update.
//
// Pulls signed releases published to GitHub Releases (see .github/workflows/release.yml),
// verifies the minisign signature against the pubkey baked into tauri.conf.json, and swaps
// the app bundle in place. The update files are fetched over public HTTPS, so the repo /
// releases must be public for this to work.
//
// Behavior:
//  - Startup / background: silently download + install the moment a newer release is reachable
//    (on launch, every few hours while running, and the instant the machine reconnects). The new
//    version becomes active on next launch — we never force a relaunch out from under the user,
//    just offer one via a toast.
//  - Manual ("Check for updates" button): `checkForUpdates({ silent: false })` prompts with a
//    native dialog and gives the user explicit control + feedback.

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { useUIStore } from '../store/useUIStore';

const SIX_HOURS = 6 * 60 * 60 * 1000;

let startupRan = false;
let inFlight = false; // guard against overlapping downloads (startup + interval + 'online' can race)
let installedVersion: string | null = null; // staged-and-waiting-for-relaunch; don't re-install it

/**
 * Silently bring the app up to date in the background: if a newer release is reachable, download +
 * install it and surface a non-blocking toast with an optional "Relaunch now". No dialog, no forced
 * restart. No-op when offline, already current, already staged, or running an unsigned dev build.
 */
async function applyUpdatesInBackground(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const update = await check();
    if (!update) return;
    if (installedVersion === update.version) return; // already downloaded; just awaiting relaunch

    await update.downloadAndInstall();
    installedVersion = update.version;

    useUIStore.getState().showToast(`✅ Updated to Agent Forge ${update.version} — relaunch to finish`, {
      label: 'Relaunch now',
      onClick: () => {
        void relaunch();
      },
    });
  } catch (err) {
    // Offline, no release yet, or an unsigned local dev build → try again on the next trigger.
    console.debug('[updater] background update skipped:', err);
  } finally {
    inFlight = false;
  }
}

/**
 * On-demand check with feedback either way. Wire to a Settings "Check for updates" button.
 */
export async function checkForUpdates({ silent = true }: { silent?: boolean } = {}): Promise<void> {
  try {
    const update = await check();

    if (!update) {
      if (!silent) {
        await message("You're on the latest version.", { title: 'Agent Forge', kind: 'info' });
      }
      return;
    }

    const notes = update.body?.trim() ? `\n\n${update.body.trim()}` : '';
    const accepted = await ask(
      `Agent Forge ${update.version} is available — you have ${update.currentVersion}.${notes}\n\n` +
        'Install now? The app will restart when it finishes.',
      {
        title: 'Update available',
        kind: 'info',
        okLabel: 'Install & restart',
        cancelLabel: 'Later',
      },
    );
    if (!accepted) return;

    useUIStore.getState().showToast(`⬇️ Downloading Agent Forge ${update.version}…`);
    await update.downloadAndInstall();
    await relaunch();
  } catch (err) {
    if (!silent) {
      await message(`Couldn't check for updates: ${String(err)}`, { title: 'Agent Forge', kind: 'error' });
    }
    console.debug('[updater] check skipped:', err);
  }
}

/**
 * Keep the app self-updating: once shortly after launch, every few hours while it stays open, and
 * the instant the machine reconnects to the internet (covers "update next time it's online").
 */
export function checkForUpdatesOnStartup(): void {
  if (startupRan) return;
  startupRan = true;

  // Deferred so it doesn't compete with first paint / startup toasts.
  setTimeout(() => {
    void applyUpdatesInBackground();
  }, 4000);

  // Always-open machines pick up new releases without ever restarting first.
  setInterval(() => {
    void applyUpdatesInBackground();
  }, SIX_HOURS);

  // Launched offline, or connection dropped and came back → grab it as soon as we're online.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      void applyUpdatesInBackground();
    });
  }
}
