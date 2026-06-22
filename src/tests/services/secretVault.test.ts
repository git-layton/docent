import { describe, it, expect, beforeEach } from 'vitest';
import { mockInvoke, resetInvoke } from '../helpers/tauri';
import { stashSecretsForDisk, rehydrateSecrets } from '../../services/secretVault';

// secretVault is a no-op without Tauri; simulate a Tauri context + an in-memory Keychain so we can
// exercise the stash → redact → rehydrate round-trip and the never-lose-a-secret invariant.
function installKeychainMock() {
  const store = new Map<string, string>();
  mockInvoke.mockImplementation((cmd: string, args: any) => {
    if (cmd === 'keychain_save') {
      store.set(args.host, args.password);
      return Promise.resolve({ ok: true });
    }
    if (cmd === 'keychain_get') {
      const v = store.get(args.host);
      return Promise.resolve(v ? { ok: true, password: v } : { ok: false });
    }
    if (cmd === 'keychain_delete') {
      store.delete(args.host);
      return Promise.resolve({ ok: true });
    }
    return Promise.resolve(null);
  });
  return store;
}

describe('secretVault — at-rest secret round-trip', () => {
  beforeEach(() => {
    resetInvoke();
    (window as any).__TAURI_INTERNALS__ = {}; // make hasTauri() true
  });

  it('stashes secrets to the Keychain and redacts the on-disk copy (originals untouched)', async () => {
    installKeychainMock();
    const models = [{ id: 'm1', apiKey: 'sk-secret', name: 'X' }, { id: 'local', apiKey: '' }];
    const integrations = { openai: { apiKey: 'oai' }, slack: { enabled: true, botToken: 'xoxb' }, brave: { apiKey: '' } };
    const { models: dm, integrations: di } = await stashSecretsForDisk(models, integrations);
    expect(dm[0].apiKey).toBe('');        // redacted on disk
    expect(dm[1].apiKey).toBe('');        // local model had no key — unchanged
    expect(di.openai.apiKey).toBe('');
    expect(di.slack.botToken).toBe('');
    expect(di.slack.enabled).toBe(true);  // non-secret fields preserved
    expect(models[0].apiKey).toBe('sk-secret'); // in-memory original NOT mutated
    expect(integrations.openai.apiKey).toBe('oai');
  });

  it('rehydrates secrets from the Keychain', async () => {
    installKeychainMock();
    await stashSecretsForDisk([{ id: 'm1', apiKey: 'sk-secret' }], { openai: { apiKey: 'oai' } });
    const { models, integrations, needsMigration } = await rehydrateSecrets(
      [{ id: 'm1', apiKey: '' }],
      { openai: { apiKey: '' } },
    );
    expect(models[0].apiKey).toBe('sk-secret');
    expect(integrations.openai.apiKey).toBe('oai');
    expect(needsMigration).toBe(false);
  });

  it('keeps legacy plaintext (on disk, not yet in Keychain) and flags it for migration', async () => {
    installKeychainMock(); // empty keychain
    const { models, needsMigration } = await rehydrateSecrets([{ id: 'm1', apiKey: 'legacy-plain' }], {});
    expect(models[0].apiKey).toBe('legacy-plain'); // kept, never dropped
    expect(needsMigration).toBe(true);
  });

  it('never redacts a secret when the Keychain write fails (never lose a secret)', async () => {
    mockInvoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'keychain_save' ? { ok: false } : null),
    );
    const { models } = await stashSecretsForDisk([{ id: 'm1', apiKey: 'sk' }], {});
    expect(models[0].apiKey).toBe('sk'); // save failed ⇒ left intact on disk
  });

  it('no-ops without Tauri — secrets stay in the blob unchanged', async () => {
    resetInvoke();
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__TAURI__;
    const { models, integrations } = await stashSecretsForDisk([{ id: 'm1', apiKey: 'sk' }], { openai: { apiKey: 'oai' } });
    expect(models[0].apiKey).toBe('sk');
    expect(integrations.openai.apiKey).toBe('oai');
  });
});
