// Builds the searchable corpus from the user's live stores, in one of two scopes:
//   • global — everything the command center holds (library docs, tasks, every conversation,
//     every open web/doc tab). Feeds the main omni-bar.
//   • space  — only what belongs to one Space (its open tabs + its conversation). This is the
//     agent's consent boundary, so it's what the docked agent retrieves over per turn.
//
// Apps (the launcher tiles) and web-history hits are NOT here: apps are a pure-UI concern owned by
// StartPage, and web history is query-dependent (see webHistory.searchWebHistory). Everything here
// is query-independent, so callers can build it once and rank many queries against it.

import { useUIStore } from '../store/useUIStore';
import { useSpaceStore } from '../store/useSpaceStore';
import { useTaskStore } from '../store/useTaskStore';
import { useChatStore } from '../store/useChatStore';
import type { SearchDoc } from './universalSearch';

export type SearchScope = { kind: 'global' } | { kind: 'space'; spaceId: string };

function domainOf(url?: string): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function buildSearchCorpus(scope: SearchScope): SearchDoc[] {
  const out: SearchDoc[] = [];
  const isGlobal = scope.kind === 'global';
  const spaceId = scope.kind === 'space' ? scope.spaceId : null;

  const { savedApps } = useUIStore.getState();
  const { omniTabs, spaces } = useSpaceStore.getState();
  const { tasks } = useTaskStore.getState();
  const { chats, messages } = useChatStore.getState();

  // Open tabs — web pages, docs, and canvases. Scoped to the Space when asked.
  for (const t of omniTabs ?? []) {
    if (t.type !== 'web' && t.type !== 'doc' && t.type !== 'code-canvas') continue;
    if (spaceId && t.spaceId !== spaceId) continue;
    out.push({
      kind: t.type === 'web' ? 'Bookmark' : 'Doc',
      id: `tab-${t.id}`,
      title: t.label || t.url || 'Tab',
      url: t.url,
      sub: t.url ? domainOf(t.url) : undefined,
    });
  }

  // Conversations — searched over their recent message text. Only chats owned by a Space are
  // reachable in the UI, so skip orphans; honor the Space scope when set.
  const chatToSpace = new Map((spaces ?? []).map((s) => [s.chatId, s]));
  for (const c of chats ?? []) {
    const owner = chatToSpace.get(c.id);
    if (!owner) continue;
    if (spaceId && owner.id !== spaceId) continue;
    const msgs = (messages?.[c.id] ?? []).filter((m: any) => m?.content && !m.isToolCall);
    const snippet = msgs.slice(-40).map((m: any) => String(m.content)).join('\n').slice(0, 6000);
    out.push({
      kind: 'Chat',
      id: `chat-${c.id}`,
      title: owner.name || c.name || 'Conversation',
      body: snippet,
      sub: 'Conversation',
      timestamp: c.updatedAt,
    });
  }

  // Saved images form the Image Library — searchable by their vision DESCRIPTION (the base64 blob is
  // never matched). They belong to a Space, so they surface in both global and that Space's scope.
  for (const a of savedApps ?? []) {
    if (a.type !== 'image') continue;
    if (!isGlobal && a.spaceId !== spaceId) continue;
    out.push({
      kind: 'Image',
      id: `img-${a.id}`,
      title: a.title || a.name || 'Image',
      body: typeof a.description === 'string' ? a.description : undefined,
      sub: a.source === 'attached' ? 'Attached image' : a.source === 'generated' ? 'Generated image' : 'Image',
      image: typeof a.content === 'string' ? a.content : undefined,
      timestamp: a.updatedAt,
    });
  }

  // Library docs and open tasks are global (not owned by a Space), so only the global scope sees them.
  if (isGlobal) {
    for (const a of savedApps ?? []) {
      if (a.type === 'image') continue; // images handled above (searchable by description, not base64)
      out.push({
        kind: 'Doc',
        id: `doc-${a.id}`,
        title: a.title || 'Untitled',
        body: typeof a.content === 'string' ? a.content.slice(0, 4000) : undefined,
        sub: a.type ? String(a.type) : undefined,
        timestamp: a.updatedAt,
      });
    }
    for (const t of tasks ?? []) {
      if (t.completed) continue;
      out.push({
        kind: 'Task',
        id: `task-${t.id}`,
        title: t.title || 'Task',
        body: t.details || undefined,
        sub: t.dueDate ? `Due ${t.dueDate}` : 'To-Do',
        timestamp: t.updatedAt ?? t.createdAt,
      });
    }
  }

  return out;
}
