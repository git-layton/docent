import { vi, afterEach } from 'vitest'

// localStorage polyfill — happy-dom does not expose Storage in this setup, and
// Node's native localStorage is gated behind --localstorage-file. The db layer
// (src/services/database.ts) falls back to localStorage outside a Tauri runtime,
// which is exactly the path store tests exercise.
if (typeof globalThis.localStorage === 'undefined') {
  const createStorage = (): Storage => {
    const map = new Map<string, string>()
    return {
      get length() { return map.size },
      clear: () => map.clear(),
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, String(v)) },
      removeItem: (k: string) => { map.delete(k) },
      key: (i: number) => Array.from(map.keys())[i] ?? null,
    }
  }
  const storage = createStorage()
  globalThis.localStorage = storage
  if (typeof window !== 'undefined') window.localStorage = storage
}

// Mock Tauri IPC layer — prevents "invoke is not a function" in unit tests
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    entries: vi.fn().mockResolvedValue([]),
  }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
  message: vi.fn().mockResolvedValue(undefined),
  confirm: vi.fn().mockResolvedValue(true),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn().mockResolvedValue(''),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
  once: vi.fn().mockResolvedValue(() => {}),
}))

afterEach(() => {
  vi.clearAllMocks()
})
