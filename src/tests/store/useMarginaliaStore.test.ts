import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the database service so tests never touch Tauri/localStorage
vi.mock('../../services/database', () => {
  const store: Record<string, unknown> = {}
  return {
    db: {
      get: vi.fn(async (key: string, defaultVal: unknown) => (key in store ? store[key] : defaultVal)),
      set: vi.fn(async (key: string, val: unknown) => { store[key] = val }),
    },
  }
})

import { useMarginaliaStore } from '../../store/useMarginaliaStore'
import { db } from '../../services/database'

function reset() {
  useMarginaliaStore.setState({ annotations: [], agentVisionOn: false })
  vi.clearAllMocks()
}

const baseAnnotation = {
  tabId: 'tab-1',
  agentId: 'dev',
  color: '#6AA9FF',
  anchor: { kind: 'text' as const, start: 0, end: 10 },
  body: 'This sentence is redundant.',
  status: 'open' as const,
}

describe('useMarginaliaStore — addAnnotation', () => {
  beforeEach(reset)

  it('adds an annotation and returns its id', () => {
    const id = useMarginaliaStore.getState().addAnnotation(baseAnnotation)
    expect(id).toBeTruthy()
    expect(useMarginaliaStore.getState().annotations).toHaveLength(1)
    expect(useMarginaliaStore.getState().annotations[0].id).toBe(id)
  })

  it('stamps createdAt', () => {
    useMarginaliaStore.getState().addAnnotation(baseAnnotation)
    expect(typeof useMarginaliaStore.getState().annotations[0].createdAt).toBe('number')
  })

  it('persists on add', async () => {
    useMarginaliaStore.getState().addAnnotation(baseAnnotation)
    await useMarginaliaStore.getState().persist()
    expect(vi.mocked(db.set).mock.calls.some(c => c[0] === 'marginaliaAnnotations')).toBe(true)
  })
})

describe('useMarginaliaStore — status + removal', () => {
  beforeEach(reset)

  it('updates status (e.g. accepted after Apply Fix)', () => {
    const id = useMarginaliaStore.getState().addAnnotation({ ...baseAnnotation, suggestedText: 'Tighter.' })
    useMarginaliaStore.getState().updateAnnotationStatus(id, 'accepted')
    expect(useMarginaliaStore.getState().annotations[0].status).toBe('accepted')
  })

  it('removes an annotation', () => {
    const id = useMarginaliaStore.getState().addAnnotation(baseAnnotation)
    useMarginaliaStore.getState().removeAnnotation(id)
    expect(useMarginaliaStore.getState().annotations).toHaveLength(0)
  })
})

describe('useMarginaliaStore — selectors + vision toggle', () => {
  beforeEach(reset)

  it('annotationsForTab returns only open annotations for that tab', () => {
    useMarginaliaStore.getState().addAnnotation({ ...baseAnnotation, tabId: 'tab-1' })
    useMarginaliaStore.getState().addAnnotation({ ...baseAnnotation, tabId: 'tab-2' })
    const closed = useMarginaliaStore.getState().addAnnotation({ ...baseAnnotation, tabId: 'tab-1' })
    useMarginaliaStore.getState().updateAnnotationStatus(closed, 'dismissed')

    const open = useMarginaliaStore.getState().annotationsForTab('tab-1')
    expect(open).toHaveLength(1)
    expect(open[0].tabId).toBe('tab-1')
    expect(open[0].status).toBe('open')
  })

  it('toggles agentVisionOn', () => {
    expect(useMarginaliaStore.getState().agentVisionOn).toBe(false)
    useMarginaliaStore.getState().setAgentVisionOn(true)
    expect(useMarginaliaStore.getState().agentVisionOn).toBe(true)
  })
})
