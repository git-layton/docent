import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, MessageSquare, CornerDownLeft, Sparkles, Loader2, Globe, FileText, CheckSquare, Image as ImageIcon } from 'lucide-react';
import clsx from 'clsx';
import { useUIStore } from '../store/useUIStore';
import { useSpaceStore } from '../store/useSpaceStore';
import { useTaskStore } from '../store/useTaskStore';
import { useChatStore } from '../store/useChatStore';
import { rankSearchDocs, type SearchDoc, type ScoredDoc } from '../services/universalSearch';
import { buildSearchCorpus, type SearchScope } from '../services/searchCorpus';
import { searchWebHistory } from '../services/webHistory';
import { quickSearchAnswer, hasSearchModel, type AnswerBasis } from '../services/searchAnswer';
import { searchKnowledgeDocs, mergeRanked, isKnowledgeDoc } from '../services/semanticDocs';
import { useMemoryStore } from '../store/useMemoryStore';
import { INTENTS, cycleIntent, parseIntent, specFor, type OmniIntent } from '../services/omniIntent';

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
    case 'Image': return ImageIcon;
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
  /** Web-intent ↵ — the caller owns opening the browser tab. */
  onWebSearch?: (query: string) => void;
}

export function OmniSearch({
  scope, onAsk, onRun, extraDocs, iconFor, includeWebHistory, agentName, placeholder, autoFocus, className, onActiveChange, onWebSearch,
}: OmniSearchProps) {
  const [query, setQuery] = useState('');
  // Intent set by clicking a chip. A typed prefix overrides it for that query.
  const [sticky, setSticky] = useState<OmniIntent>('auto');
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = parseIntent(query);
  const intent: OmniIntent = parsed.hadPrefix ? parsed.intent : sticky;

  // Subscribe to the stores the corpus draws from, so it stays fresh as they change.
  const savedApps = useUIStore((s) => s.savedApps);
  const omniTabs = useSpaceStore((s) => s.omniTabs);
  const spaces = useSpaceStore((s) => s.spaces);
  const tasks = useTaskStore((s) => s.tasks);
  const chats = useChatStore((s) => s.chats);

  const scopeKey = scope.kind === 'space' ? `space:${scope.spaceId}` : 'global';

  // Switching scope (e.g. moving between Spaces) starts a fresh search.
  useEffect(() => { setQuery(''); setSticky('auto'); }, [scopeKey]);

  const corpus = useMemo<SearchDoc[]>(() => {
    return [...(extraDocs ?? []), ...buildSearchCorpus(scope)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, extraDocs, savedApps, omniTabs, spaces, tasks, chats]);

  // Everything downstream searches the intent-STRIPPED text, so ">cal" looks up "cal", not ">cal".
  const text = parsed.text;
  const q = text.trim().toLowerCase();

  const matches = useMemo<ScoredDoc[]>(() => {
    if (!q) return [];
    // Web history is only worth pulling for the blended and web intents.
    const webDocs: SearchDoc[] = includeWebHistory && (intent === 'auto' || intent === 'web')
      ? searchWebHistory(text, 6).map((h) => ({
          kind: 'Web', id: `web-${h.url}`, title: h.title || h.url, url: h.url, sub: domainOf(h.url), body: h.url, timestamp: h.timestamp,
        }))
      : [];
    const ranked = rankSearchDocs([...corpus, ...webDocs], text, 8, Date.now());
    // An aimed bar shows only what it was aimed at.
    if (intent === 'app') return ranked.filter((d) => d.kind === 'App');
    if (intent === 'web') return ranked.filter((d) => d.kind === 'Web' || d.kind === 'Bookmark');
    if (intent === 'knowledge') return [];
    return ranked;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, corpus, includeWebHistory, intent]);

  // Semantic Knowledge-Core hits — only on the user's own global search (the space bar is
  // privacy-scoped and must not reach cross-agent memory, like includeWebHistory). Debounced and
  // Tauri-guarded, then merged into the lexical matches so the bar ranks by meaning, not keywords.
  // Knowledge intent is explicitly asking for this layer, so it stays on even in app/web mode's absence.
  const semanticEnabled = scope.kind === 'global' && (intent === 'auto' || intent === 'knowledge');
  const [semantic, setSemantic] = useState<ScoredDoc[]>([]);
  useEffect(() => {
    if (!semanticEnabled || !q) { setSemantic([]); return; }
    let stale = false;
    const t = setTimeout(async () => {
      const docs = await searchKnowledgeDocs(text);
      if (!stale) setSemantic(docs);
    }, 300);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, semanticEnabled]);

  const displayed = useMemo<ScoredDoc[]>(
    () => mergeRanked(matches, semanticEnabled ? semantic : [], 8),
    [matches, semantic, semanticEnabled],
  );

  // App intent promotes its best hit into row 0, so the list below must not repeat it. `rows` is the
  // single source of truth for what's listed — keyboard indices and dispatch both read it.
  const topApp = intent === 'app' ? displayed[0] : undefined;
  const rows = useMemo<ScoredDoc[]>(() => (topApp ? displayed.slice(1) : displayed), [displayed, topApp]);

  const resultCount = 1 + rows.length;
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => { setActiveIndex(0); }, [q]);
  useEffect(() => { onActiveChange?.(!!q);   }, [q]);

  // ── AI answer: a short, grounded reply streamed in for natural-language queries ──
  const [answer, setAnswer] = useState('');
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [answerBasis, setAnswerBasis] = useState<AnswerBasis>('unknown');
  const matchesRef = useRef<ScoredDoc[]>(displayed);
  matchesRef.current = displayed;

  const queryText = text.trim();
  const wordCount = queryText ? queryText.split(/\s+/).filter(Boolean).length : 0;
  // Only the blended intent guesses. Once the user has aimed the bar, a streamed answer is latency
  // and tokens spent on something they didn't ask for.
  const wantsAnswer = intent === 'auto' && queryText.length >= 5 && (wordCount >= 2 || queryText.endsWith('?'));
  useEffect(() => {
    setAnswer(''); setAnswerError(null); setAnswering(false); setAnswerBasis('unknown');
    if (!wantsAnswer || !hasSearchModel()) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setAnswering(true);
      try {
        await quickSearchAnswer(queryText, matchesRef.current, {
          signal: ctrl.signal,
          includeWebHistory: !!includeWebHistory, // space scope must not leak global browsing history
          onChunk: (c) => { if (!ctrl.signal.aborted) setAnswer((prev) => prev + c); },
          onBasis: (b) => { if (!ctrl.signal.aborted) setAnswerBasis(b); },
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

  const ask = (s: string) => { const t = s.trim(); if (t) onAsk(t); };

  // What ↵ on row 0 means, per intent. Ask stays the default so plain text + ↵ → chat, unchanged.
  const runPrimary = () => {
    const t = queryText;
    if (!t) return;
    if (intent === 'web') {
      if (onWebSearch) onWebSearch(t);
      else ask(t);
      return;
    }
    if (intent === 'knowledge') {
      const mem = useMemoryStore.getState();
      mem.setMemmoPanelTab('library');
      mem.setShowMemmoPanel(true);
      return;
    }
    // App intent runs the top app hit when there is one; otherwise fall through to the agent.
    if (topApp) { onRun(topApp); return; }
    ask(t);
  };

  const runIndex = (i: number) => {
    if (i <= 0) { runPrimary(); return; }
    const m = rows[i - 1];
    if (!m) return;
    // Semantic Knowledge-Core hits open the Knowledge Base — the caller's onRun only knows about
    // apps/tabs/docs/urls, so keep this here and callers stay unchanged.
    if (isKnowledgeDoc(m.id)) {
      const mem = useMemoryStore.getState();
      mem.setMemmoPanelTab('library');
      mem.setShowMemmoPanel(true);
      return;
    }
    onRun(m);
  };

  // Clicking a chip aims the bar and keeps focus in the input, dropping any typed prefix so the
  // two mechanisms can't disagree about what mode we're in.
  const pickIntent = (next: OmniIntent) => {
    if (parsed.hadPrefix) setQuery(parsed.text);
    setSticky(next);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, resultCount - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); runIndex(activeIndex); }
    else if (e.key === 'Tab') { e.preventDefault(); pickIntent(cycleIntent(intent)); }
    // Escape unwinds one layer at a time: aim first, then the query.
    else if (e.key === 'Escape') {
      if (parsed.hadPrefix) { e.preventDefault(); setQuery(parsed.text); }
      else if (sticky !== 'auto') { e.preventDefault(); setSticky('auto'); }
      else if (q) { e.preventDefault(); setQuery(''); }
    }
    // Backspace on an empty input drops the aim rather than doing nothing.
    else if (e.key === 'Backspace' && !query && sticky !== 'auto') { e.preventDefault(); setSticky('auto'); }
  };

  const resolveIcon = (doc: SearchDoc): React.ElementType => iconFor?.(doc) ?? iconForKind(doc);
  const activeSpec = specFor(intent);
  const ph = intent !== 'auto'
    ? activeSpec.placeholder
    : placeholder ?? (agentName ? `Search, or ask ${agentName} anything…` : 'Search, or ask your agent…');

  // Row 0 — the default ↵ action, relabelled for whatever the bar is currently aimed at.
  const primary: { Icon: React.ElementType; title: string; sub: string } =
    intent === 'web'
      ? { Icon: Globe, title: 'Search the web', sub: `“${queryText}”` }
      : intent === 'knowledge'
        ? { Icon: Sparkles, title: 'Search your knowledge', sub: `“${queryText}”` }
        : topApp
          ? { Icon: resolveIcon(topApp), title: `Open ${topApp.title}`, sub: topApp.sub ?? 'App' }
          : { Icon: MessageSquare, title: agentName ? `Ask ${agentName}` : 'Ask your agent', sub: `“${queryText}”` };

  return (
    <div className={clsx('relative w-full', className)}>
      <div className="flex items-center gap-3 rounded-full border border-edge-2 bg-panel-2 px-5 py-3 shadow-sm transition-colors focus-within:border-accent">
        <Search className="h-4 w-4 shrink-0 text-ink-3" />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={ph}
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 outline-none"
        />
        <kbd className="hidden items-center gap-1 rounded-md border border-edge px-1.5 py-0.5 text-[10px] font-medium text-ink-3 sm:flex">
          <CornerDownLeft className="h-3 w-3" />
          {activeIndex > 0 ? 'open' : intent === 'web' ? 'search' : intent === 'app' ? 'open' : intent === 'knowledge' ? 'browse' : 'ask'}
        </kbd>
        <span className="hidden sm:flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[11px] font-bold text-on-accent">
          {intent === 'auto' ? 'Ask' : activeSpec.label}
        </span>
      </div>

      {/* Intent chips — each shows its own prefix, so clicking teaches the keystroke. Hidden while
          the bar is at rest so the Start page stays calm. */}
      {(q || sticky !== 'auto') && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {INTENTS.map((s) => {
            const on = s.intent === intent;
            return (
              <button
                key={s.intent}
                type="button"
                onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                onClick={() => pickIntent(s.intent)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  on ? 'bg-accent-soft text-accent-soft-ink' : 'bg-wash text-ink-3 hover:text-ink-2',
                )}
              >
                {s.label}
                {s.prefix && (
                  <kbd className={clsx(
                    'rounded px-1 text-[10px] font-bold',
                    on ? 'bg-accent/20' : 'bg-inset text-ink-3',
                  )}>
                    {s.prefix}
                  </kbd>
                )}
              </button>
            );
          })}
          <span className="ml-1 hidden text-[10px] text-ink-3 sm:inline">tab to switch</span>
        </div>
      )}

      {q && (
        <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-edge-2 bg-panel py-1.5 text-left shadow-2xl shadow-black/20">
          {/* AI answer — a short, grounded reply for natural-language queries, streamed in */}
          {wantsAnswer && (answering || answerText || answerError) && (
            <div className="mx-1.5 mb-1 rounded-xl bg-accent-soft/40 px-3.5 py-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent-strong">
                <Sparkles className="h-3 w-3" /> Answer
                {answering && <Loader2 className="h-3 w-3 animate-spin opacity-70" />}
                {/* Basis badge — grounded in the user's data vs. the model's general knowledge.
                    Parsed deterministically from the reply; no badge when the model didn't say. */}
                {answerBasis !== 'unknown' && answerText && (
                  <span
                    className={clsx(
                      'ml-auto rounded-full px-2 py-0.5 text-[9px] font-bold normal-case tracking-normal',
                      answerBasis === 'grounded' && 'bg-success/15 text-success',
                      answerBasis === 'general' && 'bg-inset text-ink-3 border border-edge',
                      answerBasis === 'unsure' && 'bg-warning-soft/60 text-warning',
                    )}
                  >
                    {answerBasis === 'grounded' ? 'From your data' : answerBasis === 'general' ? 'General knowledge' : 'Unsure'}
                  </span>
                )}
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

          {/* Primary row — always index 0, the default ↵ action for the active intent */}
          <ResultRow active={activeIndex === 0} onMouseEnter={() => setActiveIndex(0)} onClick={() => runIndex(0)}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent">
              <primary.Icon className="h-3.5 w-3.5 text-on-accent" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{primary.title}</span>
              <span className="block truncate text-[11px] text-ink-3">{primary.sub}</span>
            </span>
            <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-3" />
          </ResultRow>

          {rows.length > 0 && <div className="my-1 border-t border-edge" />}

          {rows.map((it, i) => {
            const Icon = resolveIcon(it);
            return (
              <ResultRow key={it.id} active={activeIndex === i + 1} onMouseEnter={() => setActiveIndex(i + 1)} onClick={() => runIndex(i + 1)}>
                {it.image ? (
                  <img src={it.image} alt={it.title || 'Image'} className="h-7 w-7 shrink-0 rounded-lg object-cover ring-1 ring-edge" />
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-wash ring-1 ring-edge">
                    <Icon className="h-3.5 w-3.5 text-ink-2" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{it.title}</span>
                  {it.sub && <span className="block truncate text-[11px] text-ink-3">{it.sub}</span>}
                </span>
                <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[10px] font-medium text-ink-3">{it.kind}</span>
              </ResultRow>
            );
          })}

          {rows.length === 0 && !answering && !answerText && (
            <div className="px-3.5 py-2 text-[11px] text-ink-3">
              {intent === 'app' && !topApp
                ? <>No app matches “{queryText}” — press ↵ to ask {agentName ?? 'your agent'} instead.</>
                : intent === 'web'
                  ? <>Press ↵ to search the web for “{queryText}”.</>
                  : intent === 'knowledge'
                    ? <>Nothing in your knowledge yet — press ↵ to browse it.</>
                    : <>No matches — press ↵ to ask {agentName ?? 'your agent'}.</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
