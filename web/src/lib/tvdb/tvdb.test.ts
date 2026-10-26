import { describe, expect, it } from 'vitest'
import type { Episode } from '../tmdb/types'
import { checkTVDBKey, tvdbEpisodes, TVDBError, type TVDBEpisode } from './client'
import { bySeason, fromTVDB, fromTrakt, tvdbLanguage, withTMDB } from './episodes'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const tmdb = (season: number, number: number, extra: Partial<Episode> = {}): Episode => ({ id: season * 1000 + number, season, number, name: `TMDB ${season}x${number}`, overview: '', ...extra })

describe('TVDB’s episodes as Flow’s', () => {
  const list: TVDBEpisode[] = [
    { id: 11, seasonNumber: 1, number: 1, name: ' Pilot ', overview: ' First. ', aired: '2008-01-20', runtime: 58, image: 'https://artworks.thetvdb.com/banners/episodes/81189/1.jpg', absoluteNumber: 1 },
    { id: 12, seasonNumber: 1, number: 2, name: null, overview: null, aired: null, runtime: 0, image: null },
    { id: 13, seasonNumber: null, number: 3 },
    { id: 14, seasonNumber: 2, number: null },
    { id: 15, seasonNumber: 0, number: 1, name: 'Good Cop Bad Cop', image: '/banners/episodes/x.jpg' },
  ]

  it('keeps the numbering TVDB gives, with a name for the unnamed', () => {
    expect(fromTVDB(list)).toEqual([
      { id: 11, season: 1, number: 1, name: 'Pilot', overview: 'First.', still: 'https://artworks.thetvdb.com/banners/episodes/81189/1.jpg', airDate: '2008-01-20', runtime: 58 },
      { id: 12, season: 1, number: 2, name: 'Episode 2', overview: '', still: undefined, airDate: undefined, runtime: undefined },
      { id: 15, season: 0, number: 1, name: 'Good Cop Bad Cop', overview: '', still: 'https://artworks.thetvdb.com/banners/episodes/x.jpg', airDate: undefined, runtime: undefined },
    ])
  })

  it('leaves out an episode it can’t place', () => {
    expect(fromTVDB([{ id: 1 }, { id: 2, seasonNumber: 1 }, { id: 3, number: 1 }])).toEqual([])
  })
})

describe('Trakt’s episodes as Flow’s', () => {
  it('reads the season and episode, and the day of the air time', () => {
    expect(
      fromTrakt([
        // The season's own number stands in for an episode that doesn't repeat it.
        { number: 1, episodes: [{ season: 1, number: 1, title: 'Pilot', overview: 'First.', first_aired: '2008-01-21T02:00:00.000Z', runtime: 58, ids: { trakt: 73640 } }, { number: 2 }, {}] },
        { number: 2, episodes: [{ number: 1, title: null }] },
        { number: 3 },
      ]),
    ).toEqual([
      { id: 73640, season: 1, number: 1, name: 'Pilot', overview: 'First.', airDate: '2008-01-21', runtime: 58 },
      { id: 1002, season: 1, number: 2, name: 'Episode 2', overview: '', airDate: undefined, runtime: undefined },
      { id: 2001, season: 2, number: 1, name: 'Episode 1', overview: '', airDate: undefined, runtime: undefined },
    ])
  })
})

describe('matching TMDB’s pictures to another numbering', () => {
  const tvdb: Episode[] = [
    { id: 1, season: 2, number: 1, name: 'Part One', overview: '', still: 'https://artworks.thetvdb.com/a.jpg' },
    { id: 2, season: 1, number: 1, name: 'Pilot', overview: 'TVDB words', still: 'https://artworks.thetvdb.com/b.jpg', runtime: 58 },
    { id: 3, season: 1, number: 2, name: 'Two', overview: '' },
  ]

  it('takes TMDB’s still, score, runtime and synopsis where the numbering lines up and the other source has none', () => {
    const out = withTMDB(tvdb, [tmdb(1, 1, { still: '/t11.jpg', rating: 8.4, runtime: 47, overview: 'TMDB words' }), tmdb(1, 2, { still: '/t12.jpg', overview: 'Second.', runtime: 44 })])
    expect(out.find((e) => e.id === 2)).toMatchObject({ name: 'Pilot', still: '/t11.jpg', rating: 8.4, runtime: 58, overview: 'TVDB words' })
    expect(out.find((e) => e.id === 3)).toMatchObject({ name: 'Two', still: '/t12.jpg', overview: 'Second.', runtime: 44 })
  })

  it('keeps the other source’s own picture where TMDB has no episode with that number', () => {
    const out = withTMDB(tvdb, [tmdb(1, 1, { still: '/t11.jpg' })])
    expect(out.find((e) => e.id === 1)).toMatchObject({ still: 'https://artworks.thetvdb.com/a.jpg', name: 'Part One' })
  })

  it('keeps its own picture when TMDB’s episode has none', () => {
    expect(withTMDB(tvdb, [tmdb(1, 1)]).find((e) => e.id === 2)!.still).toBe('https://artworks.thetvdb.com/b.jpg')
  })

  it('puts the episodes in season and episode order', () => {
    expect(withTMDB(tvdb, []).map((e) => e.id)).toEqual([2, 3, 1])
  })

  it('groups by season, each in order, specials as season 0', () => {
    const by = bySeason([tmdb(2, 2), tmdb(1, 1), tmdb(0, 1), tmdb(2, 1)])
    expect(Object.keys(by)).toEqual(['0', '1', '2'])
    expect(by[2]!.map((e) => e.number)).toEqual([1, 2])
  })
})

