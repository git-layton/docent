export const db = {
  store: null as any,
  _initPromise: null as Promise<void> | null,
  backup: {} as Record<string, any>,
  backupReady: false,

  init(): Promise<void> {
    if (!this._initPromise) {
      this._initPromise = (async () => {
        try {
          if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
            const { load } = await import('@tauri-apps/plugin-store');
            this.store = await load('agent_forge_db.bin', { autoSave: true, defaults: {} });
            const { invoke } = await import('@tauri-apps/api/core');
            const result = await invoke<{ ok: boolean; state?: Record<string, any> }>('read_app_state_backup').catch(() => null);
            if (result?.ok && result.state && typeof result.state === 'object') {
              this.backup = result.state;
              this.backupReady = true;
            }
          }
        } catch (e) {
          console.warn("[Agent Forge] Tauri Store plugin missing or failed.", e);
        }
      })();
    }
    return this._initPromise;
  },

  async get(key: string, defaultVal: any) {
    try {
      await this.init();
      if (this.store) {
        const val = await this.store.get(key);
        if (val !== null && val !== undefined) return val;
      }
      // localStorage fallback (non-Tauri or store unavailable)
      const localVal = localStorage.getItem(key);
      if (localVal) return JSON.parse(localVal);
      if (this.backupReady && Object.prototype.hasOwnProperty.call(this.backup, key)) return this.backup[key];
      return defaultVal;
    } catch { return defaultVal; }
  },

  async set(key: string, val: any) {
    try {
      await this.init();
      if (this.store) {
        await this.store.set(key, val);
        if (this.store.save) await this.store.save();
      } else {
        // localStorage fallback only when Tauri store is unavailable
        localStorage.setItem(key, JSON.stringify(val));
      }
      if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
        this.backup = { ...(this.backup ?? {}), [key]: val };
        this.backupReady = true;
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('write_app_state_backup', { state: this.backup }).catch((e) => {
          console.warn("[Agent Forge] App state backup failed.", e);
        });
      }
    } catch (e) { console.error("DB Save Error:", e); }
  },
};
