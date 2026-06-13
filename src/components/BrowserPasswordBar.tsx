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
    <div className="flex items-center gap-2 px-3 h-9 border-b border-edge shrink-0 bg-panel-2 z-10">
      <Key className="w-3.5 h-3.5 text-accent shrink-0" />

      {/* Autofill mode — triggered automatically when password field focused */}
      {mode === 'autofill' && (
        <>
          <span className="text-[11px] text-ink-2 flex-1">
            Saved credentials for <strong>{host}</strong>
          </span>
          <button
            onClick={onAutofill}
            className="text-[11px] px-2.5 py-0.5 rounded-md bg-accent text-on-accent hover:bg-accent-strong transition-colors shrink-0"
          >
            Autofill
          </button>
        </>
      )}

      {/* Save-prompt mode — triggered automatically on form submit */}
      {mode === 'save-prompt' && (
        <>
          <span className="text-[11px] text-ink-2 flex-1">
            Save password for <strong>{host}</strong>?
            {pendingUsername && <span className="text-ink-3 ml-1">({pendingUsername})</span>}
          </span>
          <button
            onClick={onSaveConfirm}
            className="text-[11px] px-2.5 py-0.5 rounded-md bg-accent text-on-accent hover:bg-accent-strong transition-colors shrink-0"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="text-[11px] px-2 py-0.5 rounded-md text-ink-3 hover:text-ink-2 transition-colors shrink-0"
          >
            Not now
          </button>
        </>
      )}

      {/* Manual mode — opened via the key button in the nav bar */}
      {mode === 'manual' && (
        <>
          <span className="text-[11px] font-medium text-ink-2 shrink-0">{host}</span>
          {manualMode === 'menu' && (
            <div className="flex items-center gap-1.5 ml-1">
              <button
                onClick={() => setManualMode('save')}
                className="text-[11px] px-2 py-0.5 rounded-md bg-accent text-on-accent hover:bg-accent-strong transition-colors"
              >
                Save password
              </button>
              <button
                onClick={() => { setManualMode('fill'); handleManualFill(); }}
                className="text-[11px] px-2 py-0.5 rounded-md border border-edge-2 text-ink-2 hover:bg-wash transition-colors"
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
                className="h-6 w-32 text-[11px] px-2 rounded-md bg-panel border border-edge outline-none focus:ring-1 ring-accent/30 text-ink"
              />
              <input
                type="password"
                placeholder="Password"
                value={manualPass}
                onChange={e => setManualPass(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleManualSave(); if (e.key === 'Escape') setManualMode('menu'); }}
                className="h-6 w-28 text-[11px] px-2 rounded-md bg-panel border border-edge outline-none focus:ring-1 ring-accent/30 text-ink"
              />
              <button
                onClick={handleManualSave}
                className="text-[11px] px-2 py-0.5 rounded-md bg-accent text-on-accent hover:bg-accent-strong transition-colors"
              >
                Save
              </button>
              <button onClick={() => setManualMode('menu')} className="text-[11px] text-ink-3 hover:text-ink-2 px-1">
                Cancel
              </button>
            </div>
          )}
          {status && (
            <span className={clsx('text-[11px] ml-1 shrink-0', status.startsWith('Error') || status.startsWith('No') ? 'text-danger' : 'text-success')}>
              {status}
            </span>
          )}
        </>
      )}

      <button onClick={onClose} className="ml-auto p-0.5 rounded text-ink-3 hover:text-ink-2 shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
