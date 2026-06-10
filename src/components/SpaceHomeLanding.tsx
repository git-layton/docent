import React from 'react';
import { Sparkles, FileText, Globe, Calendar, Code, Search } from 'lucide-react';

// ---------------------------------------------------------------------------
// SpaceHomeLanding — the "new tab page" hero shown inline (centered) when a
// Space's chat thread is empty. It does NOT render its own input — the chat
// input lives in ChatPanel's footer. Chips funnel through onSendPrompt.
// ---------------------------------------------------------------------------

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

const DEFAULT_SUGGESTIONS: SuggestionChip[] = [
  { id: 'draft-doc', label: 'Draft a document', prompt: 'Help me draft a new document. Ask me what it should cover.', icon: FileText },
  { id: 'research', label: 'Research a topic', prompt: 'Research a topic for me and summarize what you find.', icon: Search },
  { id: 'open-web', label: 'Browse the web', prompt: 'Open a web page for me — ask me which site.', icon: Globe },
  { id: 'plan-day', label: 'Plan my day', prompt: 'Look at my calendar and to-do list and help me plan my day.', icon: Calendar },
  { id: 'write-code', label: 'Build something', prompt: 'Let’s build something in a code canvas. Ask me what.', icon: Code },
];

export function SpaceHomeLanding({ agentName, onSendPrompt, suggestions }: SpaceHomeLandingProps): React.ReactElement {
  const chips = suggestions ?? DEFAULT_SUGGESTIONS;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center select-none">
      {/* Glyph */}
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4A5D75] to-[#2C3E50] flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.4)] mb-6">
        <Sparkles className="w-7 h-7 text-white/90" />
      </div>

      {/* Headline */}
      <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white max-w-md leading-tight">
        What are we diving into today?
      </h1>
      <p className="mt-3 text-sm text-[rgba(255,255,255,0.5)] max-w-sm leading-relaxed">
        Chat with {agentName ? agentName : 'your team'}, search the web, or open an app.
      </p>

      {/* Suggestion chips */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2 max-w-lg">
        {chips.map(chip => {
          const Icon = chip.icon ?? Sparkles;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => onSendPrompt(chip.prompt)}
              className="group flex items-center gap-2 px-3.5 py-2 rounded-full bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.7)] hover:text-white text-xs font-medium transition-all"
            >
              <Icon className="w-3.5 h-3.5 shrink-0 opacity-70 group-hover:opacity-100" />
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
