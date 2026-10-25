import { describe, expect, it } from 'vitest'
import type { ProviderState, Source } from '../../lib/sources'
import { aboutRows, airedRefs, bestSource, cardOf, playsFirst, episodePrint, isNew, metaLine, playFacts, playLabel, realSeasons, runtimeText, sourcesSummary, starsOf, statusLabel, titlePrint, todayOf, versionParts } from './logic'
import { toFacts } from '../../components/stripLayout'
import type { PrintPart } from '../../components/stripLayout'

/** Print as the screen reads it: white facts as text, the time left as { key }. */
const plain = (parts: PrintPart[]) => toFacts(parts).map((f) => (f.key ? { key: f.text } : f.text))

const now = new Date(2026, 9, 22, 21, 30).getTime()
const source = (over: Partial<Source> = {}): Source => ({ id: 'a', origin: 'addon', provider: 'AIOStreams', title: 'x', url: 'https://x', engine: 'native', ...over })
const film = { type: 'movie' as const, year: 2024, runtime: 167, seasons: [] }

describe('film-can label', () => {
  it('prints the best version as the release says it', () => {
    const s = source({ resolution: '2160p', hdr: ['DV', 'HDR10'], audio: ['TrueHD'], audioChannels: '7.1', sizeBytes: 18.2 * 1024 ** 3 })
    expect(versionParts(s)).toEqual(['2160p', 'Dolby Vision', 'TrueHD 7.1', '18.20 GB'])
    expect(versionParts(source({ resolution: '480p' }))).toEqual(['SD'])
    expect(versionParts(source())).toEqual([])
  })

  it('says how it plays and what is compromised', () => {
    expect(playFacts(source())).toEqual({ direct: true, mode: 'Direct', notes: [] })
    const facts = playFacts(source({ engine: 'remux', convertsAudio: true, mayStutter: true }))
    expect(facts.direct).toBe(false)
    expect(facts.notes).toEqual([
      { text: 'Audio converted for this browser', tone: 'plain' },
      { text: 'May stutter on this device', tone: 'warn' },
    ])
  })

  it('offers the last played source, else the first that plays', () => {
    const list = [source({ id: 'dts', unsupported: 'DTS' }), source({ id: 'ok' }), source({ id: 'other' })]
    expect(bestSource(list)?.id).toBe('ok')
    expect(bestSource(list, list[2])?.id).toBe('other')
    expect(bestSource([list[0]!])).toBeUndefined()
  })

  it('says what Play opens: what the player remembered, else the picker\'s, else the ranking, and which of them it is', () => {
    const list = [source({ id: 'dts', unsupported: 'DTS' }), source({ id: 'ok', resolution: '1080p' }), source({ id: 'uhd', resolution: '2160p' })]
    expect(playsFirst(list)).toEqual({ source: list[1], lastPlayed: false })
    // The player plays what it remembered, so the label shows that, even when the ranking prefers another.
    expect(playsFirst(list, { source: list[2]!, matched: list[2] })).toEqual({ source: list[2], lastPlayed: true })
    // Not in this search any more: the player still opens it as remembered, so the label does too.
    const gone = source({ id: 'gone', resolution: '2160p' })
    expect(playsFirst(list, { source: gone })).toEqual({ source: gone, lastPlayed: true })
    expect(playsFirst(list, undefined, list[2])).toEqual({ source: list[2], lastPlayed: true })
  })

  it('lists who answered', () => {
    const providers: ProviderState[] = [
      { id: '1', name: 'AIOStreams', kind: 'addon', state: 'done', count: 4, torrents: 0 },
      { id: '2', name: 'Empty', kind: 'addon', state: 'done', count: 0, torrents: 0 },
      { id: '3', name: 'Trellis', kind: 'addon', state: 'done', count: 1, torrents: 0 },
      { id: '4', name: 'Down', kind: 'addon', state: 'failed', error: 'x' },
    ]
    expect(sourcesSummary(5, providers)).toBe('5 · AIOStreams, Trellis')
  })
})

