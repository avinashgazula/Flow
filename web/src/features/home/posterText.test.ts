import { describe, expect, it } from 'vitest'
import { continueMeta, posterCaption } from './posterText'

const dune = { title: 'Dune: Part Two', year: 2024 }

describe('posterCaption', () => {
  it('shows the title and no year by default, as the apps do', () => {
    expect(posterCaption(dune, { showTitles: true, showYear: false })).toEqual({ title: 'Dune: Part Two', meta: undefined })
  })

  it('adds the year under the title', () => {
    expect(posterCaption(dune, { showTitles: true, showYear: true })).toEqual({ title: 'Dune: Part Two', meta: '2024' })
  })

  it('leaves the year alone when titles are hidden, and nothing when both are', () => {
    expect(posterCaption(dune, { showTitles: false, showYear: true })).toEqual({ meta: '2024' })
    expect(posterCaption(dune, { showTitles: false, showYear: false })).toEqual({ meta: undefined })
  })

  it('keeps a caller’s own line, and has no year for a title without one', () => {
    expect(posterCaption(dune, { showTitles: true, showYear: true }, 'Film · 2024')).toEqual({ title: 'Dune: Part Two', meta: 'Film · 2024' })
    expect(posterCaption({ title: 'Untitled' }, { showTitles: true, showYear: true })).toEqual({ title: 'Untitled', meta: undefined })
  })
})

describe('continueMeta', () => {
  it('ends the line with the year', () => {
    expect(continueMeta('S2 E3 · The Door', 2019, true)).toBe('S2 E3 · The Door · 2019')
    expect(continueMeta('18 min left', 2021, true)).toBe('18 min left · 2021')
  })

  it('is the line as it was when the switch is off or the year is unknown', () => {
    expect(continueMeta('S2 E3 · The Door', 2019, false)).toBe('S2 E3 · The Door')
    expect(continueMeta('S2 E3', undefined, true)).toBe('S2 E3')
  })
})
