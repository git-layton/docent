import { describe, it, expect } from 'vitest'
import {
  hasSemanticHits,
  buildSemanticMemoryNotes,
  type SemanticLayerResult,
  type SemanticFactHit,
  type SemanticEntityHit,
  type SemanticRelationHit,
  type SemanticDocumentHit,
} from '../../services/semantic'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeFact = (overrides: Partial<SemanticFactHit> = {}): SemanticFactHit => ({
  fact: 'The sky is blue',
  title: 'Nature Notes',
  path: 'notes/nature.md',
  scope: 'local',
  ...overrides,
})

const makeEntity = (overrides: Partial<SemanticEntityHit> = {}): SemanticEntityHit => ({
  name: 'Alice',
  kind: 'person',
  title: 'People',
  path: 'notes/people.md',
  scope: 'local',
  ...overrides,
})

const makeRelation = (overrides: Partial<SemanticRelationHit> = {}): SemanticRelationHit => ({
  source: 'Alice',
  relation: 'knows',
  target: 'Bob',
  title: 'Relationships',
  path: 'notes/relationships.md',
  scope: 'local',
  ...overrides,
})

const makeDocument = (overrides: Partial<SemanticDocumentHit> = {}): SemanticDocumentHit => ({
  title: 'Project Overview',
  path: 'docs/overview.md',
  scope: 'project',
  ...overrides,
})

// ---------------------------------------------------------------------------
// hasSemanticHits
// ---------------------------------------------------------------------------