describe('strip and buttons', () => {
  it('prints a film not started with when it would end', () => {
    expect(plain(titlePrint(film, undefined, now, 'en-GB'))).toEqual(['2024', '2 h 47', 'ends 00:17'])
  })

  it('puts time left in the key slot once started', () => {
    expect(plain(titlePrint(film, { position: 3720, duration: 10020 }, now, 'en-GB'))).toEqual(['2024', '2 h 47', { key: '1h45 left' }, 'ends 23:15'])
  })

  it('prints a series by its seasons, and a started one by its episode', () => {
    const show = { type: 'show' as const, year: 2008, runtime: 47, seasons: [{ number: 0, name: 'Specials', episodeCount: 1 }, { number: 1, name: 'Season 1', episodeCount: 7 }] }
    expect(plain(titlePrint(show, undefined, now, 'en-GB'))).toEqual(['2008', '1 season', '47 min', 'ends 22:17'])
    expect(plain(titlePrint(show, { position: 600, duration: 2700, episode: { season: 3, episode: 7 } }, now, 'en-GB'))).toEqual(['S3 E7', { key: '35m left' }, 'ends 22:05'])
  })

  it('ranks the year lowest, so a narrow strip drops it first and keeps the time left and the end time', () => {
    const facts = toFacts(titlePrint(film, { position: 3720, duration: 10020 }, now, 'en-GB'))
    const order = [...facts].sort((a, b) => a.rank - b.rank).map((f) => f.text)
    expect(order[0]).toBe('1h45 left')
    expect(order[1]).toBe('ends 23:15')
    expect(order.at(-1)).toBe('2024')
  })

  it('labels the yellow button', () => {
    expect(playLabel(film, { position: 3720, duration: 10020 }, undefined, now, 'en-GB').text).toBe('Resume · 1 h 45 min left')
    expect(playLabel({ type: 'show', runtime: 47 }, { position: 600, duration: 2700, episode: { season: 3, episode: 7 } }, undefined, now, 'en-GB').text).toBe('Resume S3 E7 · 35 min left')
    expect(playLabel(film, undefined, undefined, now, 'en-GB').text).toBe('Play · ends 00:17')
    expect(playLabel({ type: 'show', runtime: 47 }, undefined, { season: 1, episode: 1 }, now, 'en-GB').text).toBe('Play S1 E1 · ends 22:17')
  })

  it('builds the meta line from what is known', () => {
    expect(metaLine({ type: 'movie', year: 2024, runtime: 167, certification: 'PG-13', genreNames: ['Science Fiction', 'Adventure', 'Drama'] }, [])).toBe('2024 · 2 h 47 min · PG-13 · Science Fiction, Adventure')
    expect(metaLine({ type: 'show', year: 2008, runtime: 47, genreNames: [] }, ['Drama'])).toBe('2008 · 47 min episodes · Drama')
  })
})

describe('episodes', () => {
  it('marks an episode new for two weeks, and only when it has aired', () => {
    expect(isNew('2026-10-15', now)).toBe(true)
    expect(isNew('2026-09-01', now)).toBe(false)
    expect(isNew('2026-11-01', now)).toBe(false)
    expect(isNew(undefined, now)).toBe(false)
  })

  it('prints runtime, with NEW first, and says when one has not aired', () => {
    expect(plain(episodePrint({ runtime: 47, airDate: '2026-10-15' }, { aired: true, watched: false, now }))).toEqual(['new', '47 min'])
    expect(plain(episodePrint({ runtime: 47, airDate: '2026-10-15' }, { aired: true, watched: true, now }))).toEqual(['47 min'])
    expect(plain(episodePrint({ runtime: 47, airDate: '2027-01-01' }, { aired: false, watched: false, now }))).toEqual(['Not yet aired'])
    expect(plain(episodePrint({}, { aired: true, watched: false, now }))).toEqual([])
  })
})

