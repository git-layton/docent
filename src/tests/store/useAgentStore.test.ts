import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore, CODEY_ASSISTANT, ALEXIS_ASSISTANT } from '../../store/useAgentStore';

// Snapshot the default cast at import time, before any test mutates the singleton.
const INITIAL = useAgentStore.getState().assistants;

describe('default agent cast', () => {
  it('ships Codey (the coding agent) and not Aria', () => {
    const ids = INITIAL.map((a: any) => a.id);
    const codey = INITIAL.find((a: any) => a.id === 'forge-dev');
    expect(codey?.name).toBe('Codey');
    expect(ids).not.toContain('forge-aria');
    expect(CODEY_ASSISTANT.name).toBe('Codey');
    expect(CODEY_ASSISTANT.id).toBe('forge-dev'); // id kept so existing chats stay wired
  });

  it('gives Codey a research toolkit (web_search + local_workspace) so he can research while coding', () => {
    // file_op/workshop are universal and commands are Developer-Mode gated, so these two flags are
    // what make Codey a full code copilot that can also browse the web + search knowledge.
    expect(CODEY_ASSISTANT.tools.web_search).toBe(true);
    expect(CODEY_ASSISTANT.tools.local_workspace).toBe(true);
  });
});

describe('deleteAgent', () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentStore.setState({
      assistants: [
        { id: 'alexis', name: 'Alexis' },
        { id: 'forge-dev', name: 'Codey' },
        { id: 'clone-123', name: 'My Bot' },
        { id: 'f-default', name: 'Assistant' },
      ],
      activeFolderId: 'alexis',
      deletedBuiltinIds: [],
    });
  });

  it('removes a custom (cloned) agent without tombstoning it', async () => {
    await useAgentStore.getState().deleteAgent('clone-123');
    const { assistants, deletedBuiltinIds } = useAgentStore.getState();
    expect(assistants.some((a: any) => a.id === 'clone-123')).toBe(false);
    expect(deletedBuiltinIds).not.toContain('clone-123');
  });

  it('tombstones a deleted built-in so hydrate cannot resurrect it', async () => {
    await useAgentStore.getState().deleteAgent('forge-dev');
    const { assistants, deletedBuiltinIds } = useAgentStore.getState();
    expect(assistants.some((a: any) => a.id === 'forge-dev')).toBe(false);
    expect(deletedBuiltinIds).toContain('forge-dev');
  });

  it('moves the active selection off a deleted active agent', async () => {
    useAgentStore.setState({ activeFolderId: 'clone-123' });
    await useAgentStore.getState().deleteAgent('clone-123');
    expect(useAgentStore.getState().activeFolderId).not.toBe('clone-123');
  });

  it('never deletes the hidden f-default fallback', async () => {
    await useAgentStore.getState().deleteAgent('f-default');
    expect(useAgentStore.getState().assistants.some((a: any) => a.id === 'f-default')).toBe(true);
  });
});

describe('hydrate', () => {
  beforeEach(() => localStorage.clear());

  it('honors the tombstone — a deleted built-in stays gone', async () => {
    localStorage.setItem('assistants', JSON.stringify([{ id: 'alexis', name: 'Alexis', prompt: ALEXIS_ASSISTANT.prompt }]));
    localStorage.setItem('deletedBuiltinIds', JSON.stringify(['forge-dev']));
    await useAgentStore.getState().hydrate();
    const ids = useAgentStore.getState().assistants.map((a: any) => a.id);
    expect(ids).not.toContain('forge-dev'); // tombstoned → not re-seeded
    expect(ids).toContain('forge-guide');   // a non-deleted built-in is still re-seeded
  });

  it('migrates a legacy "Dev" agent to "Codey"', async () => {
    localStorage.setItem('assistants', JSON.stringify([{ id: 'forge-dev', name: 'Dev', prompt: 'old prompt' }]));
    await useAgentStore.getState().hydrate();
    const codey = useAgentStore.getState().assistants.find((a: any) => a.id === 'forge-dev');
    expect(codey?.name).toBe('Codey');
  });
});
