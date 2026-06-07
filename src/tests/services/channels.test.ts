import { describe, it, expect } from 'vitest'
import {
  normalizeChatRecord,
  extractMentionedAgentIds,
  routeAgentsForChannel,
  buildChannelPromptAddendum,
  chatIncludesAgent,
  getParticipantAgents,
} from '../../services/channels'

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

const makeAgent = (id: string, name: string, description = '') => ({
  id,
  name,
  description,
  model: 'claude-sonnet-4-5',
  systemPrompt: '',
  createdAt: 1000000,
})

const alice = makeAgent('agent-alice', 'Alice', 'Creative writer')
const bob = makeAgent('agent-bob', 'Bob', 'Data analyst')
const charlie = makeAgent('agent-charlie', 'Charlie', 'Backend engineer')
const dana = makeAgent('agent-dana', 'Dana')

const makeChannel = (overrides: Record<string, unknown> = {}) => ({
  id: 'chan-1',
  name: 'Test Channel',
  kind: 'channel' as const,
  primaryAgentId: alice.id,
  participantAgentIds: [alice.id, bob.id, charlie.id],
  norm: 'default' as const,
  goal: '',
  createdAt: 1000000,
  updatedAt: 1000000,
  ...overrides,
})

const makeDm = (overrides: Record<string, unknown> = {}) => ({
  id: 'dm-1',
  name: 'Alice Direct',
  kind: 'dm' as const,
  primaryAgentId: alice.id,
  folderId: alice.id,
  participantAgentIds: [alice.id],
  norm: 'default' as const,
  goal: '',
  createdAt: 1000000,
  updatedAt: 1000000,
  ...overrides,
})

// ---------------------------------------------------------------------------
// normalizeChatRecord
// ---------------------------------------------------------------------------

describe('normalizeChatRecord', () => {
  it('fills in missing fields with sensible defaults', () => {
    const result = normalizeChatRecord({})
    expect(result.kind).toBe('dm')
    expect(result.norm).toBe('default')
    expect(result.goal).toBe('')
    expect(result.primaryAgentId).toBe('f-default')
    expect(result.participantAgentIds).toContain('f-default')
  })

  it('uses the provided fallbackAgentId when no primaryAgentId is present', () => {
    const result = normalizeChatRecord({}, 'fallback-agent')
    expect(result.primaryAgentId).toBe('fallback-agent')
    expect(result.participantAgentIds).toContain('fallback-agent')
  })

  it('preserves an existing primaryAgentId over the fallback', () => {
    const result = normalizeChatRecord({ primaryAgentId: alice.id }, 'fallback-agent')
    expect(result.primaryAgentId).toBe(alice.id)
  })

  it('deduplicates participant ids that appear multiple times', () => {
    const chat = {
      primaryAgentId: alice.id,
      folderId: alice.id,
      participantAgentIds: [alice.id, alice.id, bob.id],
    }
    const result = normalizeChatRecord(chat)
    const count = result.participantAgentIds!.filter(id => id === alice.id).length
    expect(count).toBe(1)
  })

  it('always includes primaryAgentId in participantAgentIds', () => {
    const chat = {
      primaryAgentId: alice.id,
      participantAgentIds: [bob.id, charlie.id],
    }
    const result = normalizeChatRecord(chat)
    expect(result.participantAgentIds).toContain(alice.id)
  })

  it('uses folderId as primaryAgentId when primaryAgentId is absent', () => {
    const chat = { folderId: bob.id }
    const result = normalizeChatRecord(chat)
    expect(result.primaryAgentId).toBe(bob.id)
  })

  it('sets createdAt and updatedAt to the same value when only one is provided', () => {
    const chat = { createdAt: 555 }
    const result = normalizeChatRecord(chat)
    expect(result.createdAt).toBe(555)
    expect(result.updatedAt).toBe(555)
  })

  it('handles a null/undefined chat gracefully', () => {
    const result = normalizeChatRecord(null)
    expect(result.kind).toBe('dm')
    expect(result.primaryAgentId).toBe('f-default')
  })
})

// ---------------------------------------------------------------------------
// extractMentionedAgentIds
// ---------------------------------------------------------------------------

