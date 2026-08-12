import { describe, it, expect, vi } from 'vitest'
import {
  stemOf, isLocalModel, fileForModel, servingMatches, portOf, ensureLocalModelServing,
} from '../../services/localEngine'

// ─── The picker must not lie about who is answering ───────────────────────────
//
// Shipped state, verified live on 2026-08-12: the model badge read "Qwen3 32B" while
// /v1/models reported gemma-4-12b-it-Q4_K_M.gguf. One llama-server serves one model, every local
// model is registered at 127.0.0.1:8080/v1, and selecting a model was `set({ selectedModelId })`
// with nothing else — no caller of start_local_model outside the Model Store, Settings and
// first-run setup.
//
// The damage went past the label: capability flags come from the SELECTED config, so Qwen's
// `canImage: false` hid image attachments while the loaded engine had Gemma's mmproj projector
// and could see. And two local models compared side by side were the same model twice.

const qwen = {
  id: 'native-mrqlbtz0', name: 'Qwen3 32B', provider: 'native', isLocal: true,
  modelId: 'Qwen_Qwen3-32B-Q4_K_M', endpoint: 'http://127.0.0.1:8080/v1', contextLimit: 32768,
}
const gemma = {
  id: 'native-mrqlfbka', name: 'Gemma 4 12B', provider: 'native', isLocal: true,
  modelId: 'gemma-4-12b-it-Q4_K_M', endpoint: 'http://127.0.0.1:8080/v1', contextLimit: 32768,
  mmprojPath: '/Users/x/AgentForge/models/mmproj-gemma-4-12b-it-F16.gguf',
}
const cloud = { id: 'm-1', name: 'gemini-2.5-pro', provider: 'google', contextLimit: 2000000 }

// Exactly what's on disk, mmproj included — list_gguf_models filters it, but never assume that.
const FILES = [
  { filename: 'Llama-3.3-70B-Instruct-Q4_K_M.gguf' },
  { filename: 'Qwen_Qwen3-30B-A3B-Q4_K_M.gguf' },
  { filename: 'Qwen_Qwen3-32B-Q4_K_M.gguf' },
  { filename: 'gemma-4-12b-it-Q4_K_M.gguf' },
]

describe('pure resolution', () => {
  it('stems a filename and a full path identically', () => {
    expect(stemOf('gemma-4-12b-it-Q4_K_M.gguf')).toBe('gemma-4-12b-it-Q4_K_M')
    expect(stemOf('/Users/x/models/gemma-4-12b-it-Q4_K_M.gguf')).toBe('gemma-4-12b-it-Q4_K_M')
  })

  it('knows local from cloud', () => {
    expect(isLocalModel(qwen)).toBe(true)
    expect(isLocalModel(cloud)).toBe(false)
    expect(isLocalModel(null)).toBe(false)
  })

  it('resolves a config to its file — configs store no path, only a stem', () => {
    expect(fileForModel(qwen, FILES)).toBe('Qwen_Qwen3-32B-Q4_K_M.gguf')
  })

  it('does not confuse 32B with 30B-A3B', () => {
    // Substring matching would pick whichever came first. These are different models.
    expect(fileForModel({ ...qwen, modelId: 'Qwen_Qwen3-30B-A3B-Q4_K_M' }, FILES))
      .toBe('Qwen_Qwen3-30B-A3B-Q4_K_M.gguf')
  })

  it('returns null for a model that is not installed', () => {
    expect(fileForModel({ ...qwen, modelId: 'Deleted-Model-Q4' }, FILES)).toBeNull()
    expect(fileForModel(qwen, [])).toBeNull()
    expect(fileForModel(qwen, null)).toBeNull()
  })

  it('detects the mismatch that shipped', () => {
    const serving = '/Users/x/AgentForge/models/gemma-4-12b-it-Q4_K_M.gguf'
    expect(servingMatches(gemma, serving)).toBe(true)
    expect(servingMatches(qwen, serving)).toBe(false)  // ← the bug, in one assertion
  })

  it('treats a moved models directory as the same model', () => {
    expect(servingMatches(gemma, '/somewhere/else/gemma-4-12b-it-Q4_K_M.gguf')).toBe(true)
  })

  it('never matches on missing data — unknown must not read as "already correct"', () => {
    expect(servingMatches(qwen, null)).toBe(false)
    expect(servingMatches(qwen, '')).toBe(false)
    expect(servingMatches({ ...qwen, modelId: undefined }, 'x.gguf')).toBe(false)
  })

  it('reads the port from the endpoint', () => {
    expect(portOf('http://127.0.0.1:8080/v1')).toBe(8080)
    expect(portOf('http://localhost:1234/v1')).toBe(1234)
    expect(portOf(undefined)).toBe(8080)
  })
})