describe('hasSemanticHits', () => {
  it('returns false for null', () => {
    expect(hasSemanticHits(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(hasSemanticHits(undefined)).toBe(false)
  })

  it('returns false for an empty object {}', () => {
    expect(hasSemanticHits({})).toBe(false)
  })

  it('returns false when all sections are empty arrays', () => {
    const result: SemanticLayerResult = {
      facts: [],
      relations: [],
      entities: [],
      documents: [],
    }
    expect(hasSemanticHits(result)).toBe(false)
  })

  it('returns true when facts has at least one entry', () => {
    expect(hasSemanticHits({ facts: [makeFact()] })).toBe(true)
  })

  it('returns true when relations has at least one entry', () => {
    expect(hasSemanticHits({ relations: [makeRelation()] })).toBe(true)
  })

  it('returns true when entities has at least one entry', () => {
    expect(hasSemanticHits({ entities: [makeEntity()] })).toBe(true)
  })

  it('returns true when documents has at least one entry', () => {
    expect(hasSemanticHits({ documents: [makeDocument()] })).toBe(true)
  })

  it('returns true when facts/relations are empty but entities has content', () => {
    const result: SemanticLayerResult = {
      facts: [],
      relations: [],
      entities: [makeEntity()],
    }
    expect(hasSemanticHits(result)).toBe(true)
  })

  it('ignores the error field — returns false if no array sections have hits', () => {
    expect(hasSemanticHits({ error: 'something went wrong' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildSemanticMemoryNotes
// ---------------------------------------------------------------------------

describe('buildSemanticMemoryNotes', () => {
  it('returns the no-hits fallback string for an empty result', () => {
    const output = buildSemanticMemoryNotes({})
    expect(output).toBe('No semantic memory facts, entities, or relations matched.')
  })

  it('returns the no-hits fallback when all sections are empty arrays', () => {
    const output = buildSemanticMemoryNotes({ facts: [], entities: [], relations: [], documents: [] })
    expect(output).toBe('No semantic memory facts, entities, or relations matched.')
  })

  // --- facts section -------------------------------------------------------

  it('includes Facts section header when result has facts', () => {
    const output = buildSemanticMemoryNotes({ facts: [makeFact()] })
    expect(output).toContain('Facts:')
  })

  it('includes the fact text in the output', () => {
    const output = buildSemanticMemoryNotes({ facts: [makeFact({ fact: 'Water boils at 100°C' })] })
    expect(output).toContain('Water boils at 100°C')
  })

  it('includes the citation title wrapped in [[...]]', () => {
    const output = buildSemanticMemoryNotes({ facts: [makeFact({ title: 'Science Notes' })] })
    expect(output).toContain('[[Science Notes]]')
  })

  it('falls back to path when title is missing', () => {
    const fact = makeFact({ title: '' })
    // title is falsy — citeLocal should use path
    const output = buildSemanticMemoryNotes({ facts: [fact] })
    expect(output).toContain('notes/nature.md')
  })

  it('respects maxPerSection — only shows first N facts', () => {
    const facts = Array.from({ length: 5 }, (_, i) => makeFact({ fact: `Fact ${i + 1}` }))
    const output = buildSemanticMemoryNotes({ facts }, 2)
    expect(output).toContain('Fact 1')
    expect(output).toContain('Fact 2')
    expect(output).not.toContain('Fact 3')
    expect(output).not.toContain('Fact 4')
    expect(output).not.toContain('Fact 5')
  })

  it('formats evidence and verification state with underscores replaced by spaces', () => {
    const fact = makeFact({ evidenceState: 'well_established', verification: 'cross_checked' })
    const output = buildSemanticMemoryNotes({ facts: [fact] })
    expect(output).toContain('evidence: well established')
    expect(output).toContain('verification: cross checked')
  })

  it('renders "unknown" for missing evidenceState and verification', () => {
    const fact = makeFact({ evidenceState: undefined, verification: undefined })
    const output = buildSemanticMemoryNotes({ facts: [fact] })
    expect(output).toContain('evidence: unknown')
    expect(output).toContain('verification: unknown')
  })

  // --- relations section ---------------------------------------------------

  it('includes Relations section header when result has relations', () => {
    const output = buildSemanticMemoryNotes({ relations: [makeRelation()] })
    expect(output).toContain('Relations:')
  })

  it('formats relation as source --rel--> target', () => {
    const output = buildSemanticMemoryNotes({
      relations: [makeRelation({ source: 'Alice', relation: 'knows', target: 'Bob' })],
    })
    expect(output).toContain('Alice --knows--> Bob')
  })

  // --- entities section ----------------------------------------------------

  it('includes Entities section header when result has entities', () => {
    const output = buildSemanticMemoryNotes({ entities: [makeEntity()] })
    expect(output).toContain('Entities:')
  })

  it('formats entity as name [kind]', () => {
    const output = buildSemanticMemoryNotes({
      entities: [makeEntity({ name: 'Alice', kind: 'person' })],
    })
    expect(output).toContain('Alice [person]')
  })

  // --- documents section ---------------------------------------------------

  it('includes Relevant Grounded Documents section header when result has documents', () => {
    const output = buildSemanticMemoryNotes({ documents: [makeDocument()] })
    expect(output).toContain('Relevant Grounded Documents:')
  })

  it('formats document with scope and type', () => {
    const output = buildSemanticMemoryNotes({
      documents: [makeDocument({ scope: 'project', type: 'spec' })],
    })
    expect(output).toContain('project/spec')
  })

  it('falls back to "note" when document type is missing', () => {
    const output = buildSemanticMemoryNotes({
      documents: [makeDocument({ type: undefined })],
    })
    expect(output).toContain('project/note')
  })

  it('caps documents at min(4, maxPerSection) when many documents exist', () => {
    const docs = Array.from({ length: 6 }, (_, i) => makeDocument({ title: `Doc ${i + 1}` }))
    const output = buildSemanticMemoryNotes({ documents: docs }, 8)
    // maxPerSection=8 but documents are capped at min(4,8)=4
    expect(output).toContain('Doc 1')
    expect(output).toContain('Doc 4')
    expect(output).not.toContain('Doc 5')
    expect(output).not.toContain('Doc 6')
  })

  // --- mixed content -------------------------------------------------------

  it('includes all non-empty sections when result has mixed content', () => {
    const result: SemanticLayerResult = {
      facts: [makeFact()],
      relations: [makeRelation()],
      entities: [makeEntity()],
      documents: [makeDocument()],
    }
    const output = buildSemanticMemoryNotes(result)
    expect(output).toContain('Facts:')
    expect(output).toContain('Relations:')
    expect(output).toContain('Entities:')
    expect(output).toContain('Relevant Grounded Documents:')
  })

  it('separates sections with a blank line', () => {
    const result: SemanticLayerResult = {
      facts: [makeFact()],
      entities: [makeEntity()],
    }
    const output = buildSemanticMemoryNotes(result)
    expect(output).toContain('\n\n')
  })

  it('does not include absent sections in the output', () => {
    const output = buildSemanticMemoryNotes({ facts: [makeFact()] })
    expect(output).not.toContain('Relations:')
    expect(output).not.toContain('Entities:')
    expect(output).not.toContain('Relevant Grounded Documents:')
  })
})
