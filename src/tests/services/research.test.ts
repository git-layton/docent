import { describe, it, expect } from 'vitest'
import {
  hasResearchIntent,
  extractSearchQuery,
  extractUrls,
  dedupeSources,
  buildSourceNotes,
  slugify,
  type ResearchSource,
} from '../../services/research'

// ---------------------------------------------------------------------------
// hasResearchIntent
// ---------------------------------------------------------------------------

describe('hasResearchIntent', () => {
  it('returns true for "what is the latest news on X"', () => {
    expect(hasResearchIntent('what is the latest news on climate change')).toBe(true)
  })

  it('returns true for "look up X"', () => {
    expect(hasResearchIntent('look up quantum computing')).toBe(true)
  })

  it('returns true for "search for X"', () => {
    expect(hasResearchIntent('search for recent AI breakthroughs')).toBe(true)
  })

  it('returns true for "research X"', () => {
    expect(hasResearchIntent('research the history of Rome')).toBe(true)
  })

  it('returns true for a message containing "cite"', () => {
    expect(hasResearchIntent('can you cite some sources for that claim?')).toBe(true)
  })

  it('returns true for a message containing "verify"', () => {
    expect(hasResearchIntent('please verify this fact for me')).toBe(true)
  })

  it('returns true for a message containing "today"', () => {
    expect(hasResearchIntent("what is today's stock price for Apple?")).toBe(true)
  })

  it('returns true for a message containing "web"', () => {
    expect(hasResearchIntent('check the web for this')).toBe(true)
  })

  it('returns false for a plain question without research keywords', () => {
    expect(hasResearchIntent('how do I write a for-loop in Python?')).toBe(false)
  })

  it('returns false for a greeting', () => {
    expect(hasResearchIntent('hello, how are you?')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(hasResearchIntent('')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(hasResearchIntent('SEARCH for something')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// extractSearchQuery
// ---------------------------------------------------------------------------

describe('extractSearchQuery', () => {
  it('strips the "search for" filler phrase', () => {
    const result = extractSearchQuery('search for climate change')
    expect(result).toBe('climate change')
  })

  it('strips the "research" keyword', () => {
    const result = extractSearchQuery('research quantum computing')
    expect(result).toBe('quantum computing')
  })

  it('strips the "look up" phrase', () => {
    const result = extractSearchQuery('look up machine learning')
    expect(result).toBe('machine learning')
  })

  it('strips "what is" filler', () => {
    const result = extractSearchQuery('what is the capital of France')
    expect(result).toBe('the capital of France')
  })

  it('strips "who is" filler', () => {
    const result = extractSearchQuery('who is Nikola Tesla')
    expect(result).toBe('Nikola Tesla')
  })

  it('strips inline URLs from the query', () => {
    const result = extractSearchQuery('check this https://example.com for me')
    expect(result).not.toContain('https://')
    expect(result).toContain('check this')
    expect(result).toContain('for me')
  })

  it('falls back to original input if cleaning produces an empty string', () => {
    const input = 'search'
    const result = extractSearchQuery(input)
    // "search" is stripped, leaving empty → falls back to trimmed original
    expect(result).toBe(input.trim())
  })

  it('collapses multiple spaces into one', () => {
    const result = extractSearchQuery('find  the  answer')
    expect(result).not.toMatch(/\s{2,}/)
  })
})

// ---------------------------------------------------------------------------
// extractUrls
// ---------------------------------------------------------------------------

describe('extractUrls', () => {
  it('finds a single http URL', () => {
    const result = extractUrls('visit http://example.com for more')
    expect(result).toEqual(['http://example.com'])
  })

  it('finds a single https URL', () => {
    const result = extractUrls('see https://example.com for details')
    expect(result).toEqual(['https://example.com'])
  })

  it('finds a URL with a path and query parameters', () => {
    const url = 'https://example.com/path/to/page?q=hello&lang=en'
    const result = extractUrls(`check out ${url}`)
    expect(result).toEqual([url])
  })

  it('finds multiple URLs in one string', () => {
    const result = extractUrls('see https://foo.com and https://bar.org/page')
    expect(result).toHaveLength(2)
    expect(result).toContain('https://foo.com')
    expect(result).toContain('https://bar.org/page')
  })

  it('deduplicates repeated URLs', () => {
    const result = extractUrls('https://example.com and again https://example.com')
    expect(result).toEqual(['https://example.com'])
  })

  it('returns an empty array when no URLs are present', () => {
    expect(extractUrls('no links here at all')).toEqual([])
  })

  it('returns an empty array for an empty string', () => {
    expect(extractUrls('')).toEqual([])
  })

  it('does not include a trailing closing parenthesis in the URL', () => {
    const result = extractUrls('(see https://example.com/foo)')
    // The regex stops at ) so the paren should not be part of the URL
    expect(result[0]).not.toMatch(/\)$/)
  })
})

// ---------------------------------------------------------------------------
// dedupeSources
// ---------------------------------------------------------------------------

describe('dedupeSources', () => {
  it('removes exact URL duplicates', () => {
    const sources: ResearchSource[] = [
      { title: 'A', url: 'https://example.com' },
      { title: 'B', url: 'https://example.com' },
    ]
    expect(dedupeSources(sources)).toHaveLength(1)
  })

  it('removes sources with the same path', () => {
    const sources: ResearchSource[] = [
      { title: 'First', path: '/docs/intro' },
      { title: 'Second', path: '/docs/intro' },
    ]
    expect(dedupeSources(sources)).toHaveLength(1)
  })

  it('removes duplicates matched by title when no url or path is set', () => {
    const sources: ResearchSource[] = [
      { title: 'My Document' },
      { title: 'My Document' },
    ]
    expect(dedupeSources(sources)).toHaveLength(1)
  })

  it('returns unique sources unchanged', () => {
    const sources: ResearchSource[] = [
      { title: 'A', url: 'https://a.com' },
      { title: 'B', url: 'https://b.com' },
      { title: 'C', url: 'https://c.com' },
    ]
    expect(dedupeSources(sources)).toHaveLength(3)
  })

  it('returns an empty array for empty input', () => {
    expect(dedupeSources([])).toEqual([])
  })

  it('key comparison is case-insensitive', () => {
    const sources: ResearchSource[] = [
      { title: 'Alpha', url: 'https://Example.COM' },
      { title: 'Beta', url: 'https://example.com' },
    ]
    expect(dedupeSources(sources)).toHaveLength(1)
  })

  it('preserves original order for the first occurrence', () => {
    const sources: ResearchSource[] = [
      { title: 'First', url: 'https://same.com' },
      { title: 'Second', url: 'https://same.com' },
    ]
    const result = dedupeSources(sources)
    expect(result[0].title).toBe('First')
  })
})

// ---------------------------------------------------------------------------
// buildSourceNotes
// ---------------------------------------------------------------------------

describe('buildSourceNotes', () => {
  it('returns a fallback message for empty sources array', () => {
    expect(buildSourceNotes([])).toBe('No sources were found.')
  })

  it('formats a single source citation correctly', () => {
    const source: ResearchSource = {
      title: 'Example Article',
      url: 'https://example.com',
      snippet: 'A short excerpt.',
    }
    const result = buildSourceNotes([source])
    expect(result).toContain('[1] Example Article')
    expect(result).toContain('URL: https://example.com')
    expect(result).toContain('Excerpt: A short excerpt.')
  })

  it('uses path when url is absent', () => {
    const source: ResearchSource = { title: 'Local Doc', path: '/docs/readme.md', snippet: 'text' }
    const result = buildSourceNotes([source])
    expect(result).toContain('URL: /docs/readme.md')
  })

  it('falls back to "local" when neither url nor path is set', () => {
    const source: ResearchSource = { title: 'Inline Note', snippet: 'some text' }
    const result = buildSourceNotes([source])
    expect(result).toContain('URL: local')
  })

  it('shows "(no excerpt available)" when snippet and text are absent', () => {
    const source: ResearchSource = { title: 'Empty Source', url: 'https://x.com' }
    const result = buildSourceNotes([source])
    expect(result).toContain('(no excerpt available)')
  })

  it('clips body text that exceeds maxChars and appends "..."', () => {
    const longText = 'x'.repeat(2000)
    const source: ResearchSource = { title: 'Long Source', url: 'https://x.com', text: longText }
    const result = buildSourceNotes([source], 100)
    expect(result).toContain('x'.repeat(100) + '...')
    expect(result).not.toContain('x'.repeat(101) + 'x')
  })

  it('does not clip body text that is within maxChars', () => {
    const shortText = 'brief text'
    const source: ResearchSource = { title: 'Short Source', url: 'https://x.com', text: shortText }
    const result = buildSourceNotes([source], 1800)
    expect(result).toContain('brief text')
    expect(result).not.toContain('...')
  })

  it('separates multiple sources with the "---" divider', () => {
    const sources: ResearchSource[] = [
      { title: 'First', url: 'https://first.com', snippet: 'a' },
      { title: 'Second', url: 'https://second.com', snippet: 'b' },
    ]
    const result = buildSourceNotes(sources)
    expect(result).toContain('---')
    expect(result).toContain('[1] First')
    expect(result).toContain('[2] Second')
  })

  it('prefers text over snippet for the excerpt body', () => {
    const source: ResearchSource = {
      title: 'Priority Test',
      url: 'https://x.com',
      text: 'full text content',
      snippet: 'snippet content',
    }
    const result = buildSourceNotes([source])
    expect(result).toContain('full text content')
    expect(result).not.toContain('snippet content')
  })
})

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('converts "Hello World!" to "hello-world"', () => {
    expect(slugify('Hello World!')).toBe('hello-world')
  })

  it('lowercases the output', () => {
    expect(slugify('UPPERCASE')).toBe('uppercase')
  })

  it('replaces spaces with hyphens', () => {
    expect(slugify('foo bar baz')).toBe('foo-bar-baz')
  })

  it('removes special characters', () => {
    expect(slugify('hello@world#test')).toBe('hello-world-test')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugify('!hello!')).toBe('hello')
  })

  it('collapses multiple consecutive special chars into a single hyphen', () => {
    expect(slugify('foo   ---   bar')).toBe('foo-bar')
  })

  it('uses the fallback when value is empty', () => {
    expect(slugify('', 'default')).toBe('default')
  })

  it('uses the fallback when value is all special characters', () => {
    expect(slugify('!!!', 'fallback')).toBe('fallback')
  })

  it('uses "note" as the default fallback', () => {
    expect(slugify('')).toBe('note')
  })

  it('truncates the slug to 60 characters', () => {
    const long = 'a'.repeat(80)
    const result = slugify(long)
    expect(result.length).toBeLessThanOrEqual(60)
  })

  it('preserves alphanumeric characters', () => {
    expect(slugify('abc123')).toBe('abc123')
  })
})
