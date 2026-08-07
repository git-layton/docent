import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { invoke } from '@tauri-apps/api/core'
import { LockedSetupScreen } from '../../components/LockedSetupScreen'
import { useSettingsStore } from '../../store/useSettingsStore'

// ─── Seam ①: first run ────────────────────────────────────────────────────────
//
// "Fresh install → model registered → first message" was exercised by nothing, and two bugs
// lived there for as long as the screen has existed:
//
//   endpoint: 'local'     — not a server URL, so chat had nothing to talk to
//   contextLimit: 8192    — while buildSystemPrompt alone spends ~8-13k tokens, so every
//                           message overflowed before the user typed anything
//
// Neither is a logic error inside a function; both are wiring, which is exactly what unit
// tests do not see. This mounts the real component against a mocked Tauri and asserts the
// registration it performs.

const mockInvoke = vi.mocked(invoke)

/** The screen polls list_gguf_models on a 3s interval; drive it deterministically. */
const withFakeTimers = async (fn: () => Promise<void>) => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try { await fn() } finally { vi.useRealTimers() }
}

describe('LockedSetupScreen — first-run model registration', () => {
  beforeEach(() => {
    useSettingsStore.setState({ models: [], selectedModelId: null } as any)
    mockInvoke.mockReset()
  })

  const wireInvoke = () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_gguf_models') return [{ filename: 'gemma-4-12b-it-Q4_K_M.gguf', size_mb: 7000 }]
      if (cmd === 'get_models_dir') return '/Users/test/AgentForge/models'
      if (cmd === 'start_local_model') return 'http://127.0.0.1:8080/v1'
      return null
    })
  }

  it('LAUNCHES the model rather than registering one that was never started', async () => {
    // The original bug: it registered `endpoint: 'local'` without ever calling
    // start_local_model, so there was no server behind the model it selected.
    wireInvoke()
    await withFakeTimers(async () => {
      render(<LockedSetupScreen />)
      await vi.advanceTimersByTimeAsync(3500)
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('start_local_model', expect.objectContaining({
          modelPath: '/Users/test/AgentForge/models/gemma-4-12b-it-Q4_K_M.gguf',
          port: 8080,
        }))
      })
    })
  })

  it('stores the REAL endpoint returned by the engine', async () => {
    wireInvoke()
    await withFakeTimers(async () => {
      render(<LockedSetupScreen />)
      await vi.advanceTimersByTimeAsync(3500)
      await waitFor(() => {
        const [m] = useSettingsStore.getState().models
        expect(m).toBeTruthy()
        expect(m.endpoint).toBe('http://127.0.0.1:8080/v1')
        expect(m.endpoint).not.toBe('local')
      })
    })
  })

  it('registers a context that matches what the engine was launched at', async () => {
    // 8192 was the shipped value while the engine ran at 32768 — the app believed the window
    // was a quarter of its real size and refused every message.
    wireInvoke()
    await withFakeTimers(async () => {
      render(<LockedSetupScreen />)
      await vi.advanceTimersByTimeAsync(3500)
      await waitFor(() => {
        const [m] = useSettingsStore.getState().models
        expect(m?.contextLimit).toBe(32768)
      })
    })
  })

  it('selects the model it just registered', async () => {
    wireInvoke()
    await withFakeTimers(async () => {
      render(<LockedSetupScreen />)
      await vi.advanceTimersByTimeAsync(3500)
      await waitFor(() => {
        const s = useSettingsStore.getState()
        expect(s.selectedModelId).toBe(s.models[0]?.id)
      })
    })
  })

  it('does NOT clobber a model the user already configured', async () => {
    useSettingsStore.setState({
      models: [{ id: 'existing', name: 'My Cloud Model', provider: 'google' }],
    } as any)
    wireInvoke()
    await withFakeTimers(async () => {
      render(<LockedSetupScreen />)
      await vi.advanceTimersByTimeAsync(3500)
      expect(useSettingsStore.getState().models).toHaveLength(1)
      expect(useSettingsStore.getState().models[0].id).toBe('existing')
      expect(mockInvoke).not.toHaveBeenCalledWith('start_local_model', expect.anything())
    })
  })

  it('registers nothing when no model has downloaded yet', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'list_gguf_models' ? [] : null))
    await withFakeTimers(async () => {
      render(<LockedSetupScreen />)
      await vi.advanceTimersByTimeAsync(3500)
      expect(useSettingsStore.getState().models).toHaveLength(0)
    })
  })

  it('survives the engine failing to start instead of registering a dead model', async () => {
    // A model registered against a launch that threw would look configured and never work.
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_gguf_models') return [{ filename: 'm.gguf', size_mb: 100 }]
      if (cmd === 'get_models_dir') return '/models'
      if (cmd === 'start_local_model') throw new Error('engine failed to start')
      return null
    })
    await withFakeTimers(async () => {
      render(<LockedSetupScreen />)
      await vi.advanceTimersByTimeAsync(3500)
      expect(useSettingsStore.getState().models).toHaveLength(0)
    })
  })
})
