import { useState } from 'react';
import { Key, X } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';

interface BrowserPasswordBarProps {
  host: string;
  onClose: () => void;
}

export function BrowserPasswordBar({ host, onClose }: BrowserPasswordBarProps) {
  const [mode, setMode] = useState<'menu' | 'save' | 'fill'>('menu');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const handleSave = async () => {
    if (!username || !password) return;
    const result = await invoke<{ ok: boolean; error?: string }>('keychain_save', { host, username, password });
    setStatus(result.ok ? 'Saved!' : `Error: ${result.error ?? 'unknown'}`);
    setTimeout(() => { setStatus(null); onClose(); }, 1500);
  };

  const handleFill = async () => {
    const result = await invoke<{ ok: boolean; password?: string }>('keychain_get', { host });
    if (!result.ok || !result.password) {
      setStatus('No saved password for this site');
      setTimeout(() => setStatus(null), 2000);
      return;
    }
    setStatus('Autofill not yet available (WKWebView limitation)');
    setTimeout(() => setStatus(null), 2500);
  };

  return (
    <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-200 dark:border-neutral-800 shrink-0 bg-neutral-50 dark:bg-neutral-850 z-10">
      <Key className="w-3.5 h-3.5 text-[#4A5D75] dark:text-[#6A829E] shrink-0" />
      <span className="text-[10px] text-neutral-600 dark:text-neutral-400 shrink-0 font-medium">{host}</span>

      {mode === 'menu' && (
        <div className="flex items-center gap-1.5 ml-1">
          <button onClick={() => setMode('save')} className="text-[10px] px-2 py-0.5 rounded bg-[#4A5D75] text-white hover:bg-[#3D4D61] transition-colors">
            Save password
          </button>
          <button onClick={handleFill} className="text-[10px] px-2 py-0.5 rounded border border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
            Fill saved
          </button>
        </div>
      )}

      {mode === 'save' && (
        <div className="flex items-center gap-1.5 ml-1 flex-1">
          <input
            autoFocus
            type="text"
            placeholder="Username / email"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="h-5.5 w-32 text-[10px] px-2 rounded bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 outline-none focus:ring-1 ring-[#6A829E]/30 text-neutral-900 dark:text-neutral-100"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setMode('menu'); }}
            className="h-5.5 w-28 text-[10px] px-2 rounded bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 outline-none focus:ring-1 ring-[#6A829E]/30 text-neutral-900 dark:text-neutral-100"
          />
          <button onClick={handleSave} className="text-[10px] px-2 py-0.5 rounded bg-[#4A5D75] text-white hover:bg-[#3D4D61] transition-colors">
            Save
          </button>
          <button onClick={() => setMode('menu')} className="text-[10px] text-neutral-400 hover:text-neutral-600 px-1">
            Cancel
          </button>
        </div>
      )}

      {status && (
        <span className={clsx('text-[10px] ml-1', status.startsWith('Error') ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>{status}</span>
      )}

      <button onClick={onClose} className="ml-auto p-0.5 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
