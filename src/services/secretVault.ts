// SEC-APIKEYS — at-rest protection for model & integration secrets.
//
// These secrets (LLM API keys, search keys, Slack bot token, GUS token) MUST stay readable by JS at
// runtime — the provider fetch headers are built in the renderer via plugin-http — so this is NOT
// full isolation. The win is encryption-at-rest: secrets live in the macOS Keychain instead of as
// plaintext in the tauri-store `.bin` (and its localStorage fallback). At runtime they're read back
// into the in-memory store on hydrate, exactly where consumers already expect them.
//
// STRICT INVARIANT — never lose a secret: a value is redacted from the on-disk blob ONLY after a
// confirmed Keychain write. Without Tauri (tests / non-macOS dev) the Keychain is unavailable, so
// these functions are no-ops and secrets stay in the blob exactly as before — zero behavior change.
//
// Deferred: googleWorkspaces[] OAuth client_secret/refreshToken (nested per-account array) — handled
// in the enforcement-layer pass; the flat provider secrets below are the common case.
import { invoke } from '@tauri-apps/api/core';

const hasTauri = (): boolean =>
  typeof window !== 'undefined' &&
  !!((window as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }).__TAURI_INTERNALS__ ||
     (window as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }).__TAURI__);

const modelHost = (id: string) => `model-key:${id}`;
const integrationHost = (provider: string) => `integration:${provider}`;

/** (provider, field) pairs holding a flat integration secret in the settings store. */
const INTEGRATION_SECRETS: ReadonlyArray<{ provider: string; field: string }> = [
  { provider: 'brave', field: 'apiKey' },
  { provider: 'tavily', field: 'apiKey' },
  { provider: 'openai', field: 'apiKey' },
  { provider: 'google', field: 'apiKey' },
  { provider: 'anthropic', field: 'apiKey' },
  { provider: 'customImage', field: 'apiKey' },
  { provider: 'slack', field: 'botToken' },
  { provider: 'gus', field: 'accessToken' },
];

async function kcSave(host: string, value: string): Promise<boolean> {
  try {
    const r = await invoke<{ ok: boolean }>('keychain_save', { host, username: host, password: value });
    return !!r?.ok;
  } catch {
    return false;
  }
}
async function kcGet(host: string): Promise<string | null> {
  try {
    const r = await invoke<{ ok: boolean; password?: string }>('keychain_get', { host });
    return r?.ok && r.password ? r.password : null;
  } catch {
    return null;
  }
}

/**
 * Move secrets into the Keychain and return REDACTED copies safe to persist to disk. Inputs are never
 * mutated (the in-memory store keeps the live secrets). No-op without Tauri.
 */
export async function stashSecretsForDisk(
  models: any[],
  integrations: any,
): Promise<{ models: any[]; integrations: any }> {
  if (!hasTauri()) return { models, integrations };
  const outModels = await Promise.all(
    (models ?? []).map(async (m: any) => {
      if (m?.id && m?.apiKey) {
        const ok = await kcSave(modelHost(m.id), m.apiKey);
        if (ok) return { ...m, apiKey: '' }; // redact ONLY after a confirmed Keychain write
      }
      return m;
    }),
  );
  const outIntegrations = { ...(integrations ?? {}) };
  for (const { provider, field } of INTEGRATION_SECRETS) {
    const val = outIntegrations?.[provider]?.[field];
    if (val) {
      const ok = await kcSave(integrationHost(provider), val);
      if (ok) outIntegrations[provider] = { ...outIntegrations[provider], [field]: '' };
    }
  }
  return { models: outModels, integrations: outIntegrations };
}

/**
 * Re-inject secrets from the Keychain into freshly-loaded models/integrations. If a secret is missing
 * from the Keychain but present (plaintext) on disk, that's a legacy/un-migrated value: it's kept
 * (never dropped) and `needsMigration` is set so the caller can persist() to move it into the Keychain.
 */
export async function rehydrateSecrets(
  models: any[],
  integrations: any,
): Promise<{ models: any[]; integrations: any; needsMigration: boolean }> {
  if (!hasTauri()) return { models, integrations, needsMigration: false };
  let legacy = false;
  const outModels = await Promise.all(
    (models ?? []).map(async (m: any) => {
      if (!m?.id) return m;
      const k = await kcGet(modelHost(m.id));
      if (k) return { ...m, apiKey: k };
      if (m?.apiKey) legacy = true; // plaintext still on disk, not yet migrated
      return m;
    }),
  );
  const outIntegrations = { ...(integrations ?? {}) };
  for (const { provider, field } of INTEGRATION_SECRETS) {
    const k = await kcGet(integrationHost(provider));
    if (k) {
      outIntegrations[provider] = { ...outIntegrations[provider], [field]: k };
    } else if (outIntegrations?.[provider]?.[field]) {
      legacy = true;
    }
  }
  return { models: outModels, integrations: outIntegrations, needsMigration: legacy };
}
