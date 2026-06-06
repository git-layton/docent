import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { Activity, Cpu, MemoryStick, Wifi, WifiOff, Zap, Server, X, Minus, GripHorizontal } from 'lucide-react';
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
  ok: boolean | null;
}

// ── Gauge Arc ────────────────────────────────────────────────────────────────
function GaugeArc({ pct, color, size = 72 }: { pct: number; color: string; size?: number }) {
  const r = (size - 10) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = 225;
  const sweep = 270;
  const clampedPct = Math.min(Math.max(pct, 0), 100);
  const angle = startAngle + sweep * (clampedPct / 100);
  const toRad = (d: number) => (d * Math.PI) / 180;
  const arcPath = (end: number) => {
    const x1 = cx + r * Math.cos(toRad(startAngle));
    const y1 = cy + r * Math.sin(toRad(startAngle));
    const x2 = cx + r * Math.cos(toRad(end));
    const y2 = cy + r * Math.sin(toRad(end));
    const large = end - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };
  return (
    <svg width={size} height={size} className="shrink-0">
      <path d={arcPath(startAngle + sweep)} fill="none" stroke="currentColor" strokeWidth="6"
        className="text-neutral-800/40" strokeLinecap="round" />
      <path d={arcPath(angle)} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 6px ${color}88)`, transition: 'all 0.6s ease' }} />
    </svg>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color, height = 28 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return <div style={{ height }} />;
  const w = 200;
  const max = Math.max(...data, 5);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');
  const areaBottom = `${(data.length - 1) / (data.length - 1) * w},${height} 0,${height}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${pts} ${areaBottom}`} fill={`url(#sg-${color.replace('#', '')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 3px ${color}66)` }} />
    </svg>
  );
}

// ── Mini bar ─────────────────────────────────────────────────────────────────
function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width 0.7s ease', boxShadow: `0 0 6px ${color}66` }} />
    </div>
  );
}

// ── Status dot ───────────────────────────────────────────────────────────────
function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="w-2 h-2 rounded-full bg-neutral-500 animate-pulse shrink-0" />;
  return ok
    ? <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" style={{ boxShadow: '0 0 6px #34d39999' }} />
    : <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" style={{ boxShadow: '0 0 6px #f8717199' }} />;
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

// ── Model ping ───────────────────────────────────────────────────────────────
async function pingModel(model: any): Promise<boolean> {
  const provider = model.provider;
  const apiKey = model.apiKey ?? '';
  try {
    if (provider === 'native' || provider === 'lmstudio' || provider === 'ollama') {
      const base = model.endpoint || (provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234');
      const res = await fetch(`${base.replace(/\/$/, '')}/v1/models`, { signal: AbortSignal.timeout(2000) });
      return res.ok || res.status === 401;
    }
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        signal: AbortSignal.timeout(3000),
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      return res.ok || res.status === 401;
    }
    if (provider === 'openai' || provider === 'custom') {
      const base = (model.endpoint || 'https://api.openai.com/v1').replace(/\/models$/, '');
      const res = await fetch(`${base}/models`, {
        signal: AbortSignal.timeout(3000),
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      return res.ok || res.status === 401;
    }
    if (provider === 'google') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, { signal: AbortSignal.timeout(3000) });
      return res.ok || res.status === 401;
    }
  } catch { return false; }
  return true;
}

