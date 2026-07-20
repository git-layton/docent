import React, { useEffect, useMemo, useState } from 'react';
import {
  Globe,
  FileText,
  Code2,
  CheckSquare,
  CalendarDays,
  Image as ImageIcon,
  Mail,
  MessageSquare,
  MessageCircle,
  Star,
  Sunrise,
  Sun,
  Sunset,
  Moon,
  Activity,
  Share2,
  Settings,
  StickyNote,
  FolderGit2,
  Monitor,
} from 'lucide-react';
import clsx from 'clsx';
import { useSpaceStore } from '../store/useSpaceStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';

import { useAgentStore } from '../store/useAgentStore';
import { useTaskStore, taskCoversDate } from '../store/useTaskStore';
import { useChatStore } from '../store/useChatStore';
import { useMessagesStore } from '../store/useMessagesStore';
import { getUnreadTotal } from '../lib/mailUnread';
import { type SearchDoc } from '../services/universalSearch';
import { OmniSearch } from './OmniSearch';
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
  tint: string; // icon chip tint classes (soft fill + readable icon, both themes)
  open: (tabId?: string) => void;
}

// Start is what a new tab renders — an ordinary tab, not a pinned fixture. Launching an app opens
// a NEW tab beside it rather than consuming it, so the launcher you came from stays put until you
// close it yourself.
function launch(_tabId: string | undefined, tab: Omit<OmniTab, 'id'>) {
  useSpaceStore.getState().openTab(tab);
}

// Focus an already-open tab (chat / bookmark); Home stays where it is.
function focusExisting(_tabId: string | undefined, targetId: string) {
  useSpaceStore.getState().setActiveTab(targetId);
}

// Open a Space's chat: focus its existing Chat tab, or recreate one (Chat is a normal
// closable tab now) — reusing the Home tab slot we came from so tabs don't stack.
function openSpaceLog(fromTabId: string | undefined, spaceId: string | undefined) {
  const st = useSpaceStore.getState();
  const log =
    st.omniTabs.find((t) => t.type === 'space-log' && t.spaceId === spaceId) ??
    st.omniTabs.find((t) => t.type === 'space-log');
  if (log) focusExisting(fromTabId, log.id);
  else launch(fromTabId, { type: 'space-log', label: 'Chat', spaceId });
}

