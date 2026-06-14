import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, MessageSquare, CornerDownLeft, Sparkles, Loader2, Globe, FileText, CheckSquare } from 'lucide-react';
import clsx from 'clsx';
import { useUIStore } from '../store/useUIStore';
import { useSpaceStore } from '../store/useSpaceStore';
import { useTaskStore } from '../store/useTaskStore';
import { useChatStore } from '../store/useChatStore';
import { rankSearchDocs, type SearchDoc, type ScoredDoc } from '../services/universalSearch';
import { buildSearchCorpus, type SearchScope } from '../services/searchCorpus';
import { searchWebHistory } from '../services/webHistory';
import { quickSearchAnswer, hasSearchModel } from '../services/searchAnswer';

// ---------------------------------------------------------------------------
// OmniSearch — the search-as-you-type bar shared by the global Home and each
// Space. Same UX everywhere; the scope decides what it reaches:
//   • global — apps + the user's docs, tasks, conversations, tabs, web history
//   • space  — only that Space's open tabs + its conversation
// Typing ranks results live (universalSearch); a natural-language query also
// streams a short grounded "Answer". ↵ runs the highlighted row — index 0 is
// always "Ask <agent>", so plain text + ↵ falls through to chat.
// ---------------------------------------------------------------------------

function domainOf(url?: string): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Icon for a ranked hit. Apps carry their own tile icon via extraDocs (iconFor handles the rest).
function iconForKind(doc: SearchDoc): React.ElementType {
  switch (doc.kind) {
    case 'Task': return CheckSquare;
    case 'Chat': return MessageSquare;
    case 'Web':
    case 'Bookmark': return Globe;
    case 'Doc':
    default: return FileText;
  }
}

function ResultRow({ active, onClick, onMouseEnter, children }: {
  active: boolean; onClick: () => void; onMouseEnter?: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={clsx(
        'flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors',
        active ? 'bg-accent-soft' : 'hover:bg-wash',
      )}
    >
      {children}
    </button>
  );
}

export interface OmniSearchProps {
  scope: SearchScope;
  /** ↵ on the (always-present) "Ask" row, or "Continue in chat" — send to the agent. */
  onAsk: (text: string) => void;
  /** Open a ranked result. The caller owns navigation (it knows about apps/tabs/docs). */
  onRun: (doc: SearchDoc) => void;
  /** Extra docs to merge into the corpus — e.g. the launcher apps on global Home. */
  extraDocs?: SearchDoc[];
  /** Resolve an icon for a hit (e.g. apps' own tile icons); falls back to per-kind icons. */
  iconFor?: (doc: SearchDoc) => React.ElementType | undefined;
  includeWebHistory?: boolean;
  agentName?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /** Notified when the query goes non-empty / empty, so a parent can hide content behind results. */
  onActiveChange?: (active: boolean) => void;
}

