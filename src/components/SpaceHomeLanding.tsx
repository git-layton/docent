import React from 'react';
import clsx from 'clsx';
import {
  Sparkles,
  PenLine,
  Telescope,
  Globe,
  CalendarRange,
  Code2,
} from 'lucide-react';

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
  const chips = suggestions ?? DEFAULT_SUGGESTIONS;
  const subtitle = agentName
    ? `Chat with ${agentName}, or pick a starting point below to get going.`
    : 'Ask anything, or pick a starting point below to get going.';

  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        {/* Gradient glyph */}
        <div className="relative mb-7">
          {/* Soft ambient glow behind the glyph */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 rounded-[28px] bg-gradient-to-br from-[#4A5D75]/50 via-[#6A829E]/35 to-[#9EADC8]/30 blur-2xl"
          />
          <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-gradient-to-br from-[#4A5D75] via-[#3D4D61] to-[#2C3E50] shadow-lg shadow-black/40 ring-1 ring-white/10">
            <Sparkles className="h-7 w-7 text-white drop-shadow-sm" strokeWidth={2.25} />
          </div>
        </div>

        {/* Headline */}
        <h1 className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-2xl font-semibold tracking-tight text-transparent sm:text-3xl">
          What are we diving into today?
        </h1>

        {/* Subtitle */}
        <p className="mt-3 max-w-md text-sm leading-relaxed text-white/45">
          {subtitle}
        </p>

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
                  'border border-white/[0.07] bg-[#12141a] px-4 py-2',
                  'text-[13px] font-medium text-white/70',
                  'shadow-sm transition-all duration-150',
                  'hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-[#171922] hover:text-white',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6A829E]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b0e]',
                  'active:translate-y-0',
                )}
              >
                {Icon && (
                  <Icon
                    className="h-4 w-4 text-[#9EADC8]/80 transition-colors group-hover:text-[#9EADC8]"
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
