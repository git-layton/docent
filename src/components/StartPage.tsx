import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Globe,
  FileText,
  Code2,
  CheckSquare,
  CalendarDays,
  Share2,
  Image as ImageIcon,
  Mail,
  MessageSquare,
  Building2,
  Star,
  CornerDownLeft,
  Sunrise,
  Sun,
  Sunset,
  Moon,
} from 'lucide-react';
import clsx from 'clsx';
import { useSpaceStore } from '../store/useSpaceStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAgentStore } from '../store/useAgentStore';
import type { OmniTab, OmniTabType, ToolTabId } from '../types/omniTab';

// ---------------------------------------------------------------------------
// StartPage — the OS-style "Home" surface opened by the new-tab (+) button.
//
// The omni-bar is search-as-you-type with chat as the default action: typing
// live-filters Apps/Docs/Bookmarks, the first result is always "Ask <agent>",
// ↑/↓ moves the selection, and ↵ runs it (so plain text + ↵ → chat). Every
// section is wired to real data — no placeholders.
// ---------------------------------------------------------------------------

// ── Apps: the openable surfaces (Tools merged in, per the agreed taxonomy) ──
interface AppEntry {
  id: string;
  label: string;
  sub: string;
  icon: React.ElementType;
  tint: string; // icon tile background tint
  open: () => void;
}

function openTab(tab: Omit<OmniTab, 'id'>) {
  useSpaceStore.getState().openTab(tab);
}

const APPS: AppEntry[] = [
  {
    id: 'chat',
    label: 'Chat',
    sub: 'Talk to your agent',
    icon: MessageSquare,
    tint: 'from-[#4A5D75]/45 to-[#2C3E50]/30',
    open: () => {
      // Focus the current Space's chat (the pinned space-log tab).
      const { omniTabs, activeSpaceId, setActiveTab } = useSpaceStore.getState();
      const sid = activeSpaceId ?? undefined;
      const log =
        omniTabs.find((t) => t.type === 'space-log' && t.spaceId === sid) ??
        omniTabs.find((t) => t.type === 'space-log');
      if (log) setActiveTab(log.id);
    },
  },
  {
    id: 'browser',
    label: 'Web Browser',
    sub: 'Browse the web',
    icon: Globe,
    tint: 'from-[#3D6E8C]/40 to-[#2C3E50]/30',
    open: () => openTab({ type: 'web', label: 'New Tab', url: 'https://duckduckgo.com' }),
  },
  {
    id: 'inbox',
    label: 'Inbox',
    sub: 'Gmail & iCloud mail',
    icon: Mail,
    tint: 'from-[#B5654A]/40 to-[#2C3E50]/30',
    open: () => openTab({ type: 'tool', toolId: 'inbox' as ToolTabId, label: 'Inbox' }),
  },
  {
    id: 'doc',
    label: 'Document',
    sub: 'Write & edit',
    icon: FileText,
    tint: 'from-[#6A829E]/40 to-[#2C3E50]/30',
    open: () => openTab({ type: 'doc', label: 'Untitled Doc' }),
  },
  {
    id: 'canvas',
    label: 'Code Canvas',
    sub: 'Build & prototype',
    icon: Code2,
    tint: 'from-[#4A5D75]/45 to-[#2C3E50]/30',
    open: () => openTab({ type: 'code-canvas', label: 'Untitled Canvas' }),
  },
  {
    id: 'todo',
    label: 'To-Do',
    sub: 'Tasks & planning',
    icon: CheckSquare,
    tint: 'from-[#5B8A72]/40 to-[#2C3E50]/30',
    open: () => openTab({ type: 'tool', toolId: 'planner' as ToolTabId, label: 'To-Do' }),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    sub: 'Your schedule',
    icon: CalendarDays,
    tint: 'from-[#8A6A9E]/40 to-[#2C3E50]/30',
    open: () => openTab({ type: 'tool', toolId: 'calendar' as ToolTabId, label: 'Calendar' }),
  },
  {
    id: 'graph',
    label: 'Knowledge Graph',
    sub: 'Connected memory',
    icon: Share2,
    tint: 'from-[#9E8A6A]/40 to-[#2C3E50]/30',
    open: () => openTab({ type: 'tool', toolId: 'knowledge-graph' as ToolTabId, label: 'Knowledge Graph' }),
  },
];

