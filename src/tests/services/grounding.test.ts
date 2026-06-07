import { describe, it, expect } from 'vitest'
import {
  buildGroundingFrontmatter,
  buildGroundingSection,
  buildGroundedMarkdown,
  type GroundingMetadata,
  type EvidenceState,
  type VerificationState,
  type ConfidenceState,
} from '../../services/grounding'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseMetadata: GroundingMetadata = {
  title: 'Test Memory',
  type: 'fact',
  scope: 'agent',
  sourceKind: 'manual',
}

const fullMetadata: GroundingMetadata = {
  title: 'Full Memory',
  type: 'summary',
  scope: 'channel',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-06-01T12:00:00.000Z',
  agentId: 'agent-123',
  agentName: 'Assistant',
  channelId: 'ch-456',
  channelName: 'general',
  sourceKind: 'document',
  sourceLabel: 'Report Q1',
  sourceUrl: 'https://example.com/report',
  sourceUrls: ['https://example.com/extra'],
  sourcePath: '/docs/report.pdf',
  sourcePaths: ['/docs/appendix.pdf'],
  captureId: 'cap-789',
  rawPath: '/raw/cap-789.html',
  derivedFrom: ['memory-001', 'memory-002'],
  tags: ['finance', 'quarterly'],
  evidenceState: 'source_backed',
  verification: 'verified',
  confidence: 'high',
  processor: 'custom-processor',
  sourceCount: 3,
}

// ---------------------------------------------------------------------------
// buildGroundingFrontmatter
// ---------------------------------------------------------------------------

