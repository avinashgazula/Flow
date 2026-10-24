import { describe, expect, it } from 'vitest'
import { exploreSource } from './source'
import { filterParams, filtersToSearch, isFiltered, looksAhead, noFilters, parseFilters, shiftDay, summarizeFilters, type ExploreFilters } from './filters'

const today = '2026-10-18'
const now = new Date('2026-10-18T12:00:00Z')
const opts = { today, region: 'GB' }
const filters = (f: Partial<ExploreFilters>): ExploreFilters => ({ providers: [], ...f })

describe('filterParams', () => {
  it('sends nothing for no filters', () => {
    expect(filterParams('movie', noFilters, opts)).toEqual({})
    expect(isFiltered(noFilters)).toBe(false)
  })

  it('turns years into whole-year bounds on the type’s own date field', () => {
    const f = filters({ yearFrom: 2010, yearTo: 2015 })
    expect(filterParams('movie', f, opts)).toEqual({ 'primary_release_date.gte': '2010-01-01', 'primary_release_date.lte': '2015-12-31' })
    expect(filterParams('show', f, opts)).toEqual({ 'first_air_date.gte': '2010-01-01', 'first_air_date.lte': '2015-12-31' })
    expect(filterParams('movie', filters({ yearFrom: 2020 }), opts)).toEqual({ 'primary_release_date.gte': '2020-01-01' })
  })

  it('turns a window into dates around today', () => {
    expect(filterParams('movie', filters({ window: 'last30' }), opts)).toEqual({ 'primary_release_date.gte': '2026-09-18', 'primary_release_date.lte': '2026-10-18' })
    expect(filterParams('show', filters({ window: 'next180' }), opts)).toEqual({ 'first_air_date.gte': '2026-10-18', 'first_air_date.lte': '2027-04-16' })
  })

  it('lets a window replace the years, as in the apps', () => {
    const p = filterParams('movie', filters({ window: 'next30', yearFrom: 1999, yearTo: 2001 }), opts)
    expect(p).toEqual({ 'primary_release_date.gte': '2026-10-18', 'primary_release_date.lte': '2026-11-17' })
  })

  it('puts a vote floor behind a minimum rating, lower for TV', () => {
    expect(filterParams('movie', filters({ minRating: 7 }), opts)).toEqual({ 'vote_average.gte': 7, 'vote_count.gte': 100 })
    expect(filterParams('show', filters({ minRating: 8 }), opts)).toEqual({ 'vote_average.gte': 8, 'vote_count.gte': 50 })
  })

  it('filters by original language', () => {
    expect(filterParams('movie', filters({ language: 'ko' }), opts)).toEqual({ with_original_language: 'ko' })
  })

  it('matches any chosen service, in the region, on a subscription', () => {
    expect(filterParams('movie', filters({ providers: [8, 337] }), opts)).toEqual({ with_watch_providers: '8|337', watch_region: 'GB', with_watch_monetization_types: 'flatrate' })
  })

  it('carries everything at once', () => {
    const p = filterParams('movie', filters({ yearFrom: 2020, minRating: 7, language: 'ja', providers: [8] }), opts)
    expect(Object.keys(p).sort()).toEqual(['primary_release_date.gte', 'vote_average.gte', 'vote_count.gte', 'watch_region', 'with_original_language', 'with_watch_monetization_types', 'with_watch_providers'])
  })
})

describe('shiftDay', () => {
  it('moves by calendar days across months and years', () => {
    expect(shiftDay('2026-12-20', 30)).toBe('2027-01-19')
    expect(shiftDay('2026-03-05', -30)).toBe('2026-02-03')
  })
})

describe('parseFilters', () => {
  it('reads a full link', () => {
    expect(parseFilters({ from: '2010', to: 2020, rating: '7', lang: 'JA', providers: '8,337' }, now)).toEqual({
      yearFrom: 2010, yearTo: 2020, window: undefined, minRating: 7, language: 'ja', providers: [8, 337],
    })
  })

  it('reads a single provider that the router parsed into a number', () => {
    expect(parseFilters({ providers: 8 }, now).providers).toEqual([8])
  })

  it('drops what isn’t valid and keeps the rest', () => {
    const f = parseFilters({ from: 'soon', to: 1800, rating: 11, lang: 'english', providers: '8,x,-3,8,0,2.5', window: 'someday' }, now)
    expect(f).toEqual({ yearFrom: undefined, yearTo: undefined, window: undefined, minRating: undefined, language: undefined, providers: [8] })
    expect(isFiltered(f)).toBe(true)
    expect(isFiltered(parseFilters({ rating: 11 }, now))).toBe(false)
  })

  it('accepts years up to two ahead of this one, no further', () => {
    expect(parseFilters({ to: 2028 }, now).yearTo).toBe(2028)
    expect(parseFilters({ to: 2029 }, now).yearTo).toBeUndefined()
    expect(parseFilters({ from: 1919 }, now).yearFrom).toBeUndefined()
  })

  it('puts a reversed year range the right way round', () => {
    expect(parseFilters({ from: 2020, to: 2010 }, now)).toMatchObject({ yearFrom: 2010, yearTo: 2020 })
  })

  it('lets a window replace the years', () => {
    expect(parseFilters({ window: 'last90', from: 2000, to: 2010 }, now)).toMatchObject({ window: 'last90', yearFrom: undefined, yearTo: undefined })
  })

  it('caps the services so a hand-made link can’t ask for hundreds', () => {
    const many = Array.from({ length: 60 }, (_, i) => i + 1).join(',')
    expect(parseFilters({ providers: many }, now).providers).toHaveLength(24)
  })

  it('reads nothing as no filters', () => {
    expect(parseFilters({}, now)).toMatchObject({ providers: [] })
    expect(isFiltered(parseFilters({}, now))).toBe(false)
  })
})