describe('about', () => {
  const dune = {
    type: 'movie' as const,
    date: '2024-02-27',
    runtime: 167,
    seasons: [],
    crew: [{ id: 1, name: 'Denis Villeneuve', role: 'Director' }, { id: 2, name: 'Hans Zimmer', role: 'Original Music Composer' }],
    certification: 'PG-13',
    status: 'Released',
    originalLanguage: 'en',
    originCountries: ['US', 'CA'],
    budget: 190_000_000,
    revenue: 714_444_358,
    productionCompanies: ['Legendary Pictures', 'Warner Bros. Pictures'],
    networks: [],
  }

  it('always lists the essentials, in the apps’ order', () => {
    expect(aboutRows(dune, { full: false, locale: 'en-GB' })).toEqual([
      { label: 'Released', value: '27 Feb 2024' },
      { label: 'Runtime', value: '2 h 47 min' },
      { label: 'Director', value: 'Denis Villeneuve' },
      { label: 'Rated', value: 'PG-13' },
    ])
  })

  it('adds status, language, countries, money and companies when About is on', () => {
    const rows = aboutRows(dune, { full: true, locale: 'en-GB' })
    expect(rows.slice(4)).toEqual([
      { label: 'Status', value: 'Released' },
      { label: 'Original Language', value: 'English' },
      { label: 'Countries', value: 'United States, Canada' },
      { label: 'Budget', value: '$190M' },
      { label: 'Revenue', value: '$714.4M' },
      { label: 'Production', value: 'Legendary Pictures, Warner Bros. Pictures', wide: true },
    ])
  })

  it('names a series by its creators, seasons and network, and leaves out what TMDB does not have', () => {
    const show = { ...dune, type: 'show' as const, status: 'Returning Series', runtime: 47, budget: undefined, revenue: undefined, productionCompanies: [], originCountries: ['US'], networks: ['HBO'], seasons: [{ number: 0, name: 'Specials', episodeCount: 2 }, { number: 1, name: 'S1', episodeCount: 8 }], crew: [{ id: 3, name: 'Vince Gilligan', role: 'Creator' }] }
    const rows = aboutRows(show, { full: true, locale: 'en-GB' })
    expect(rows.map((r) => `${r.label}: ${r.value}`)).toEqual(['First Aired: 27 Feb 2024', 'Runtime: 47 min', 'Seasons: 1', 'Created By: Vince Gilligan', 'Rated: PG-13', 'Status: Returning', 'Original Language: English', 'Country: United States', 'Network: HBO'])
  })

  it('prints runtimes and statuses the way the apps do', () => {
    expect(runtimeText(60)).toBe('1 h')
    expect(runtimeText(45)).toBe('45 min')
    expect(statusLabel('Returning Series')).toBe('Returning')
    expect(statusLabel('Ended')).toBe('Ended')
  })
})

describe('series helpers', () => {
  it('lists Specials last, and not at all when they are turned off', () => {
    const seasons = [{ number: 0 }, { number: 2 }, { number: 1 }]
    expect(realSeasons(seasons).map((x) => x.number)).toEqual([1, 2, 0])
    expect(realSeasons(seasons, false).map((x) => x.number)).toEqual([1, 2])
  })

  it('counts an episode as aired only when it has a date that is today or earlier', () => {
    const today = todayOf(Date.UTC(2026, 9, 24, 12))
    expect(today).toBe('2026-10-24')
    expect(airedRefs([{ season: 1, number: 1, airDate: '2026-10-24' }, { season: 1, number: 2, airDate: '2026-10-25' }, { season: 1, number: 3 }], today)).toEqual([{ season: 1, episode: 1 }])
  })

  it('keeps a library entry small', () => {
    const entry = cardOf({ type: 'show', id: 1, title: 'A', overview: 'x', genres: [1], poster: '/p', cast: [1, 2, 3] } as never)
    expect(Object.keys(entry)).not.toContain('cast')
    expect(entry.poster).toBe('/p')
  })

  it('turns a 1 to 10 score into whole stars, two points each', () => {
    expect([undefined, 1, 2, 7, 10].map(starsOf)).toEqual([0, 0, 1, 3, 5])
  })
})
