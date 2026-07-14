import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, ChevronDown, ChevronUp, Cpu, MemoryStick, Wifi, WifiOff, X, Trash2, Terminal, Gauge, AlertTriangle, Moon, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useUIStore } from '../store/useUIStore';
import { useAgentStore } from '../store/useAgentStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { getSystemPromptBreakdown } from '../services/llm';
import type { ContextHealth, ContextHealthRecommendation } from '../services/contextHealth';

interface SystemStats {
  cpu_pct: number;
  total_mb: number;
  used_mb: number;
  available_mb: number;
  internet: boolean;
}

interface ActivityMonitorButtonProps {
  visible: boolean;
  onToggle: () => void;
}

interface ActivityMonitorBarProps {
  messages: any[];
  systemPromptLen: number;
  limit: number;
  health: ContextHealth;
  showContext?: boolean;
  onHide: () => void;
  onRunDreamCycle?: () => void;
}

function pctColor(pct: number) {
  if (pct > 90) return '#C98A8A';
  if (pct > 75) return '#D4AA7D';
  return '#9FBBAF';
}

// Context is shown by HEALTH, not fullness — a full window that's self-managing
// is the normal steady state of a never-ending conversation, never a red alert.
const HEALTH_COLORS: Record<ContextHealth['status'], string> = {
  healthy: '#9FBBAF',
  optimized: '#A79FC9',
  attention: '#D4AA7D',
};

function HealthRecommendations({
  recommendations,
  onRunDreamCycle,
}: {
  recommendations: ContextHealthRecommendation[];
  onRunDreamCycle?: () => void;
}) {
  const isDreamRunning = useMemoryStore(s => s.isDreamRunning);
  if (recommendations.length === 0) return null;
  return (
    <>
      {recommendations.map(rec => (
        <div key={rec.id} className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-2">
          {rec.id === 'dream'
            ? <Moon className="w-3 h-3 mt-0.5 shrink-0" style={{ color: HEALTH_COLORS.optimized }} />
            : <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: HEALTH_COLORS.attention }} />}
          <span>{rec.text}</span>
          {rec.id === 'dream' && onRunDreamCycle && (
            <button
              onClick={onRunDreamCycle}
              disabled={isDreamRunning}
              className="shrink-0 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-accent hover:bg-accent-soft transition-colors disabled:opacity-50"
            >
              {isDreamRunning ? <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Dreaming</> : 'Run now'}
            </button>
          )}
        </div>
      ))}
    </>
  );
}


function formatGb(mb: number) {
  return `${(mb / 1024).toFixed(1)}GB`;
}

function StatusPill({
  icon,
  label,
  value,
  color,
  title,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  color: string;
  title?: string;
}) {
  return (
    <div title={title ?? label} className="hidden sm:flex items-center gap-1 min-w-0">
      <span className="shrink-0 opacity-50" style={{ color }}>{icon}</span>
      <span className="text-[10px] font-medium tabular-nums text-ink-3">{value}</span>
    </div>
  );
}

