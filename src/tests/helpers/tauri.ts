import { vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'

export const mockInvoke = invoke as ReturnType<typeof vi.fn>

/** Set up invoke to return a specific value for a given command */
export function mockCommand(command: string, returnValue: unknown) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === command) return Promise.resolve(returnValue)
    return Promise.resolve(null)
  })
}

/** Reset invoke mock between tests */
export function resetInvoke() {
  mockInvoke.mockReset().mockResolvedValue(null)
}
