import { describe, expect, it } from 'vitest'
import type { ProviderState, Source } from '../../lib/sources'
import { bestSource, episodePrint, isNew, metaLine, playFacts, playLabel, sourcesSummary, titlePrint, versionParts } from './logic'

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
    expect(titlePrint(film, undefined, now, 'en-GB')).toEqual(['2024', '2 h 47', 'ends 00:17'])
  })

  it('puts time left in the key slot once started', () => {
    expect(titlePrint(film, { position: 3720, duration: 10020 }, now, 'en-GB')).toEqual(['2024', '2 h 47', { key: '1 h 45 min left' }, 'ends 23:15'])
  })

  it('prints a series by its seasons', () => {
    const show = { type: 'show' as const, year: 2008, runtime: 47, seasons: [{ number: 0, name: 'Specials', episodeCount: 1 }, { number: 1, name: 'Season 1', episodeCount: 7 }] }
    expect(titlePrint(show, undefined, now, 'en-GB')).toEqual(['2008', '1 season', '47 min episodes', 'ends 22:17'])
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
    expect(episodePrint({ runtime: 47, airDate: '2026-10-15' }, { aired: true, watched: false, now })).toEqual([{ key: 'new' }, '47 min'])
    expect(episodePrint({ runtime: 47, airDate: '2026-10-15' }, { aired: true, watched: true, now })).toEqual(['47 min'])
    expect(episodePrint({ runtime: 47, airDate: '2027-01-01' }, { aired: false, watched: false, now })).toEqual(['Not yet aired'])
    expect(episodePrint({}, { aired: true, watched: false, now })).toEqual([])
  })
})
