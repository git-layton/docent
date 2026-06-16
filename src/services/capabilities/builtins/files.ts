// Files capability — folds the agent's workspace contents into context so it can answer about / work
// with the files on its desk in a single turn (like knowledgeSearch folds RAG hits). MUTATIONS are not
// done here — the agent proposes those via ```file-op blocks, which go through the consent layer in
// App.tsx. This capability is read-only context. See docs/agent-file-access-design.md.
import { invoke } from '@tauri-apps/api/core';
import { useSpaceStore } from '../../../store/useSpaceStore';
import { spaceHome, relativeToSpace } from '../../fileAccess/spaces';
import type { Capability, CapabilityContext, CapabilityResult } from '../types';

const MAX_ENTRIES = 200;

export const filesCapability: Capability = {
  id: 'file-access',
  title: 'Files',
  description: "Read and work with files in the agent's workspace (~/AgentForge/workspace).",
  effect: 'read',
  surfaces: '*',
  routes: ['files'],
  async execute(_ctx: CapabilityContext): Promise<CapabilityResult> {
    let toolData = '';
    try {
      if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
        // Scope the listing to the active space's home folder (spaces/<id>/), so the agent sees
        // exactly the files the human panel shows — and present them space-relative so it works in
        // terms of `plan.md`, not `spaces/<id>/plan.md`. Relative paths it emits land here too.
        const spaceId = useSpaceStore.getState().activeSpaceId;
        const home = spaceHome(spaceId);
        const res = await invoke<{ ok: boolean; entries: Array<{ path: string; isDir: boolean; size: number }>; root: string }>(
          'fs_list',
          { path: home },
        );
        const entries = (res?.entries ?? []).slice(0, MAX_ENTRIES);
        const tree = entries.length
          ? entries.map(e => {
              const rel = relativeToSpace(spaceId, e.path);
              return `- ${e.isDir ? `📁 ${rel}/` : `${rel} (${e.size} bytes)`}`;
            }).join('\n')
          : '(this folder is empty)';
        toolData += `\n\n[SYSTEM NOTE: THIS SPACE'S FOLDER — your private workspace for this space]\n${tree}\n` +
          `These are the files in THIS space's folder. Relative paths you emit (e.g. "plan.md") land here. ` +
          `To read a file, create/edit one, or run a command, emit a \`\`\`file-op block as described in your instructions.\n[END WORKSPACE]`;
      }
    } catch (e: any) {
      toolData += `\n\n[SYSTEM NOTE: WORKSPACE LISTING FAILED]\nError: ${e?.message ?? e}\n[END]`;
    }
    return { toolData, sources: [], status: { type: 'remove' } };
  },
};
