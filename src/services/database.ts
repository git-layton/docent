export const db = {
  store: null as any,
  _initPromise: null as Promise<void> | null,

  init(): Promise<void> {
    if (!this._initPromise) {
      this._initPromise = (async () => {
        try {
          if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
            const { load } = await import('@tauri-apps/plugin-store');
            this.store = await load('agent_forge_db.bin', { autoSave: true, defaults: {} });
          }
        } catch (e) {
          console.warn("[Docent] Tauri Store plugin missing or failed.", e);
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
      return localVal ? JSON.parse(localVal) : defaultVal;
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
    } catch (e) { console.error("DB Save Error:", e); }
  },
};
