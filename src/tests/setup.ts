import { vi, afterEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }))
vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue({ get: vi.fn().mockResolvedValue(null), set: vi.fn(), save: vi.fn() }),
}))

afterEach(() => { vi.clearAllMocks() })
