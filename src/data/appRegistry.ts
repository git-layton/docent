// App registry — the single source of truth for Docent's openable "apps" (the launcher surfaces,
// with Tools merged in per the agreed taxonomy). Three consumers share this one definition so they
// can't drift:
//   • the Start grid renders APPS as tiles;
//   • the omni-bar folds appSearchDocs() into its search corpus (keywords are matched, not shown);
//   • the agent can be handed appCatalogPrompt() so it knows which surface a request wants.
// The tab-launching helpers (launch/focusExisting/openSpaceLog) live here too, since opening an app
// IS a tab operation and both the grid and the omni-bar dispatch through them.

import type { ElementType } from 'react';
import {
  Code2,
  Mail,
  CalendarDays,
  CheckSquare,
  MessageCircle,
  Monitor,
  StickyNote,
  MessageSquare,
  FileText,
  Globe,
  Image as ImageIcon,
  Activity,
  Settings,
  Share2,
} from 'lucide-react';
import { useSpaceStore } from '../store/useSpaceStore';
import type { OmniTab, ToolTabId } from '../types/omniTab';
import type { SearchDoc } from '../services/universalSearch';

// ── Tab-launch helpers ──
// Start is what a new tab renders — an ordinary tab, not a pinned fixture. Launching an app opens a
// NEW tab beside it rather than consuming it, so the launcher you came from stays put until you
// close it yourself.
export function launch(_tabId: string | undefined, tab: Omit<OmniTab, 'id'>) {
  useSpaceStore.getState().openTab(tab);
}

// Focus an already-open tab (chat / bookmark); Home stays where it is.
export function focusExisting(_tabId: string | undefined, targetId: string) {
  useSpaceStore.getState().setActiveTab(targetId);
}

// Open a Space's chat: focus its existing Chat tab, or recreate one (Chat is a normal closable tab
// now) — reusing the Home tab slot we came from so tabs don't stack.
export function openSpaceLog(_fromTabId: string | undefined, spaceId: string | undefined) {
  // "Surface the conversation" now means reveal the docked copilot — chat no longer has a center
  // tab. Land on the space's Start dashboard (creating it if the space has none) and open the
  // copilot so a reply is actually visible. Named openSpaceLog still because every caller means
  // exactly this: "take me to where I talk to this space's agent."
  const st = useSpaceStore.getState();
  st.setActiveTab(st.ensureHomeTab(spaceId));
  window.dispatchEvent(new Event('forge:open-copilot'));
}

// ── The catalog ──
export interface AppEntry {
  id: string;
  label: string;
  sub: string;
  icon: ElementType;
  tint: string; // icon chip: saturated gradient + white glyph, so it reads as an app icon rather than a faint swatch
  /** Extra search aliases folded into the omni-bar corpus (matched, never displayed). */
  keywords?: string;
  /** One line for the agent's app catalog — when this surface is the right answer. */
  useWhen?: string;
  open: (tabId?: string) => void;
}