export function ActivityMonitorButton({ visible, onToggle }: ActivityMonitorButtonProps) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={visible}
      className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 ${
        visible
          ? 'bg-accent-soft text-accent-soft-ink'
          : 'hover:bg-wash text-ink-3'
      }`}
      title={visible ? 'Hide Activity Bar' : 'Show Activity Bar'}
    >
      <Activity className="w-5 h-5" />
    </button>
  );
}

export function ActivityMonitorBar({
  messages,
  systemPromptLen,
  limit,
  health,
  showContext = true,
  onHide,
  onRunDreamCycle,
}: ActivityMonitorBarProps) {
  const ramStats = useUIStore(s => s.ramStats);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Store reads for context breakdown
  const assistants = useAgentStore(s => s.assistants);
  const activeFolderId = useAgentStore(s => s.activeFolderId);
  const globalPins = useMemoryStore(s => s.globalPins);
  const userProfile = useSettingsStore(s => s.userProfile);
  const tasks = useTaskStore(s => s.tasks);

  const activeAssistant = useMemo(
    () => assistants.find(a => a.id === activeFolderId) ?? assistants[0],
    [assistants, activeFolderId],
  );

  const breakdown = useMemo(() => {
    const agent = activeAssistant;
    const profile = userProfile;
    const pins = globalPins.filter((p: any) => p.agentId === agent?.id);
    const trainingDocs = agent?.trainingDocs ?? [];
    return getSystemPromptBreakdown({ agent, profile, pinnedMessages: pins, trainingDocs, tasks });
  }, [activeAssistant, userProfile, globalPins, tasks]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await invoke<SystemStats>('get_system_stats');
        if (!cancelled) setStats(next);
      } catch {
        if (!cancelled) setStats(null);
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const mergedStats = stats ?? (ramStats ? { ...ramStats, cpu_pct: 0, internet: true } : null);
  const cpuPct = stats?.cpu_pct ?? 0;
  const ramPct = mergedStats ? Math.min((mergedStats.used_mb / mergedStats.total_mb) * 100, 100) : 0;
  const contextUsed = useMemo(
    () => messages.reduce((n: number, m: any) => n + String(m.content ?? '').length, 0) + systemPromptLen,
    [messages, systemPromptLen],
  );
  const contextPct = health.fillPct;
  const contextColor = HEALTH_COLORS[health.status];
  const cpuColor = pctColor(cpuPct);
  const ramColor = pctColor(ramPct);
  const contextTitle = `${health.headline} — ${health.detail} (${contextUsed.toLocaleString()} / ${limit.toLocaleString()} chars)`;

  // When system load runs hot, tell the user what they can actually do about it.
  // Context health has its own recommendation pipeline (services/contextHealth).
  const availMb = mergedStats?.available_mb ?? Infinity;
  const tips: string[] = [];
  if (availMb < 2048) tips.push('Memory is very low — close other apps (browser tabs, etc.), or switch to a smaller model in Settings → AI Models. A big model like a 70B can outgrow this Mac.');
  else if (availMb < 4096) tips.push('Memory is getting tight — a smaller or faster model (like the 30B MoE) will run smoother here.');

  return (
    <div className="shrink-0 border-b border-edge bg-panel-2/95 backdrop-blur-md">
      {/* Main bar */}
      <div className="h-7 px-3 lg:px-4 flex items-center gap-3 overflow-hidden">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: ramColor, boxShadow: `0 0 5px ${ramColor}88` }} />
        </div>

        <div className="h-3 w-px bg-edge-2 shrink-0" />

        <StatusPill
          icon={<Cpu className="w-3 h-3" />}
          label="CPU"
          value={stats ? `${cpuPct.toFixed(0)}%` : '--'}
          color={cpuColor}
        />
        <StatusPill
          icon={<MemoryStick className="w-3 h-3" />}
          label="RAM"
          value={mergedStats ? `${ramPct.toFixed(0)}%` : '--'}
          color={ramColor}
          title={mergedStats ? `${formatGb(mergedStats.available_mb)} free of ${formatGb(mergedStats.total_mb)}` : undefined}
        />
        <StatusPill
          icon={stats?.internet ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          label="Net"
          value={stats ? (stats.internet ? 'on' : 'off') : '--'}
          color={stats?.internet ? '#9FBBAF' : '#C98A8A'}
        />

        {showContext && (
          <div title={contextTitle} className="ml-auto flex min-w-[9rem] max-w-[44rem] flex-1 items-center gap-2">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: contextColor, boxShadow: `0 0 5px ${contextColor}88` }} />
              <span className="text-[10px] font-medium text-ink-3">{health.headline}</span>
            </div>
            <div className="h-1.5 flex-1 rounded-full bg-inset overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${contextPct}%`, background: contextColor, boxShadow: `0 0 6px ${contextColor}66` }}
              />
            </div>
          </div>
        )}

        {showContext && (
          <button
            onClick={() => setIsExpanded(v => !v)}
            className="p-1 rounded-md text-ink-3 hover:text-ink hover:bg-wash transition-colors shrink-0"
            title={isExpanded ? 'Hide context breakdown' : 'Show context breakdown'}
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}

        <button
          onClick={onHide}
          className="p-1 -mr-1 rounded-md text-ink-3 hover:text-ink hover:bg-wash transition-colors shrink-0"
          title="Hide Activity Bar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Actionable tips: system pressure + context health recommendations */}
      {(tips.length > 0 || health.recommendations.length > 0) && (
        <div className="px-3 lg:px-4 pb-2 space-y-1">
          {tips.map((t, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-2">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: '#D4AA7D' }} />
              <span>{t}</span>
            </div>
          ))}
          <HealthRecommendations recommendations={health.recommendations} onRunDreamCycle={onRunDreamCycle} />
        </div>
      )}

      {/* Expanded context breakdown panel */}
      {isExpanded && showContext && (
        <div className="px-3 lg:px-4 pb-3 mt-1">
          <div className="text-[9px] font-black uppercase tracking-widest text-ink-3 mb-2">Context Breakdown</div>
          <div className="space-y-1.5">
            {(() => {
              // Include the conversation itself — the breakdown should account for the WHOLE
              // window, not just the prompt scaffolding, so "what is my context made of?" has
              // an honest answer.
              const chatChars = Math.max(0, contextUsed - systemPromptLen);
              const rows = [
                { label: 'Chat', chars: chatChars, color: 'bg-violet-400' },
                { label: 'System', chars: breakdown.systemChars, color: 'bg-blue-400' },
                { label: 'Pins', chars: breakdown.pinsChars, color: 'bg-amber-400' },
                { label: 'Docs', chars: breakdown.docsChars, color: 'bg-emerald-400' },
                ...(breakdown.browserChars > 0
                  ? [{ label: 'Browser', chars: breakdown.browserChars, color: 'bg-teal-500' }]
                  : []),
              ];
              return rows;
            })().map(({ label, chars, color }, _i, rows) => {
              const totalAll = rows.reduce((n, r) => n + r.chars, 0);
              const pct = totalAll > 0 ? Math.round((chars / totalAll) * 100) : 0;
              const kb = (chars / 1000).toFixed(1);
              return (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-12 text-[9px] font-black uppercase tracking-widest text-ink-3 shrink-0">{label}</div>
                  <div className="flex-1 h-1.5 bg-inset rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-10 text-right text-[9px] font-medium text-ink-3 shrink-0">{kb}k</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ActivityPanel — the full-screen "Activity" app (Home tile + OmniTab).
// Consolidates what used to live in the chat header's activity bar: live system
// performance (CPU / RAM / Net), the conversation's context-window usage +
// breakdown, and the rolling console / error log.
// ───────────────────────────────────────────────────────────────────────────
function StatCard({
  icon,
  label,
  value,
  sub,
  color,
  pct,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string;
  pct?: number;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-panel p-4">
      <div className="flex items-center gap-2 text-ink-3">
        <span style={{ color }}>{icon}</span>
        <span className="text-[11px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-3">{sub}</div>}
      {pct !== undefined && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-inset">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}66` }}
          />
        </div>
      )}
    </div>
  );
}

interface ActivityPanelProps {
  messages: any[];
  systemPromptLen: number;
  limit: number;
  health: ContextHealth;
  onRunDreamCycle?: () => void;
}

export function ActivityPanel({ messages, systemPromptLen, limit, health, onRunDreamCycle }: ActivityPanelProps) {
  const ramStats = useUIStore(s => s.ramStats);
  const logs = useUIStore(s => s.logs);
  const [stats, setStats] = useState<SystemStats | null>(null);

  // Stores feeding the context breakdown.
  const assistants = useAgentStore(s => s.assistants);
  const activeFolderId = useAgentStore(s => s.activeFolderId);
  const globalPins = useMemoryStore(s => s.globalPins);
  const userProfile = useSettingsStore(s => s.userProfile);
  const tasks = useTaskStore(s => s.tasks);

  const activeAssistant = useMemo(
    () => assistants.find(a => a.id === activeFolderId) ?? assistants[0],
    [assistants, activeFolderId],
  );

  const breakdown = useMemo(() => {
    const pins = globalPins.filter((p: any) => p.agentId === activeAssistant?.id);
    const trainingDocs = activeAssistant?.trainingDocs ?? [];
    return getSystemPromptBreakdown({ agent: activeAssistant, profile: userProfile, pinnedMessages: pins, trainingDocs, tasks });
  }, [activeAssistant, userProfile, globalPins, tasks]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await invoke<SystemStats>('get_system_stats');
        if (!cancelled) setStats(next);
      } catch {
        if (!cancelled) setStats(null);
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const mergedStats = stats ?? (ramStats ? { ...ramStats, cpu_pct: 0, internet: true } : null);
  const cpuPct = stats?.cpu_pct ?? 0;
  const ramPct = mergedStats ? Math.min((mergedStats.used_mb / mergedStats.total_mb) * 100, 100) : 0;
  const contextUsed = useMemo(
    () => messages.reduce((n: number, m: any) => n + String(m.content ?? '').length, 0) + systemPromptLen,
    [messages, systemPromptLen],
  );
  const contextPct = health.fillPct;
  const healthColor = HEALTH_COLORS[health.status];

  const errorCount = useMemo(() => logs.filter((l: any) => l.level === 'error').length, [logs]);

  return (
    <div className="flex h-full w-full justify-center overflow-hidden bg-base">
      <div className="flex min-h-0 w-full max-w-4xl flex-col gap-6 px-8 py-8">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-danger/40 to-accent/30 ring-1 ring-edge-2">
            <Activity className="h-[18px] w-[18px] text-ink/90" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-ink">Activity</h1>
            <p className="text-[12px] text-ink-3">System performance, context window &amp; console logs</p>
          </div>
        </div>

        {/* System performance */}
        <div className="shrink-0 space-y-3">
          <h2 className="px-1 text-[11px] font-bold uppercase tracking-widest text-ink-3">System</h2>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <StatCard
              icon={<Cpu className="h-4 w-4" />}
              label="CPU"
              value={stats ? `${cpuPct.toFixed(0)}%` : '--'}
              color={pctColor(cpuPct)}
              pct={stats ? cpuPct : 0}
            />
            <StatCard
              icon={<MemoryStick className="h-4 w-4" />}
              label="Memory"
              value={mergedStats ? `${ramPct.toFixed(0)}%` : '--'}
              sub={mergedStats ? `${formatGb(mergedStats.available_mb)} free of ${formatGb(mergedStats.total_mb)}` : undefined}
              color={pctColor(ramPct)}
              pct={ramPct}
            />
            <StatCard
              icon={stats?.internet ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              label="Network"
              value={stats ? (stats.internet ? 'Online' : 'Offline') : '--'}
              color={stats?.internet ? '#9FBBAF' : '#C98A8A'}
            />
          </div>
        </div>

        {/* Context health — status first, fullness second: a full window that's
            self-managing is steady state for a never-ending conversation. */}
        <div className="shrink-0 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-3">Context Health</h2>
            <span className="text-[11px] tabular-nums text-ink-3">
              {contextUsed.toLocaleString()} / {limit.toLocaleString()} chars · {contextPct.toFixed(0)}%
            </span>
          </div>
          <div className="rounded-2xl border border-edge bg-panel p-4">
            <div className="mb-2 flex items-center gap-2">
              <span
                className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: `${healthColor}26`, color: healthColor }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: healthColor }} />
                {health.headline}
              </span>
              <span className="text-[11px] text-ink-3">{health.detail}</span>
            </div>
            <div className="mb-3 flex items-center gap-2 text-ink-3">
              <Gauge className="h-4 w-4" style={{ color: healthColor }} />
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-inset">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${contextPct}%`, background: healthColor, boxShadow: `0 0 6px ${healthColor}66` }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              {[
                { label: 'System', chars: breakdown.systemChars, color: 'bg-blue-400' },
                { label: 'Pins', chars: breakdown.pinsChars, color: 'bg-amber-400' },
                { label: 'Docs', chars: breakdown.docsChars, color: 'bg-emerald-400' },
                ...(breakdown.browserChars > 0
                  ? [{ label: 'Browser', chars: breakdown.browserChars, color: 'bg-teal-500' }]
                  : []),
              ].map(({ label, chars, color }) => {
                const pct = breakdown.total > 0 ? Math.round((chars / breakdown.total) * 100) : 0;
                const kb = (chars / 1000).toFixed(1);
                return (
                  <div key={label} className="flex items-center gap-2">
                    <div className="w-14 shrink-0 text-[10px] font-bold uppercase tracking-widest text-ink-3">{label}</div>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-inset">
                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-10 shrink-0 text-right text-[10px] font-medium text-ink-3">{kb}k</div>
                  </div>
                );
              })}
            </div>
            {health.recommendations.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-edge pt-3">
                <HealthRecommendations recommendations={health.recommendations} onRunDreamCycle={onRunDreamCycle} />
              </div>
            )}
          </div>
        </div>

        {/* Console / logs */}
        <div className="flex min-h-0 flex-1 flex-col space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-ink-3">
              <Terminal className="h-3.5 w-3.5" /> Console
              {errorCount > 0 && (
                <span className="rounded-full bg-danger-soft px-1.5 py-0.5 text-[9px] font-black text-danger">
                  {errorCount} error{errorCount === 1 ? '' : 's'}
                </span>
              )}
            </h2>
            <button
              onClick={() => useUIStore.getState().clearLogs()}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-ink-3 transition-colors hover:bg-wash hover:text-ink"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-edge bg-inset p-4 font-mono text-xs custom-scrollbar select-text">
            {logs.length === 0 ? (
              <span className="italic text-ink-3">No logs yet…</span>
            ) : (
              <div className="space-y-1.5">
                {logs.map((l: any, i: number) => (
                  <div
                    key={i}
                    className={`flex gap-3 ${l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warning' : 'text-ink-2'}`}
                  >
                    <span className="shrink-0 select-none text-ink-3">[{l.time}]</span>
                    <span className="whitespace-pre-wrap break-all">{l.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
