import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../store/useSettingsStore';

export function PermissionsBootstrapper() {
  const hasPromptedMacPermissions = useSettingsStore(s => s.hasPromptedMacPermissions);
  const setHasPromptedMacPermissions = useSettingsStore(s => s.setHasPromptedMacPermissions);
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasPromptedMacPermissions || hasRun.current) return;
    hasRun.current = true;

    const bootstrapPermissions = async () => {
      try {
        // Auto-prompt core OS permissions on first launch for a seamless setup experience.
        // We only prompt for Accessibility and Screen Capture. We do NOT auto-prompt
        // Automation (Notes, Messages) because macOS forces the target app to launch
        // to show the consent dialog, which is too chaotic for startup.
        await invoke('accessibility_request_access').catch(() => {});
        
        // Give the OS a tiny beat before firing the second prompt to avoid dialog glitches
        setTimeout(async () => {
          await invoke('request_screen_capture_access').catch(() => {});
        }, 1000);

        setHasPromptedMacPermissions(true);
      } catch (e) {
        console.warn('[PermissionsBootstrapper] Failed to bootstrap permissions:', e);
      }
    };

    void bootstrapPermissions();
  }, [hasPromptedMacPermissions, setHasPromptedMacPermissions]);

  return null; // Headless component
}
