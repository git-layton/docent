// In-app auto-update.
//
// Pulls signed releases published to GitHub Releases (see .github/workflows/release.yml),
// verifies the minisign signature against the pubkey baked into tauri.conf.json, and swaps
// the app bundle in place. The update files are fetched over public HTTPS, so the repo /
// releases must be public for this to work.
//
// Behavior:
//  - Startup / background: Check for updates (on launch, every few hours, and when online).
//    If a newer release is reachable, it waits until no LLM generation is active, logs the status,
//    and then prompts the user with a native dialog to install and restart.
//  - Manual ("Check for updates" button): `checkForUpdates({ silent: false })` prompts with a
//    native dialog immediately and gives the user explicit control + feedback.

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { useUIStore } from '../store/useUIStore';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

let startupRan = false;
let inFlight = false; // guard against overlapping downloads (startup + interval + 'online' can race)
let installedVersion: string | null = null; // staged-and-waiting-for-relaunch; don't re-install it

/**
 * Check for updates in the background. If one is found, wait until there are no active LLM streams,
 * then prompt the user with a native dialog to install and restart. Logs states clearly.
 */
async function applyUpdatesInBackground(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const update = await check();
    if (!update) return;
    if (installedVersion === update.version) return; // already downloaded; just awaiting relaunch

    console.info(`[updater] Update found: v${update.version}. Waiting for LLM idle state...`);
    
    // Wait until there are no active LLM response sessions
    while ((window as any).__isGenerating) {
      await new Promise(r => setTimeout(r, 2000));
    }
    
    console.info(`[updater] LLM is idle. Prompting user for update...`);

    const notes = update.body?.trim() ? `\n\n${update.body.trim()}` : '';
    const accepted = await ask(
      `Docent ${update.version} is available — you have ${update.currentVersion}.${notes}\n\n` +
        'Install now? The app will restart when it finishes.',
      {
        title: 'Update available',
        kind: 'info',
        okLabel: 'Install & restart',
        cancelLabel: 'Later',
      },
    );

    if (!accepted) {
      console.info(`[updater] User deferred update v${update.version}.`);
      return;
    }

    console.info(`[updater] Downloading update v${update.version}...`);
    useUIStore.getState().showToast(`⬇️ Downloading Docent ${update.version}…`);
    await update.downloadAndInstall();
    installedVersion = update.version;
    
    console.info(`[updater] Update downloaded. Relaunching app...`);
    await relaunch();
  } catch (err) {
    // Offline, no release yet, or an unsigned local dev build → try again on the next trigger.
    console.warn('[updater] background update check failed:', err);
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
        await message("You're on the latest version.", { title: 'Docent', kind: 'info' });
      }
      return;
    }

    const notes = update.body?.trim() ? `\n\n${update.body.trim()}` : '';
    const accepted = await ask(
      `Docent ${update.version} is available — you have ${update.currentVersion}.${notes}\n\n` +
        'Install now? The app will restart when it finishes.',
      {
        title: 'Update available',
        kind: 'info',
        okLabel: 'Install & restart',
        cancelLabel: 'Later',
      },
    );
    if (!accepted) return;

    useUIStore.getState().showToast(`⬇️ Downloading Docent ${update.version}…`);
    await update.downloadAndInstall();
    await relaunch();
  } catch (err) {
    if (!silent) {
      await message(`Couldn't check for updates: ${String(err)}`, { title: 'Docent', kind: 'error' });
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
  }, FIFTEEN_MINUTES);

  // Launched offline, or connection dropped and came back → grab it as soon as we're online.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      void applyUpdatesInBackground();
    });
  }
}
