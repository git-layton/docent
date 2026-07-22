import { describe, it, expect } from 'vitest'
import { isEnrichable, buildDossier } from '../../services/entityEnrichment'

// This feature touches the network and writes files without being asked, so the rules that decide
// WHETHER to act matter more than the acting. The consent boundary is the important one: looking up
// the people in someone's private notes on the open web is a different product from this one.

const meta = (o: Record<string, unknown>) => JSON.stringify(o)

describe('isEnrichable — consent boundary', () => {
  it('NEVER researches a person, however connected they are', () => {
    expect(isEnrichable({ node_type: 'person' }, 50)).toBe(false)
    expect(isEnrichable({ node_type: 'PERSON' }, 50)).toBe(false)
  })

  it('does research public things that come up repeatedly', () => {
    expect(isEnrichable({ node_type: 'product' }, 2)).toBe(true)
    expect(isEnrichable({ node_type: 'technology' }, 5)).toBe(true)
  })
})

describe('isEnrichable — spending rules', () => {
  it('ignores something mentioned only once', () => {
    // Could be a passing reference or an extraction mistake; twice means it matters.
    expect(isEnrichable({ node_type: 'product' }, 1)).toBe(false)
  })

  it('never overwrites what the user curated themselves', () => {
    expect(isEnrichable({ node_type: 'product', metadata_json: meta({ curated: true }) }, 9)).toBe(false)
  })

  it('skips anything that already has a dossier', () => {
    expect(isEnrichable(
      { node_type: 'product', metadata_json: meta({ dossier_path: 'entities/x.md' }) }, 9,
    )).toBe(false)
  })

  it('does not re-research within 30 days, but will after', () => {
    const now = Date.now()
    const recent = meta({ enriched_at: now - 5 * 24 * 60 * 60 * 1000 })
    const old = meta({ enriched_at: now - 40 * 24 * 60 * 60 * 1000 })
    expect(isEnrichable({ node_type: 'product', metadata_json: recent }, 9, now)).toBe(false)
    expect(isEnrichable({ node_type: 'product', metadata_json: old }, 9, now)).toBe(true)
  })

  it('survives malformed metadata rather than throwing mid-run', () => {
    expect(isEnrichable({ node_type: 'product', metadata_json: '{oops' }, 4)).toBe(true)
  })
})

describe('buildDossier', () => {
  const sources = [
    { title: "Baldur's Gate 3", url: 'https://en.wikipedia.org/wiki/BG3', snippet: 'A 2023 role-playing video game.' },
  ]

  it('carries a source URL on every fact — a fact without provenance is a rumour', () => {
    const d = buildDossier("Baldur's Gate 3", 'product', sources)
    expect(d).toContain('https://en.wikipedia.org/wiki/BG3')
    expect(d).toContain('## Facts')
  })

  it('writes the charter sections the dossier page expects', () => {
    const d = buildDossier('X', 'concept', sources)
    for (const s of ['## Summary', '## Facts', '## Relationships', '## Open questions', '## Log']) {
      expect(d).toContain(s)
    }
  })

  it('is honest when nothing was found rather than inventing a summary', () => {
    const d = buildDossier('Obscure Thing', 'concept', [])
    expect(d).toContain('Nothing found in public sources yet.')
  })

  it('escapes quotes so the frontmatter stays parseable', () => {
    expect(buildDossier('The "Best" Thing', 'concept', [])).toContain('\\"Best\\"')
  })
})