describe('ensureLocalModelServing', () => {
  const deps = (serving: string | null, files = FILES) => ({
    invoke: vi.fn(async (cmd: string, _args?: any) => {
      if (cmd === 'get_models_dir') return '/Users/x/AgentForge/models'
      if (cmd === 'list_gguf_models') return files
      if (cmd === 'start_local_model') return 'http://127.0.0.1:8080/v1'
      return null
    }),
    fetchServing: vi.fn(async () => serving),
  })

  it('launches the picked model when a DIFFERENT one is serving', async () => {
    const d = deps('/Users/x/AgentForge/models/gemma-4-12b-it-Q4_K_M.gguf')
    const out = await ensureLocalModelServing(qwen, d)
    expect(out).toEqual({ switched: true, endpoint: 'http://127.0.0.1:8080/v1' })
    const call = d.invoke.mock.calls.find(c => c[0] === 'start_local_model')!
    expect((call[1] as any).modelPath).toBe('/Users/x/AgentForge/models/Qwen_Qwen3-32B-Q4_K_M.gguf')
  })

  it('does nothing when the right model is already up', async () => {
    const d = deps('/Users/x/AgentForge/models/Qwen_Qwen3-32B-Q4_K_M.gguf')
    expect(await ensureLocalModelServing(qwen, d)).toEqual({ switched: false, reason: 'already-serving' })
    expect(d.invoke).not.toHaveBeenCalled()
  })

  it('never touches the engine for a cloud model', async () => {
    const d = deps(null)
    expect(await ensureLocalModelServing(cloud, d)).toEqual({ switched: false, reason: 'not-local' })
    expect(d.invoke).not.toHaveBeenCalled()
    expect(d.fetchServing).not.toHaveBeenCalled()
  })

  it('passes the projector so a vision model keeps its sight', async () => {
    const d = deps('/Users/x/AgentForge/models/Qwen_Qwen3-32B-Q4_K_M.gguf')
    await ensureLocalModelServing(gemma, d)
    const call = d.invoke.mock.calls.find(c => c[0] === 'start_local_model')!
    expect((call[1] as any).mmprojPath).toContain('mmproj-gemma-4-12b-it-F16.gguf')
  })

  it("launches at the config's own contextLimit so charBudget and -c agree", async () => {
    // Drifting these apart is how a prompt that "fits" gets rejected by the engine.
    const d = deps(null)
    await ensureLocalModelServing({ ...qwen, contextLimit: 16384 }, d)
    const call = d.invoke.mock.calls.find(c => c[0] === 'start_local_model')!
    expect((call[1] as any).ctxTokens).toBe(16384)
  })

  it('leaves a working engine alone when the picked model is not installed', async () => {
    // Tearing down a serving model for one that cannot launch would leave nothing running.
    const d = deps('/Users/x/AgentForge/models/gemma-4-12b-it-Q4_K_M.gguf', [])
    expect(await ensureLocalModelServing(qwen, d)).toEqual({ switched: false, reason: 'file-missing' })
    expect(d.invoke.mock.calls.some(c => c[0] === 'start_local_model')).toBe(false)
  })

  it('reports rather than throws when the engine cannot be launched', async () => {
    // A failed switch must not block sending — but it must be reported, or the badge is silently
    // wrong again, which is the whole bug.
    const d = {
      invoke: vi.fn(async (cmd: string, _args?: any) => {
        if (cmd === 'get_models_dir') return '/Users/x/AgentForge/models'
        if (cmd === 'list_gguf_models') return FILES
        throw new Error('engine OOM')
      }),
      fetchServing: vi.fn(async () => null),
    }
    expect(await ensureLocalModelServing(qwen, d)).toEqual({ switched: false, reason: 'unavailable' })
  })

  it('survives a server that is down (no /models to ask)', async () => {
    const d = {
      ...deps(null),
      fetchServing: vi.fn(async () => { throw new Error('ECONNREFUSED') }),
    }
    const out = await ensureLocalModelServing(qwen, d)
    expect(out).toEqual({ switched: true, endpoint: 'http://127.0.0.1:8080/v1' })
  })

  it('two concurrent sends launch ONE server, not two on the same port', async () => {
    const d = deps(null)
    const [a, b] = await Promise.all([
      ensureLocalModelServing(qwen, d),
      ensureLocalModelServing(qwen, d),
    ])
    expect(a).toEqual(b)
    expect(d.invoke.mock.calls.filter(c => c[0] === 'start_local_model')).toHaveLength(1)
  })
})