// Order mirrors the home-page mockup: lead with the actionable daily-driver apps
// (Inbox, Calendar, To-Do, Messages), then the creation/utility apps.
const APPS: AppEntry[] = [
  {
    id: 'canvas',
    label: '+ Create app',
    sub: 'Build apps & prototypes',
    icon: Code2,
    tint: 'bg-slate-500/12 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300',
    open: (tabId) => launch(tabId, { type: 'code-canvas', label: 'Untitled Canvas' }),
  },
  {
    id: 'inbox',
    label: 'Inbox',
    sub: 'Gmail & iCloud mail',
    icon: Mail,
    tint: 'bg-orange-500/12 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'inbox' as ToolTabId, label: 'Inbox' }),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    sub: 'Your schedule',
    icon: CalendarDays,
    tint: 'bg-violet-500/12 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'calendar' as ToolTabId, label: 'Calendar' }),
  },
  {
    id: 'todo',
    label: 'To-Do',
    sub: 'Tasks & planning',
    icon: CheckSquare,
    tint: 'bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'planner' as ToolTabId, label: 'To-Do' }),
  },
  {
    id: 'messages',
    label: 'Messages',
    sub: 'iMessage & SMS',
    icon: MessageCircle,
    tint: 'bg-green-500/12 text-green-700 dark:bg-green-400/15 dark:text-green-300',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'messages' as ToolTabId, label: 'Messages' }),
  },
  {
    id: 'desktop',
    label: 'Desktop',
    sub: 'Mission Control',
    icon: Monitor,
    tint: 'bg-blue-500/12 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'desktop' as ToolTabId, label: 'Desktop' }),
  },
  {
    id: 'notes',
    label: 'Notes',
    sub: 'Apple Notes',
    icon: StickyNote,
    tint: 'bg-amber-500/12 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'notes' as ToolTabId, label: 'Notes' }),
  },
  {
    id: 'chat',
    label: 'Chat',
    sub: 'Talk to your agent',
    icon: MessageSquare,
    tint: 'bg-pink-500/12 text-pink-700 dark:bg-pink-400/15 dark:text-pink-300',
    open: (tabId) => {
      // Open the current Space's chat — recreating its Chat tab if it was closed.
      openSpaceLog(tabId, useSpaceStore.getState().activeSpaceId ?? undefined);
    },
  },
  {
    id: 'doc',
    label: 'Document',
    sub: 'Write & edit',
    icon: FileText,
    tint: 'bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
    open: (tabId) => launch(tabId, { type: 'doc', label: 'Untitled Doc' }),
  },
  {
    id: 'agentforge-code',
    label: 'Code',
    sub: 'Real development — open a folder, write & run code',
    icon: FolderGit2,
    tint: 'bg-teal-500/12 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300',
    // Code is a CANVAS (Codey's coding surface), not a space — open it in the CURRENT space so that
    // space's own group chat stays the rail beside it. Consume the Home tab we launched from.
    open: (tabId) => {
      useSpaceStore.getState().openCodeCanvas();
      if (tabId) useSpaceStore.getState().closeTab(tabId);
    },
  },
  {
    id: 'browser',
    label: 'Web Browser',
    sub: 'Browse the web',
    icon: Globe,
    tint: 'bg-blue-500/12 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
    open: (tabId) => launch(tabId, { type: 'web', label: 'New Tab', url: 'https://duckduckgo.com' }),
  },
  {
    id: 'gallery',
    label: 'Gallery',
    sub: 'Your saved images',
    icon: ImageIcon,
    tint: 'bg-violet-500/12 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'gallery' as ToolTabId, label: 'Gallery' }),
  },
  {
    id: 'activity',
    label: 'Activity',
    sub: 'Logs, performance & context',
    icon: Activity,
    tint: 'bg-rose-500/12 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'activity' as ToolTabId, label: 'Activity' }),
  },
  {
    id: 'settings',
    label: 'Settings',
    sub: 'Profile, models & connections',
    icon: Settings,
    tint: 'bg-slate-500/12 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'settings' as ToolTabId, label: 'Settings' }),
  },
  {
    id: 'knowledge-graph',
    label: 'Knowledge Graph',
    sub: 'Your connected memory',
    icon: Share2,
    tint: 'bg-amber-500/12 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'knowledge-graph' as ToolTabId, label: 'Knowledge Graph' }),
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
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-3">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] font-bold text-accent-soft-ink bg-accent-soft px-1.5 py-0.5 rounded-full">{count}</span>
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
        'group flex items-center gap-3 rounded-2xl border border-edge bg-panel-2 px-3.5 py-3 text-left',
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

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-edge-2 px-4 py-5 text-center text-[11px] leading-relaxed text-ink-3">
      {children}
    </div>
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
  const appDocs = useMemo<SearchDoc[]>(
    () => APPS.map((a) => ({ kind: 'App', id: `app-${a.id}`, title: a.label, sub: a.sub })),
    [],
  );

  // The omni-bar hides the section grid behind its results while a query is active.
  const [searchActive, setSearchActive] = useState(false);

  // Apps keep their own tile icon in results; other kinds fall back to OmniSearch's per-kind icons.
  const iconForDoc = (doc: SearchDoc): React.ElementType | undefined =>
    doc.kind === 'App' ? APPS.find((a) => `app-${a.id}` === doc.id)?.icon : undefined;

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
        APPS.find((a) => `app-${a.id}` === doc.id)?.open(tabId);
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
    <div className="relative h-full w-full overflow-y-auto bg-panel no-scrollbar">
      {/* Global settings — profile, models, integrations live here (per-chat settings stay in chat). */}
      <button
        type="button"
        onClick={() => useSettingsStore.getState().setShowProfileSettings(true)}
        title="Settings"
        className="absolute right-5 top-5 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-edge bg-panel-2 text-ink-3 shadow-sm transition-colors hover:border-edge-2 hover:text-ink"
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
            placeholder={agentName ? `Search apps & docs, or ask ${agentName} anything…` : 'Search apps & docs, or ask your agent…'}
            onAsk={ask}
            onRun={runSearchDoc}
            onActiveChange={setSearchActive}
          />
          {!searchActive && (
            <p className="mt-2 text-[11px] text-ink-3">
              Search your apps, docs, tasks &amp; history · press <span className="text-ink-2">↵</span> to ask your agent
            </p>
          )}
        </div>

        {/* The section grid hides while searching — the omni-bar results take over. */}
        {!searchActive && (<>
        {/* ── Pick up where you left off (first — your most likely next action) ── */}
        {(recentDoc || lastChat) && (
        <Section title="Pick up where you left off">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {recentDoc && (
              <Tile onClick={() => openDoc(recentDoc, tabId)}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
                  {recentDoc?.type === 'image'
                    ? <ImageIcon className="h-[18px] w-[18px] text-accent-soft-ink" />
                    : <FileText className="h-[18px] w-[18px] text-accent-soft-ink" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">{recentDoc?.title || 'Untitled'}</span>
                  <span className="block truncate text-[11px] text-ink-3">Edited {relativeTime(recentDoc?.updatedAt)}</span>
                </span>
              </Tile>
            )}
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

        {/* ── Docs ── */}
        <Section title="Docs" count={docs.length}>
          {docs.length === 0 ? (
            <EmptyHint>Nothing saved yet — anything you build or save to your Library shows up here.</EmptyHint>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {docs.map((doc: any) => {
                const Icon = doc?.type === 'image' ? ImageIcon : doc?.type === 'doc' ? FileText : Code2;
                return (
                  <Tile key={doc.id} onClick={() => openDoc(doc, tabId)}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-wash ring-1 ring-edge">
                      <Icon className="h-[18px] w-[18px] text-ink-2" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {doc?.title || 'Untitled'}
                      </span>
                      <span className="block truncate text-[11px] text-ink-3">{relativeTime(doc?.updatedAt)}</span>
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
                Star a web page <Star className="h-3 w-3 text-warning" /> to pin it here for quick access.
              </span>
            </EmptyHint>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {bookmarks.map((tab) => (
                <Tile key={tab.id} onClick={() => focusExisting(tabId, tab.id)}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-wash ring-1 ring-edge">
                    <Globe className="h-[18px] w-[18px] text-ink-2" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">{tab.label}</span>
                    <span className="block truncate text-[11px] text-ink-3">{domainOf(tab.url)}</span>
                  </span>
                </Tile>
              ))}
            </div>
          )}
        </Section>

        </>)}
      </div>
    </div>
  );
}

export default StartPage;
