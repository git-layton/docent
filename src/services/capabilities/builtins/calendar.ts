// Calendar / To-Dos — create a to-do through the ACTIVE connector backend, so an agent-created item
// lands wherever the user chose: the local planner, or the native Reminders app (which syncs to the
// user's iPhone via iCloud). Routes the gatekeeper's 'calendar' route. effect: 'write' (the native
// backend is the user's own store). A future phase can split read/write and add dedicated notes/tasks
// routes once the gatekeeper emits them.
import { useUIStore } from '../../../store/useUIStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { getTasks } from '../../connectors';
import type { Capability, CapabilityContext, CapabilityResult } from '../types';

export const calendarCapability: Capability = {
  id: 'calendar',
  title: 'Calendar',
  description: 'Add a to-do / reminder through the active backend (local planner or the Reminders app).',
  effect: 'write',
  surfaces: '*',
  routes: ['calendar'],
  async execute(ctx: CapabilityContext): Promise<CapabilityResult> {
    let toolData = '';
    try {
      const taskText = ctx.userMsg.content.replace(/^(schedule|remind me to|add|calendar|set reminder for)\s*/i, '').trim();
      await getTasks().createTask({ title: taskText });
      const backend = (useSettingsStore.getState().integrations as any)?.tasks?.backend ?? 'local';
      const where = backend === 'eventkit' ? 'Reminders (syncing to your devices)' : 'your planner';
      toolData += `\n\n[CALENDAR]\nAdded to ${where}: "${taskText}"`;
      useUIStore.getState().showToast(`Added: ${taskText.slice(0, 60)}${taskText.length > 60 ? '…' : ''}`);
    } catch (e: any) {
      toolData += `\n\n[CALENDAR ERROR]\n${e?.message ?? e}`;
    }
    return { toolData, sources: [], status: { type: 'remove' } };
  },
};