// Time-of-day character — drives the greeting word, glyph, and accent color.
function timeOfDay(d: Date): { greeting: string; Icon: React.ElementType; color: string } {
  const h = d.getHours();
  if (h >= 5 && h < 12) return { greeting: 'Good morning', Icon: Sunrise, color: '#E0B36A' };
  if (h >= 12 && h < 17) return { greeting: 'Good afternoon', Icon: Sun, color: '#E7C66B' };
  if (h >= 17 && h < 21) return { greeting: 'Good evening', Icon: Sunset, color: '#D88C5A' };
  return { greeting: 'Good evening', Icon: Moon, color: '#8893C0' };
}

function relativeTime(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

function domainOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ── Section shell ──
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] font-bold text-neutral-600">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

// ── Tile primitives ──
function Tile({
  onClick,
  className,
  children,
}: {
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-[#12141a] px-3.5 py-3 text-left',
        'shadow-sm transition-all duration-150',
        'hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-[#171922]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6A829E]/60',
        'active:translate-y-0',
        className,
      )}
    >
      {children}
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.06] px-4 py-5 text-center text-[11px] leading-relaxed text-neutral-600">
      {children}
    </div>
  );
}

// ── Omni-bar result row ──
function ResultRow({
  active,
  onClick,
  onMouseEnter,
  children,
}: {
  active: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={clsx(
        'flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors',
        active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
      )}
    >
      {children}
    </button>
  );
}

interface StartPageProps {
  /** Send a message to the active conversation — wired from App's handleSendPrompt. */
  onAsk?: (text: string) => void;
}

