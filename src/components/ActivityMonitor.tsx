import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, ChevronDown, ChevronUp, Cpu, MemoryStick, Wifi, WifiOff, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useUIStore } from '../store/useUIStore';
import { useAgentStore } from '../store/useAgentStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { getSystemPromptBreakdown } from '../services/llm';

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
  showContext?: boolean;
  onHide: () => void;
}

function pctColor(pct: number) {
  if (pct > 90) return '#C98A8A';
  if (pct > 75) return '#D4AA7D';
  return '#9FBBAF';
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
    <div title={title} className="hidden sm:flex items-center gap-1.5 min-w-0 text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
      <span className="shrink-0" style={{ color }}>{icon}</span>
      <span className="hidden lg:inline">{label}</span>
      <span className="tabular-nums text-neutral-700 dark:text-neutral-200">{value}</span>
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
          ? 'bg-[#D6E0EA] dark:bg-[#1E2B38]/50 text-[#4A5D75]'
          : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400'
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
  showContext = true,
  onHide,
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
  const contextPct = limit > 0 ? Math.min((contextUsed / limit) * 100, 100) : 0;
  const contextColor = pctColor(contextPct);
  const cpuColor = pctColor(cpuPct);
  const ramColor = pctColor(ramPct);
  const contextTitle = `Context: ${contextUsed.toLocaleString()} / ${limit.toLocaleString()} chars`;

  return (
    <div className="shrink-0 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/95 dark:bg-neutral-950/95 backdrop-blur-md">
      {/* Main bar */}
      <div className="h-7 px-3 lg:px-4 flex items-center gap-3 overflow-hidden">
        <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-black uppercase tracking-widest text-neutral-400">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: ramColor, boxShadow: `0 0 5px ${ramColor}88` }} />
          <span>Activity</span>
        </div>

        <div className="h-3 w-px bg-neutral-200 dark:bg-neutral-800 shrink-0" />

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
            <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-black uppercase tracking-widest text-neutral-400">
              <span>Context</span>
              <span className="tabular-nums text-neutral-600 dark:text-neutral-300">{contextPct.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 flex-1 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
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
            className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/70 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
            title={isExpanded ? 'Hide context breakdown' : 'Show context breakdown'}
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}

        <button
          onClick={onHide}
          className="p-1 -mr-1 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/70 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
          title="Hide Activity Bar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expanded context breakdown panel */}
      {isExpanded && showContext && (
        <div className="px-3 lg:px-4 pb-3 mt-1">
          <div className="text-[9px] font-black uppercase tracking-widest text-neutral-400 mb-2">Context Breakdown</div>
          <div className="space-y-1.5">
            {[
              { label: 'System', chars: breakdown.systemChars, color: 'bg-blue-400' },
              { label: 'Pins', chars: breakdown.pinsChars, color: 'bg-amber-400' },
              { label: 'Docs', chars: breakdown.docsChars, color: 'bg-emerald-400' },
            ].map(({ label, chars, color }) => {
              const pct = breakdown.total > 0 ? Math.round((chars / breakdown.total) * 100) : 0;
              const kb = (chars / 1000).toFixed(1);
              return (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-12 text-[9px] font-black uppercase tracking-widest text-neutral-500 shrink-0">{label}</div>
                  <div className="flex-1 h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-10 text-right text-[9px] font-medium text-neutral-400 shrink-0">{kb}k</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
