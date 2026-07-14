import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, RefreshCw, Trash2, QrCode } from 'lucide-react';

// Mobile companion pairing — shows a QR the phone app scans to pair with this
// Mac's relay. The QR carries reachable hosts + a one-time code, never tokens;
// the phone trades the code for its own device token via /v1/pair/claim.

interface RelayStatus {
  installed: boolean;
  running: boolean;
  instanceId: string;
  adminToken: string;
  tailscaleHostname: string | null;
  localHostname: string | null;
}

interface PairedDevice {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  lastSeenAt: number;
  online: boolean;
}

const RELAY_PORT = 8765;

// The relay has no CORS headers, so browser fetch from the webview origin is
// blocked — route through the Tauri HTTP plugin like llm.ts does for local engines.
async function relayFetch(pathname: string, token: string, options: { method?: string; body?: any } = {}) {
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  const res = await tauriFetch(`http://127.0.0.1:${RELAY_PORT}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return res.json();
}

export function MobileCompanionCard({ onOpenRelaySetup }: { onOpenRelaySetup: () => void }) {
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDevices = useCallback(async (s: RelayStatus | null) => {
    if (!s?.running || !s?.adminToken) return;
    try {
      const result = await relayFetch('/v1/devices', s.adminToken);
      if (result.ok) setDevices(result.devices ?? []);
    } catch {
      // Relay went away between status check and fetch — status refresh will catch it.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<RelayStatus>('get_relay_status');
      setStatus(s);
      await loadDevices(s);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [loadDevices]);

  useEffect(() => { refresh(); }, [refresh]);

  // While the QR is up, poll so the phone appears in the list the moment it pairs.
  useEffect(() => {
    if (!pairing) return;
    pollRef.current = setInterval(() => {
      loadDevices(status);
      if (Date.now() > pairing.expiresAt) setPairing(null);
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pairing, status, loadDevices]);

  const startPairing = async () => {
    if (!status?.adminToken) return;
    setBusy(true);
    setError('');
    try {
      const result = await relayFetch('/v1/pair/start', status.adminToken, { method: 'POST', body: {} });
      if (!result.ok) throw new Error(result.error ?? 'Could not start pairing');
      setPairing({ code: result.code, expiresAt: result.expiresAt });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const revokeDevice = async (deviceId: string) => {
    if (!status?.adminToken) return;
    try {
      await relayFetch(`/v1/devices/${deviceId}`, status.adminToken, { method: 'DELETE' });
      setDevices(prev => prev.filter(d => d.id !== deviceId));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const hosts = [status?.localHostname, status?.tailscaleHostname].filter(Boolean) as string[];
  const qrPayload = pairing
    ? JSON.stringify({ v: 1, hosts, port: RELAY_PORT, code: pairing.code, instanceId: status?.instanceId ?? '' })
    : '';

  return (
    <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-inset rounded-xl shadow-sm border border-edge-2"><Smartphone className="w-5 h-5 text-secondary" /></div>
          <div className="flex flex-col">
            <span className="text-sm font-black uppercase tracking-widest block">Mobile Companion</span>
            <span className="text-xs text-ink-3 font-medium mt-0.5">
              Chat with your agents from your phone. Everything stays on this Mac — the phone is a remote control.
            </span>
          </div>
        </div>
        {status?.running && status?.adminToken ? (
          <button
            onClick={pairing ? () => setPairing(null) : startPairing}
            disabled={busy}
            className="px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm shrink-0 bg-primary text-white hover:bg-primary-hover disabled:opacity-50 flex items-center gap-2"
          >
            <QrCode className="w-3.5 h-3.5" /> {pairing ? 'Done' : 'Pair a Phone'}
          </button>
        ) : (
          <button
            onClick={onOpenRelaySetup}
            className="px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm shrink-0 bg-primary text-white hover:bg-primary-hover"
          >
            Set up Relay
          </button>
        )}
      </div>

      {error && <p className="text-xs text-danger font-medium">{error}</p>}

      {!status?.running && status?.installed && (
        <p className="text-xs text-ink-3 font-medium">The relay is installed but not running — it starts automatically at login, or re-run setup.</p>
      )}

      {pairing && (
        <div className="animate-in slide-in-from-top-2 pt-4 border-t border-edge flex flex-col md:flex-row gap-6 items-center">
          <div className="p-4 bg-white rounded-2xl shadow-sm border border-edge-2">
            <QRCodeSVG value={qrPayload} size={168} marginSize={1} />
          </div>
          <div className="flex flex-col gap-2 text-center md:text-left">
            <p className="text-sm font-bold text-ink">Scan with the Agent Forge mobile app</p>
            <p className="text-xs text-ink-3 font-medium">
              Or enter manually — host <span className="font-mono font-bold text-ink-2">{hosts[0] ?? 'this Mac'}:{RELAY_PORT}</span>, code:
            </p>
            <p className="text-2xl font-black tracking-[0.3em] font-mono text-ink">{pairing.code}</p>
            <p className="text-tiny text-ink-3 font-medium">
              One-time code, expires in {Math.max(1, Math.round((pairing.expiresAt - Date.now()) / 60000))} min.
              {!status?.tailscaleHostname && ' Tip: install Tailscale on both devices to chat away from home.'}
            </p>
          </div>
        </div>
      )}

      {devices.length > 0 && (
        <div className="pt-4 border-t border-edge flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-tiny font-black uppercase tracking-widest text-ink-3">Paired devices</span>
            <button onClick={() => loadDevices(status)} className="text-ink-3 hover:text-ink transition-colors" title="Refresh">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          {devices.map(device => (
            <div key={device.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-inset border border-edge-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${device.online ? 'bg-success' : 'bg-edge-2'}`} title={device.online ? 'Connected' : 'Offline'} />
                <span className="text-xs font-bold text-ink truncate">{device.name}</span>
                <span className="text-tiny text-ink-3 font-medium shrink-0">
                  paired {new Date(device.createdAt).toLocaleDateString()}
                </span>
              </div>
              <button
                onClick={() => revokeDevice(device.id)}
                className="text-ink-3 hover:text-danger transition-colors shrink-0"
                title="Revoke access"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