describe('TVDB’s languages', () => {
  it('maps the viewer’s language to a three-letter code, English when unknown', () => {
    expect(['en-US', 'pt-BR', 'ja', 'nb-NO', 'zh-TW', 'xx-XX', ''].map(tvdbLanguage)).toEqual(['eng', 'por', 'jpn', 'nor', 'zho', 'eng', 'eng'])
  })
})

describe('asking TVDB', () => {
  interface Call {
    url: string
    method?: string
    auth?: string
    body?: string
  }
  /** TVDB with `episodes` split into pages, accepting only `token`. */
  function tvdb(pages: TVDBEpisode[][], { token = 'T1', accepts = ['T1'], key = 'good' }: { token?: string; accepts?: string[]; key?: string } = {}) {
    const calls: Call[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      calls.push({ url, method: init?.method, auth: headers?.Authorization, body: init?.body as string | undefined })
      if (url.endsWith('/login')) return JSON.parse(String(init?.body)).apikey === key ? json({ data: { token } }) : json({ Message: 'Invalid credentials' }, 401)
      if (!accepts.includes(headers?.Authorization?.replace('Bearer ', '') ?? '')) return json({}, 401)
      const page = Number(new URL(url).searchParams.get('page'))
      return json({ data: { episodes: pages[page] ?? [] }, links: { next: page + 1 < pages.length ? `x?page=${page + 1}` : null } })
    }) as unknown as typeof fetch
    return { calls, fetchImpl }
  }

  const ep = (n: number): TVDBEpisode => ({ id: n, seasonNumber: 1, number: n })

  it('logs in once with the project key, then reads every page in order', async () => {
    const { calls, fetchImpl } = tvdb([[ep(1), ep(2)], [ep(3)]])
    const all = await tvdbEpisodes(81189, 'good', 'eng', { fetchImpl })
    expect(all.map((e) => e.id)).toEqual([1, 2, 3])
    expect(calls[0]).toMatchObject({ url: 'https://api4.thetvdb.com/v4/login', method: 'POST', body: JSON.stringify({ apikey: 'good' }) })
    expect(calls.slice(1).map((c) => c.url)).toEqual(['https://api4.thetvdb.com/v4/series/81189/episodes/default/eng?page=0', 'https://api4.thetvdb.com/v4/series/81189/episodes/default/eng?page=1'])
    expect(calls.slice(1).every((c) => c.auth === 'Bearer T1')).toBe(true)
    // The token is reused for the next series.
    await tvdbEpisodes(5, 'good', 'eng', { fetchImpl })
    expect(calls.filter((c) => c.url.endsWith('/login'))).toHaveLength(1)
  })

  it('logs in again once when the token has gone stale', async () => {
    const first = tvdb([[ep(1)]])
    await tvdbEpisodes(1, 'good', 'eng', { fetchImpl: first.fetchImpl })
    const { calls, fetchImpl } = tvdb([[ep(1)]], { token: 'T2', accepts: ['T2'] })
    expect((await tvdbEpisodes(1, 'good', 'eng', { fetchImpl })).map((e) => e.id)).toEqual([1])
    expect(calls.map((c) => c.auth ?? c.method)).toEqual(['Bearer T1', 'POST', 'Bearer T2'])
  })

  it('reads a series TVDB doesn’t know as no episodes', async () => {
    const fetchImpl = (async (url: string) => (url.endsWith('/login') ? json({ data: { token: 'T9' } }) : json({ message: 'not found' }, 404))) as unknown as typeof fetch
    expect(await tvdbEpisodes(0, 'good9', 'eng', { fetchImpl })).toEqual([])
  })

  it('says what to do about a refused key, without repeating it', async () => {
    const { fetchImpl } = tvdb([], { key: 'other' })
    const error = await tvdbEpisodes(1, 'wrong-key', 'eng', { fetchImpl }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TVDBError)
    expect((error as TVDBError).kind).toBe('key')
    expect((error as TVDBError).message).not.toContain('wrong-key')
  })

  it('checks a key by logging in', async () => {
    const { fetchImpl } = tvdb([])
    expect(await checkTVDBKey(' good ', { fetchImpl })).toEqual({ ok: true })
    expect(await checkTVDBKey('nope', { fetchImpl })).toMatchObject({ ok: false, error: expect.stringContaining('didn’t accept') })
    expect(await checkTVDBKey('', { fetchImpl })).toMatchObject({ ok: false })
  })

  it('says it couldn’t reach TVDB when the request fails', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await checkTVDBKey('good', { fetchImpl })).toMatchObject({ ok: false, error: expect.stringContaining('Couldn’t reach api4.thetvdb.com') })
  })
})
