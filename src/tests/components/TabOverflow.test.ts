import { describe, it, expect } from 'vitest'
import { partitionTabs, filterHiddenTabs, MAX_VISIBLE_TABS } from '../../components/OmniTabBar'
import type { OmniTab } from '../../types/omniTab'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tab(overrides: Partial<OmniTab> & { id: string }): OmniTab {
  return {
    type: 'space-log',
    label: overrides.id,
    spaceId: 'space-test',
    ...overrides,
  }
}

// Build N tabs t0..t(N-1)
function tabs(n: number): OmniTab[] {
  return Array.from({ length: n }, (_, i) => tab({ id: `t${i}` }))
}

// ---------------------------------------------------------------------------
// partitionTabs
// ---------------------------------------------------------------------------

describe('partitionTabs', () => {
  it('keeps everything visible at or below the threshold', () => {
    const list = tabs(MAX_VISIBLE_TABS)
    const { visible, overflow } = partitionTabs(list, list[0].id)
    expect(visible).toHaveLength(MAX_VISIBLE_TABS)
    expect(overflow).toHaveLength(0)
  })

  it('keeps everything visible when there are fewer than the threshold', () => {
    const list = tabs(3)
    const { visible, overflow } = partitionTabs(list, 't0')
    expect(visible.map(t => t.id)).toEqual(['t0', 't1', 't2'])
    expect(overflow).toHaveLength(0)
  })

  it('collapses the surplus into overflow past the threshold', () => {
    const list = tabs(MAX_VISIBLE_TABS + 5) // 13 tabs
    const { visible, overflow } = partitionTabs(list, 't0')
    expect(visible).toHaveLength(MAX_VISIBLE_TABS)
    expect(overflow).toHaveLength(5)
    expect(visible[0].id).toBe('t0')
    expect(overflow.map(t => t.id)).toEqual(['t8', 't9', 't10', 't11', 't12'])
  })

  it('respects a custom maxVisible argument', () => {
    const list = tabs(6)
    const { visible, overflow } = partitionTabs(list, 't0', 4)
    expect(visible).toHaveLength(4)
    expect(overflow.map(t => t.id)).toEqual(['t4', 't5'])
  })

  it('never hides the active tab — swaps it into the last visible slot', () => {
    const list = tabs(MAX_VISIBLE_TABS + 5)
    const { visible, overflow } = partitionTabs(list, 't11') // t11 would be in overflow
    expect(visible.some(t => t.id === 't11')).toBe(true)
    expect(overflow.some(t => t.id === 't11')).toBe(false)
    // The demoted last-visible tab (t7) moves into overflow at the swapped slot.
    expect(overflow.some(t => t.id === 't7')).toBe(true)
    expect(visible).toHaveLength(MAX_VISIBLE_TABS)
    expect(overflow).toHaveLength(5)
  })

  it('leaves an already-visible active tab untouched', () => {
    const list = tabs(MAX_VISIBLE_TABS + 5)
    const { visible, overflow } = partitionTabs(list, 't2')
    expect(visible.map(t => t.id)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
    expect(overflow.map(t => t.id)).toEqual(['t8', 't9', 't10', 't11', 't12'])
  })

  it('does not mutate the input array', () => {
    const list = tabs(MAX_VISIBLE_TABS + 3)
    const before = list.map(t => t.id)
    partitionTabs(list, 't10')
    expect(list.map(t => t.id)).toEqual(before)
  })

  it('handles a null active id', () => {
    const list = tabs(MAX_VISIBLE_TABS + 2)
    const { visible, overflow } = partitionTabs(list, null)
    expect(visible).toHaveLength(MAX_VISIBLE_TABS)
    expect(overflow).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// filterHiddenTabs
// ---------------------------------------------------------------------------

describe('filterHiddenTabs', () => {
  const list: OmniTab[] = [
    tab({ id: 'a', label: 'GitHub Issues', type: 'web', url: 'https://github.com/issues' }),
    tab({ id: 'b', label: 'My Notes', type: 'doc' }),
    tab({ id: 'c', label: 'Search Results', type: 'web', url: 'https://www.google.com/search?q=foo' }),
    tab({ id: 'd', label: 'Planner', type: 'tool' }),
  ]

  it('returns all tabs for an empty query', () => {
    expect(filterHiddenTabs(list, '')).toEqual(list)
  })

  it('returns all tabs for a whitespace-only query', () => {
    expect(filterHiddenTabs(list, '   ')).toEqual(list)
  })

  it('matches on label, case-insensitive', () => {
    const out = filterHiddenTabs(list, 'notes')
    expect(out.map(t => t.id)).toEqual(['b'])
  })

  it('matches partial labels', () => {
    const out = filterHiddenTabs(list, 'plan')
    expect(out.map(t => t.id)).toEqual(['d'])
  })

  it('matches on url for web tabs, case-insensitive', () => {
    const out = filterHiddenTabs(list, 'GITHUB.COM')
    expect(out.map(t => t.id)).toEqual(['a'])
  })

  it('does not match url for non-web tabs', () => {
    // 'google' only appears in a web url; a doc/tool tab with that url-ish text
    // should not match since url matching is gated on type === web.
    const withDocUrl: OmniTab[] = [tab({ id: 'x', label: 'Doc', type: 'doc', url: 'https://google.com' })]
    expect(filterHiddenTabs(withDocUrl, 'google')).toHaveLength(0)
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterHiddenTabs(list, 'zzz-no-match')).toHaveLength(0)
  })
})
