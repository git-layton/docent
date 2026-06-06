import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Activity, Cpu, MemoryStick, Wifi, WifiOff, Zap, Server } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';

interface SystemStats {
  cpu_pct: number;
  total_mb: number;
  used_mb: number;
  available_mb: number;
  internet: boolean;
}

interface ModelStatus {
  id: string;
  name: string;
  provider: string;
  ok: boolean | null; // null = checking
}

function GaugeArc({ pct, color, size = 64 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const cx = size / 2;
  const cy = size / 2;
  // 3/4 circle arc, starting at bottom-left (225deg), going clockwise
  const startAngle = 225;
  const sweep = 270;
  const angle = startAngle + sweep * (pct / 100);
  const toRad = (d: number) => (d * Math.PI) / 180;
  const arcPath = (end: number) => {
    const x1 = cx + r * Math.cos(toRad(startAngle));
    const y1 = cy + r * Math.sin(toRad(startAngle));
    const x2 = cx + r * Math.cos(toRad(end));
    const y2 = cy + r * Math.sin(toRad(end));
    const large = end - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };
  const trackPath = arcPath(startAngle + sweep);
  const valuePath = arcPath(angle);

  return (
    <svg width={size} height={size} className="shrink-0">
      <path d={trackPath} fill="none" stroke="currentColor" strokeWidth="5" className="text-neutral-200 dark:text-neutral-700" strokeLinecap="round" />
      <path d={valuePath} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${color}66)` }} />
    </svg>
  );
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="w-2 h-2 rounded-full bg-neutral-400 animate-pulse shrink-0" />;
  return ok
    ? <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" style={{ boxShadow: '0 0 6px #34d39966' }} />
    : <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" style={{ boxShadow: '0 0 6px #f8717166' }} />;
}

function cpuColor(pct: number) {
  if (pct > 80) return '#f87171';
  if (pct > 50) return '#fbbf24';
  return '#34d399';
}

function ramColor(pct: number) {
  if (pct > 85) return '#f87171';
  if (pct > 65) return '#fbbf24';
  return '#60a5fa';
}

// Checks if a model endpoint is reachable by doing a fast HEAD/GET
async function pingModel(model: any): Promise<boolean> {
  const provider = model.provider;
  const apiKey = model.apiKey ?? '';
  if (provider === 'native' || provider === 'lmstudio' || provider === 'ollama') {
    const base = model.endpoint || (provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234');
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/v1/models`, {
        signal: AbortSignal.timeout(2000),
        headers: provider === 'lmstudio' ? {} : {},
      });
      return res.ok || res.status === 401;
    } catch { return false; }
  }
  if (provider === 'anthropic') {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        signal: AbortSignal.timeout(3000),
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      return res.ok || res.status === 401;
    } catch { return false; }
  }
  if (provider === 'openai' || provider === 'custom') {
    const base = (model.endpoint || 'https://api.openai.com/v1').replace(/\/models$/, '');
    try {
      const res = await fetch(`${base}/models`, {
        signal: AbortSignal.timeout(3000),
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      return res.ok || res.status === 401;
    } catch { return false; }
  }
  if (provider === 'google') {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok || res.status === 401;
    } catch { return false; }
  }
  return true;
}

