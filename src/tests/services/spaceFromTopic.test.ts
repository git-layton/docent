import { describe, it, expect } from 'vitest'
import {
  planSpaceFromTabs,
  nameFromTabs,
  duplicateForSpace,
  movesEverything,
} from '../../services/spaceFromTopic'
import type { OmniTab } from '../../types/omniTab'

const tab = (over: Partial<OmniTab> = {}): OmniTab => ({
  id: 't1',
  type: 'doc',
  label: 'Prompt injection',
  spaceId: 'space-a',
  ...over,
})

const TABS: OmniTab[] = [
  tab({ id: 'home', type: 'home', label: 'Start' }),
  tab({ id: 'a', label: 'Prompt injection' }),
  tab({ id: 'b', label: 'Trust model §3' }),
  tab({ id: 'c', label: 'Capability security', spaceId: 'space-b' }),
]

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

describe('planSpaceFromTabs', () => {
  it('takes the requested tabs, in order', () => {
    const plan = planSpaceFromTabs(TABS, ['b', 'a'], 'copy')
    expect(plan.take.map(t => t.id)).toEqual(['b', 'a'])
  })

  it('COPY removes nothing from the original', () => {
    const plan = planSpaceFromTabs(TABS, ['a', 'b'], 'copy')
    expect(plan.remove).toEqual([])
  })

  it('MOVE detaches exactly what it took', () => {
    const plan = planSpaceFromTabs(TABS, ['a', 'b'], 'move')
    expect(plan.remove).toEqual(['a', 'b'])
  })

  it('never takes a home tab — it is a dashboard, not content', () => {
    // On copy it would duplicate a dashboard the new Space makes anyway; on move it
    // would strip the original Space of the tab that makes it navigable.
    const plan = planSpaceFromTabs(TABS, ['home', 'a'], 'move')
    expect(plan.take.map(t => t.id)).toEqual(['a'])
    expect(plan.skipped).toContainEqual({ id: 'home', reason: 'home-tab' })
    expect(plan.remove).toEqual(['a'])
  })

  it('reports unknown ids rather than silently dropping them', () => {
    const plan = planSpaceFromTabs(TABS, ['a', 'ghost'], 'copy')
    expect(plan.take.map(t => t.id)).toEqual(['a'])
    expect(plan.skipped).toContainEqual({ id: 'ghost', reason: 'not-found' })
  })

  it('takes a repeated id once and says so', () => {
    const plan = planSpaceFromTabs(TABS, ['a', 'a'], 'copy')
    expect(plan.take).toHaveLength(1)
    expect(plan.skipped).toContainEqual({ id: 'a', reason: 'duplicate' })
  })

  it('handles an empty selection', () => {
    const plan = planSpaceFromTabs(TABS, [], 'move')
    expect(plan).toEqual({ take: [], remove: [], skipped: [] })
  })

  it('can gather tabs from more than one Space', () => {
    const plan = planSpaceFromTabs(TABS, ['a', 'c'], 'move')
    expect(plan.take.map(t => t.id)).toEqual(['a', 'c'])
  })
})

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

describe('nameFromTabs', () => {
  it('uses the label when there is one tab', () => {
    expect(nameFromTabs([tab({ label: 'Prompt injection' })])).toBe('Prompt injection')
  })

  it('summarises several as "<first> +N"', () => {
    expect(nameFromTabs([tab({ label: 'Prompt injection' }), tab({ label: 'x' }), tab({ label: 'y' })]))
      .toBe('Prompt injection +2')
  })

  it('falls back rather than producing an unnamed Space', () => {
    expect(nameFromTabs([])).toBe('New Space')
    expect(nameFromTabs([tab({ label: '   ' })])).toBe('New Space')
  })

  it('caps a very long label', () => {
    expect(nameFromTabs([tab({ label: 'x'.repeat(200) })]).length).toBeLessThanOrEqual(60)
  })
})

// ---------------------------------------------------------------------------
// Duplication
// ---------------------------------------------------------------------------

describe('duplicateForSpace', () => {
  it('gives the copy its own identity and Space', () => {
    const copy = duplicateForSpace(tab({ id: 'a' }), 'new-1', 'space-new')
    expect(copy.id).toBe('new-1')
    expect(copy.spaceId).toBe('space-new')
  })

  it('SHARES the content reference — a copy duplicates the view, not the document', () => {
    const copy = duplicateForSpace(tab({ id: 'a', canvasContentId: 'doc-7' }), 'new-1', 'space-new')
    expect(copy.canvasContentId).toBe('doc-7')
  })

  it('drops pin and favourite — those describe a place, not the tab', () => {
    const copy = duplicateForSpace(
      tab({ id: 'a', isPinned: true, isFavorite: true }), 'new-1', 'space-new',
    )
    expect(copy.isPinned).toBeUndefined()
    expect(copy.isFavorite).toBeUndefined()
  })

  it('leaves the original untouched', () => {
    const original = tab({ id: 'a', isPinned: true })
    duplicateForSpace(original, 'new-1', 'space-new')
    expect(original.id).toBe('a')
    expect(original.isPinned).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The emptying guard
// ---------------------------------------------------------------------------

describe('movesEverything', () => {
  it('is true when a move would leave only the dashboard behind', () => {
    const plan = planSpaceFromTabs(TABS, ['a', 'b'], 'move')
    expect(movesEverything(TABS, 'space-a', plan)).toBe(true)
  })

  it('is false when content remains', () => {
    const plan = planSpaceFromTabs(TABS, ['a'], 'move')
    expect(movesEverything(TABS, 'space-a', plan)).toBe(false)
  })

  it('is always false for a copy — nothing leaves', () => {
    const plan = planSpaceFromTabs(TABS, ['a', 'b'], 'copy')
    expect(movesEverything(TABS, 'space-a', plan)).toBe(false)
  })
})