describe('filtersToSearch', () => {
  it('leaves unset parts out, so the plain address stays bare', () => {
    expect(filtersToSearch(noFilters)).toEqual({})
  })

  it('writes providers as one comma-separated value', () => {
    expect(filtersToSearch(filters({ providers: [8, 337], minRating: 7 }))).toEqual({ providers: '8,337', rating: 7 })
  })

  it('writes a window, not the years behind it', () => {
    expect(filtersToSearch(filters({ window: 'last30', yearFrom: 2000 }))).toEqual({ window: 'last30' })
  })

  it('round-trips through the address', () => {
    const f = filters({ yearFrom: 2005, yearTo: 2012, minRating: 8, language: 'ko', providers: [350, 8] })
    expect(parseFilters(filtersToSearch(f) as Record<string, unknown>, now)).toEqual({ ...f, window: undefined })
    const w = filters({ window: 'next30', providers: [] })
    expect(parseFilters(filtersToSearch(w) as Record<string, unknown>, now)).toEqual({ ...w, yearFrom: undefined, yearTo: undefined, minRating: undefined, language: undefined })
  })
})

describe('summarizeFilters', () => {
  const names = new Map([[8, 'Netflix'], [337, 'Disney Plus']])
  it('is one line, parts in the sheet’s order', () => {
    expect(summarizeFilters(filters({ yearFrom: 2020, yearTo: 2024, minRating: 7, language: 'ja', providers: [8, 337] }), names)).toBe('2020–2024 · Rated 7+ · Japanese · Netflix, Disney Plus')
  })

  it('words open and single years, and windows', () => {
    expect(summarizeFilters(filters({ yearFrom: 2015 }))).toBe('2015 and later')
    expect(summarizeFilters(filters({ yearTo: 1999 }))).toBe('1999 and earlier')
    expect(summarizeFilters(filters({ yearFrom: 2001, yearTo: 2001 }))).toBe('2001')
    expect(summarizeFilters(filters({ window: 'next180' }))).toBe('Next 6 Months')
  })

  it('counts services it can’t name yet rather than showing ids', () => {
    expect(summarizeFilters(filters({ providers: [8, 99999] }), names)).toBe('2 Streaming Services')
    expect(summarizeFilters(filters({ providers: [8] }))).toBe('1 Streaming Service')
  })

  it('is empty without filters', () => {
    expect(summarizeFilters(noFilters)).toBe('')
  })
})

describe('looksAhead', () => {
  it('is true for windows and years that reach past today', () => {
    expect(looksAhead(filters({ window: 'next30' }), today)).toBe(true)
    expect(looksAhead(filters({ window: 'last30' }), today)).toBe(false)
    expect(looksAhead(filters({ yearFrom: 2027 }), today)).toBe(true)
    expect(looksAhead(filters({ yearFrom: 2020 }), today)).toBe(false)
  })
})

describe('exploreSource with filters', () => {
  it('sends any filter through Discover, even on a plain sort', () => {
    const s = exploreSource('movie', 'trending', undefined, filters({ language: 'ko' }), opts)
    expect(s).toEqual({ kind: 'discover', params: { sort_by: 'popularity.desc', with_original_language: 'ko' } })
  })

  it('combines a genre, a sort and the filters', () => {
    const s = exploreSource('show', 'popular', 18, filters({ yearFrom: 2020, providers: [8] }), opts)
    expect(s).toEqual({
      kind: 'discover',
      params: { with_genres: 18, sort_by: 'popularity.desc', 'first_air_date.gte': '2020-01-01', with_watch_providers: '8', watch_region: 'GB', with_watch_monetization_types: 'flatrate' },
    })
  })

  it('keeps the higher vote floor of the sort and the rating', () => {
    const top = exploreSource('movie', 'top', undefined, filters({ minRating: 8 }), opts)
    expect(top).toMatchObject({ params: { sort_by: 'vote_average.desc', 'vote_average.gte': 8, 'vote_count.gte': 300 } })
    const tv = exploreSource('show', 'new', undefined, filters({ minRating: 8 }), opts)
    expect(tv).toMatchObject({ params: { 'vote_average.gte': 8, 'vote_count.gte': 50, 'first_air_date.lte': today } })
  })

  it('lets a window past today override Newest’s “released only”, and drops its vote floor', () => {
    const s = exploreSource('movie', 'new', undefined, filters({ window: 'next30' }), opts)
    expect(s).toEqual({ kind: 'discover', params: { sort_by: 'primary_release_date.desc', 'primary_release_date.gte': today, 'primary_release_date.lte': '2026-11-17' } })
  })

  it('reads “Last 30 Days” with Newest as the last 30 days up to today', () => {
    const s = exploreSource('movie', 'new', undefined, filters({ window: 'last30' }), opts)
    expect(s).toMatchObject({ params: { 'primary_release_date.gte': '2026-09-18', 'primary_release_date.lte': today, 'vote_count.gte': 40 } })
  })
})
