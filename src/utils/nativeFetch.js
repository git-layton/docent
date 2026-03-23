import { fetch } from '@tauri-apps/plugin-http';

// Tauri's http fetch requires headers to be a flat object, not a Headers instance.
// Errors from the Tauri HTTP backend are sometimes plain objects/strings, not Error
// instances — use optional chaining on .name/.message throughout.
export const fetchWithRetry = async (url, options, retries = 3, signal) => {
  let delay = 1000;

  const safeOptions = {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Calls the Rust backend, completely bypassing browser CORS
      const res = await fetch(url, safeOptions);

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          errMsg = body?.error?.message ?? body?.message ?? errMsg;
        } catch { /* non-JSON error body */ }

        if (res.status === 400 && /context|size|too large/i.test(errMsg)) {
          throw new Error('CONTEXT_LIMIT_EXCEEDED');
        }
        throw new Error(errMsg);
      }
      return await res.json();
    } catch (err) {
      if (err?.name === 'AbortError' || err?.message === 'CONTEXT_LIMIT_EXCEEDED') throw err;
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }
};
