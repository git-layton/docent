import React, { useEffect, useMemo, useState } from 'react';
import { WanderingFriends } from './ui/WanderingFriends';
import {
  FileText,
  Code2,
  Image as ImageIcon,
  MessageSquare,
  Sunrise,
  Sun,
  Sunset,
  Moon,
  Settings,
  TriangleAlert,
  ShieldAlert,
} from 'lucide-react';
import clsx from 'clsx';
import { useSpaceStore } from '../store/useSpaceStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { useAgentStore } from '../store/useAgentStore';
import { useWeatherStore, weatherCondition } from '../store/useWeatherStore';
import { useTaskStore, taskCoversDate } from '../store/useTaskStore';
import { useChatStore } from '../store/useChatStore';
import { useMessagesStore } from '../store/useMessagesStore';
import { getUnreadTotal } from '../lib/mailUnread';
import { type SearchDoc } from '../services/universalSearch';
import { OmniSearch } from './OmniSearch';
import {
  APPS,
  appDocId,
  appSearchDocs,
  launch,
  focusExisting,
  openSpaceLog,
} from '../data/appRegistry';
import { webSearchUrl } from '../services/omniIntent';
import type { OmniTabType, ToolTabId } from '../types/omniTab';

// ---------------------------------------------------------------------------
// StartPage — the OS-style "Home" surface opened by the new-tab (+) button.
//
// The omni-bar is search-as-you-type with chat as the default action: typing
// live-filters Apps/Docs/Bookmarks, the first result is always "Ask <agent>",
// ↑/↓ moves the selection, and ↵ runs it (so plain text + ↵ → chat). Every
// section is wired to real data — no placeholders.
// ---------------------------------------------------------------------------

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

// Recents shown in Pick-up before "See all" — see the note at its useState.
const RECENT_LIMIT = 2;

// ── Section shell ──
function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  /** Optional trailing affordance, right-aligned — e.g. a "See all" into the Library. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-3">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] font-bold text-accent-soft-ink bg-accent-soft px-1.5 py-0.5 rounded-full">{count}</span>
        )}
        {action && <span className="ml-auto">{action}</span>}
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
        // glass-sky tints from the wallpaper's brightness, not the theme — see the
        // sky-adaptive block in index.css. Blur stays; only the tint source changed.
        'group flex items-center gap-3 rounded-2xl border border-edge/50 glass-sky backdrop-blur-xl px-3.5 py-3 text-left',
        'shadow-sm transition-all duration-150',
        'hover:-translate-y-0.5 hover:border-edge-2',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        'active:translate-y-0',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── Omni-bar result row ──

interface StartPageProps {
  /** Send a message to the active conversation — wired from App's handleSendPrompt. */
  onAsk?: (text: string) => void;
  /** The id of the Home tab this page is rendered in — opening an app reuses it. */
  tabId?: string;
}