export function ActivityMonitor() {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);

  const fetchStats = useCallback(async () => {
    try {
      const s = await invoke<SystemStats>('get_system_stats');
      setStats(s);
    } catch { /* no-op if backend unavailable */ }
  }, []);

  const checkModels = useCallback(async () => {
    if (!models.length) return;
    // Only check selected model + unique providers to keep it snappy
    const toCheck = models.reduce<any[]>((acc, m) => {
      if (m.id === selectedModelId || !acc.find(x => x.provider === m.provider)) acc.push(m);
      return acc;
    }, []).slice(0, 4);

    setModelStatuses(toCheck.map(m => ({ id: m.id, name: m.name, provider: m.provider, ok: null })));
    for (const m of toCheck) {
      const ok = await pingModel(m);
      setModelStatuses(prev => prev.map(s => s.id === m.id ? { ...s, ok } : s));
    }
  }, [models, selectedModelId]);

  useEffect(() => {
    if (!open) return;
    fetchStats();
    checkModels();
    intervalRef.current = setInterval(fetchStats, 2000);
    modelIntervalRef.current = setInterval(checkModels, 15000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (modelIntervalRef.current) clearInterval(modelIntervalRef.current);
    };
  }, [open, fetchStats, checkModels]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const cpuPct = stats?.cpu_pct ?? 0;
  const ramPct = stats ? (stats.used_mb / stats.total_mb) * 100 : 0;
  const isBusy = cpuPct > 70 || ramPct > 80;
  const isWarning = cpuPct > 50 || ramPct > 65;
  const dotColor = !stats ? '#a3a3a3' : isBusy ? '#f87171' : isWarning ? '#fbbf24' : '#34d399';

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 ${open ? 'bg-[#D6E0EA] dark:bg-[#1E2B38]/50 text-[#4A5D75]' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400'}`}
        title="Activity Monitor"
      >
        <Activity className="w-5 h-5" />
        {stats && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500"
            style={{ background: dotColor, boxShadow: `0 0 5px ${dotColor}99` }}
          />
        )}
      </button>

      {/* Floating panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 z-[200] animate-in fade-in zoom-in-95 duration-150 origin-top-right">
          {/* Glass card */}
          <div className="bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-neutral-200/80 dark:border-neutral-700/60 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-[#6A829E]" />
                <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-neutral-400">System Monitor</span>
              </div>
              <span className="text-[9px] font-bold text-neutral-400">live</span>
            </div>

            <div className="p-4 space-y-4">
              {/* CPU + RAM gauges row */}
              <div className="flex gap-3">
                {/* CPU */}
                <div className="flex-1 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl p-3 flex flex-col items-center gap-1.5">
                  <div className="relative">
                    <GaugeArc pct={cpuPct} color={cpuColor(cpuPct)} size={60} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center pb-1">
                      <Cpu className="w-3 h-3 text-neutral-400" />
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-black tabular-nums" style={{ color: cpuColor(cpuPct) }}>
                      {stats ? `${cpuPct.toFixed(0)}%` : '—'}
                    </div>
                    <div className="text-[9px] font-bold uppercase tracking-widest text-neutral-400">CPU</div>
                  </div>
                </div>

                {/* RAM */}
                <div className="flex-1 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl p-3 flex flex-col items-center gap-1.5">
                  <div className="relative">
                    <GaugeArc pct={ramPct} color={ramColor(ramPct)} size={60} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center pb-1">
                      <MemoryStick className="w-3 h-3 text-neutral-400" />
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-black tabular-nums" style={{ color: ramColor(ramPct) }}>
                      {stats ? `${(stats.used_mb / 1024).toFixed(1)}` : '—'}
                      <span className="text-[9px] font-bold text-neutral-400">GB</span>
                    </div>
                    <div className="text-[9px] font-bold uppercase tracking-widest text-neutral-400">
                      {stats ? `of ${(stats.total_mb / 1024).toFixed(0)}GB` : 'RAM'}
                    </div>
                  </div>
                </div>
              </div>

              {/* RAM detail bar */}
              {stats && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] font-bold text-neutral-400">
                    <span>Memory Pressure</span>
                    <span className="tabular-nums">{ramPct.toFixed(0)}%</span>
                  </div>
                  <MiniBar pct={ramPct} color={ramColor(ramPct)} />
                  <div className="flex justify-between text-[9px] text-neutral-400">
                    <span>{(stats.available_mb / 1024).toFixed(1)} GB free</span>
                    <span>{(stats.used_mb / 1024).toFixed(1)} GB used</span>
                  </div>
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-neutral-100 dark:border-neutral-800" />

              {/* Network */}
              <div className="space-y-2">
                <div className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Connectivity</div>
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    {stats?.internet ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> : <WifiOff className="w-3.5 h-3.5 text-red-400" />}
                    <span className="text-xs font-bold text-neutral-700 dark:text-neutral-200">Internet</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusDot ok={stats?.internet ?? null} />
                    <span className={`text-[10px] font-bold ${stats?.internet ? 'text-emerald-500' : stats ? 'text-red-400' : 'text-neutral-400'}`}>
                      {stats ? (stats.internet ? 'Online' : 'Offline') : '—'}
                    </span>
                  </div>
                </div>

                {/* Model connectivity */}
                {modelStatuses.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {modelStatuses.map(m => (
                      <div key={m.id} className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-2 truncate">
                          <Server className="w-3 h-3 text-neutral-400 shrink-0" />
                          <span className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 truncate max-w-[130px]">{m.name}</span>
                          {m.id === selectedModelId && (
                            <span className="text-[8px] font-black uppercase bg-[#E8EFF6] dark:bg-[#1E2B38]/60 text-[#4A5D75] px-1.5 py-0.5 rounded-full shrink-0">active</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <StatusDot ok={m.ok} />
                          <span className={`text-[10px] font-bold ${m.ok === true ? 'text-emerald-500' : m.ok === false ? 'text-red-400' : 'text-neutral-400'}`}>
                            {m.ok === null ? 'checking' : m.ok ? 'reachable' : 'unreachable'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer timestamp */}
            <div className="px-4 py-2 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/30">
              <span className="text-[9px] text-neutral-400 font-mono">updates every 2s · model check every 15s</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