export function StartPage({ onAsk }: StartPageProps) {
  const userName = useSettingsStore((s) => s.userName);
  const integrations = useSettingsStore((s) => s.integrations);
  const savedApps = useUIStore((s) => s.savedApps);
  const omniTabs = useSpaceStore((s) => s.omniTabs);
  const assistants = useAgentStore((s) => s.assistants);
  const activeSpace = useSpaceStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId) ?? null);

  const [query, setQuery] = useState('');

  // Live clock — ticks every 30s so the time + greeting stay current.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const tod = useMemo(() => timeOfDay(now), [now]);
  const TodIcon = tod.Icon;
  const greeting = useMemo(() => {
    const name = userName?.trim();
    return name ? `${tod.greeting}, ${name}` : tod.greeting;
  }, [tod, userName]);
  const [clock, meridiem] = useMemo(() => {
    const parts = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).split(' ');
    return [parts[0], parts[1] ?? ''];
  }, [now]);
  const dateStr = useMemo(
    () => now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
    [now],
  );

  // Docs — saved Library artifacts (most-recent first)
  const docs = useMemo(
    () =>
      [...(savedApps ?? [])]
        .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 8),
    [savedApps],
  );

  // Bookmarks — favorited web tabs
  const bookmarks = useMemo(
    () => omniTabs.filter((t) => t.isFavorite && t.type === 'web'),
    [omniTabs],
  );

  // Integrations — connected accounts read straight from settings
  const connected = useMemo(() => {
    const out: { id: string; label: string; icon: React.ElementType }[] = [];
    if (integrations?.slack?.botToken) out.push({ id: 'slack', label: 'Slack', icon: MessageSquare });
    for (const acct of (((integrations as any)?.mailAccounts ?? []) as Array<{ id: string; provider: string; email: string }>)) {
      out.push({ id: `mail-${acct.id}`, label: acct.email, icon: Mail });
    }
    if (integrations?.gus?.accessToken) out.push({ id: 'gus', label: 'GUS', icon: Building2 });
    return out;
  }, [integrations]);

  const openDoc = (item: any) => {
    useUIStore.getState().setCanvasContent(item);
    openTab({
      type: (item?.type === 'image' ? 'doc' : 'code-canvas') as OmniTabType,
      label: item?.title || 'Untitled',
      canvasContentId: item?.id,
    });
  };

  // ── Omni-bar: search-as-you-type, chat as the default action ──
  const agentName = useMemo(() => {
    const id = activeSpace?.agentIds?.[0];
    return assistants.find((a: any) => a.id === id)?.name as string | undefined;
  }, [assistants, activeSpace]);

  // Flattened, searchable index of everything the launcher can open.
  const searchItems = useMemo(() => {
    type Item = { kind: 'App' | 'Doc' | 'Bookmark'; id: string; label: string; sub?: string; icon: React.ElementType; run: () => void };
    const apps: Item[] = APPS.map((a) => ({ kind: 'App', id: `app-${a.id}`, label: a.label, sub: a.sub, icon: a.icon, run: a.open }));
    const docItems: Item[] = docs.map((d: any) => ({ kind: 'Doc', id: `doc-${d.id}`, label: d.title || 'Untitled', sub: relativeTime(d.updatedAt), icon: d?.type === 'image' ? ImageIcon : Code2, run: () => openDoc(d) }));
    const bms: Item[] = bookmarks.map((t) => ({ kind: 'Bookmark', id: `bm-${t.id}`, label: t.label, sub: domainOf(t.url), icon: Globe, run: () => useSpaceStore.getState().setActiveTab(t.id) }));
    return [...apps, ...docItems, ...bms];
    // openDoc is closure-stable (reads from getState); safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, bookmarks]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (!q ? [] : searchItems.filter((it) => `${it.label} ${it.sub ?? ''}`.toLowerCase().includes(q)).slice(0, 8)),
    [q, searchItems],
  );

  // results[0] is always the "Ask" action; matches follow (1-indexed).
  const resultCount = 1 + matches.length;
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => { setActiveIndex(0); }, [q]);

  const ask = (text: string) => {
    const t = text.trim();
    if (!t) return;
    // Surface the conversation (the pinned space-log tab), then send.
    const { omniTabs: tabs, activeSpaceId, setActiveTab } = useSpaceStore.getState();
    const sid = activeSpaceId ?? undefined;
    const log = tabs.find((x) => x.type === 'space-log' && x.spaceId === sid) ?? tabs.find((x) => x.type === 'space-log');
    if (log) setActiveTab(log.id);
    onAsk?.(t);
  };

  const runIndex = (i: number) => {
    if (i <= 0) ask(query);
    else matches[i - 1]?.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, resultCount - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); runIndex(activeIndex); }
    else if (e.key === 'Escape' && q) { e.preventDefault(); setQuery(''); }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0a0b0e] no-scrollbar">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-8 py-12">
        {/* ── Hero + omni-bar ── */}
        <div className="flex flex-col items-center text-center">
          {/* Apple-Weather-style time-of-day header */}
          <div className="mb-2.5 flex items-end gap-2.5">
            <span
              aria-hidden="true"
              className="mb-1 flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-white/10"
              style={{ color: tod.color, background: `${tod.color}1f` }}
            >
              <TodIcon className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[44px] font-extralight leading-none tracking-tight text-white tabular-nums">
              {clock}
            </span>
            {meridiem && <span className="mb-1.5 text-sm font-medium text-neutral-400">{meridiem}</span>}
          </div>
          <h1 className="bg-gradient-to-b from-white to-white/55 bg-clip-text text-2xl font-semibold tracking-tight text-transparent sm:text-3xl">
            {greeting}
          </h1>
          <p className="mt-1 text-[12px] font-medium text-neutral-500">{dateStr}</p>

          {/* Omni-bar — search-as-you-type, chat is the default ↵ action */}
          <div className="relative mt-7 w-full max-w-xl">
            <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#12141a] px-4 py-3 shadow-lg shadow-black/30 transition-colors focus-within:border-[#6A829E]/50">
              <Search className="h-4 w-4 shrink-0 text-neutral-500" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search apps & docs, or ask your agent…"
                className="flex-1 bg-transparent text-sm text-neutral-100 placeholder:text-neutral-500 outline-none"
              />
              <kbd className="hidden items-center gap-1 rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 sm:flex">
                <CornerDownLeft className="h-3 w-3" /> {activeIndex === 0 ? 'ask' : 'open'}
              </kbd>
            </div>

            {q ? (
              <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#12141a] py-1.5 text-left shadow-2xl shadow-black/50">
                {/* Ask row — always index 0, the default action */}
                <ResultRow active={activeIndex === 0} onMouseEnter={() => setActiveIndex(0)} onClick={() => runIndex(0)}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#4A5D75]/40 ring-1 ring-white/10">
                    <MessageSquare className="h-3.5 w-3.5 text-white/90" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-neutral-100">{agentName ? `Ask ${agentName}` : 'Ask your agent'}</span>
                    <span className="block truncate text-[11px] text-neutral-500">“{query.trim()}”</span>
                  </span>
                  <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                </ResultRow>

                {matches.length > 0 && <div className="my-1 border-t border-white/[0.05]" />}

                {matches.map((it, i) => {
                  const Icon = it.icon;
                  return (
                    <ResultRow key={it.id} active={activeIndex === i + 1} onMouseEnter={() => setActiveIndex(i + 1)} onClick={() => runIndex(i + 1)}>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] ring-1 ring-white/10">
                        <Icon className="h-3.5 w-3.5 text-neutral-300" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-neutral-100">{it.label}</span>
                        {it.sub && <span className="block truncate text-[11px] text-neutral-500">{it.sub}</span>}
                      </span>
                      <span className="shrink-0 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-medium text-neutral-500">{it.kind}</span>
                    </ResultRow>
                  );
                })}

                {matches.length === 0 && (
                  <div className="px-3.5 py-2 text-[11px] text-neutral-600">No matches — press ↵ to ask {agentName ?? 'your agent'}.</div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-neutral-600">
                Type to filter your apps &amp; docs · press <span className="text-neutral-500">↵</span> to ask your agent
              </p>
            )}
          </div>
        </div>

        {/* The section grid hides while searching — the omni-bar results take over. */}
        {!q && (<>
        {/* ── Apps ── */}
        <Section title="Apps">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {APPS.map((app) => {
              const Icon = app.icon;
              return (
                <Tile key={app.id} onClick={app.open}>
                  <span
                    className={clsx(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-white/10',
                      app.tint,
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] text-white/90" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-neutral-100">{app.label}</span>
                    <span className="block truncate text-[11px] text-neutral-500">{app.sub}</span>
                  </span>
                </Tile>
              );
            })}
          </div>
        </Section>

        {/* ── Docs ── */}
        <Section title="Docs" count={docs.length}>
          {docs.length === 0 ? (
            <EmptyHint>Nothing saved yet — anything you build or save to your Library shows up here.</EmptyHint>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {docs.map((doc: any) => {
                const Icon = doc?.type === 'image' ? ImageIcon : doc?.type === 'doc' ? FileText : Code2;
                return (
                  <Tile key={doc.id} onClick={() => openDoc(doc)}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] ring-1 ring-white/10">
                      <Icon className="h-[18px] w-[18px] text-neutral-300" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-neutral-100">
                        {doc?.title || 'Untitled'}
                      </span>
                      <span className="block truncate text-[11px] text-neutral-500">{relativeTime(doc?.updatedAt)}</span>
                    </span>
                  </Tile>
                );
              })}
            </div>
          )}
        </Section>

        {/* ── Bookmarks ── */}
        <Section title="Bookmarks" count={bookmarks.length}>
          {bookmarks.length === 0 ? (
            <EmptyHint>
              <span className="inline-flex items-center gap-1.5">
                Star a web page <Star className="h-3 w-3 text-[#C9A227]" /> to pin it here for quick access.
              </span>
            </EmptyHint>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {bookmarks.map((tab) => (
                <Tile key={tab.id} onClick={() => useSpaceStore.getState().setActiveTab(tab.id)}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] ring-1 ring-white/10">
                    <Globe className="h-[18px] w-[18px] text-neutral-300" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-neutral-100">{tab.label}</span>
                    <span className="block truncate text-[11px] text-neutral-500">{domainOf(tab.url)}</span>
                  </span>
                </Tile>
              ))}
            </div>
          )}
        </Section>

        {/* ── Integrations ── */}
        <Section title="Integrations" count={connected.length}>
          {connected.length === 0 ? (
            <EmptyHint>No integrations connected yet — connect Gmail, Slack, Drive and more in Settings.</EmptyHint>
          ) : (
            <div className="flex flex-wrap gap-2">
              {connected.map((it) => {
                const Icon = it.icon;
                return (
                  <div
                    key={it.id}
                    className="inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-[#12141a] px-3 py-1.5"
                  >
                    <Icon className="h-3.5 w-3.5 text-neutral-300" />
                    <span className="text-[12px] font-medium text-neutral-200">{it.label}</span>
                    <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400/80" title="Connected" />
                  </div>
                );
              })}
            </div>
          )}
        </Section>
        </>)}
      </div>
    </div>
  );
}

export default StartPage;
