import React, { useMemo } from 'react';
import { CheckSquare, FileText, Mail, Cake } from 'lucide-react';
import { useTaskStore, taskCoversDate } from '../store/useTaskStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';

export interface GroundedChip {
  id: string;
  label: string;
  prompt: string;
  icon?: React.ElementType;
}

export interface GroundedStatusItem {
  id: string;
  icon: React.ElementType;
  text: string;
}

/**
 * Grounded conversation starters built from real local state — open/due tasks,
 * today's saved events, recently edited Library docs, connected mail. No LLM
 * round-trip and nothing leaves the machine. Shared by the empty-space landing
 * and the post-greeting chip row in chat.
 */
export function useGroundedSuggestions(): {
  statusItems: GroundedStatusItem[];
  chips: GroundedChip[];
} {
  const tasks = useTaskStore((s) => s.tasks);
  const recurringEvents = useTaskStore((s) => s.recurringEvents);
  const savedApps = useUIStore((s) => s.savedApps);
  const integrations = useSettingsStore((s) => s.integrations);

  return useMemo(() => {
    const items: GroundedStatusItem[] = [];
    const chips: GroundedChip[] = [];

    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const open = tasks.filter((t: any) => !t.completed);
    const dueToday = open.filter((t: any) => taskCoversDate(t, iso));
    if (open.length > 0) {
      items.push({
        id: 'tasks',
        icon: CheckSquare,
        text: dueToday.length > 0
          ? `${open.length} open task${open.length !== 1 ? 's' : ''} — ${dueToday.length} due today`
          : `${open.length} open task${open.length !== 1 ? 's' : ''}`,
      });
      chips.push({
        id: 'tasks-chip',
        label: dueToday.length > 0 ? "What's due today?" : 'Review my open tasks',
        prompt: dueToday.length > 0
          ? 'Walk me through what is due today from my pending tasks, then help me decide what to tackle first.'
          : 'Review my open tasks with me. Summarize them, flag anything that looks stale or urgent, and suggest an order of attack.',
        icon: CheckSquare,
      });
    }

    const todaysEvents = (recurringEvents ?? []).filter(
      (e: any) => e.month === now.getMonth() + 1 && e.day === now.getDate(),
    );
    if (todaysEvents.length > 0) {
      items.push({
        id: 'events',
        icon: Cake,
        text: `Today: ${todaysEvents.map((e: any) => e.name).join(', ')}`,
      });
    }

    const recentDoc = [...(savedApps ?? [])]
      .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .find((d: any) => d.updatedAt && Date.now() - d.updatedAt < 7 * 24 * 60 * 60 * 1000);
    if (recentDoc) {
      const title = recentDoc.title || 'Untitled';
      items.push({ id: 'doc', icon: FileText, text: `Last touched: “${title}”` });
      chips.push({
        id: 'resume-doc',
        label: `Resume “${title.length > 24 ? `${title.slice(0, 24)}…` : title}”`,
        prompt: `Let's pick up where I left off on "${title}". Recap what it is, then ask me what I want to change or add next.`,
        icon: FileText,
      });
    }

    if (((integrations as any)?.mailAccounts ?? []).length > 0) {
      chips.push({
        id: 'inbox-chip',
        label: 'Summarize my inbox',
        prompt: 'Check my mail and give me a short summary of what is new or needs a reply, grouped by importance.',
        icon: Mail,
      });
    }

    return { statusItems: items, chips };
  }, [tasks, recurringEvents, savedApps, integrations]);
}
