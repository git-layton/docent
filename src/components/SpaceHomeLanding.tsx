import React, { useMemo } from 'react';
import clsx from 'clsx';
import {
  Sparkles,
  PenLine,
  Telescope,
  Globe,
  CalendarRange,
  Code2,
  CheckSquare,
  FileText,
  Mail,
  Cake,
} from 'lucide-react';
import { useTaskStore, taskCoversDate } from '../store/useTaskStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';

export interface SuggestionChip {
  id: string;
  label: string;
  prompt: string;
  icon?: React.ElementType;
}

interface SpaceHomeLandingProps {
  agentName?: string;
  onSendPrompt: (text: string) => void;
  suggestions?: SuggestionChip[];
}

/**
 * Default suggestion set — spans the common modes of work so the empty state
 * feels genuinely useful rather than decorative: drafting, research, web,
 * planning, and building.
 */
const DEFAULT_SUGGESTIONS: SuggestionChip[] = [
  {
    id: 'draft',
    label: 'Draft something',
    prompt: 'Help me draft a clear, well-structured first version of something. Ask me what it is, who it is for, and the tone you should hit before you start.',
    icon: PenLine,
  },
  {
    id: 'research',
    label: 'Research a topic',
    prompt: 'I want to dig into a topic in depth. Ask me what to research, then give me a structured briefing with the key facts, tradeoffs, and open questions.',
    icon: Telescope,
  },
  {
    id: 'web',
    label: 'Search the web',
    prompt: 'Search the web for the latest on a topic I care about and summarize what you find with sources. Ask me what to look up first.',
    icon: Globe,
  },
  {
    id: 'plan',
    label: 'Plan my week',
    prompt: 'Help me plan the week ahead. Ask me about my priorities, deadlines, and constraints, then propose a realistic day-by-day plan.',
    icon: CalendarRange,
  },
  {
    id: 'build',
    label: 'Build a quick tool',
    prompt: 'Help me build a small, self-contained tool or script. Ask me what it should do and what inputs and outputs you should design around.',
    icon: Code2,
  },
];

export function SpaceHomeLanding({
  agentName,
  onSendPrompt,
  suggestions,
}: SpaceHomeLandingProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const recurringEvents = useTaskStore((s) => s.recurringEvents);
  const savedApps = useUIStore((s) => s.savedApps);
  const integrations = useSettingsStore((s) => s.integrations);

  // ── Grounded status: built from real local data, no LLM round-trip ──
  const { statusItems, dynamicChips } = useMemo(() => {
    const items: { id: string; icon: React.ElementType; text: string }[] = [];
    const chips: SuggestionChip[] = [];

    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const open = tasks.filter((t: any) => !t.completed);
    const dueToday = open.filter((t: any) => taskCoversDate(t, iso));
    if (open.length > 0) {
      items.push({
        id: 'tasks',
        icon: CheckSquare,
        text: dueToday.length > 0
          ? `${open.length} open task${open.length !== 1 ? 's' : ''} — ${dueToday.length} due today`
          : `${open.length} open task${open.length !== 1 ? 's' : ''}`,
      });
      chips.push({
        id: 'tasks-chip',
        label: dueToday.length > 0 ? "What's due today?" : 'Review my open tasks',
        prompt: dueToday.length > 0
          ? 'Walk me through what is due today from my pending tasks, then help me decide what to tackle first.'
          : 'Review my open tasks with me. Summarize them, flag anything that looks stale or urgent, and suggest an order of attack.',
        icon: CheckSquare,
      });
    }

    const todaysEvents = (recurringEvents ?? []).filter(
      (e: any) => e.month === now.getMonth() + 1 && e.day === now.getDate(),
    );
    if (todaysEvents.length > 0) {
      items.push({
        id: 'events',
        icon: Cake,
        text: `Today: ${todaysEvents.map((e: any) => e.name).join(', ')}`,
      });
    }

    const recentDoc = [...(savedApps ?? [])]
      .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .find((d: any) => d.updatedAt && Date.now() - d.updatedAt < 7 * 24 * 60 * 60 * 1000);
    if (recentDoc) {
      const title = recentDoc.title || 'Untitled';
      items.push({ id: 'doc', icon: FileText, text: `Last touched: “${title}”` });
      chips.push({
        id: 'resume-doc',
        label: `Resume “${title.length > 24 ? `${title.slice(0, 24)}…` : title}”`,
        prompt: `Let's pick up where I left off on "${title}". Recap what it is, then ask me what I want to change or add next.`,
        icon: FileText,
      });
    }

    if (((integrations as any)?.mailAccounts ?? []).length > 0) {
      chips.push({
        id: 'inbox-chip',
        label: 'Summarize my inbox',
        prompt: 'Check my mail and give me a short summary of what is new or needs a reply, grouped by importance.',
        icon: Mail,
      });
    }

    return { statusItems: items, dynamicChips: chips };
  }, [tasks, recurringEvents, savedApps, integrations]);

  const chips = suggestions
    ?? [...dynamicChips, ...DEFAULT_SUGGESTIONS.filter((d) => !dynamicChips.some((c) => c.icon === d.icon))].slice(0, 6);
  const subtitle = agentName
    ? `Chat with ${agentName}, or pick a starting point below to get going.`
    : 'Ask anything, or pick a starting point below to get going.';

  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        {/* Accent glyph */}
        <div className="relative mb-7">
          <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-accent shadow-lg shadow-black/20">
            <Sparkles className="h-7 w-7 text-on-accent drop-shadow-sm" strokeWidth={2.25} />
          </div>
        </div>

        {/* Headline */}
        <h1 className="font-serif text-2xl tracking-tight text-ink sm:text-3xl">
          What are we diving into today?
        </h1>

        {/* Subtitle */}
        <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-3">
          {subtitle}
        </p>

        {/* While-you-were-away status — grounded in real local data */}
        {statusItems.length > 0 && (
          <div className="mt-6 w-full max-w-md rounded-2xl border border-edge bg-panel-2 px-4 py-3 text-left">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-ink-3">
              While you were away
            </p>
            <ul className="space-y-1.5">
              {statusItems.map(({ id, icon: Icon, text }) => (
                <li key={id} className="flex items-center gap-2.5 text-[13px] text-ink-2">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                  <span className="min-w-0 truncate">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Suggestion chips */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
          {chips.map((chip) => {
            const Icon = chip.icon;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => onSendPrompt(chip.prompt)}
                className={clsx(
                  'group inline-flex items-center gap-2 rounded-full',
                  'border border-edge bg-panel-2 px-4 py-2',
                  'text-[13px] font-medium text-ink-2',
                  'shadow-sm transition-all duration-150',
                  'hover:-translate-y-0.5 hover:border-accent hover:text-accent-strong',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-panel',
                  'active:translate-y-0',
                )}
              >
                {Icon && (
                  <Icon
                    className="h-4 w-4 text-accent transition-colors"
                    aria-hidden="true"
                  />
                )}
                <span>{chip.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SpaceHomeLanding;
