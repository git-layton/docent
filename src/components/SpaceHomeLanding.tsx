import React from 'react';
import clsx from 'clsx';
import {
  Bot,
  PenLine,
  Telescope,
  Globe,
  CalendarRange,
  Code2,
} from 'lucide-react';
import { useGroundedSuggestions } from '../lib/useGroundedSuggestions';
import { useSpaceStore } from '../store/useSpaceStore';
import { OmniSearch } from './OmniSearch';
import type { SearchDoc } from '../services/universalSearch';

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
  // ── Grounded status: built from real local data, no LLM round-trip ──
  const { statusItems, chips: dynamicChips } = useGroundedSuggestions();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);

  // Open a hit within this Space: focus the matching tab, or jump to the conversation log.
  const runSpaceDoc = (doc: SearchDoc) => {
    const st = useSpaceStore.getState();
    if (doc.id.startsWith('tab-')) st.setActiveTab(doc.id.slice(4));
    else if (doc.id.startsWith('chat-')) {
      const log = st.omniTabs.find((t) => t.type === 'space-log' && t.spaceId === activeSpaceId);
      if (log) st.setActiveTab(log.id);
    }
  };

  const chips = suggestions
    ?? [...dynamicChips, ...DEFAULT_SUGGESTIONS.filter((d) => !dynamicChips.some((c) => c.icon === d.icon))].slice(0, 6);
  const subtitle = agentName
    ? `Chat with ${agentName}, or pick a starting point below to get going.`
    : 'Ask anything, or pick a starting point below to get going.';

  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        {/* Agent Forge brand mark — matches the sidebar logo */}
        <div className="relative mb-7">
          <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-accent shadow-lg shadow-black/20">
            <Bot className="h-7 w-7 text-on-accent drop-shadow-sm" strokeWidth={2.25} />
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

        {/* Scoped search — same omni-bar as global Home, but reaching only this Space's
            tabs + conversation. ↵ falls through to the Space's agent. */}
        {activeSpaceId && (
          <OmniSearch
            className="z-10 mt-6 max-w-xl"
            scope={{ kind: 'space', spaceId: activeSpaceId }}
            agentName={agentName}
            placeholder={agentName ? `Search this space, or ask ${agentName}…` : 'Search this space, or ask your agent…'}
            onAsk={onSendPrompt}
            onRun={runSpaceDoc}
          />
        )}

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