// Order mirrors the home-page mockup: lead with the actionable daily-driver apps (Inbox, Calendar,
// To-Do, Messages), then the creation/utility apps.
export const APPS: AppEntry[] = [
  {
    id: 'canvas',
    label: '+ Create app',
    sub: 'Build apps & prototypes',
    icon: Code2,
    tint: 'bg-gradient-to-br from-slate-400 to-slate-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'code coding build app prototype canvas create developer',
    useWhen: 'the user wants to build or prototype an app or interactive UI',
    open: (tabId) => launch(tabId, { type: 'code-canvas', label: 'Untitled Canvas' }),
  },
  {
    id: 'inbox',
    label: 'Inbox',
    sub: 'Gmail & iCloud mail',
    icon: Mail,
    tint: 'bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'email mail gmail icloud message unread',
    useWhen: 'the user wants to read, search, or triage email',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'inbox' as ToolTabId, label: 'Inbox' }),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    sub: 'Your schedule',
    icon: CalendarDays,
    tint: 'bg-gradient-to-br from-violet-400 to-violet-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'schedule events agenda meeting appointment date',
    useWhen: 'the user asks about their schedule, events, or availability',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'calendar' as ToolTabId, label: 'Calendar' }),
  },
  {
    id: 'todo',
    label: 'To-Do',
    sub: 'Tasks & planning',
    icon: CheckSquare,
    tint: 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'tasks planner planning reminders checklist todo',
    useWhen: 'the user wants to manage tasks, plans, or reminders',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'planner' as ToolTabId, label: 'To-Do' }),
  },
  {
    id: 'messages',
    label: 'Messages',
    sub: 'iMessage & SMS',
    icon: MessageCircle,
    tint: 'bg-gradient-to-br from-green-400 to-green-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'imessage sms text texting chat contacts',
    useWhen: 'the user wants to read or send iMessage/SMS',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'messages' as ToolTabId, label: 'Messages' }),
  },
  {
    id: 'desktop',
    label: 'Desktop',
    sub: 'Mission Control',
    icon: Monitor,
    tint: 'bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'screen mission control windows apps computer',
    useWhen: 'the user wants to see or control what is on their screen',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'desktop' as ToolTabId, label: 'Desktop' }),
  },
  {
    id: 'notes',
    label: 'Notes',
    sub: 'Apple Notes',
    icon: StickyNote,
    tint: 'bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'apple notes notepad jot memo',
    useWhen: 'the user wants to read or write Apple Notes',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'notes' as ToolTabId, label: 'Notes' }),
  },
  {
    id: 'chat',
    label: 'Chat',
    sub: 'Talk to your agent',
    icon: MessageSquare,
    tint: 'bg-gradient-to-br from-pink-400 to-pink-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'chat conversation ask agent assistant talk',
    useWhen: 'the user just wants to talk to their assistant',
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
    tint: 'bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'document write writing editor text draft',
    useWhen: 'the user wants to write or edit a document',
    open: (tabId) => launch(tabId, { type: 'doc', label: 'Untitled Doc' }),
  },
  {
    id: 'browser',
    label: 'Web Browser',
    sub: 'Browse the web',
    icon: Globe,
    tint: 'bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'browser web internet website url surf',
    useWhen: 'the user wants to open a web page or browse',
    // No url: an empty web tab lands on Docent's own start page (bookmarks + search) rather than
    // dropping the user straight onto duckduckgo.com.
    open: (tabId) => launch(tabId, { type: 'web', label: 'New Tab' }),
  },
  {
    id: 'gallery',
    label: 'Gallery',
    sub: 'Your saved images',
    icon: ImageIcon,
    tint: 'bg-gradient-to-br from-violet-400 to-violet-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'images pictures photos gallery art',
    useWhen: 'the user wants to see saved or generated images',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'gallery' as ToolTabId, label: 'Gallery' }),
  },
  {
    id: 'activity',
    label: 'Activity',
    sub: 'Logs, performance & context',
    icon: Activity,
    tint: 'bg-gradient-to-br from-rose-400 to-rose-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'logs performance context monitor diagnostics activity',
    useWhen: 'the user wants to inspect logs, performance, or context health',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'activity' as ToolTabId, label: 'Activity' }),
  },
  {
    id: 'settings',
    label: 'Settings',
    sub: 'Profile, models & connections',
    icon: Settings,
    tint: 'bg-gradient-to-br from-slate-400 to-slate-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'settings preferences profile models integrations connections config',
    useWhen: 'the user wants to change settings, models, or connected accounts',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'settings' as ToolTabId, label: 'Settings' }),
  },
  {
    id: 'knowledge-graph',
    label: 'Knowledge Graph',
    sub: 'Your connected memory',
    icon: Share2,
    tint: 'bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-sm ring-1 ring-inset ring-white/25',
    keywords: 'knowledge graph memory connections entities people',
    useWhen: 'the user wants to explore their knowledge graph or connected memory',
    open: (tabId) => launch(tabId, { type: 'tool', toolId: 'knowledge-graph' as ToolTabId, label: 'Knowledge Graph' }),
  },
];

// The SearchDoc id namespace for apps, so results can be traced back to their AppEntry.
export function appDocId(id: string): string {
  return `app-${id}`;
}

// Launcher apps as search docs — merged into the omni-bar corpus. Keywords ride in `body` so they
// match a query without cluttering the displayed row (universalSearch matches body, never shows it).
export function appSearchDocs(): SearchDoc[] {
  return APPS.map((a) => ({
    kind: 'App',
    id: appDocId(a.id),
    title: a.label,
    sub: a.sub,
    body: a.keywords,
  }));
}

// A compact catalog for the agent's system prompt: one "use when" line per app, so the model can
// point the user at the right surface instead of guessing.
export function appCatalogPrompt(): string {
  const lines = APPS.filter((a) => a.useWhen).map((a) => `- ${a.label}: ${a.useWhen}`);
  return `Available apps you can suggest opening:\n${lines.join('\n')}`;
}
