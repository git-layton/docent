import { useEffect, useMemo, useState } from 'react';
import { Search, MessageSquarePlus, FileText, Pin, Loader2, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import {
  SHELVES,
  buildEntityItems,
  mergeSearchHits,
  matchesQuery,
  rankItems,
  groupByShelf,
  searchNoteContent,
  buildTopicChatPrompt,
  type LibraryItem,
  type ShelfId,
  type GraphNodeLike,
  type GraphEdgeLike,
  type RagHitLike,
} from '../services/knowledgeLibrary';

const NODE_COLORS: Record<string, string> = {
  page: '#38bdf8', file: '#a78bfa', note: '#34d399', entity: '#f97316', person: '#f97316',
  org: '#fb923c', place: '#f472b6', product: '#fbbf24', concept: '#facc15', technology: '#facc15',
};
const colorFor = (item: LibraryItem): string =>
  item.kind === 'note' ? '#34d399' : (NODE_COLORS[String(item.nodeType).toLowerCase()] ?? '#94a3b8');

interface KnowledgeLibraryViewProps {
  nodes: GraphNodeLike[];
  edges: GraphEdgeLike[];
  /** Notes/dossiers already loaded by the panel (listing + previews). */
  noteItems: LibraryItem[];
  loading: boolean;
  agentId?: string | null;
  onOpenEntity: (nodeId: string) => void;
  onOpenNote: (path: string) => void;
  onSendPrompt?: (text: string) => void;
}

/**
 * The Knowledge Base as a library you can actually use: notes and extracted entities on the same
 * shelves, a search box that looks inside note content rather than only at labels, and a way to
 * start a conversation about anything you find. Previously this was a flat grid of graph nodes —
 * saved notes were not shown here at all, and search matched node labels only.
 */
export function KnowledgeLibraryView({
  nodes, edges, noteItems, loading, agentId, onOpenEntity, onOpenNote, onSendPrompt,
}: KnowledgeLibraryViewProps) {
  const [query, setQuery] = useState('');
  const [shelfFilter, setShelfFilter] = useState<ShelfId | 'all'>('all');
  const [hits, setHits] = useState<RagHitLike[]>([]);
  const [searching, setSearching] = useState(false);

  // Semantic search over note CONTENT, debounced. Local label matching happens synchronously below,
  // so typing stays responsive and the content hits fold in when they land.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchNoteContent(q, agentId)
        .then(results => { if (!cancelled) setHits(results); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, agentId]);

  const entityItems = useMemo(() => buildEntityItems(nodes, edges), [nodes, edges]);

  const grouped = useMemo(() => {
    const all = mergeSearchHits([...entityItems, ...noteItems], hits);
    // A semantic hit is a match even when the query words appear nowhere in the title, so keep
    // anything the search scored alongside the locally-matched items.
    const matched = all.filter(item => item.score !== undefined || matchesQuery(item, query));
    return groupByShelf(rankItems(matched, query));
  }, [entityItems, noteItems, hits, query]);

  const totalMatched = useMemo(
    () => Object.values(grouped).reduce((sum, list) => sum + list.length, 0),
    [grouped],
  );

  const visibleShelves = SHELVES.filter(
    s => (shelfFilter === 'all' || shelfFilter === s.id) && grouped[s.id].length > 0,
  );

  const handleChat = (item: LibraryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onSendPrompt) return;
    const prompt = buildTopicChatPrompt(item);
    if (prompt) onSendPrompt(prompt);
  };

  const openItem = (item: LibraryItem) => {
    if (item.kind === 'note' && item.path) onOpenNote(item.path);
    else if (item.kind === 'entity') onOpenEntity(item.id);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search + shelf navigation */}
      <div className="shrink-0 px-4 pt-3 pb-2 border-b border-edge space-y-2.5">
        <div className="relative">
          {searching
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-accent animate-spin" />
            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />}
          <input
            className="w-full bg-inset rounded-xl pl-9 pr-3 py-2.5 text-xs outline-none focus:ring-1 ring-accent/40 placeholder:text-ink-3"
            placeholder="Search everything you've saved — people, topics, and inside your notes…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div className="flex gap-1 flex-wrap items-center">
          <button
            onClick={() => setShelfFilter('all')}
            className={clsx(
              'px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all',
              shelfFilter === 'all' ? 'bg-accent text-on-accent' : 'bg-inset text-ink-3 hover:text-ink-2',
            )}
          >
            Everything
          </button>
          {SHELVES.map(s => {
            const count = grouped[s.id].length;
            return (
              <button
                key={s.id}
                onClick={() => setShelfFilter(s.id)}
                disabled={count === 0}
                className={clsx(
                  'px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all disabled:opacity-30',
                  shelfFilter === s.id ? 'bg-accent text-on-accent' : 'bg-inset text-ink-3 hover:text-ink-2',
                )}
              >
                {s.label} {count > 0 && <span className="opacity-60">{count}</span>}
              </button>
            );
          })}
          <span className="ml-auto text-[10px] text-ink-3">
            {totalMatched} item{totalMatched === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Shelves */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-xs text-ink-3">
            <Loader2 className="w-4 h-4 animate-spin" /> Opening your knowledge base…
          </div>
        ) : totalMatched === 0 ? (
          <EmptyState query={query} hasAnything={nodes.length > 0 || noteItems.length > 0} onSendPrompt={onSendPrompt} />
        ) : (
          <div className="space-y-7">
            {visibleShelves.map(shelf => (
              <section key={shelf.id}>
                <div className="flex items-baseline gap-2 mb-2.5">
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-ink">{shelf.label}</h3>
                  <span className="text-[10px] text-ink-3">{shelf.blurb}</span>
                  <span className="ml-auto text-[10px] font-bold text-ink-3">{grouped[shelf.id].length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {grouped[shelf.id].map(item => (
                    <LibraryCard
                      key={`${item.kind}:${item.id}`}
                      item={item}
                      onOpen={() => openItem(item)}
                      onChat={onSendPrompt ? e => handleChat(item, e) : undefined}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryCard({ item, onOpen, onChat }: {
  item: LibraryItem;
  onOpen: () => void;
  onChat?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="group flex flex-col gap-2 p-3 rounded-xl border border-edge bg-panel-2 hover:bg-wash hover:border-accent/40 transition-all text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent/40"
    >
      <div className="flex items-start gap-2.5">
        {item.kind === 'note' ? (
          <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center bg-inset">
            <FileText className="w-3.5 h-3.5" style={{ color: colorFor(item) }} />
          </div>
        ) : (
          <div
            className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-black text-white"
            style={{ background: colorFor(item) }}
          >
            {item.label.slice(0, 2).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-ink truncate group-hover:text-accent transition-colors">
              {item.label}
            </span>
            {item.curated && <Pin className="w-2.5 h-2.5 text-accent shrink-0" aria-label="Confirmed by you" />}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {item.kind === 'entity' && (
              <>
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-inset text-ink-3">
                  {item.nodeType}
                </span>
                {(item.connections ?? 0) > 0 && (
                  <span className="text-[10px] text-ink-3">
                    {item.connections} link{item.connections === 1 ? '' : 's'}
                  </span>
                )}
              </>
            )}
            {item.kind === 'note' && item.path && (
              <span className="text-[9px] text-ink-3 truncate font-mono">
                {item.path.split('/').slice(-2).join('/')}
              </span>
            )}
          </div>
        </div>

        {onChat && (
          <button
            onClick={onChat}
            title="Start a chat about this"
            className="shrink-0 p-1.5 rounded-lg text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-on-accent transition-all focus:opacity-100"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {item.snippet && (
        <p className="text-[11px] leading-snug text-ink-3 line-clamp-2">{item.snippet}</p>
      )}
    </div>
  );
}

function EmptyState({ query, hasAnything, onSendPrompt }: {
  query: string;
  hasAnything: boolean;
  onSendPrompt?: (text: string) => void;
}) {
  if (query.trim()) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <Search className="w-5 h-5 text-ink-3" />
        <p className="text-xs font-bold text-ink-2">Nothing saved matches “{query.trim()}”</p>
        <p className="text-[11px] text-ink-3 max-w-xs">
          This searches inside your notes as well as their titles. If it isn't here, your agent hasn't
          learned it yet.
        </p>
        {onSendPrompt && (
          <button
            onClick={() => onSendPrompt(`I want to talk about ${query.trim().slice(0, 120)}. Tell me what you know, and let's build up my notes on it.`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-accent text-on-accent hover:opacity-90 transition-opacity"
          >
            <Sparkles className="w-3.5 h-3.5" /> Start a chat about it instead
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
      <FileText className="w-5 h-5 text-ink-3" />
      <p className="text-xs font-bold text-ink-2">
        {hasAnything ? 'Nothing on this shelf yet' : 'Your knowledge base is empty'}
      </p>
      <p className="text-[11px] text-ink-3 max-w-sm">
        Notes you save and pages your agent reads land here — people, topics and sources, each one
        something you can open or start a conversation about.
      </p>
    </div>
  );
}
