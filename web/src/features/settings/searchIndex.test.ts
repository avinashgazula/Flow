import { describe, expect, it } from 'vitest'
import { buildIndex, normalise, rowKeywords, search, step, type RawRow } from './searchIndex'

const row = (section: string, title: string, patch: Partial<RawRow> = {}): RawRow => ({
  key: `${section}:${title}`,
  section,
  sectionTitle: section[0]!.toUpperCase() + section.slice(1),
  group: '',
  title,
  detail: '',
  footer: '',
  ...patch,
})

const order = ['appearance', 'playback', 'sources']
const index = buildIndex([
  row('appearance', 'Opening Tab'),
  row('playback', 'Picture in Picture', { detail: 'Show the button in the player' }),
  row('playback', 'Subtitle Type', { group: 'Subtitles', footer: 'Subtitle Type picks SDH or standard subtitles.' }),
  row('playback', 'Sync Offset', { group: 'Subtitles', footer: 'Subtitle Type picks SDH or standard subtitles.' }),
  row('playback', 'Auto-sync'),
  row('sources', 'Provider Timeout', { footer: 'Slow add-ons give up after this long.' }),
])
const titles = (query: string) => search(index, query, order).flatMap((r) => r.hits.map((h) => h.entry.title))

describe('Settings search', () => {
  it('reads accents, curly quotes and spacing out of what is typed', () => {
    expect(normalise('  Café   Server’s ')).toBe("cafe server's")
  })

  it('finds a row by its title, in any case and any part of it', () => {
    expect(titles('picture')).toEqual(['Picture in Picture'])
    expect(titles('TIMEOUT')).toEqual(['Provider Timeout'])
  })

  it('finds a row by the names the apps give it', () => {
    expect(titles('pip')).toEqual(['Picture in Picture'])
    expect(titles('sdh')).toContain('Subtitle Type')
    expect(titles('stremio')).toEqual(['Provider Timeout'])
  })

  it('needs every word, in any order', () => {
    expect(titles('type subtitle')).toContain('Subtitle Type')
    expect(titles('picture banana')).toEqual([])
  })

  it('matches a short word at the start of a word only', () => {
    expect(titles('ti')).toContain('Provider Timeout')
    expect(titles('ab')).toEqual([])
  })

  it('finds rows through their detail, group and footer words, after the closer matches', () => {
    expect(titles('button')).toEqual(['Picture in Picture'])
    // "subtitle" is the title of one row and the group and footer of another.
    expect(titles('subtitle')).toEqual(['Subtitle Type', 'Sync Offset', 'Auto-sync'])
    expect(titles('slow')).toEqual(['Provider Timeout'])
  })

  it('groups by section in the page’s order, closest rows first inside each', () => {
    const results = search(index, 'sync', order)
    expect(results.map((r) => r.section)).toEqual(['playback'])
    expect(results[0]!.hits.map((h) => [h.entry.title, h.tier])).toEqual([
      ['Sync Offset', 0],
      ['Auto-sync', 0],
    ])
    expect(search(index, 'timeout', order).map((r) => r.section)).toEqual(['sources'])
  })

  it('returns nothing for an empty query, and caps a broad one with the closest first', () => {
    expect(search(index, '   ', order)).toEqual([])
    const many = buildIndex(Array.from({ length: 10 }, (_, i) => row('playback', i < 8 ? `Row ${i}` : `Zed ${i}`, { footer: 'zed' })))
    const kept = search(many, 'zed', order, 3).flatMap((r) => r.hits.map((h) => h.entry.title))
    expect(kept).toHaveLength(3)
    // Both Zed rows (title matches) are kept ahead of footer-only matches.
    expect(kept).toEqual(expect.arrayContaining(['Zed 8', 'Zed 9']))
  })

  it('keeps its keyword table in the form the matcher reads', () => {
    for (const [title, words] of Object.entries(rowKeywords)) {
      expect(normalise(title)).toBe(title)
      expect(normalise(words)).toBe(words)
    }
  })
})

describe('moving through results', () => {
  it('starts at the first or last and wraps at both ends', () => {
    expect(step(-1, 1, 3)).toBe(0)
    expect(step(-1, -1, 3)).toBe(2)
    expect(step(2, 1, 3)).toBe(0)
    expect(step(0, -1, 3)).toBe(2)
    expect(step(0, 1, 0)).toBe(-1)
  })
})
