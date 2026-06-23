import { describe, it, expect } from 'vitest'
import {
  buildDreamerSystemPrompt,
  parseDreamerResponse,
  type DreamerOp,
} from '../../services/dreamer'

// ---------------------------------------------------------------------------
// Reflection — the INSIGHT op (durable cross-file synthesis persisted to memory)
// ---------------------------------------------------------------------------

describe('parseDreamerResponse — insight op', () => {
  it('parses an insight op and preserves its fields', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'insight',
          description: 'recurring preference across notes',
          title: 'User prefers concise answers',
          insight: 'Across several notes the user consistently asks for shorter, bulleted replies.',
          source_paths: ['memory/a/gatekeeper/x.md', 'memory/a/gatekeeper/y.md'],
        },
      ],
    })
    const plan = parseDreamerResponse(raw)
    expect(plan).not.toBeNull()
    expect(plan!.operations).toHaveLength(1)
    const op = plan!.operations[0] as Extract<DreamerOp, { type: 'insight' }>
    expect(op.type).toBe('insight')
    expect(op.title).toBe('User prefers concise answers')
    expect(op.source_paths).toHaveLength(2)
    expect(op.insight).toContain('bulleted')
  })

  it('parses a mixed plan that interleaves an insight with a consolidation op', () => {
    const raw = '```json\n' + JSON.stringify({
      operations: [
        { type: 'merge', description: 'combine', source_paths: ['a', 'b'], target_path: 'memory/a/memos/m.md', merged_content: '# m' },
        { type: 'insight', description: 'pattern', title: 'Projects stall at deploy', insight: 'Deployment is the recurring blocker.', source_paths: ['a', 'b'] },
      ],
    }) + '\n```'
    const plan = parseDreamerResponse(raw)
    expect(plan).not.toBeNull()
    expect(plan!.operations.map(o => o.type)).toEqual(['merge', 'insight'])
  })
})

describe('buildDreamerSystemPrompt — reflection contract', () => {
  it('documents the INSIGHT job and that insights are saved back into memory', () => {
    const prompt = buildDreamerSystemPrompt()
    expect(prompt).toContain('INSIGHT')
    expect(prompt).toMatch(/saved back into memory|carry forward/i)
    // The insight op must be in the response schema so the model emits it.
    expect(prompt).toContain('"type": "insight"')
  })
})
