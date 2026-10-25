import { describe, expect, it } from 'vitest'
import opensubtitlesDownload from './__fixtures__/opensubtitles-download.json'
import opensubtitlesQuota from './__fixtures__/opensubtitles-quota.json'
import opensubtitlesSearch from './__fixtures__/opensubtitles-search.json'
import subdlSearch from './__fixtures__/subdl-search.json'
import subsourceMovie from './__fixtures__/subsource-movie.json'
import subsourceSubtitles from './__fixtures__/subsource-subtitles.json'
import wyzieSearch from './__fixtures__/wyzie-search.json'
import { openSubtitlesSearchURL, parseOpenSubtitles, parseOpenSubtitlesLink, parseSubDL, parseSubSource, parseSubSourceMovie, parseWyzie, providers, subdlSearchURL, subSourceListURL, subSourceMovieURL, wyzieSearchURL } from './providers'
import { SubtitleError, type SubtitleQuery } from './types'

const movie: SubtitleQuery = { type: 'movie', tmdbId: 693134, imdbId: 'tt15239678', languages: ['en', 'pt'] }
const episode: SubtitleQuery = { type: 'show', tmdbId: 1399, imdbId: 'tt0944947', season: 2, episode: 3, languages: ['en'] }

const params = (url: string) => Object.fromEntries(new URL(url).searchParams)

describe('OpenSubtitles', () => {
  it('asks for a film by its TMDB id, with the parameters in alphabetical order', () => {
    const url = openSubtitlesSearchURL(movie)
    expect(url).toBe('https://api.opensubtitles.com/api/v1/subtitles?languages=en%2Cpt&tmdb_id=693134&type=movie')
    // Any other order is answered with a redirect, which costs a second preflight from a web page.
    const keys = [...new URL(url).searchParams.keys()]
    expect(keys).toEqual([...keys].sort())
  })

  it('asks for an episode through the show’s id', () => {
    const url = openSubtitlesSearchURL(episode)
    expect(params(url)).toEqual({ episode_number: '3', languages: 'en', parent_tmdb_id: '1399', season_number: '2', type: 'episode' })
    const keys = [...new URL(url).searchParams.keys()]
    expect(keys).toEqual([...keys].sort())
  })

  it('reads the list: file id, language, release, SDH and downloads; skips entries with no file', () => {
    const found = parseOpenSubtitles(opensubtitlesSearch)
    expect(found.map((r) => r.id)).toEqual(['os-8847112', 'os-8847113', 'os-8847114'])
    expect(found[0]).toEqual({
      id: 'os-8847112',
      provider: 'opensubtitles',
      language: 'en',
      languageName: 'English',
      release: 'Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.Atmos.H.264-FLUX',
      hearingImpaired: false,
      downloads: 48210,
      token: '8847112',
    })
    expect(found[1]!.hearingImpaired).toBe(true)
    expect(found[2]).toMatchObject({ language: 'pt-BR', languageName: 'Brazilian Portuguese' })
  })

  it('reads the download link, and says when there is none', () => {
    expect(parseOpenSubtitlesLink(opensubtitlesDownload)).toMatch(/^https:\/\/www\.opensubtitles\.com\/download\//)
    expect(() => parseOpenSubtitlesLink({ message: 'nope' })).toThrow(SubtitleError)
  })

  it('needs the API key and sends it as the Api-Key header, never a login token a page can’t send', async () => {
    expect(providers.opensubtitles.ready({})).toBe(false)
    expect(providers.opensubtitles.ready({ openSubtitlesKey: '  ' })).toBe(false)
    const calls: { url: string; init?: RequestInit }[] = []
    const fetch = async (url: string, init?: RequestInit) => (calls.push({ url, init }), new Response(JSON.stringify(opensubtitlesDownload)))
    const found = await providers.opensubtitles.locate(parseOpenSubtitles(opensubtitlesSearch)[0]!, { openSubtitlesKey: 'KEY', openSubtitlesUsername: 'me', openSubtitlesPassword: 'secret' }, { fetch })
    expect(found.url).toContain('opensubtitles.com/download')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.opensubtitles.com/api/v1/download')
    expect(calls[0]!.init?.method).toBe('POST')
    expect(calls[0]!.init?.body).toBe('{"file_id":8847112}')
    const headers = calls[0]!.init?.headers as Record<string, string>
    expect(headers['Api-Key']).toBe('KEY')
    // The wildcard in OpenSubtitles' Access-Control-Allow-Headers doesn't cover Authorization.
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization')
  })
})

describe('SubDL', () => {
  it('asks by TMDB id with the key in the address, languages in capitals', () => {
    expect(params(subdlSearchURL(movie, 'k'))).toEqual({ api_key: 'k', tmdb_id: '693134', type: 'movie', languages: 'EN,PT', subs_per_page: '30' })
    expect(params(subdlSearchURL(episode, 'k'))).toMatchObject({ type: 'tv', season_number: '2', episode_number: '3' })
  })

  it('reads the code from whichever field holds it, and the hearing-impaired flag', () => {
    const found = parseSubDL(subdlSearch)
    expect(found.map((r) => r.id)).toEqual(['subdl-/subtitle/3417622-3417622.zip', 'subdl-/subtitle/3417700-3417700.zip', 'subdl-/subtitle/3417811-3417811.zip'])
    expect(found[0]).toMatchObject({ provider: 'subdl', language: 'EN', languageName: 'English', release: 'Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.Atmos.H.264-FLUX', hearingImpaired: false, token: '/subtitle/3417622-3417622.zip' })
    expect(found[1]!.hearingImpaired).toBe(true)
    expect(found[2]).toMatchObject({ language: 'ES', languageName: 'Spanish' })
  })

  it('finds the file on dl.subdl.com', async () => {
    const where = await providers.subdl.locate(parseSubDL(subdlSearch)[0]!, {}, { fetch: async () => new Response() })
    expect(where).toEqual({ url: 'https://dl.subdl.com/subtitle/3417622-3417622.zip' })
  })

  it('tells a refused key from a title it doesn’t know', async () => {
    const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })
    await expect(providers.subdl.search(movie, { subdlKey: 'k' }, { fetch: answer(403, { status: false, error: 'not_authorized', message: 'Not Authorized' }) })).rejects.toMatchObject({ kind: 'key' })
    await expect(providers.subdl.search(movie, { subdlKey: 'k' }, { fetch: answer(200, { status: false, error: "can't find movie or tv" }) })).resolves.toEqual([])
  })
})

