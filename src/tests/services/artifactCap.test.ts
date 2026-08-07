import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, charBudget } from '../../services/llm'

const agent = { name: 'Docent', prompt: 'be useful', tools: {} }
const base = { agent, tasks: [] }

describe('buildSystemPrompt — the open artifact must not eat the window', () => {
  it('includes a small artifact whole', () => {
    const p = buildSystemPrompt({ ...base, canvasContent: { title: 'Note', content: 'short body' }, contextLimit: 32768 })
    expect(p).toContain('short body')
    expect(p).toContain('ENTIRE updated artifact')
  })

  it('caps a huge artifact instead of blowing the window', () => {
    // The real failure: a long note or generated app went in WHOLE on every turn and the
    // system prompt alone exceeded a 32K window before the user typed anything.
    const huge = 'x'.repeat(500_000)
    const p = buildSystemPrompt({ ...base, canvasContent: { title: 'Big', content: huge }, contextLimit: 32768 })
    expect(p.length).toBeLessThan(charBudget(32768))
    expect(p).toContain('TRUNCATED')
  })

  it('FORBIDS whole-file rewrites when truncated — otherwise it deletes what it never saw', () => {
    const huge = 'y'.repeat(500_000)
    const p = buildSystemPrompt({ ...base, canvasContent: { title: 'Big', content: huge }, contextLimit: 32768 })
    expect(p).toContain('Do NOT output a full replacement')
    expect(p).not.toContain('output the ENTIRE updated artifact')
  })

  it('scales the allowance with the model window', () => {
    const body = 'z'.repeat(200_000)
    const small = buildSystemPrompt({ ...base, canvasContent: { title: 'B', content: body }, contextLimit: 8192 })
    const big = buildSystemPrompt({ ...base, canvasContent: { title: 'B', content: body }, contextLimit: 200000 })
    expect(big.length).toBeGreaterThan(small.length)
  })
})
