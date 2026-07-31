// End-to-end wiring proof for the screen log: does a real user sentence actually reach the
// capability? Unit tests on each piece can all pass while the chain between them is broken —
// this asserts the chain itself.
//
//   user sentence → gatekeeper route → registry lookup → the right capability
import { describe, it, expect } from 'vitest'
import { evaluateMemoryGate, selectPrimaryToolRoute } from '../../services/memoryGatekeeper'
import { capabilityForRoute, allCapabilities } from '../../services/capabilities'
import type { CapabilityContext } from '../../services/capabilities'

const ctx = (): CapabilityContext => ({
  userMsg: { content: '' },
  chatId: 'c1',
  agentId: 'a1',
  assistant: { id: 'a1' },
  hwProfile: {},
  integrations: {},
  model: {},
  openTabs: [],
  setStatus: () => {},
})

const routeFor = (text: string) =>
  selectPrimaryToolRoute(evaluateMemoryGate({ text, enabledTools: { local_workspace: true } }))

describe('screen recall — registration', () => {
  it('is registered on import of the capabilities barrel', () => {
    expect(allCapabilities().map(c => c.id)).toContain('screen-recall')
  })

  it('is a READ capability — it can never start capturing', () => {
    // The agent may ask what was seen; deciding to watch stays with the user.
    const cap = allCapabilities().find(c => c.id === 'screen-recall')!
    expect(cap.effect).toBe('read')
  })

  it('describes itself well enough for a model to choose it', () => {
    const cap = allCapabilities().find(c => c.id === 'screen-recall')!
    expect(cap.description.toLowerCase()).toContain('screen')
    expect(cap.description.toLowerCase()).toContain('never captures')
  })
})

describe('screen recall — routing', () => {
  it.each([
    'what was I looking at earlier',
    'what was I reading before lunch',
    "what's on my screen about prompt injection",
    'that page I saw yesterday',
    'search the screen log for capability security',
  ])('routes %j to screen_recall', (text) => {
    expect(routeFor(text)).toBe('screen_recall')
  })

  it('does NOT steal ordinary knowledge-base questions', () => {
    // MEMORY_SEARCH_RE owns "recall"/"what do you remember"; the two must not collide.
    expect(routeFor('what did we decide about the release process')).toBe('memory_search')
    expect(routeFor('search my notes for the vendor contract')).toBe('memory_search')
  })

  it('does not fire on unrelated requests', () => {
    expect(routeFor('what is the weather today')).not.toBe('screen_recall')
    expect(routeFor('add milk to my todo list')).not.toBe('screen_recall')
  })
})

describe('screen recall — resolution', () => {
  it('the route resolves to the screen-recall capability', () => {
    const cap = capabilityForRoute('screen_recall', ctx())
    expect(cap?.id).toBe('screen-recall')
  })

  it('is available on every surface — recall is not tied to a tab being open', () => {
    expect(capabilityForRoute('screen_recall', { ...ctx(), openTabs: [] })?.id).toBe('screen-recall')
  })

  it('does not hijack memory_search', () => {
    expect(capabilityForRoute('memory_search', ctx())?.id).toBe('knowledge-search')
  })

  it('the full chain holds: sentence → route → capability', () => {
    const route = routeFor('what was I looking at earlier')
    const cap = capabilityForRoute(route, ctx())
    expect(cap?.id).toBe('screen-recall')
  })
})