describe('Wyzie', () => {
  it('asks sub.wyzie.io, with the key when there is one', () => {
    expect(wyzieSearchURL(movie, 'k')).toBe('https://sub.wyzie.io/search?id=693134&language=en%2Cpt&format=srt&key=k')
    expect(wyzieSearchURL(episode, '')).toBe('https://sub.wyzie.io/search?id=1399&language=en&format=srt&season=2&episode=3')
  })

  it('reads the list; a result with no link is skipped', () => {
    const found = parseWyzie(wyzieSearch)
    expect(found).toHaveLength(2)
    expect(found[0]).toEqual({
      id: 'wyzie-1962054623',
      provider: 'wyzie',
      language: 'en',
      languageName: 'English',
      release: 'Dune.Part.Two.2024.1080p.WEB-DL',
      hearingImpaired: false,
      downloads: 3100,
      token: 'https://sub.wyzie.io/c/6d1f0b4a/id/1962054623?format=srt&encoding=utf-8',
    })
    expect(found[1]).toMatchObject({ language: 'es', hearingImpaired: true, release: 'Dune: Part Two (2024)' })
    expect(parseWyzie({ not: 'a list' })).toEqual([])
  })

  it('names the new key rule when it answers 401', async () => {
    const refused = async () => new Response(JSON.stringify({ code: 401, message: 'API key required' }), { status: 401 })
    await expect(providers.wyzie.search(movie, { wyzieKey: 'k' }, { fetch: refused })).rejects.toThrow(/free key/)
    expect(providers.wyzie.ready({})).toBe(false)
    expect(providers.wyzie.ready({ wyzieKey: 'k' })).toBe(true)
  })
})

