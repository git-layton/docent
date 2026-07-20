import { describe, it, expect } from 'vitest'
import {
  buildDreamerSystemPrompt,
  buildDreamerUserMessage,
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

// ---------------------------------------------------------------------------
// Entity dossiers as READ-ONLY reference. Dossiers are the user's curated notes, so the dreamer
// may read and cite them but must never merge, prune, or rewrite one. The caller enforces this by
// keeping dossier paths out of the mutable path set; these tests pin the prompt half of that
// contract — the dossiers must reach the model, and must arrive clearly marked as off-limits.
// ---------------------------------------------------------------------------

const memFile = (path: string, content = 'body text') => ({ path, name: path.split('/').pop()!, content })

describe('buildDreamerUserMessage — dossier reference files', () => {
  it('renders dossiers in a read-only section that names them off-limits for mutation', () => {
    const msg = buildDreamerUserMessage(
      [memFile('memory/a/notes/one.md'), memFile('memory/a/notes/two.md')],
      'Docent',
      'a',
      80_000,
      { referenceFiles: [memFile('people/taylor.md', 'Taylor ships the release.')] },
    )
    expect(msg).toContain('READ-ONLY REFERENCE')
    expect(msg).toContain('=== DOSSIER: people/taylor.md ===')
    expect(msg).toContain('Taylor ships the release.')
    expect(msg).toMatch(/never.*merge source_path|NEVER[\s\S]*merge source_path/i)
  })

  it('keeps dossiers out of the mutable file inventory the ops are validated against', () => {
    const msg = buildDreamerUserMessage(
      [memFile('memory/a/notes/one.md'), memFile('memory/a/notes/two.md')],
      'Docent',
      'a',
      80_000,
      { referenceFiles: [memFile('people/taylor.md')] },
    )
    // The inventory counts and lists only the mutable memory files.
    expect(msg).toContain('File inventory (2 files)')
    const inventory = msg.slice(msg.indexOf('File inventory'), msg.indexOf('File contents:'))
    expect(inventory).not.toContain('people/taylor.md')
  })

  it('omits the reference section entirely when there are no dossiers', () => {
    const msg = buildDreamerUserMessage([memFile('memory/a/notes/one.md')], 'Docent', 'a')
    expect(msg).not.toContain('READ-ONLY REFERENCE')
  })

  it('drops reference files that would overflow the context budget', () => {
    const big = memFile('memory/a/notes/big.md', 'x'.repeat(500))
    const dossier = memFile('people/taylor.md', 'y'.repeat(500))
    const msg = buildDreamerUserMessage([big], 'Docent', 'a', 600, { referenceFiles: [dossier] })
    expect(msg).toContain('=== FILE: memory/a/notes/big.md ===')
    // Memory files claim the budget first; the dossier no longer fits and is left out.
    expect(msg).not.toContain('=== DOSSIER: people/taylor.md ===')
  })
})

describe('buildDreamerSystemPrompt — dossier guardrail', () => {
  it('tells the model that read-only reference files are never merge/prune/update targets', () => {
    const prompt = buildDreamerSystemPrompt()
    expect(prompt).toContain('READ-ONLY REFERENCE')
    expect(prompt).toMatch(/never use one as a merge or prune source_path/i)
  })
})