describe('extractMentionedAgentIds', () => {
  const participants = [alice, bob, charlie, dana]

  it('matches a full agent name case-insensitively', () => {
    const ids = extractMentionedAgentIds('@Alice what do you think?', participants)
    expect(ids.has(alice.id)).toBe(true)
    expect(ids.size).toBe(1)
  })

  it('matches a lowercase @mention against a mixed-case name', () => {
    const ids = extractMentionedAgentIds('@alice how are you?', participants)
    expect(ids.has(alice.id)).toBe(true)
  })

  it('matches via prefix (e.g. @Char matches Charlie)', () => {
    const ids = extractMentionedAgentIds('@Char can you review?', participants)
    expect(ids.has(charlie.id)).toBe(true)
  })

  it('does not include unknown @mentions', () => {
    const ids = extractMentionedAgentIds('@Zara are you there?', participants)
    expect(ids.size).toBe(0)
  })

  it('collects multiple distinct mentions', () => {
    const ids = extractMentionedAgentIds('@Alice and @Bob discuss this', participants)
    expect(ids.has(alice.id)).toBe(true)
    expect(ids.has(bob.id)).toBe(true)
    expect(ids.size).toBe(2)
  })

  it('deduplicates repeated mentions of the same agent', () => {
    const ids = extractMentionedAgentIds('@Alice @Alice again', participants)
    expect(ids.size).toBe(1)
  })

  it('returns an empty set when there are no @mentions', () => {
    const ids = extractMentionedAgentIds('Just a plain message.', participants)
    expect(ids.size).toBe(0)
  })

  it('returns an empty set for an empty string', () => {
    const ids = extractMentionedAgentIds('', participants)
    expect(ids.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// routeAgentsForChannel
// ---------------------------------------------------------------------------

describe('routeAgentsForChannel', () => {
  const agents = [alice, bob, charlie, dana]

  it('returns only the primary agent for a DM chat', () => {
    const dm = makeDm()
    const result = routeAgentsForChannel('hello', dm, agents, alice.id)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(alice.id)
  })

  it('returns all participants when there are no @mentions in a channel', () => {
    const channel = makeChannel()
    const result = routeAgentsForChannel('What does everyone think?', channel, agents, alice.id)
    const ids = result.map((a: { id: string }) => a.id)
    expect(ids).toContain(alice.id)
    expect(ids).toContain(bob.id)
    expect(ids).toContain(charlie.id)
  })

  it('puts the mentioned agent first when @mentioned in a channel', () => {
    const channel = makeChannel()
    const result = routeAgentsForChannel('@Bob can you help?', channel, agents, alice.id)
    expect(result[0].id).toBe(bob.id)
  })

  it('orders multiple @mentions by their appearance order in the message', () => {
    const channel = makeChannel()
    const result = routeAgentsForChannel('@Charlie first, then @Bob', channel, agents, alice.id)
    expect(result[0].id).toBe(charlie.id)
    expect(result[1].id).toBe(bob.id)
  })

  it('still includes non-mentioned participants after the mentioned ones', () => {
    const channel = makeChannel()
    const result = routeAgentsForChannel('@Bob take the lead', channel, agents, alice.id)
    const ids = result.map((a: { id: string }) => a.id)
    expect(ids[0]).toBe(bob.id)
    expect(ids).toContain(alice.id)
    expect(ids).toContain(charlie.id)
  })

  it('falls back to the primary agent when channel has only one participant', () => {
    const channel = makeChannel({ participantAgentIds: [alice.id] })
    const result = routeAgentsForChannel('hello', channel, agents, alice.id)
    expect(result[0].id).toBe(alice.id)
  })

  it('returns empty array when agents list is empty', () => {
    const dm = makeDm()
    const result = routeAgentsForChannel('hello', dm, [], alice.id)
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// buildChannelPromptAddendum
// ---------------------------------------------------------------------------

describe('buildChannelPromptAddendum', () => {
  const allParticipants = [alice, bob, charlie]

  it('includes the agent name and channel name in the header', () => {
    const chat = makeChannel({ name: 'Design Room' })
    const addendum = buildChannelPromptAddendum(chat, allParticipants, [], alice, false)
    expect(addendum).toContain('Alice')
    expect(addendum).toContain('Design Room')
  })

  it('includes the channel goal when one is set', () => {
    const chat = makeChannel({ goal: 'Ship the feature by Friday' })
    const addendum = buildChannelPromptAddendum(chat, allParticipants, [], alice, false)
    expect(addendum).toContain('Ship the feature by Friday')
  })

  it('lists other participants and does not list the current agent in the "Others" line', () => {
    const chat = makeChannel()
    const addendum = buildChannelPromptAddendum(chat, allParticipants, [], alice, false)
    expect(addendum).toContain('Bob')
    expect(addendum).toContain('Charlie')
    // Alice should appear only in the "You are Alice" header, not in the "Other participants" list
    const othersLine = addendum.split('\n').find(l => l.startsWith('Other participants:'))
    expect(othersLine).toBeDefined()
    expect(othersLine).not.toContain('Alice')
  })

  it('adds a direct-mention directive when isMentioned is true', () => {
    const chat = makeChannel()
    const addendum = buildChannelPromptAddendum(chat, allParticipants, [], alice, true)
    expect(addendum).toContain('directly mentioned')
    expect(addendum).toContain('MUST respond')
  })

  it('social norm instructs ALWAYS responding', () => {
    const chat = makeChannel({ norm: 'social' })
    const addendum = buildChannelPromptAddendum(chat, allParticipants, [], alice, false)
    expect(addendum).toContain('ALWAYS respond')
  })

  it('social norm does NOT include the [PASS] pass-through instruction', () => {
    const chat = makeChannel({ norm: 'social' })
    const addendum = buildChannelPromptAddendum(chat, allParticipants, [], alice, false)
    expect(addendum).not.toContain('To pass: respond with exactly [PASS]')
  })

  it('work norm includes the [PASS] instruction', () => {
    const chat = makeChannel({ norm: 'work' })
    const addendum = buildChannelPromptAddendum(chat, allParticipants, [], alice, false)
    expect(addendum).toContain('[PASS]')
    expect(addendum).toContain('To pass:')
  })

  it('creative norm instructs responding with new ideas and allows [PASS]', () => {
    const chat = makeChannel({ norm: 'creative' })
    const addendum = buildChannelPromptAddendum(chat, allParticipants, [], alice, false)
    expect(addendum).toContain('creative')
    expect(addendum).toContain('[PASS]')
  })

  it('default norm falls through to the general participation instruction', () => {
    const chat = makeChannel({ norm: 'default' })
    const addendum = buildChannelPromptAddendum(chat, allParticipants, [], alice, false)
    expect(addendum).toContain('meaningfully advances')
    expect(addendum).toContain('[PASS]')
  })

  it('includes previous responses when provided', () => {
    const chat = makeChannel()
    const prev = [{ agentName: 'Bob', content: 'I think we should do X.' }]
    const addendum = buildChannelPromptAddendum(chat, allParticipants, prev, alice, false)
    expect(addendum).toContain('Bob')
    expect(addendum).toContain('I think we should do X.')
    expect(addendum).toContain('Do not repeat')
  })

  it('truncates very long previous responses at 1500 characters', () => {
    const chat = makeChannel()
    const longContent = 'x'.repeat(2000)
    const prev = [{ agentName: 'Bob', content: longContent }]
    const addendum = buildChannelPromptAddendum(chat, allParticipants, prev, alice, false)
    expect(addendum).toContain('...')
    expect(addendum).not.toContain('x'.repeat(1600))
  })

  it('includes agent description in participant list when present', () => {
    const chat = makeChannel()
    const addendum = buildChannelPromptAddendum(chat, allParticipants, [], alice, false)
    expect(addendum).toContain('Data analyst')
    expect(addendum).toContain('Backend engineer')
  })
})

// ---------------------------------------------------------------------------
// chatIncludesAgent
// ---------------------------------------------------------------------------

describe('chatIncludesAgent', () => {
  it('returns true when the agent is in the participant list of a channel', () => {
    const channel = makeChannel()
    expect(chatIncludesAgent(channel, bob.id)).toBe(true)
  })

  it('returns false when the agent is NOT in the participant list', () => {
    const channel = makeChannel()
    expect(chatIncludesAgent(channel, dana.id)).toBe(false)
  })

  it('returns true when the agent is the primaryAgentId of a channel', () => {
    const channel = makeChannel({ participantAgentIds: [] })
    expect(chatIncludesAgent(channel, alice.id)).toBe(true)
  })

  it('returns true for the primary agent in a DM', () => {
    const dm = makeDm()
    expect(chatIncludesAgent(dm, alice.id)).toBe(true)
  })

  it('returns false for an agent not associated with a DM', () => {
    const dm = makeDm()
    expect(chatIncludesAgent(dm, charlie.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getParticipantAgents
// ---------------------------------------------------------------------------

describe('getParticipantAgents', () => {
  const agents = [alice, bob, charlie, dana]

  it('returns only the agents whose ids appear in participantAgentIds for a channel', () => {
    const channel = makeChannel()
    const result = getParticipantAgents(channel, agents)
    const ids = result.map((a: { id: string }) => a.id)
    expect(ids).toContain(alice.id)
    expect(ids).toContain(bob.id)
    expect(ids).toContain(charlie.id)
    expect(ids).not.toContain(dana.id)
  })

  it('returns only the primary agent for a DM', () => {
    const dm = makeDm()
    const result = getParticipantAgents(dm, agents)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(alice.id)
  })

  it('omits ids that do not correspond to any agent in the list', () => {
    const channel = makeChannel({ participantAgentIds: [alice.id, 'ghost-id'] })
    const result = getParticipantAgents(channel, agents)
    const ids = result.map((a: { id: string }) => a.id)
    expect(ids).toContain(alice.id)
    expect(ids).not.toContain('ghost-id')
  })

  it('returns an empty array when the agent list is empty', () => {
    const channel = makeChannel()
    const result = getParticipantAgents(channel, [])
    expect(result).toHaveLength(0)
  })
})