describe('SubSource', () => {
  it('looks the title up by IMDb id, then lists each language by its name', () => {
    expect(subSourceMovieURL('tt0944947', 2)).toBe('https://api.subsource.net/api/v1/movies/search?searchType=imdb&imdb=tt0944947&season=2')
    expect(subSourceMovieURL('tt15239678')).toBe('https://api.subsource.net/api/v1/movies/search?searchType=imdb&imdb=tt15239678')
    expect(subSourceListURL('mv_7731', 'english')).toBe('https://api.subsource.net/api/v1/subtitles?movieId=mv_7731&language=english')
    expect(parseSubSourceMovie(subsourceMovie)).toBe('mv_7731')
    expect(parseSubSourceMovie([{ movieId: 4 }])).toBe('4')
    expect(parseSubSourceMovie({ data: [] })).toBeUndefined()
  })

  it('keeps the episode asked for and drops the others', () => {
    const found = parseSubSource(subsourceSubtitles, 'en', { season: 2, episode: 3 })
    // S02E04 is another episode; "2x03" is this one; a season pack names no episode, so it stays.
    expect(found.map((r) => r.id)).toEqual(['subsource-ss_9001', 'subsource-ss_9003', 'subsource-ss_9004'])
    expect(found[1]).toMatchObject({ hearingImpaired: true, downloads: 55, language: 'en', languageName: 'English' })
    expect(parseSubSource(subsourceSubtitles, 'en')).toHaveLength(4)
  })

  it('says a web page can’t read it when the browser refuses the request', async () => {
    const blocked = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(providers.subsource.search(movie, { subSourceKey: 'k' }, { fetch: blocked })).rejects.toMatchObject({ kind: 'blocked', message: expect.stringMatching(/web pages/) })
  })

  it('sends the key as X-API-Key, for the search and for the download', async () => {
    const seen: (HeadersInit | undefined)[] = []
    const fetch = async (url: string, init?: RequestInit) => {
      seen.push(init?.headers)
      return new Response(JSON.stringify(url.includes('/movies/') ? subsourceMovie : subsourceSubtitles))
    }
    await providers.subsource.search({ ...movie, languages: ['en'] }, { subSourceKey: 'KEY' }, { fetch })
    expect(seen.every((h) => (h as Record<string, string>)['X-API-Key'] === 'KEY')).toBe(true)
    const where = await providers.subsource.locate({ id: 's', provider: 'subsource', language: 'en', languageName: 'English', release: '', hearingImpaired: false, token: 'ss_9001' }, { subSourceKey: 'KEY' }, { fetch })
    expect(where).toEqual({ url: 'https://api.subsource.net/api/v1/subtitles/ss_9001/download', headers: { 'X-API-Key': 'KEY' } })
  })

  it('has nothing to ask without an IMDb id', async () => {
    await expect(providers.subsource.search({ ...movie, imdbId: undefined }, { subSourceKey: 'k' }, { fetch: async () => new Response('{}') })).resolves.toEqual([])
  })
})

describe('what goes wrong', () => {
  const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })

  it('says to check the key when a service refuses it', async () => {
    await expect(providers.opensubtitles.search(movie, { openSubtitlesKey: 'k' }, { fetch: answer(401, { message: 'invalid' }) })).rejects.toMatchObject({ kind: 'key', message: expect.stringMatching(/Settings → Playback/) })
  })

  it('reports a used-up day with the service’s own words', async () => {
    await expect(providers.opensubtitles.locate(parseOpenSubtitles(opensubtitlesSearch)[0]!, { openSubtitlesKey: 'k' }, { fetch: answer(406, opensubtitlesQuota) })).rejects.toMatchObject({
      kind: 'limit',
      message: 'OpenSubtitles: You have downloaded your allowed 5 subtitles for today.',
    })
  })

  it('says to check the connection when nothing answers', async () => {
    const down = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(providers.subdl.search(movie, { subdlKey: 'k' }, { fetch: down })).rejects.toMatchObject({ kind: 'network', message: expect.stringMatching(/Couldn’t reach SubDL/) })
  })

  it('does not swallow a cancelled search', async () => {
    const controller = new AbortController()
    controller.abort()
    const aborted = async () => {
      throw new DOMException('Aborted', 'AbortError')
    }
    await expect(providers.subdl.search(movie, { subdlKey: 'k' }, { fetch: aborted, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