// ── Draggable floating window ─────────────────────────────────────────────────
function MonitorWindow({ onClose, onMinimize, minimized }: {
  onClose: () => void;
  onMinimize: () => void;
  minimized: boolean;
}) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([]);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramHistory, setRamHistory] = useState<number[]>([]);
  const [pos, setPos] = useState({ x: window.innerWidth - 320, y: 80 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);

  const fetchStats = useCallback(async () => {
    try {
      const s = await invoke<SystemStats>('get_system_stats');
      setStats(s);
      setCpuHistory(prev => [...prev.slice(-39), s.cpu_pct]);
      const rp = (s.used_mb / s.total_mb) * 100;
      setRamHistory(prev => [...prev.slice(-39), rp]);
    } catch {}
  }, []);

  const checkModels = useCallback(async () => {
    if (!models.length) return;
    const toCheck = models.reduce<any[]>((acc, m) => {
      if (m.id === selectedModelId || !acc.find((x: any) => x.provider === m.provider)) acc.push(m);
      return acc;
    }, []).slice(0, 5);
    setModelStatuses(toCheck.map(m => ({ id: m.id, name: m.name, provider: m.provider, ok: null })));
    for (const m of toCheck) {
      const ok = await pingModel(m);
      setModelStatuses(prev => prev.map(s => s.id === m.id ? { ...s, ok } : s));
    }
  }, [models, selectedModelId]);

  useEffect(() => {
    fetchStats();
    checkModels();
    intervalRef.current = setInterval(fetchStats, 2000);
    modelIntervalRef.current = setInterval(checkModels, 15000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (modelIntervalRef.current) clearInterval(modelIntervalRef.current);
    };
  }, [fetchStats, checkModels]);

  // Drag logic
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 300, dragRef.current.origX + ev.clientX - dragRef.current.startX)),
        y: Math.max(0, Math.min(window.innerHeight - 60, dragRef.current.origY + ev.clientY - dragRef.current.startY)),
      });
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  const cpuPct = stats?.cpu_pct ?? 0;
  const ramPct = stats ? (stats.used_mb / stats.total_mb) * 100 : 0;

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, width: 300, zIndex: 9999, userSelect: 'none' }}
      className="rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.6)] border border-white/10"
    >
      {/* Dark glass background */}
      <div className="bg-[#0f1117]/95 backdrop-blur-2xl">

        {/* Title bar — drag handle */}
        <div
          onMouseDown={onMouseDown}
          className="flex items-center justify-between px-3 py-2.5 cursor-grab active:cursor-grabbing select-none border-b border-white/5"
          style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #0f1117 100%)' }}
        >
          <div className="flex items-center gap-2">
            <GripHorizontal className="w-3 h-3 text-white/20" />
            <Zap className="w-3 h-3 text-[#6A829E]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/60">Activity Monitor</span>
          </div>
          <div className="flex items-center gap-1">
            {/* Traffic light buttons */}
            <button onClick={onMinimize} className="w-3 h-3 rounded-full bg-yellow-400/80 hover:bg-yellow-400 transition-colors flex items-center justify-center group" title="Minimize">
              <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100" />
            </button>
            <button onClick={onClose} className="w-3 h-3 rounded-full bg-red-400/80 hover:bg-red-400 transition-colors flex items-center justify-center group" title="Close">
              <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100" />
            </button>
          </div>
        </div>

        {!minimized && (
          <div className="p-4 space-y-4">
            {/* CPU + RAM gauge row */}
            <div className="flex gap-3">
              {/* CPU card */}
              <div className="flex-1 rounded-xl p-3 flex flex-col items-center gap-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="relative">
                  <GaugeArc pct={cpuPct} color={cpuColor(cpuPct)} size={72} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center pb-2">
                    <Cpu className="w-3.5 h-3.5 text-white/30" />
                  </div>
                </div>
                <div className="text-center w-full">
                  <div className="text-base font-black tabular-nums leading-none" style={{ color: cpuColor(cpuPct) }}>
                    {stats ? `${cpuPct.toFixed(0)}%` : '—'}
                  </div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-white/30 mt-0.5">CPU</div>
                </div>
                <div className="w-full">
                  <Sparkline data={cpuHistory} color={cpuColor(cpuPct)} height={24} />
                </div>
              </div>

              {/* RAM card */}
              <div className="flex-1 rounded-xl p-3 flex flex-col items-center gap-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="relative">
                  <GaugeArc pct={ramPct} color={ramColor(ramPct)} size={72} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center pb-2">
                    <MemoryStick className="w-3.5 h-3.5 text-white/30" />
                  </div>
                </div>
                <div className="text-center w-full">
                  <div className="text-base font-black tabular-nums leading-none" style={{ color: ramColor(ramPct) }}>
                    {stats ? `${(stats.used_mb / 1024).toFixed(1)}` : '—'}
                    <span className="text-[9px] font-bold text-white/30">GB</span>
                  </div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-white/30 mt-0.5">
                    {stats ? `of ${(stats.total_mb / 1024).toFixed(0)} GB` : 'RAM'}
                  </div>
                </div>
                <div className="w-full">
                  <Sparkline data={ramHistory} color={ramColor(ramPct)} height={24} />
                </div>
              </div>
            </div>

            {/* Memory pressure bar */}
            {stats && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[9px] font-bold text-white/30">
                  <span>Memory Pressure</span>
                  <span className="tabular-nums" style={{ color: ramColor(ramPct) }}>{ramPct.toFixed(0)}%</span>
                </div>
                <MiniBar pct={ramPct} color={ramColor(ramPct)} />
                <div className="flex justify-between text-[9px] text-white/20">
                  <span>{(stats.available_mb / 1024).toFixed(1)} GB free</span>
                  <span>{(stats.used_mb / 1024).toFixed(1)} GB used</span>
                </div>
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-white/5" />

            {/* Connectivity */}
            <div className="space-y-2">
              <div className="text-[9px] font-black uppercase tracking-widest text-white/30">Connectivity</div>

              {/* Internet row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {stats?.internet
                    ? <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                    : <WifiOff className="w-3.5 h-3.5 text-red-400" />}
                  <span className="text-xs font-bold text-white/70">Internet</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusDot ok={stats?.internet ?? null} />
                  <span className={`text-[10px] font-bold ${stats?.internet ? 'text-emerald-400' : stats ? 'text-red-400' : 'text-white/30'}`}>
                    {stats ? (stats.internet ? 'Online' : 'Offline') : '—'}
                  </span>
                </div>
              </div>

              {/* Model rows */}
              {modelStatuses.map(m => (
                <div key={m.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                    <Server className="w-3 h-3 text-white/25 shrink-0" />
                    <span className="text-[11px] font-semibold text-white/60 truncate">{m.name}</span>
                    {m.id === selectedModelId && (
                      <span className="text-[8px] font-black uppercase bg-[#1E2B38] text-[#6A829E] px-1.5 py-0.5 rounded-full shrink-0 border border-[#4A5D75]/30">active</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <StatusDot ok={m.ok} />
                    <span className={`text-[10px] font-bold ${m.ok === true ? 'text-emerald-400' : m.ok === false ? 'text-red-400' : 'text-white/30'}`}>
                      {m.ok === null ? 'checking' : m.ok ? 'ok' : 'down'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-1.5 border-t border-white/5 flex items-center justify-between">
          <span className="text-[9px] text-white/20 font-mono">2s · 15s</span>
          <span className="text-[9px] text-white/20 font-mono">{stats ? 'live' : 'connecting…'}</span>
        </div>
      </div>
    </div>
  );
}

// ── Exported component ────────────────────────────────────────────────────────
export function ActivityMonitor() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  // Derive a dot color from a quick lightweight poll when window is closed
  const [dotColor, setDotColor] = useState('#a3a3a3');

  useEffect(() => {
    const poll = async () => {
      try {
        const s = await invoke<SystemStats>('get_system_stats');
        const cpuPct = s.cpu_pct;
        const ramPct = (s.used_mb / s.total_mb) * 100;
        const busy = cpuPct > 70 || ramPct > 80;
        const warn = cpuPct > 50 || ramPct > 65;
        setDotColor(busy ? '#f87171' : warn ? '#fbbf24' : '#34d399');
      } catch {}
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  const handleOpen = () => {
    setOpen(true);
    setMinimized(false);
  };

  return (
    <>
      {/* Header trigger button */}
      <button
        onClick={open ? () => setMinimized(v => !v) : handleOpen}
        className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 ${open ? 'bg-[#D6E0EA] dark:bg-[#1E2B38]/50 text-[#4A5D75]' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400'}`}
        title={open ? (minimized ? 'Restore Activity Monitor' : 'Minimize Activity Monitor') : 'Open Activity Monitor'}
      >
        <Activity className="w-5 h-5" />
        <span className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-700"
          style={{ background: dotColor, boxShadow: `0 0 5px ${dotColor}99` }} />
      </button>

      {/* Portal-rendered floating window */}
      {open && createPortal(
        <MonitorWindow
          onClose={() => setOpen(false)}
          onMinimize={() => setMinimized(v => !v)}
          minimized={minimized}
        />,
        document.body
      )}
    </>
  );
}
