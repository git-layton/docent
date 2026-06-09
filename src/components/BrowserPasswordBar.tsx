import { useState } from 'react';
import { Key, X } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';

interface BrowserPasswordBarProps {
  mode: 'autofill' | 'save-prompt' | 'manual';
  host: string;
  pendingUsername?: string;
  pendingPassword?: string;
  onAutofill?: () => void;
  onSaveConfirm?: () => void;
  onClose: () => void;
}

export function BrowserPasswordBar({
  mode,
  host,
  pendingUsername = '',
  onAutofill,
  onSaveConfirm,
  onClose,
}: BrowserPasswordBarProps) {
  const [manualUser, setManualUser] = useState('');
  const [manualPass, setManualPass] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState<'menu' | 'save' | 'fill'>('menu');

  const handleManualSave = async () => {
    if (!manualUser || !manualPass) return;
    const result = await invoke<{ ok: boolean; error?: string }>('keychain_save', {
      host, username: manualUser, password: manualPass,
    });
    if (result.ok) {
      setStatus('Saved!');
      setTimeout(onClose, 1200);
    } else {
      setStatus(`Error: ${result.error ?? 'unknown'}`);
    }
  };

  const handleManualFill = async () => {
    const result = await invoke<{ ok: boolean; username?: string; password?: string }>('keychain_get', { host });
    if (!result.ok) {
      setStatus('No saved credentials for this site');
      setTimeout(() => setStatus(null), 2000);
      return;
    }
    onAutofill?.();
  };

  return (
    <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-200 dark:border-neutral-800 shrink-0 bg-neutral-50 dark:bg-neutral-900 z-10">
      <Key className="w-3.5 h-3.5 text-[#4A5D75] dark:text-[#6A829E] shrink-0" />

      {/* Autofill mode — triggered automatically when password field focused */}
      {mode === 'autofill' && (
        <>
          <span className="text-[11px] text-neutral-700 dark:text-neutral-300 flex-1">
            Saved credentials for <strong>{host}</strong>
          </span>
          <button
            onClick={onAutofill}
            className="text-[11px] px-2.5 py-0.5 rounded-md bg-[#4A5D75] text-white hover:bg-[#3D4D61] transition-colors shrink-0"
          >
            Autofill
          </button>
        </>
      )}

      {/* Save-prompt mode — triggered automatically on form submit */}
      {mode === 'save-prompt' && (
        <>
          <span className="text-[11px] text-neutral-700 dark:text-neutral-300 flex-1">
            Save password for <strong>{host}</strong>?
            {pendingUsername && <span className="text-neutral-400 ml-1">({pendingUsername})</span>}
          </span>
          <button
            onClick={onSaveConfirm}
            className="text-[11px] px-2.5 py-0.5 rounded-md bg-[#4A5D75] text-white hover:bg-[#3D4D61] transition-colors shrink-0"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="text-[11px] px-2 py-0.5 rounded-md text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors shrink-0"
          >
            Not now
          </button>
        </>
      )}

      {/* Manual mode — opened via the key button in the nav bar */}
      {mode === 'manual' && (
        <>
          <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 shrink-0">{host}</span>
          {manualMode === 'menu' && (
            <div className="flex items-center gap-1.5 ml-1">
              <button
                onClick={() => setManualMode('save')}
                className="text-[11px] px-2 py-0.5 rounded-md bg-[#4A5D75] text-white hover:bg-[#3D4D61] transition-colors"
              >
                Save password
              </button>
              <button
                onClick={() => { setManualMode('fill'); handleManualFill(); }}
                className="text-[11px] px-2 py-0.5 rounded-md border border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                Fill saved
              </button>
            </div>
          )}
          {manualMode === 'save' && (
            <div className="flex items-center gap-1.5 ml-1 flex-1">
              <input
                autoFocus
                type="text"
                placeholder="Username / email"
                value={manualUser}
                onChange={e => setManualUser(e.target.value)}
                className="h-6 w-32 text-[11px] px-2 rounded-md bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-600 outline-none focus:ring-1 ring-[#6A829E]/30 text-neutral-900 dark:text-neutral-100"
              />
              <input
                type="password"
                placeholder="Password"
                value={manualPass}
                onChange={e => setManualPass(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleManualSave(); if (e.key === 'Escape') setManualMode('menu'); }}
                className="h-6 w-28 text-[11px] px-2 rounded-md bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-600 outline-none focus:ring-1 ring-[#6A829E]/30 text-neutral-900 dark:text-neutral-100"
              />
              <button
                onClick={handleManualSave}
                className="text-[11px] px-2 py-0.5 rounded-md bg-[#4A5D75] text-white hover:bg-[#3D4D61] transition-colors"
              >
                Save
              </button>
              <button onClick={() => setManualMode('menu')} className="text-[11px] text-neutral-400 hover:text-neutral-600 px-1">
                Cancel
              </button>
            </div>
          )}
          {status && (
            <span className={clsx('text-[11px] ml-1 shrink-0', status.startsWith('Error') || status.startsWith('No') ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
              {status}
            </span>
          )}
        </>
      )}

      <button onClick={onClose} className="ml-auto p-0.5 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
