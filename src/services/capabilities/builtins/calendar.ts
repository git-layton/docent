// Calendar — append an item to the local planner/tasks. Extracted verbatim from the former App.tsx
// tool if-chain (route 'calendar'); behavior-identical. `effect: 'write'` (local mutation); a future
// phase splits calendar_read / calendar_write so writes stay gated (design §8 #4).
import { invoke } from '@tauri-apps/api/core';
import { useUIStore } from '../../../store/useUIStore';
import type { Capability, CapabilityContext, CapabilityResult } from '../types';

export const calendarCapability: Capability = {
  id: 'calendar',
  title: 'Calendar',
  description: 'Add an item to the local planner / tasks (~/AgentForge/memory/tasks.md).',
  effect: 'write',
  surfaces: '*',
  routes: ['calendar'],
  async execute(ctx: CapabilityContext): Promise<CapabilityResult> {
    let toolData = '';
    try {
        const taskText = ctx.userMsg.content.replace(/^(schedule|remind me to|add|calendar|set reminder for)\s*/i, '').trim();
        await invoke('append_task', { text: taskText });
        toolData += `\n\n[CALENDAR]\nAdded to local planner: "${taskText}"\nSaved to ~/AgentForge/memory/tasks.md`;
        useUIStore.getState().showToast(`Added to planner: ${taskText.slice(0, 60)}${taskText.length > 60 ? '…' : ''}`);
    } catch (e: any) {
        toolData += `\n\n[CALENDAR ERROR]\n${e?.message ?? e}`;
    }
    return { toolData, sources: [], status: { type: 'remove' } };
  },
};