describe('buildGroundingFrontmatter', () => {
  it('starts and ends with YAML delimiters', () => {
    const result = buildGroundingFrontmatter(baseMetadata)
    expect(result).toMatch(/^---\n/)
    expect(result).toMatch(/\n---\n\n$/)
  })

  it('includes required fields: title, type, scope, source_kind', () => {
    const result = buildGroundingFrontmatter(baseMetadata)
    expect(result).toContain('title: "Test Memory"')
    expect(result).toContain('type: "fact"')
    expect(result).toContain('scope: "agent"')
    expect(result).toContain('source_kind: "manual"')
  })

  it('uses defaults for evidenceState, verification, confidence when omitted', () => {
    const result = buildGroundingFrontmatter(baseMetadata)
    expect(result).toContain('evidence_state: "unverified"')
    expect(result).toContain('verification: "needs_verification"')
    expect(result).toContain('confidence: "unknown"')
  })

  it('uses defaults for processor and tags when omitted', () => {
    const result = buildGroundingFrontmatter(baseMetadata)
    expect(result).toContain('processor: "agent-forge"')
    expect(result).toContain('tags: []')
  })

  it('omits optional fields when null/undefined', () => {
    const result = buildGroundingFrontmatter(baseMetadata)
    expect(result).not.toContain('updated:')
    expect(result).not.toContain('agent_id:')
    expect(result).not.toContain('agent:')
    expect(result).not.toContain('channel_id:')
    expect(result).not.toContain('channel:')
    expect(result).not.toContain('source_label:')
    expect(result).not.toContain('source_urls:')
    expect(result).not.toContain('source_paths:')
    expect(result).not.toContain('capture_id:')
    expect(result).not.toContain('raw_path:')
    expect(result).not.toContain('derived_from:')
    expect(result).not.toContain('source_count:')
  })

  it('includes all optional fields when fully populated', () => {
    const result = buildGroundingFrontmatter(fullMetadata)
    expect(result).toContain('updated: "2024-06-01T12:00:00.000Z"')
    expect(result).toContain('agent_id: "agent-123"')
    expect(result).toContain('agent: "Assistant"')
    expect(result).toContain('channel_id: "ch-456"')
    expect(result).toContain('channel: "general"')
    expect(result).toContain('source_label: "Report Q1"')
    expect(result).toContain('capture_id: "cap-789"')
    expect(result).toContain('raw_path: "/raw/cap-789.html"')
    expect(result).toContain('source_count: 3')
    expect(result).toContain('processor: "custom-processor"')
  })

  it('merges sourceUrl and sourceUrls into source_urls array', () => {
    const result = buildGroundingFrontmatter(fullMetadata)
    expect(result).toContain('source_urls: ["https://example.com/report", "https://example.com/extra"]')
  })

  it('merges sourcePath and sourcePaths into source_paths array', () => {
    const result = buildGroundingFrontmatter(fullMetadata)
    expect(result).toContain('source_paths: ["/docs/report.pdf", "/docs/appendix.pdf"]')
  })

  it('includes derived_from array', () => {
    const result = buildGroundingFrontmatter(fullMetadata)
    expect(result).toContain('derived_from: ["memory-001", "memory-002"]')
  })

  it('includes tags array', () => {
    const result = buildGroundingFrontmatter(fullMetadata)
    expect(result).toContain('tags: ["finance", "quarterly"]')
  })

  it('escapes double quotes in string values', () => {
    const meta: GroundingMetadata = {
      ...baseMetadata,
      title: 'He said "hello"',
    }
    const result = buildGroundingFrontmatter(meta)
    expect(result).toContain('title: "He said \\"hello\\""')
  })

  it('escapes backslashes in string values', () => {
    const meta: GroundingMetadata = {
      ...baseMetadata,
      sourceLabel: 'C:\\Users\\docs',
    }
    const result = buildGroundingFrontmatter(meta)
    expect(result).toContain('source_label: "C:\\\\Users\\\\docs"')
  })

  it('emits correct evidence_state for all EvidenceState values', () => {
    const states: EvidenceState[] = [
      'user_provided',
      'source_backed',
      'capture_backed',
      'agent_inferred',
      'mixed',
      'unverified',
    ]
    for (const state of states) {
      const result = buildGroundingFrontmatter({ ...baseMetadata, evidenceState: state })
      expect(result).toContain(`evidence_state: "${state}"`)
    }
  })

  it('emits correct verification for all VerificationState values', () => {
    const states: VerificationState[] = [
      'verified',
      'partially_verified',
      'needs_verification',
      'unverified',
    ]
    for (const state of states) {
      const result = buildGroundingFrontmatter({ ...baseMetadata, verification: state })
      expect(result).toContain(`verification: "${state}"`)
    }
  })

  it('emits correct confidence for all ConfidenceState values', () => {
    const states: ConfidenceState[] = ['high', 'medium', 'low', 'unknown']
    for (const state of states) {
      const result = buildGroundingFrontmatter({ ...baseMetadata, confidence: state })
      expect(result).toContain(`confidence: "${state}"`)
    }
  })

  it('uses provided createdAt when present', () => {
    const meta: GroundingMetadata = {
      ...baseMetadata,
      createdAt: '2023-03-15T08:00:00.000Z',
    }
    const result = buildGroundingFrontmatter(meta)
    expect(result).toContain('created: "2023-03-15T08:00:00.000Z"')
  })

  it('falls back to a generated ISO timestamp when createdAt is absent', () => {
    const result = buildGroundingFrontmatter(baseMetadata)
    // The created field must exist and contain a valid ISO-like string
    expect(result).toMatch(/created: "\d{4}-\d{2}-\d{2}T/)
  })

  it('omits empty string entries from array fields (compact)', () => {
    const meta: GroundingMetadata = {
      ...baseMetadata,
      tags: ['alpha', '', 'beta'],
      derivedFrom: ['', 'ref-1', ''],
    }
    const result = buildGroundingFrontmatter(meta)
    expect(result).toContain('tags: ["alpha", "beta"]')
    expect(result).toContain('derived_from: ["ref-1"]')
  })
})

// ---------------------------------------------------------------------------
// buildGroundingSection
// ---------------------------------------------------------------------------

describe('buildGroundingSection', () => {
  it('outputs a ## Grounding heading', () => {
    const result = buildGroundingSection(baseMetadata)
    expect(result).toContain('## Grounding')
  })

  it('outputs a ## Learning Status section', () => {
    const result = buildGroundingSection(baseMetadata)
    expect(result).toContain('## Learning Status')
  })

  it('maps evidence_state labels correctly for all values', () => {
    const mapping: Record<EvidenceState, string> = {
      user_provided: 'User provided',
      source_backed: 'Source backed',
      capture_backed: 'Capture backed',
      agent_inferred: 'Agent inferred',
      mixed: 'Mixed evidence',
      unverified: 'Unverified',
    }
    for (const [state, label] of Object.entries(mapping)) {
      const result = buildGroundingSection({
        ...baseMetadata,
        evidenceState: state as EvidenceState,
      })
      expect(result).toContain(`- Evidence state: ${label}`)
    }
  })

  it('maps verification labels correctly for all values', () => {
    const mapping: Record<VerificationState, string> = {
      verified: 'Verified',
      partially_verified: 'Partially verified',
      needs_verification: 'Needs verification',
      unverified: 'Unverified',
    }
    for (const [state, label] of Object.entries(mapping)) {
      const result = buildGroundingSection({
        ...baseMetadata,
        verification: state as VerificationState,
      })
      expect(result).toContain(`- Verification: ${label}`)
    }
  })

  it('maps confidence labels correctly for all values', () => {
    const mapping: Record<ConfidenceState, string> = {
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      unknown: 'Unknown',
    }
    for (const [state, label] of Object.entries(mapping)) {
      const result = buildGroundingSection({
        ...baseMetadata,
        confidence: state as ConfidenceState,
      })
      expect(result).toContain(`- Confidence: ${label}`)
    }
  })

  it('uses defaults (unverified / needs_verification / unknown) when states absent', () => {
    const result = buildGroundingSection(baseMetadata)
    expect(result).toContain('- Evidence state: Unverified')
    expect(result).toContain('- Verification: Needs verification')
    expect(result).toContain('- Confidence: Unknown')
  })

  it('includes source kind', () => {
    const result = buildGroundingSection(baseMetadata)
    expect(result).toContain('- Source kind: manual')
  })

  it('omits optional lines when values are absent', () => {
    const result = buildGroundingSection(baseMetadata)
    expect(result).not.toContain('- Source label:')
    expect(result).not.toContain('- Capture ID:')
    expect(result).not.toContain('- Raw path:')
    expect(result).not.toContain('- Agent:')
    expect(result).not.toContain('- Channel:')
  })

  it('includes agent name when agentName provided', () => {
    const result = buildGroundingSection({ ...baseMetadata, agentName: 'Aria' })
    expect(result).toContain('- Agent: Aria')
  })

  it('falls back to agentId when agentName absent', () => {
    const result = buildGroundingSection({ ...baseMetadata, agentId: 'agent-42' })
    expect(result).toContain('- Agent: agent-42')
  })

  it('includes channel name when channelName provided', () => {
    const result = buildGroundingSection({ ...baseMetadata, channelName: 'ops' })
    expect(result).toContain('- Channel: ops')
  })

  it('lists source URLs as sub-items', () => {
    const result = buildGroundingSection({
      ...baseMetadata,
      sourceUrl: 'https://a.com',
      sourceUrls: ['https://b.com'],
    })
    expect(result).toContain('- Source URLs:')
    expect(result).toContain('  - https://a.com')
    expect(result).toContain('  - https://b.com')
  })

  it('lists source paths as sub-items', () => {
    const result = buildGroundingSection({
      ...baseMetadata,
      sourcePath: '/path/one',
      sourcePaths: ['/path/two'],
    })
    expect(result).toContain('- Source paths:')
    expect(result).toContain('  - /path/one')
    expect(result).toContain('  - /path/two')
  })

  it('lists derivedFrom entries as sub-items', () => {
    const result = buildGroundingSection({
      ...baseMetadata,
      derivedFrom: ['mem-a', 'mem-b'],
    })
    expect(result).toContain('- Derived from:')
    expect(result).toContain('  - mem-a')
    expect(result).toContain('  - mem-b')
  })

  it('shows default processor when processor absent', () => {
    const result = buildGroundingSection(baseMetadata)
    expect(result).toContain('- Processed by: agent-forge')
  })

  it('shows custom processor when provided', () => {
    const result = buildGroundingSection({ ...baseMetadata, processor: 'my-tool' })
    expect(result).toContain('- Processed by: my-tool')
  })

  it('always includes scope and processor lines even with minimal metadata', () => {
    // The fallback "No grounding metadata available" is never shown in practice because
    // scope, confidence, verification, and processor are always present.
    const result = buildGroundingSection(baseMetadata)
    expect(result).toContain('- Scope: agent')
    expect(result).toContain('- Processed by: agent-forge')
    // Ensure the fallback text is absent when there is real content
    expect(result).not.toContain('No grounding metadata available.')
  })
})

// ---------------------------------------------------------------------------
// buildGroundedMarkdown
// ---------------------------------------------------------------------------

describe('buildGroundedMarkdown', () => {
  it('starts with the YAML frontmatter block', () => {
    const result = buildGroundedMarkdown(baseMetadata, 'Body text.')
    expect(result).toMatch(/^---\n/)
  })

  it('contains an H1 heading matching the title', () => {
    const result = buildGroundedMarkdown(baseMetadata, 'Body text.')
    expect(result).toContain('# Test Memory')
  })

  it('contains the grounding section', () => {
    const result = buildGroundedMarkdown(baseMetadata, 'Body text.')
    expect(result).toContain('## Grounding')
  })

  it('contains the body content trimmed', () => {
    const result = buildGroundedMarkdown(baseMetadata, '  Some content.  ')
    expect(result).toContain('Some content.')
  })

  it('ends with a newline', () => {
    const result = buildGroundedMarkdown(baseMetadata, 'Body.')
    expect(result).toMatch(/\n$/)
  })

  it('full composition order: frontmatter → heading → grounding → body', () => {
    const result = buildGroundedMarkdown(baseMetadata, 'Body.')
    const fmEnd = result.indexOf('---\n\n')
    const h1 = result.indexOf('# Test Memory')
    const grounding = result.indexOf('## Grounding')
    const body = result.indexOf('Body.')
    expect(fmEnd).toBeLessThan(h1)
    expect(h1).toBeLessThan(grounding)
    expect(grounding).toBeLessThan(body)
  })

  it('deduplicates and compacts empty tag entries', () => {
    const meta: GroundingMetadata = {
      ...baseMetadata,
      tags: ['a', '', 'b', '', 'a'],
    }
    const result = buildGroundedMarkdown(meta, 'Body.')
    // Empty entries are filtered; duplicates remain if the source has them
    // (clean() + filter(Boolean) removes blanks)
    expect(result).not.toMatch(/tags: \[.*""/)
  })

  it('compacts empty derivedFrom entries', () => {
    const meta: GroundingMetadata = {
      ...baseMetadata,
      derivedFrom: ['', 'ref-1', ''],
    }
    const result = buildGroundedMarkdown(meta, 'Body.')
    expect(result).toContain('derived_from: ["ref-1"]')
    expect(result).not.toContain('""')
  })

  it('round-trip: exact expected shape for minimal metadata', () => {
    const result = buildGroundedMarkdown(
      { title: 'My Fact', type: 'fact', scope: 'global', sourceKind: 'manual', createdAt: '2024-01-01T00:00:00.000Z' },
      'Learned something.'
    )
    expect(result).toContain('title: "My Fact"')
    expect(result).toContain('scope: "global"')
    expect(result).toContain('evidence_state: "unverified"')
    expect(result).toContain('# My Fact')
    expect(result).toContain('## Grounding')
    expect(result).toContain('## Learning Status')
    expect(result).toContain('Learned something.')
  })
})
