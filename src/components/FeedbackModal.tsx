import { useState, useEffect } from 'react';
import { X, Camera, Loader2, Send } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [happened, setHappened] = useState('');
  const [expected, setExpected] = useState('');
  const [screenshotB64, setScreenshotB64] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [version, setVersion] = useState<string>('');

  const smtp = useSettingsStore(s => s.integrations.smtp);

  useEffect(() => {
    import('@tauri-apps/api/app')
      .then(m => m.getVersion())
      .then(setVersion)
      .catch(() => setVersion('unknown'));
  }, []);
  
  const handleCapture = async () => {
    setCapturing(true);
    try {
      // Hide modal momentarily (if we wanted to, but Tauri capture_window just captures the window)
      const res = await invoke<{ b64: string }>('capture_window', { includeCursor: false });
      if (res?.b64) setScreenshotB64(res.b64);
    } catch (err) {
      console.warn('Screenshot failed', err);
    }
    setCapturing(false);
  };

  const handleSend = async () => {
    const body = `WHAT HAPPENED:\n${happened}\n\nWHAT I EXPECTED:\n${expected}\n\nApp Version: ${version}`;
    const subject = `Docent Feedback (v${version})`;
    
    if (smtp?.enabled && smtp.email) {
      setSending(true);
      try {
        await invoke('mail_send', {
          provider: smtp.provider,
          email: smtp.email,
          to: ['help@amplifiedintelligence.net'],
          cc: [],
          subject,
          body,
          inReplyTo: null,
          attachmentB64: screenshotB64
        });
        useUIStore.getState().showToast('Feedback sent silently! Thank you.');
        onClose();
      } catch (err) {
        useUIStore.getState().showToast(`Failed to send feedback via SMTP: ${String(err)}`);
        setSending(false);
      }
    } else {
      // Fallback to mailto
      const url = `mailto:help@amplifiedintelligence.net?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      invoke('open_url', { url }).catch(() => {});
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface border border-ink-4/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-4/10">
          <h2 className="text-lg font-bold text-ink-1">Feedback</h2>
          <button onClick={onClose} className="p-1 text-ink-3 hover:text-ink-1 hover:bg-ink-4/10 rounded-full transition-colors"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1">What happened?</label>
            <textarea 
              value={happened} onChange={e => setHappened(e.target.value)}
              className="w-full h-24 p-3 bg-ink-4/5 border border-ink-4/20 rounded-xl focus:border-brand/50 focus:ring-1 focus:ring-brand/50 transition-all resize-none text-sm text-ink-1 placeholder-ink-4"
              placeholder="Describe the issue or feedback..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1">What were you expecting to have happen?</label>
            <textarea 
              value={expected} onChange={e => setExpected(e.target.value)}
              className="w-full h-24 p-3 bg-ink-4/5 border border-ink-4/20 rounded-xl focus:border-brand/50 focus:ring-1 focus:ring-brand/50 transition-all resize-none text-sm text-ink-1 placeholder-ink-4"
              placeholder="(Optional) How should it have worked?"
            />
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={handleCapture} disabled={capturing}
              className="flex items-center gap-2 px-4 py-2 bg-ink-4/10 hover:bg-ink-4/20 text-ink-1 text-sm font-medium rounded-lg transition-colors"
            >
              {capturing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Camera className="w-4 h-4"/>}
              Capture Screenshot
            </button>
            {screenshotB64 && (
              <div className="relative group rounded-md overflow-hidden border border-ink-4/20">
                <img src={`data:image/png;base64,${screenshotB64}`} alt="Screenshot" className="h-10 w-auto object-contain" />
                <button onClick={() => setScreenshotB64(null)} className="absolute inset-0 bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="p-4 bg-ink-4/5 border-t border-ink-4/10 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-ink-2 hover:text-ink-1 transition-colors">Cancel</button>
          <button 
            onClick={handleSend} 
            disabled={!happened.trim() || sending}
            className="flex items-center gap-2 px-5 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-light transition-colors disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4"/>}
            Send Feedback
          </button>
        </div>
      </div>
    </div>
  );
}
