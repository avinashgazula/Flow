import { describe, expect, it } from 'vitest'
import { createSimklClient, readPlayback, readWatched, readWatchlist, tmdbOf, toList } from './simkl'

/* Simkl's answers in the shapes FlowKit's SimklClient reads, and the requests the page makes. */

describe('reading Simkl’s answers', () => {
  it('reads a TMDB id that is a number or numeric text, and nothing else', () => {
    expect(tmdbOf({ ids: { tmdb: 603 } })).toBe(603)
    expect(tmdbOf({ ids: { tmdb: '603' } })).toBe(603)
    for (const bad of [{ ids: { tmdb: '' } }, { ids: { tmdb: 'x' } }, { ids: { tmdb: 0 } }, { ids: {} }, { tmdb: 5 }, null, 'text']) expect(tmdbOf(bad)).toBeUndefined()
  })

  it('reads the plan-to-watch lists, skipping titles with no TMDB id', () => {
    const movies = { movies: [{ added_to_watchlist_at: '2026-10-02T00:00:00Z', status: 'plantowatch', movie: { title: 'Dune', year: 2021, ids: { simkl: 1, tmdb: '438631' } } }, { movie: { title: 'No id', ids: { simkl: 2 } } }] }
    const shows = { shows: [{ added_to_watchlist_at: '2026-10-03T00:00:00Z', show: { title: 'Severance', year: 2022, ids: { tmdb: 95396 } } }] }
    expect(readWatchlist(movies, shows)).toEqual([
      { type: 'movie', tmdb: 438631, title: 'Dune', year: 2021, at: Date.parse('2026-10-02T00:00:00Z') },
      { type: 'show', tmdb: 95396, title: 'Severance', year: 2022, at: Date.parse('2026-10-03T00:00:00Z') },
    ])
    expect(readWatchlist(null, null)).toEqual([])
  })

  it('makes the history from films’ last watch and every episode’s time, newest first and capped, with the shows’ episodes alongside', () => {
    const movies = { movies: [{ last_watched_at: '2026-10-01T00:00:00Z', movie: { title: 'Dune', ids: { tmdb: 2 } } }] }
    const shows = {
      shows: [
        {
          last_watched_at: '2026-10-06T00:00:00Z',
          show: { title: 'Severance', ids: { tmdb: 3 } },
          seasons: [{ number: 1, episodes: [{ number: 1, watched_at: '2026-10-04T00:00:00Z' }, { number: 2 }] }],
        },
        { show: { title: 'Planned', ids: { tmdb: 4 } } },
      ],
    }
    const all = readWatched(movies, shows, 10)
    expect(all.history.map((h) => [h.type, h.tmdb, h.season, h.episode])).toEqual([
      ['show', 3, 1, 2],
      ['show', 3, 1, 1],
      ['movie', 2, undefined, undefined],
    ])
    // An episode with no time of its own takes the show's last watch.
    expect(all.history[0]!.at).toBe(Date.parse('2026-10-06T00:00:00Z'))
    expect(all.shows.map((s) => [s.tmdb, s.episodes.length])).toEqual([[3, 2], [4, 0]])
    expect(readWatched(movies, shows, 1).history).toHaveLength(1)
    expect(readWatched(null, null, 5)).toEqual({ history: [], shows: [] })
  })

  it('reads resume points for films and episodes, whatever the id’s type', () => {
    const body = [
      { id: 9, progress: 40.5, paused_at: '2026-10-06T00:00:00Z', type: 'movie', movie: { title: 'Dune', ids: { tmdb: 2 } } },
      { id: '10', progress: 12, paused_at: '2026-10-07T00:00:00Z', type: 'episode', show: { title: 'Severance', ids: { tmdb: 3 } }, episode: { season: 1, number: 2, title: 'Half Loop' } },
      { id: 11, progress: 5, type: 'episode', show: { ids: { tmdb: 3 } }, episode: { season: 1, episode: 4 } },
      { id: 12, progress: 5, type: 'episode', show: { ids: { tmdb: 3 } } },
      { id: 'x', progress: 5, type: 'movie', movie: { ids: { tmdb: 2 } } },
    ]
    const out = readPlayback(body)
    expect(out.map((r) => [r.id, r.type, r.tmdb, r.season, r.episode, r.percent])).toEqual([
      [9, 'movie', 2, undefined, undefined, 40.5],
      [10, 'show', 3, 1, 2, 12],
      [11, 'show', 3, 1, 4, 5],
    ])
    expect(out[1]!.episodeTitle).toBe('Half Loop')
    expect(readPlayback(null)).toEqual([])
  })
})

describe('what is sent', () => {
  it('puts a title on the plan-to-watch list with the same body shape the other lists use', () => {
    expect(toList([{ type: 'movie', id: 1 }, { type: 'show', id: 2 }])).toEqual({ movies: [{ ids: { tmdb: 1 }, to: 'plantowatch' }], shows: [{ ids: { tmdb: 2 }, to: 'plantowatch' }] })
    expect(toList([])).toEqual({})
  })
})

interface Seen {
  url: URL
  init: RequestInit
}

