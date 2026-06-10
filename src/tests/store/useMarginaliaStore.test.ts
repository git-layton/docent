import { describe, it, expect, beforeEach } from 'vitest'
import {
  useMarginaliaStore,
  getAgentColor,
  type Annotation,
} from '../../store/useMarginaliaStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useMarginaliaStore.setState({
    annotations: [],
    agentVisionOn: true,
  })
}

type AddInput = Parameters<ReturnType<typeof useMarginaliaStore.getState>['addAnnotation']>[0]

function makeInput(overrides: Partial<AddInput> = {}): AddInput {
  return {
    tabId: 'tab-1',
    agentId: 'dev',
    anchor: { kind: 'text', start: 0, end: 4 },
    body: 'Consider rewording this sentence.',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// getAgentColor
// ---------------------------------------------------------------------------

describe('getAgentColor', () => {
  it('returns the dev accent color', () => {
    expect(getAgentColor('dev')).toBe('#6AA9FF')
  })

  it('returns the alexis accent color', () => {
    expect(getAgentColor('alexis')).toBe('#E59FC4')
  })

  it('treats "lexi" as the same color as alexis', () => {
    expect(getAgentColor('lexi')).toBe('#E59FC4')
  })

  it('returns the aria accent color', () => {
    expect(getAgentColor('aria')).toBe('#7A9E8D')
  })

  it('is case-insensitive', () => {
    expect(getAgentColor('DEV')).toBe('#6AA9FF')
    expect(getAgentColor('Aria')).toBe('#7A9E8D')
  })

  it('returns a fallback color for unknown agents', () => {
    expect(getAgentColor('mystery-bot')).toBe('#8A8F98')
  })

  it('returns the fallback for an empty string', () => {
    expect(getAgentColor('')).toBe('#8A8F98')
  })

  it('returns distinct colors for dev / alexis / aria', () => {
    const colors = new Set([
      getAgentColor('dev'),
      getAgentColor('alexis'),
      getAgentColor('aria'),
    ])
    expect(colors.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// addAnnotation
// ---------------------------------------------------------------------------

describe('addAnnotation', () => {
  beforeEach(resetStore)

  it('appends an annotation', () => {
    useMarginaliaStore.getState().addAnnotation(makeInput())
    expect(useMarginaliaStore.getState().annotations).toHaveLength(1)
  })

  it('assigns an id with the "ann" prefix', () => {
    const created = useMarginaliaStore.getState().addAnnotation(makeInput())
    expect(created.id).toMatch(/^ann-/)
  })

  it('defaults status to "open"', () => {
    const created = useMarginaliaStore.getState().addAnnotation(makeInput())
    expect(created.status).toBe('open')
  })

  it('sets a numeric createdAt timestamp', () => {
    const before = Date.now()
    const created = useMarginaliaStore.getState().addAnnotation(makeInput())
    const after = Date.now()
    expect(created.createdAt).toBeGreaterThanOrEqual(before)
    expect(created.createdAt).toBeLessThanOrEqual(after)
  })

  it('derives the color from the agent when none is supplied', () => {
    const created = useMarginaliaStore.getState().addAnnotation(makeInput({ agentId: 'aria' }))
    expect(created.color).toBe('#7A9E8D')
  })

  it('honors an explicitly supplied color', () => {
    const created = useMarginaliaStore
      .getState()
      .addAnnotation(makeInput({ agentId: 'dev', color: '#FF0000' }))
    expect(created.color).toBe('#FF0000')
  })

  it('preserves an optional suggestedText', () => {
    const created = useMarginaliaStore
      .getState()
      .addAnnotation(makeInput({ suggestedText: 'A better version.' }))
    expect(created.suggestedText).toBe('A better version.')
  })

  it('generates unique ids across many calls', () => {
    for (let i = 0; i < 50; i++) {
      useMarginaliaStore.getState().addAnnotation(makeInput({ body: `note ${i}` }))
    }
    const ids = useMarginaliaStore.getState().annotations.map(a => a.id)
    expect(new Set(ids).size).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// updateAnnotationStatus
// ---------------------------------------------------------------------------

describe('updateAnnotationStatus', () => {
  beforeEach(resetStore)

  it('marks an annotation accepted', () => {
    const { id } = useMarginaliaStore.getState().addAnnotation(makeInput())
    useMarginaliaStore.getState().updateAnnotationStatus(id, 'accepted')
    expect(useMarginaliaStore.getState().annotations[0].status).toBe('accepted')
  })

  it('marks an annotation dismissed', () => {
    const { id } = useMarginaliaStore.getState().addAnnotation(makeInput())
    useMarginaliaStore.getState().updateAnnotationStatus(id, 'dismissed')
    expect(useMarginaliaStore.getState().annotations[0].status).toBe('dismissed')
  })

  it('does not affect other annotations', () => {
    const a = useMarginaliaStore.getState().addAnnotation(makeInput({ body: 'a' }))
    useMarginaliaStore.getState().addAnnotation(makeInput({ body: 'b' }))
    useMarginaliaStore.getState().updateAnnotationStatus(a.id, 'accepted')
    const other = useMarginaliaStore.getState().annotations.find(x => x.body === 'b')
    expect(other?.status).toBe('open')
  })

  it('does nothing for an unknown id', () => {
    useMarginaliaStore.getState().addAnnotation(makeInput())
    expect(() =>
      useMarginaliaStore.getState().updateAnnotationStatus('nope', 'accepted'),
    ).not.toThrow()
    expect(useMarginaliaStore.getState().annotations[0].status).toBe('open')
  })
})

// ---------------------------------------------------------------------------
// removeAnnotation
// ---------------------------------------------------------------------------

describe('removeAnnotation', () => {
  beforeEach(resetStore)

  it('removes the targeted annotation', () => {
    const { id } = useMarginaliaStore.getState().addAnnotation(makeInput())
    useMarginaliaStore.getState().removeAnnotation(id)
    expect(useMarginaliaStore.getState().annotations).toHaveLength(0)
  })

  it('only removes the targeted annotation', () => {
    const a = useMarginaliaStore.getState().addAnnotation(makeInput({ body: 'keep' }))
    useMarginaliaStore.getState().addAnnotation(makeInput({ body: 'drop' }))
    const drop = useMarginaliaStore.getState().annotations.find(x => x.body === 'drop')!
    useMarginaliaStore.getState().removeAnnotation(drop.id)
    expect(useMarginaliaStore.getState().annotations).toHaveLength(1)
    expect(useMarginaliaStore.getState().annotations[0].id).toBe(a.id)
  })

  it('does not throw for an unknown id', () => {
    expect(() => useMarginaliaStore.getState().removeAnnotation('ghost')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// setAgentVisionOn
// ---------------------------------------------------------------------------

describe('setAgentVisionOn', () => {
  beforeEach(resetStore)

  it('turns vision off', () => {
    useMarginaliaStore.getState().setAgentVisionOn(false)
    expect(useMarginaliaStore.getState().agentVisionOn).toBe(false)
  })

  it('turns vision back on', () => {
    useMarginaliaStore.getState().setAgentVisionOn(false)
    useMarginaliaStore.getState().setAgentVisionOn(true)
    expect(useMarginaliaStore.getState().agentVisionOn).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// annotationsForTab
// ---------------------------------------------------------------------------

describe('annotationsForTab', () => {
  beforeEach(resetStore)

  it('returns only annotations for the given tab', () => {
    useMarginaliaStore.getState().addAnnotation(makeInput({ tabId: 'tab-1' }))
    useMarginaliaStore.getState().addAnnotation(makeInput({ tabId: 'tab-2' }))
    useMarginaliaStore.getState().addAnnotation(makeInput({ tabId: 'tab-1' }))
    const forTab1 = useMarginaliaStore.getState().annotationsForTab('tab-1')
    expect(forTab1).toHaveLength(2)
    expect(forTab1.every(a => a.tabId === 'tab-1')).toBe(true)
  })

  it('returns an empty array when no annotations match', () => {
    useMarginaliaStore.getState().addAnnotation(makeInput({ tabId: 'tab-1' }))
    expect(useMarginaliaStore.getState().annotationsForTab('tab-99')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// persist & hydrate (localStorage fallback — no Tauri runtime in tests)
// ---------------------------------------------------------------------------

describe('persist', () => {
  beforeEach(() => {
    resetStore()
    localStorage.clear()
  })

  it('writes annotations to localStorage', async () => {
    useMarginaliaStore.getState().addAnnotation(makeInput({ body: 'persisted' }))
    await useMarginaliaStore.getState().persist()
    const stored = JSON.parse(localStorage.getItem('annotations') ?? '[]')
    expect(Array.isArray(stored)).toBe(true)
    expect(stored).toHaveLength(1)
    expect(stored[0].body).toBe('persisted')
  })
})

describe('hydrate', () => {
  beforeEach(() => {
    resetStore()
    localStorage.clear()
  })

  it('populates annotations from localStorage', async () => {
    const saved: Annotation[] = [
      {
        id: 'ann-1',
        tabId: 'tab-1',
        agentId: 'dev',
        color: '#6AA9FF',
        anchor: { kind: 'text', start: 0, end: 3 },
        body: 'Hydrated note',
        status: 'open',
        createdAt: 0,
      },
    ]
    localStorage.setItem('annotations', JSON.stringify(saved))
    await useMarginaliaStore.getState().hydrate()
    expect(useMarginaliaStore.getState().annotations).toHaveLength(1)
    expect(useMarginaliaStore.getState().annotations[0].body).toBe('Hydrated note')
  })

  it('restores agentVisionOn from localStorage', async () => {
    localStorage.setItem('annotations', JSON.stringify([]))
    localStorage.setItem('agentVisionOn', JSON.stringify(false))
    await useMarginaliaStore.getState().hydrate()
    expect(useMarginaliaStore.getState().agentVisionOn).toBe(false)
  })

  it('defaults agentVisionOn to true when nothing is stored', async () => {
    await useMarginaliaStore.getState().hydrate()
    expect(useMarginaliaStore.getState().agentVisionOn).toBe(true)
  })
})
