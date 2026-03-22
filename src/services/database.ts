// ─── Bulletproof Database Helper (Tauri + LocalStorage Mirror) ───────────────
export const db = {
  store: null as any,
  async init() {
    try {
      if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
        const { load } = await import('@tauri-apps/plugin-store');
        if (load) {
          this.store = await load('agent_forge_db.bin', { autoSave: true, defaults: {} });
        }
      }
    } catch (e) {
      console.warn("[Agent Forge] Tauri Store plugin missing or failed.", e);
    }
  },
  async get(key: string, defaultVal: any) {
    try {
      if (this.store) {
        const val = await this.store.get(key);
        if (val !== null && val !== undefined) {
           localStorage.setItem(key, JSON.stringify(val));
           return val;
        }
      }
      const localVal = localStorage.getItem(key);
      return localVal ? JSON.parse(localVal) : defaultVal;
    } catch { return defaultVal; }
  },
  async set(key: string, val: any) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      if (this.store) {
        await this.store.set(key, val);
        if (this.store.save) await this.store.save();
      }
    } catch (e) { console.error("DB Save Error:", e); }
  }
};