export function OmniSearch({
  scope, onAsk, onRun, extraDocs, iconFor, includeWebHistory, agentName, placeholder, autoFocus, className, onActiveChange,
}: OmniSearchProps) {
  const [query, setQuery] = useState('');

  // Subscribe to the stores the corpus draws from, so it stays fresh as they change.
  const savedApps = useUIStore((s) => s.savedApps);
  const omniTabs = useSpaceStore((s) => s.omniTabs);
  const spaces = useSpaceStore((s) => s.spaces);
  const tasks = useTaskStore((s) => s.tasks);
  const chats = useChatStore((s) => s.chats);

  const scopeKey = scope.kind === 'space' ? `space:${scope.spaceId}` : 'global';

  // Switching scope (e.g. moving between Spaces) starts a fresh search.
  useEffect(() => { setQuery(''); }, [scopeKey]);

  const corpus = useMemo<SearchDoc[]>(() => {
    return [...(extraDocs ?? []), ...buildSearchCorpus(scope)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, extraDocs, savedApps, omniTabs, spaces, tasks, chats]);

  const q = query.trim().toLowerCase();

  const matches = useMemo<ScoredDoc[]>(() => {
    if (!q) return [];
    const webDocs: SearchDoc[] = includeWebHistory
      ? searchWebHistory(query, 6).map((h) => ({
          kind: 'Web', id: `web-${h.url}`, title: h.title || h.url, url: h.url, sub: domainOf(h.url), body: h.url, timestamp: h.timestamp,
        }))
      : [];
    return rankSearchDocs([...corpus, ...webDocs], query, 8, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, corpus, includeWebHistory]);

  const resultCount = 1 + matches.length;
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => { setActiveIndex(0); }, [q]);
  useEffect(() => { onActiveChange?.(!!q); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [q]);

  // ── AI answer: a short, grounded reply streamed in for natural-language queries ──
  const [answer, setAnswer] = useState('');
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const matchesRef = useRef<ScoredDoc[]>(matches);
  matchesRef.current = matches;

  const queryText = query.trim();
  const wordCount = queryText ? queryText.split(/\s+/).filter(Boolean).length : 0;
  const wantsAnswer = queryText.length >= 5 && (wordCount >= 2 || queryText.endsWith('?'));
  useEffect(() => {
    setAnswer(''); setAnswerError(null); setAnswering(false);
    if (!wantsAnswer || !hasSearchModel()) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setAnswering(true);
      try {
        await quickSearchAnswer(queryText, matchesRef.current, {
          signal: ctrl.signal,
          includeWebHistory: !!includeWebHistory, // space scope must not leak global browsing history
          onChunk: (c) => { if (!ctrl.signal.aborted) setAnswer((prev) => prev + c); },
        });
      } catch (e: any) {
        if (e?.name !== 'AbortError' && !ctrl.signal.aborted) setAnswerError(e?.message ?? 'Search failed.');
      } finally {
        if (!ctrl.signal.aborted) setAnswering(false);
      }
    }, 500);
    return () => { clearTimeout(timer); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryText, wantsAnswer, scopeKey]);

  // Code/action fences never belong in a one-line search answer — strip them for display.
  const answerText = answer.replace(/```[\s\S]*?(?:```|$)/g, '').trim();

  const ask = (text: string) => { const t = text.trim(); if (t) onAsk(t); };

  const runIndex = (i: number) => {
    if (i <= 0) ask(query);
    else { const m = matches[i - 1]; if (m) onRun(m); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, resultCount - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); runIndex(activeIndex); }
    else if (e.key === 'Escape' && q) { e.preventDefault(); setQuery(''); }
  };

  const resolveIcon = (doc: SearchDoc): React.ElementType => iconFor?.(doc) ?? iconForKind(doc);
  const ph = placeholder ?? (agentName ? `Search, or ask ${agentName} anything…` : 'Search, or ask your agent…');

  return (
    <div className={clsx('relative w-full', className)}>
      <div className="flex items-center gap-3 rounded-full border border-edge-2 bg-panel-2 px-5 py-3 shadow-sm transition-colors focus-within:border-accent">
        <Search className="h-4 w-4 shrink-0 text-ink-3" />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={ph}
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 outline-none"
        />
        <kbd className="hidden items-center gap-1 rounded-md border border-edge px-1.5 py-0.5 text-[10px] font-medium text-ink-3 sm:flex">
          <CornerDownLeft className="h-3 w-3" /> {activeIndex === 0 ? 'ask' : 'open'}
        </kbd>
        <span className="hidden sm:flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[11px] font-bold text-on-accent">
          Ask
        </span>
      </div>

      {q && (
        <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-edge-2 bg-panel py-1.5 text-left shadow-2xl shadow-black/20">
          {/* AI answer — a short, grounded reply for natural-language queries, streamed in */}
          {wantsAnswer && (answering || answerText || answerError) && (
            <div className="mx-1.5 mb-1 rounded-xl bg-accent-soft/40 px-3.5 py-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent-strong">
                <Sparkles className="h-3 w-3" /> Answer
                {answering && <Loader2 className="h-3 w-3 animate-spin opacity-70" />}
              </div>
              {answerError ? (
                <p className="text-[12px] text-ink-3">Couldn’t generate an answer: {answerError}</p>
              ) : answerText ? (
                <>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{answerText}</p>
                  <button
                    type="button"
                    onClick={() => runIndex(0)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                  >
                    Continue in chat <CornerDownLeft className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <p className="text-[12px] text-ink-3">Searching your stuff…</p>
              )}
            </div>
          )}

          {/* Ask row — always index 0, the default action */}
          <ResultRow active={activeIndex === 0} onMouseEnter={() => setActiveIndex(0)} onClick={() => runIndex(0)}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent">
              <MessageSquare className="h-3.5 w-3.5 text-on-accent" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{agentName ? `Ask ${agentName}` : 'Ask your agent'}</span>
              <span className="block truncate text-[11px] text-ink-3">“{query.trim()}”</span>
            </span>
            <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-3" />
          </ResultRow>

          {matches.length > 0 && <div className="my-1 border-t border-edge" />}

          {matches.map((it, i) => {
            const Icon = resolveIcon(it);
            return (
              <ResultRow key={it.id} active={activeIndex === i + 1} onMouseEnter={() => setActiveIndex(i + 1)} onClick={() => runIndex(i + 1)}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-wash ring-1 ring-edge">
                  <Icon className="h-3.5 w-3.5 text-ink-2" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{it.title}</span>
                  {it.sub && <span className="block truncate text-[11px] text-ink-3">{it.sub}</span>}
                </span>
                <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[10px] font-medium text-ink-3">{it.kind}</span>
              </ResultRow>
            );
          })}

          {matches.length === 0 && !answering && !answerText && (
            <div className="px-3.5 py-2 text-[11px] text-ink-3">No matches — press ↵ to ask {agentName ?? 'your agent'}.</div>
          )}
        </div>
      )}
    </div>
  );
}
