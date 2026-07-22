import { describe, it, expect } from 'vitest'
import { matchEntities, formatGraphContext } from '../../services/graphContext'

// The graph was write-only: nothing outside the two UI panels ever read it, so every extracted
// entity was stored, drawn, and never consulted when answering. These cover the pure half of the
// read path — which entities a message names, and how they're rendered within budget.

const node = (id: string, label: string, node_type = 'concept', aliases?: string[]) =>
  ({ id, label, node_type, aliases })

describe('matchEntities', () => {
  const nodes = [
    node('n1', "Baldur's Gate 3", 'product'),
    node('n2', 'Gate', 'concept'),
    node('n3', 'Alex Layton', 'person', ['Alex']),
    node('n4', 'Docent', 'product'),
  ]

  it('finds an entity named in the message', () => {
    const m = matchEntities('how far into docent are we', nodes)
    expect(m.map(x => x.id)).toContain('n4')
  })

  it('prefers the longest match, so a specific name beats a vague one', () => {
    const m = matchEntities("I am playing baldur's gate 3 tonight", nodes, 1)
    expect(m[0].id).toBe('n1')
  })

  it('matches an alias folded in by a merge', () => {
    const m = matchEntities('did alex finish it', nodes)
    expect(m.map(x => x.id)).toContain('n3')
  })

  it('is case and punctuation insensitive', () => {
    expect(matchEntities('BALDURS GATE 3!!', nodes).length).toBeGreaterThan(0)
  })

  it('ignores labels too short to be anything but coincidence', () => {
    const m = matchEntities('it is on', [node('x', 'it'), node('y', 'on')])
    expect(m).toEqual([])
  })

  it('caps how many entities can reach the prompt', () => {
    const many = Array.from({ length: 20 }, (_, i) => node(`m${i}`, `Entity Number ${i}`))
    const msg = many.map(n => n.label).join(' and ')
    expect(matchEntities(msg, many, 2)).toHaveLength(2)
  })

  it('returns nothing for a message naming nothing known', () => {
    expect(matchEntities('what time is it', nodes)).toEqual([])
  })

  it('never returns the same node twice when label and alias both hit', () => {
    const m = matchEntities('alex layton and alex', nodes)
    expect(m.filter(x => x.id === 'n3')).toHaveLength(1)
  })
})

describe('formatGraphContext', () => {
  it('renders label, type and connections', () => {
    const out = formatGraphContext([
      { label: 'Docent', node_type: 'product', relations: ['created by Alex Layton', 'uses Tauri'] },
    ])
    expect(out).toContain('Docent (product)')
    expect(out).toContain('created by Alex Layton')
  })

  it('stays inside its character budget however big the graph gets', () => {
    const out = formatGraphContext([
      { label: 'X', node_type: 'concept', relations: Array.from({ length: 200 }, (_, i) => `related to Thing ${i}`) },
    ], 300)
    expect(out.length).toBeLessThanOrEqual(300)
  })

  it('is empty when nothing matched, so no block is injected at all', () => {
    expect(formatGraphContext([])).toBe('')
  })
})