function client(answer: (seen: Seen) => Response | Promise<Response> | 'offline', token: string | null = 'tok', clientID = 'cid') {
  const seen: Seen[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    const s = { url: new URL(url), init }
    seen.push(s)
    const out = await answer(s)
    if (out === 'offline') throw new TypeError('Failed to fetch')
    return out
  }) as typeof fetch
  return { seen, api: createSimklClient({ clientID: () => clientID, accessToken: () => token }, fetcher) }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('requests', () => {
  it('sends the Client ID in the address and the header, and the token as a Bearer, with no Content-Type on a GET', async () => {
    const { seen, api } = client(() => json([]))
    await api.playback()
    expect(seen[0]!.url.href).toBe('https://api.simkl.com/sync/playback?client_id=cid')
    expect(seen[0]!.init.headers).toEqual({ 'simkl-api-key': 'cid', Authorization: 'Bearer tok' })
  })

  it('sends a scrobble as JSON in the shape Trakt uses', async () => {
    const { seen, api } = client(() => json({}, 201))
    await api.scrobble('stop', { type: 'show', id: 3, season: 1, episode: 2 }, 91.234)
    expect(seen[0]!.url.pathname).toBe('/scrobble/stop')
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ show: { ids: { tmdb: 3 } }, episode: { season: 1, number: 2 }, progress: 91.23 })
    expect((seen[0]!.init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('asks for a PIN and polls it, with no token', async () => {
    const { seen, api } = client(({ url }) => (url.pathname === '/oauth/pin' ? json({ result: 'OK', user_code: 'AB12C', verification_url: 'https://simkl.com/pin', expires_in: 900, interval: 5 }) : json(seen.length > 2 ? { result: 'OK', access_token: 'secret' } : { result: 'KO', message: 'Authorization pending' })), null)
    expect(await api.startPin()).toEqual({ code: 'AB12C', url: 'https://simkl.com/pin', expiresIn: 900, interval: 5 })
    expect(await api.pollPin('AB12C')).toEqual({})
    expect(await api.pollPin('AB12C')).toEqual({ token: { accessToken: 'secret', refreshToken: null, expiresAt: null, redirectURI: null } })
    expect(seen.map((s) => s.url.pathname)).toEqual(['/oauth/pin', '/oauth/pin/AB12C', '/oauth/pin/AB12C'])
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('keeps the PIN flow for a Client ID that has one, never touching the device endpoints', async () => {
    const { seen, api } = client(() => json({ user_code: 'AB12C', expires_in: 900 }), null)
    await api.startPin()
    expect(seen.map((s) => s.url.pathname)).toEqual(['/oauth/pin'])
  })

  it('does not follow a verification address that is not https', async () => {
    const { api } = client(() => json({ user_code: 'X', verification_url: 'javascript:alert(1)' }), null)
    expect((await api.startPin()).url).toBe('https://simkl.com/pin')
  })

  it('reads an empty list, which Simkl sends as null', async () => {
    const { api } = client(() => new Response('null', { status: 200 }))
    expect(await api.watchlist()).toEqual([])
  })

  it('says in words what went wrong', async () => {
    const say = async (status: number | 'offline', token: string | null = 'tok', clientID = 'cid') => {
      const { api } = client(() => (status === 'offline' ? 'offline' : new Response('{}', { status })), token, clientID)
      return api.playback().catch((e: Error & { kind?: string }) => `${e.kind}: ${e.message}`)
    }
    expect(await say(412)).toBe('client-id: Simkl didn’t accept this app’s Client ID. Check it in Settings → Account.')
    expect(await say(401)).toBe('signed-out: Simkl ended this sign-in. Sign in again.')
    expect(await say(429)).toBe('rate: Simkl is busy. Marquee will try again in a moment.')
    expect(await say(503)).toBe('server: Simkl had a problem (503). Marquee will try again in a moment.')
    expect(await say(400)).toBe('rejected: Simkl didn’t accept that update (400).')
    expect(await say('offline')).toBe('network: Couldn’t reach Simkl. Check your connection.')
    expect(await say(200, null)).toBe('signed-out: Simkl ended this sign-in. Sign in again.')
    expect(await say(200, 'tok', '')).toBe('client-id: Add a Simkl Client ID in Settings → Account first.')
  })
})

const oauth2Only = { error: 'unauthorized_client', code: 400, message: 'This client_id is an OAuth 2.0 app: use POST /oauth2/device instead of /oauth/pin' }
const device = { device_code: 'd'.repeat(64), user_code: 'ZZ9Z-0AB1', verification_uri: 'https://simkl.com/pin', verification_uri_complete: 'https://simkl.com/pin?user_code=ZZ9Z-0AB1', expires_in: 900, interval: 5 }
const body = (s: Seen) => JSON.parse(String(s.init.body))

describe('an OAuth 2.0 app’s sign-in', () => {
  it('switches to the device flow when /oauth/pin turns the app away, and remembers the device code', async () => {
    const { seen, api } = client(({ url }) => (url.pathname === '/oauth/pin' ? json(oauth2Only, 400) : json(device)), null)
    expect(await api.startPin()).toEqual({ code: 'ZZ9Z-0AB1', deviceCode: 'd'.repeat(64), url: 'https://simkl.com/pin?user_code=ZZ9Z-0AB1', expiresIn: 900, interval: 5 })
    expect(seen.map((s) => `${s.init.method} ${s.url.pathname}`)).toEqual(['GET /oauth/pin', 'POST /oauth2/device'])
    expect(body(seen[1]!)).toEqual({ client_id: 'cid', scope: 'media:read media:write' })
    expect((seen[1]!.init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('switches on the message alone, and falls back to the PIN page when no address is given', async () => {
    const { api } = client(({ url }) => (url.pathname === '/oauth/pin' ? json({ message: 'use POST /oauth2/device' }, 400) : json({ device_code: 'dc', user_code: 'U' })), null)
    expect(await api.startPin()).toEqual({ code: 'U', deviceCode: 'dc', url: 'https://simkl.com/pin', expiresIn: 900, interval: 5 })
  })

  it('does not call another 400 an OAuth 2.0 app, and does not blame the Client ID for it', async () => {
    const { seen, api } = client(() => json({ error: 'invalid_request' }, 400), null)
    await expect(api.startPin()).rejects.toMatchObject({ kind: 'rejected', message: 'Simkl didn’t accept that update (400).' })
    expect(seen).toHaveLength(1)
  })

  it('says the Client ID is refused when the device start turns it down', async () => {
    const { api } = client(({ url }) => (url.pathname === '/oauth/pin' ? json(oauth2Only, 400) : json({ error: 'invalid_client' }, 401)), null)
    await expect(api.startPin()).rejects.toMatchObject({ kind: 'client-id' })
  })

  it('polls with the device code until Simkl hands over a token, which may carry a refresh token and an expiry', async () => {
    let n = 0
    const { seen, api } = client(() => (++n < 3 ? json({ error: 'authorization_pending', error_description: 'The user has not yet approved this device' }, 400) : json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'bearer' })), null)
    expect(await api.pollPin('U', 'dc')).toEqual({})
    expect(await api.pollPin('U', 'dc')).toEqual({})
    const done = await api.pollPin('U', 'dc')
    expect(done.token).toMatchObject({ accessToken: 'at', refreshToken: 'rt', redirectURI: null })
    expect(Date.parse(done.token!.expiresAt!) - Date.now()).toBeGreaterThan(3590_000)
    expect(seen[0]!.url.pathname).toBe('/oauth2/token')
    expect(body(seen[0]!)).toEqual({ client_id: 'cid', device_code: 'dc', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
  })

  it('takes a token with nothing but the access token', async () => {
    const { api } = client(() => json({ access_token: 'only' }), null)
    expect((await api.pollPin('U', 'dc')).token).toEqual({ accessToken: 'only', refreshToken: null, expiresAt: null, redirectURI: null })
  })

  it('reads expires_in sent as text, and ignores one that is not a number', async () => {
    const a = client(() => json({ access_token: 'x', expires_in: '120' }), null)
    expect(Date.parse((await a.api.pollPin('U', 'dc')).token!.expiresAt!) - Date.now()).toBeGreaterThan(110_000)
    const b = client(() => json({ access_token: 'x', expires_in: 'soon' }), null)
    expect((await b.api.pollPin('U', 'dc')).token!.expiresAt).toBeNull()
  })

  it('reports slow_down so the caller waits longer', async () => {
    const { api } = client(() => json({ error: 'slow_down' }, 400), null)
    expect(await api.pollPin('U', 'dc')).toEqual({ slowDown: true })
  })

  it('stops with a sentence for an expired code and for a declined sign-in', async () => {
    const expired = client(() => json({ error: 'expired_token' }, 400), null)
    await expect(expired.api.pollPin('U', 'dc')).rejects.toMatchObject({ kind: 'rejected', message: 'That code expired before it was approved. Start again from Settings → Account.' })
    const denied = client(() => json({ error: 'access_denied' }, 400), null)
    await expect(denied.api.pollPin('U', 'dc')).rejects.toMatchObject({ kind: 'rejected', message: expect.stringContaining('declined') })
  })

  it('refreshes with the refresh token, keeping the old one when Simkl sends no new one', async () => {
    const { seen, api } = client(() => json({ access_token: 'new', expires_in: 7200 }))
    const fresh = await api.refresh('rt')
    expect(fresh).toMatchObject({ accessToken: 'new', refreshToken: 'rt' })
    expect(body(seen[0]!)).toEqual({ client_id: 'cid', grant_type: 'refresh_token', refresh_token: 'rt' })
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('treats a refused refresh (400 or 401) as signed out', async () => {
    for (const status of [400, 401]) {
      const { api } = client(() => json({ error: 'invalid_grant' }, status))
      await expect(api.refresh('rt')).rejects.toMatchObject({ kind: 'signed-out', message: 'Simkl ended this sign-in. Sign in again.' })
    }
    const busy = client(() => json({}, 503))
    await expect(busy.api.refresh('rt')).rejects.toMatchObject({ kind: 'server' })
  })
})