export function StartPage({ onAsk, tabId }: StartPageProps) {
  const userName = useSettingsStore((s) => s.userName);
  const integrations = useSettingsStore((s) => s.integrations);
  const savedApps = useUIStore((s) => s.savedApps);
  const omniTabs = useSpaceStore((s) => s.omniTabs);
  const tasks = useTaskStore((s) => s.tasks);
  const recurringEvents = useTaskStore((s) => s.recurringEvents);
  const chats = useChatStore((s) => s.chats);
  const assistants = useAgentStore((s) => s.assistants);
  const activeSpace = useSpaceStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId) ?? null);
  const activeOmniTabId = useSpaceStore((s) => s.activeOmniTabId);

  const isActive = activeOmniTabId === tabId;
  const [focusKey, setFocusKey] = useState(0);

  useEffect(() => {
    if (isActive) setFocusKey((k) => k + 1);
  }, [isActive, tabId]);

  useEffect(() => {
    const onFocus = () => { if (isActive) setFocusKey((k) => k + 1); };
    window.addEventListener('forge:focus-omni', onFocus);
    return () => window.removeEventListener('forge:focus-omni', onFocus);
  }, [isActive]);

  // Gallery is "openable, auto-shown when images exist": only surface its tile when this scope has
  // images (global Home → any image; a Space → that Space's images).
  const galleryScopeId = activeSpace?.id ?? 'space-home';
  const hasImagesInScope = useMemo(
    () => (savedApps ?? []).some((a: any) => a.type === 'image' && (galleryScopeId === 'space-home' || a.spaceId === galleryScopeId)),
    [savedApps, galleryScopeId],
  );
  const visibleApps = useMemo(() => APPS.filter((app) => app.id !== 'gallery' || hasImagesInScope), [hasImagesInScope]);


  // Unread mail badge — cheap IMAP SEARCH per account, cached 5 min in lib/mailUnread.
  const [unread, setUnread] = useState<number | null>(null);
  const mailAccounts = ((integrations as any)?.mailAccounts ?? []) as Array<{ id: string; provider: string; email: string }>;
  const mailKey = mailAccounts.map(a => a.email).join(',');

  const weatherCode = useWeatherStore((s) => s.weatherCode);
  const temperature = useWeatherStore((s) => s.temperature);
  const currentCondition = weatherCondition(weatherCode);
  const isSevereWeather = weatherCode !== null && weatherCode >= 95;

  useEffect(() => {
    let alive = true;
    if (mailAccounts.length === 0) { setUnread(null); return; }
    getUnreadTotal(mailAccounts).then(n => { if (alive) setUnread(n); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailKey]);

  // Unread iMessage count — shared store, kept fresh app-wide by OmniTabBar's poller. Refresh on
  // open too so the Home card is immediate. Gated on completed Messages setup.
  const msgUnread = useMessagesStore(s => s.unread);
  const refreshMsgUnread = useMessagesStore(s => s.refreshUnread);
  const imessageReady = !!(integrations as any)?.imessage?.setupComplete;
  useEffect(() => {
    if (imessageReady) refreshMsgUnread();
  }, [imessageReady, refreshMsgUnread]);

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

  // Docs — saved Library artifacts (most-recent first, excludes apps)
  const docs = useMemo(
    () =>
      [...(savedApps ?? [])]
        .filter((a: any) => a.type !== 'code')
        .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 8),
    [savedApps],
  );

  // How many recents Pick-up shows before the See-all. Two, so that with the chat
  // tile the row lands at three — one grid row at sm and up, and few enough to read
  // as a suggestion rather than a list to work through.
  const [showAllRecent, setShowAllRecent] = useState(false);

  // Apps — saved Codey apps
  const yourApps = useMemo(
    () =>
      [...(savedApps ?? [])]
        .filter((a: any) => a.type === 'code')
        .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [savedApps],
  );

  // Bookmarks — favorited web tabs
  const bookmarks = useMemo(
    () => omniTabs.filter((t) => t.isFavorite && t.type === 'web'),
    [omniTabs],
  );

  // ── Live card data: real local state only, no placeholders ──
  const live = useMemo(() => {
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const open = tasks.filter((t: any) => !t.completed);
    const dueToday = open.filter((t: any) => taskCoversDate(t, iso));
    const docsToday = (savedApps ?? []).filter((d: any) => (d.updatedAt ?? 0) >= dayStart && d.type !== 'code').length;
    const drafts = (savedApps ?? []).filter((d: any) => d.type !== 'image' && d.type !== 'doc').length;
    const mailCount = ((integrations as any)?.mailAccounts ?? []).length;
    const todayEvents = (recurringEvents ?? []).filter((e: any) => e.month === now.getMonth() + 1 && e.day === now.getDate());
    const sub: Record<string, string | undefined> = {
      todo: open.length > 0 ? `${open.length} open task${open.length !== 1 ? 's' : ''}` : undefined,
      doc: docsToday > 0 ? `${docsToday} edited today` : undefined,
      canvas: drafts > 0 ? `${drafts} draft${drafts !== 1 ? 's' : ''}` : undefined,
      browser: bookmarks.length > 0 ? `${bookmarks.length} saved tab${bookmarks.length !== 1 ? 's' : ''}` : undefined,
      inbox: mailCount > 0 ? `${mailCount} account${mailCount !== 1 ? 's' : ''} connected` : undefined,
      calendar: todayEvents.length > 0 ? `Today: ${todayEvents[0].name}` : dueToday.length > 0 ? `Due: ${dueToday[0].title}` : undefined,
    };
    if (unread !== null && unread > 0) sub.inbox = `${unread} unread`;
    if (msgUnread > 0) sub.messages = `${msgUnread} new message${msgUnread !== 1 ? 's' : ''}`;
    const badge: Record<string, { text: string; tone: 'warning' | 'accent' } | undefined> = {
      todo: dueToday.length > 0 ? { text: `${dueToday.length} due`, tone: 'warning' } : undefined,
      inbox: unread !== null && unread > 0 ? { text: `${unread} new`, tone: 'accent' } : undefined,
      messages: msgUnread > 0 ? { text: `${msgUnread} new`, tone: 'accent' } : undefined,
    };
    return { sub, badge };
  }, [now, tasks, savedApps, bookmarks, integrations, recurringEvents, unread, msgUnread]);

  // ── Pick up where you left off: most recent doc + most recent chat ──
  const recentDoc = docs[0];
  const lastChat = useMemo(
    () => [...(chats ?? [])].sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0],
    [chats],
  );

  const openDoc = (item: any, fromTabId?: string) => {
    useUIStore.getState().setCanvasContent(item);
    launch(fromTabId, {
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

  // Launcher apps as search docs — merged into the global corpus by <OmniSearch>.
  const appDocs = useMemo<SearchDoc[]>(() => appSearchDocs(), []);

  // The omni-bar hides the section grid behind its results while a query is active.
  const [searchActive, setSearchActive] = useState(false);

  // Apps keep their own tile icon in results; other kinds fall back to OmniSearch's per-kind icons.
  const iconForDoc = (doc: SearchDoc): React.ElementType | undefined =>
    doc.kind === 'App' ? APPS.find((a) => appDocId(a.id) === doc.id)?.icon : undefined;

  const ask = (text: string) => {
    const t = text.trim();
    if (!t) return;
    // Surface the conversation (recreating its Chat tab if closed), consuming the Home tab, then send.
    openSpaceLog(tabId, useSpaceStore.getState().activeSpaceId ?? undefined);
    onAsk?.(t);
  };

  // Switch to a conversation's Space and focus its log, consuming the Home tab like the tiles do.
  const openConversation = (chatId: string) => {
    const st = useSpaceStore.getState();
    const sp = st.spaces.find((s) => s.chatId === chatId);
    if (!sp) return; // searchCorpus only emits chats that have an owning Space, so this is defensive
    st.setActiveSpaceId(sp.id);
    openSpaceLog(tabId, sp.id);
  };

  // Open whatever a ranked hit points at. The id prefix encodes the source (see searchCorpus).
  const runSearchDoc = (doc: SearchDoc) => {
    switch (doc.kind) {
      case 'App':
        APPS.find((a) => appDocId(a.id) === doc.id)?.open(tabId);
        break;
      case 'Task':
        launch(tabId, { type: 'tool', toolId: 'planner' as ToolTabId, label: 'To-Do' });
        break;
      case 'Chat':
        openConversation(doc.id.replace(/^chat-/, ''));
        break;
      case 'Web':
        if (doc.url) launch(tabId, { type: 'web', url: doc.url, label: doc.title });
        break;
      case 'Image': {
        const img = (savedApps ?? []).find((a: any) => `img-${a.id}` === doc.id);
        if (img) openDoc(img, tabId);
        break;
      }
      case 'Bookmark':
      case 'Doc':
      default:
        if (doc.id.startsWith('tab-')) focusExisting(tabId, doc.id.slice(4));
        else if (doc.id.startsWith('doc-')) {
          const d = (savedApps ?? []).find((a: any) => `doc-${a.id}` === doc.id);
          if (d) openDoc(d, tabId);
        } else if (doc.url) {
          launch(tabId, { type: 'web', url: doc.url, label: doc.title });
        }
    }
  };

  return (
    <div className="relative h-full w-full overflow-y-auto bg-transparent no-scrollbar">
      {/* Rare, silent, and nobody's business but yours. */}
      <WanderingFriends />
      {/* Global settings — profile, models, integrations live here (per-chat settings stay in chat). */}
      <button
        type="button"
        onClick={() => useSettingsStore.getState().setShowProfileSettings(true)}
        title="Settings"
        className="on-sky absolute right-5 top-5 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-edge text-ink-2 transition-colors hover:border-edge-2 hover:text-ink"
      >
        <Settings className="h-[18px] w-[18px]" />
      </button>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-10">        {/* ── Compact header + omni-bar ── */}
        <div className="flex flex-col">
          <div className="flex items-baseline justify-between gap-4 pr-12">
            <h1 className="font-serif text-2xl tracking-tight text-ink sm:text-[28px]">
              {greeting}
            </h1>
            <p className="flex shrink-0 items-center gap-2 text-[12px] font-medium text-ink-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded-full"
                style={{ color: tod.color, background: `${tod.color}1f` }}
              >
                <TodIcon className="h-3.5 w-3.5" />
              </span>
              {dateStr} · <span className="tabular-nums">{clock}{meridiem ? ` ${meridiem.toLowerCase()}` : ''}</span>
              {weatherCode !== null && (
                <button
                  onClick={() => launch(tabId, { type: 'web', url: `https://start.duckduckgo.com/?q=${encodeURIComponent('local weather warning')}`, label: 'Local Weather Warning' })}
                  className={clsx(
                    "flex items-center gap-1.5 ml-2 px-2 py-1 rounded-md transition-colors cursor-pointer",
                    isSevereWeather 
                      ? "bg-red-500/10 text-red-500 hover:bg-red-500/20" 
                      : "bg-ink-3/10 text-ink-3 hover:bg-ink-3/20 hover:text-ink-2"
                  )}
                  title={isSevereWeather ? "Severe weather detected — click to search" : "Current weather"}
                >
                  {isSevereWeather ? <TriangleAlert className="w-3.5 h-3.5" /> : null}
                  <span className="font-bold tracking-tight uppercase text-[10px]">
                    {isSevereWeather ? "SEVERE WEATHER WARNING" : `${currentCondition.charAt(0).toUpperCase() + currentCondition.slice(1)} ${temperature !== null && temperature !== undefined ? `· ${Math.round(temperature)}°` : ''}`}
                  </span>
                </button>
              )}
            </p>
          </div>

          {/* Omni-bar — search-as-you-type across everything, chat is the default ↵ action */}
          <OmniSearch
            className="mt-5"
            scope={{ kind: 'global' }}
            extraDocs={appDocs}
            includeWebHistory
            iconFor={iconForDoc}
            agentName={agentName}
            autoFocus
            focusKey={focusKey}
            placeholder={agentName ? `Search apps & docs, or ask ${agentName} anything…` : 'Search apps & docs, or ask your agent…'}
            onAsk={ask}
            onRun={runSearchDoc}
            onWebSearch={(text) => launch(tabId, { type: 'web', url: webSearchUrl(text), label: text })}
            onActiveChange={setSearchActive}
          />
          {!searchActive && (
            <>
              <p className="mt-2 w-fit text-[11px] text-ink-3">
                Search your apps, docs, tasks &amp; history · press <span className="text-ink-2">↵</span> to ask your agent
              </p>
            </>
          )}
        </div>

        {/* The section grid hides while searching — the omni-bar results take over. */}
        {!searchActive && (<>
        {/* ── Pick up where you left off (first — your most likely next action) ── */}
        {(recentDoc || lastChat) && (
        <Section
          title="Pick up where you left off"
          action={docs.length > RECENT_LIMIT && (
            <button
              onClick={() => setShowAllRecent((v) => !v)}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink-2 transition-colors hover:text-ink"
            >
              {showAllRecent ? 'Show less' : `See all ${docs.length}`}
            </button>
          )}
        >
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {/* Recents stay deliberately short — this is a suggestion, not an index.
                Chat leads because resuming a conversation is the likeliest next move;
                docs follow, newest first, capped at RECENT_LIMIT until See-all. */}
            {(showAllRecent ? docs : docs.slice(0, RECENT_LIMIT)).map((doc: any) => (
              <Tile key={doc.id} onClick={() => openDoc(doc, tabId)}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
                  {doc?.type === 'image'
                    ? <ImageIcon className="h-[18px] w-[18px] text-accent-soft-ink" />
                    : <FileText className="h-[18px] w-[18px] text-accent-soft-ink" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">{doc?.title || 'Untitled'}</span>
                  <span className="block truncate text-[11px] text-ink-3">Edited {relativeTime(doc?.updatedAt)}</span>
                </span>
              </Tile>
            ))}
            {lastChat && (
              <Tile onClick={() => APPS.find((a) => a.id === 'chat')?.open(tabId)}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
                  <MessageSquare className="h-[18px] w-[18px] text-accent-soft-ink" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {agentName ? `Chat with ${agentName}` : 'Last conversation'}
                  </span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {activeSpace?.name ? `# ${activeSpace.name}` : 'Chat'}{lastChat?.updatedAt ? ` · ${relativeTime(lastChat.updatedAt)}` : ''}
                  </span>
                </span>
              </Tile>
            )}
          </div>
        </Section>
        )}



        {/* ── Apps ── */}
        <Section title="Apps">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {visibleApps.map((app) => {
              const Icon = app.icon;
              const badge = live.badge[app.id];
              const liveSub = app.id === 'chat' && agentName ? `Resume ${agentName}` : live.sub[app.id];
              return (
                <Tile key={app.id} onClick={() => app.open(tabId)}>
                  <span
                    className={clsx(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                      app.tint,
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{app.label}</span>
                    <span className={clsx('block truncate text-[11px]', liveSub ? 'text-ink-2' : 'text-ink-3')}>{liveSub ?? app.sub}</span>
                  </span>
                  {badge && (
                    <span
                      className={clsx(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold',
                        badge.tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent-soft-ink',
                      )}
                    >
                      {badge.text}
                    </span>
                  )}
                </Tile>
              );
            })}
          </div>
        </Section>

        {/* ── Your apps ── */}
        {yourApps.length > 0 && (
          <Section title="Your apps" count={yourApps.length}>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {yourApps.map((app: any) => (
                <Tile key={app.id} onClick={() => openDoc(app, tabId)}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-wash ring-1 ring-edge">
                    <Code2 className="h-[18px] w-[18px] text-ink-2" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {app?.title || 'Untitled App'}
                    </span>
                    <span className="block truncate text-[11px] text-ink-3">{relativeTime(app?.updatedAt)}</span>
                  </span>
                </Tile>
              ))}
            </div>
          </Section>
        )}

        {/* Docs and Bookmarks used to close the page out here as their own sections.
            Both spent most of their life rendering an empty state, so Home ended in
            two apologies. Recent docs now surface as Pick-up tiles above (with See
            all → Library), and bookmarks moved to the browser, which is the only
            place they're ever acted on — and where the real, persisted list already
            lives as `favorites` in useBrowserStore. The Home list was reading a
            different source entirely: web tabs flagged isFavorite, which vanish when
            the tab closes. Two bookmark systems; this retires the wrong one. */}

        </>)}
      </div>
    </div>
  );
}

export default StartPage;
