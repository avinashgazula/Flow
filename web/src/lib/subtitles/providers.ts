/* The four subtitle services, ported from FlowKit's Subtitles.swift: how each is asked, and how its answer
   becomes a list of SubtitleResult. Requests are built and answers read by pure functions (tested on recorded
   answers); `search` and `locate` only carry them out with a `fetch`.

   What a web page can do differs from the apps, and each difference is checked against the live services:
   - OpenSubtitles sends `Access-Control-Allow-Origin: *`, and allows the headers a preflight asks for except
     Authorization (a wildcard never covers that one), so the page asks with the API key alone and not the
     login's token. The file's link is on www.opensubtitles.com, which sends no CORS headers: the file is
     fetched through the stream proxy (download.ts).
   - SubDL allows every origin, for its API and its files.
   - Wyzie allows every origin, but now wants a free key (the `key` parameter) and lives at sub.wyzie.io;
     the apps still ask sub.wyzie.ru without one, which redirects there and is refused.
   - SubSource sends no Access-Control-Allow-Origin at all, and its key is a header the stream proxy
     doesn't pass on, so a web page can't read it. It is asked anyway, and says so when the browser refuses. */

import { episodeIn } from './episode'
import { languageCodeOf, subtitleLanguageName } from './names'
import { hasCredentials } from './options'
import { SubtitleError, providerNames, type Credentials, type Fetch, type ProviderId, type SubtitleQuery, type SubtitleResult } from './types'

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined)
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export interface Io {
  fetch: Fetch
  signal?: AbortSignal
}

/** What a request for a subtitle file carries and where it goes. */
export interface Location {
  url: string
  headers?: Record<string, string>
}

export interface Provider {
  id: ProviderId
  /** True when the viewer has what this service needs. */
  ready(credentials: Credentials): boolean
  search(query: SubtitleQuery, credentials: Credentials, io: Io): Promise<SubtitleResult[]>
  /** Where the file for a result is. Most are a plain address; OpenSubtitles asks for a one-time link first. */
  locate(result: SubtitleResult, credentials: Credentials, io: Io): Promise<Location>
}

// MARK: Calling a service

const settingsWhere = 'Settings → Playback'

/** One call, with the words for what can go wrong. */
async function call(provider: ProviderId, io: Io, url: string, init?: RequestInit): Promise<unknown> {
  const name = providerNames[provider]
  let response: Response
  try {
    response = await io.fetch(url, { ...init, signal: io.signal, credentials: 'omit' })
  } catch (error) {
    if (io.signal?.aborted || (error as Error)?.name === 'AbortError') throw error
    if (provider === 'subsource') {
      throw new SubtitleError('SubSource doesn’t let web pages read its answers, and its key is a header a stream proxy can’t pass on, so it can only be used in the apps.', 'blocked')
    }
    throw new SubtitleError(`Couldn’t reach ${name}. Check your connection, and that nothing in your browser blocks it.`, 'network')
  }
  if (response.ok) {
    try {
      return await response.json()
    } catch {
      throw new SubtitleError(`${name} didn’t answer with the data Flow expected. Try again in a moment.`)
    }
  }
  const body = await response.json().catch(() => undefined)
  const said = isObject(body) ? (text(body.message) ?? text(body.error)) : undefined
  if (response.status === 401 || response.status === 403) throw new SubtitleError(`${name} didn’t accept the API key. Check it in ${settingsWhere}.`, 'key')
  // OpenSubtitles answers 406 when the day's downloads are used up; the others use 429 for too many requests.
  if (response.status === 406 || response.status === 429) throw new SubtitleError(said ? `${name}: ${said}` : `${name} says you’ve asked too often. Try again later.`, 'limit')
  if (response.status >= 500) throw new SubtitleError(`${name} had a problem (${response.status}). Try again in a moment.`)
  throw new SubtitleError(said ? `${name}: ${said}` : `${name} answered ${response.status}.`)
}

// MARK: OpenSubtitles

const osBase = 'https://api.opensubtitles.com/api/v1'

/** The search address. The parameters are in alphabetical order, which is how OpenSubtitles writes them:
 *  any other order is answered with a redirect to that one, and a redirect costs a second preflight. */
export function openSubtitlesSearchURL(q: SubtitleQuery): string {
  const params: Record<string, string> = { languages: q.languages.map((l) => l.toLowerCase()).join(',') }
  if (q.season !== undefined && q.episode !== undefined) {
    params.parent_tmdb_id = String(q.tmdbId)
    params.season_number = String(q.season)
    params.episode_number = String(q.episode)
    params.type = 'episode'
  } else {
    params.tmdb_id = String(q.tmdbId)
    params.type = 'movie'
  }
  return `${osBase}/subtitles?${Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k]!)}`)
    .join('&')}`
}

export function parseOpenSubtitles(json: unknown): SubtitleResult[] {
  if (!isObject(json)) return []
  const out: SubtitleResult[] = []
  for (const entry of list(json.data)) {
    const a = isObject(entry) && isObject(entry.attributes) ? entry.attributes : undefined
    const file = list(a?.files).find(isObject)
    const fileID = isObject(file) ? text(file.file_id) : undefined
    const language = text(a?.language)
    if (!a || !fileID || !language) continue
    out.push({
      id: `os-${fileID}`,
      provider: 'opensubtitles',
      language,
      languageName: subtitleLanguageName(language),
      release: text(a.release) ?? '',
      hearingImpaired: a.hearing_impaired === true,
      downloads: count(a.download_count),
      token: fileID,
    })
  }
  return out
}

/** The one-time link a file is at, from the answer to a download request. */
export function parseOpenSubtitlesLink(json: unknown): string {
  const link = isObject(json) ? text(json.link) : undefined
  if (!link) throw new SubtitleError('OpenSubtitles didn’t give a link for that subtitle. Try again, or choose another.')
  return link
}

const openSubtitles: Provider = {
  id: 'opensubtitles',
  ready: (c) => hasCredentials('opensubtitles', c),
  async search(q, c, io) {
    const json = await call('opensubtitles', io, openSubtitlesSearchURL(q), { headers: { 'Api-Key': c.openSubtitlesKey!.trim(), Accept: 'application/json' } })
    return parseOpenSubtitles(json)
  },
  async locate(result, c, io) {
    const json = await call('opensubtitles', io, `${osBase}/download`, {
      method: 'POST',
      headers: { 'Api-Key': c.openSubtitlesKey!.trim(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ file_id: Number(result.token) || 0 }),
    })
    return { url: parseOpenSubtitlesLink(json) }
  },
}

// MARK: SubDL

export function subdlSearchURL(q: SubtitleQuery, apiKey: string): string {
  const params: Record<string, string> = {
    api_key: apiKey,
    tmdb_id: String(q.tmdbId),
    type: q.type === 'movie' ? 'movie' : 'tv',
    languages: q.languages.map((l) => l.toUpperCase()).join(','),
    subs_per_page: '30',
  }
  if (q.season !== undefined && q.episode !== undefined) {
    params.season_number = String(q.season)
    params.episode_number = String(q.episode)
  }
  return `https://api.subdl.com/api/v1/subtitles?${Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')}`
}

export function parseSubDL(json: unknown): SubtitleResult[] {
  if (!isObject(json)) return []
  const out: SubtitleResult[] = []
  for (const e of list(json.subtitles)) {
    if (!isObject(e)) continue
    const path = text(e.url)
    if (!path) continue
    // SubDL has written the code in one of these two fields and the name in the other.
    const language = languageCodeOf(text(e.lang), text(e.language))
    out.push({
      id: `subdl-${path}`,
      provider: 'subdl',
      language,
      languageName: subtitleLanguageName(language),
      release: text(e.release_name) ?? text(e.name) ?? '',
      hearingImpaired: e.hi === true,
      token: path,
    })
  }
  return out
}

const subdl: Provider = {
  id: 'subdl',
  ready: (c) => hasCredentials('subdl', c),
  async search(q, c, io) {
    const json = await call('subdl', io, subdlSearchURL(q, c.subdlKey!.trim()))
    // A title SubDL doesn't know comes back as status false with a sentence, not as an empty list.
    if (isObject(json) && json.status === false && /api|key|author/i.test(text(json.error) ?? text(json.message) ?? '')) {
      throw new SubtitleError('SubDL didn’t accept the API key. Check it in Settings → Playback.', 'key')
    }
    return parseSubDL(json)
  },
  async locate(result) {
    return { url: `https://dl.subdl.com${result.token.startsWith('/') ? '' : '/'}${result.token}` }
  },
}

// MARK: Wyzie

/** Wyzie moved from sub.wyzie.ru to sub.wyzie.io and asks for a key; both are in the address. */
export function wyzieSearchURL(q: SubtitleQuery, key: string): string | undefined {
  const mediaID = q.tmdbId ? String(q.tmdbId) : q.imdbId
  if (!mediaID) return undefined
  const params: Record<string, string> = { id: mediaID, language: q.languages.join(','), format: 'srt' }
  if (q.season !== undefined && q.episode !== undefined) {
    params.season = String(q.season)
    params.episode = String(q.episode)
  }
  if (key) params.key = key
  return `https://sub.wyzie.io/search?${Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')}`
}

export function parseWyzie(json: unknown): SubtitleResult[] {
  const out: SubtitleResult[] = []
  for (const e of list(json)) {
    if (!isObject(e)) continue
    const url = text(e.url)
    if (!url) continue
    const language = languageCodeOf(text(e.language), text(e.display))
    out.push({
      id: `wyzie-${text(e.id) ?? url}`,
      provider: 'wyzie',
      language,
      languageName: text(e.display) ?? subtitleLanguageName(language),
      release: text(e.release) ?? text(e.media) ?? text(e.fileName) ?? '',
      hearingImpaired: e.isHearingImpaired === true,
      downloads: count(e.downloadCount),
      token: url,
    })
  }
  return out
}

const wyzie: Provider = {
  id: 'wyzie',
  ready: (c) => hasCredentials('wyzie', c),
  async search(q, c, io) {
    const url = wyzieSearchURL(q, c.wyzieKey?.trim() ?? '')
    if (!url) return []
    try {
      return parseWyzie(await call('wyzie', io, url))
    } catch (error) {
      if (error instanceof SubtitleError && error.kind === 'key') throw new SubtitleError('Wyzie needs a free key now. Claim one at store.wyzie.io/redeem and add it in Settings → Playback.', 'key')
      throw error
    }
  },
  async locate(result) {
    return { url: result.token }
  },
}

// MARK: SubSource

const ssBase = 'https://api.subsource.net/api/v1'

export function subSourceMovieURL(imdb: string, season?: number): string {
  return `${ssBase}/movies/search?searchType=imdb&imdb=${encodeURIComponent(imdb)}${season !== undefined ? `&season=${season}` : ''}`
}

export function subSourceListURL(movieId: string, language: string): string {
  return `${ssBase}/subtitles?movieId=${encodeURIComponent(movieId)}&language=${encodeURIComponent(language)}`
}

/** The id of the title in the answer to a search by IMDb id. */
export function parseSubSourceMovie(json: unknown): string | undefined {
  const first = isObject(json) ? (list(json.data)[0] ?? undefined) : list(json)[0]
  return isObject(first) ? text(first.movieId) : undefined
}

/** One language's list. An episode whose release names another episode is dropped; the services list a whole season together. */
export function parseSubSource(json: unknown, language: string, episode?: { season: number; episode: number }): SubtitleResult[] {
  if (!isObject(json)) return []
  const out: SubtitleResult[] = []
  for (const e of list(json.data)) {
    if (!isObject(e)) continue
    const id = text(e.subtitleId)
    if (!id) continue
    const release = text(e.releaseInfo) ?? text(e.release_info) ?? ''
    const named = episode ? episodeIn(release) : undefined
    if (episode && named && (named.season !== episode.season || named.episode !== episode.episode)) continue
    out.push({
      id: `subsource-${id}`,
      provider: 'subsource',
      language,
      languageName: subtitleLanguageName(language),
      release,
      hearingImpaired: e.hearingImpaired === true,
      downloads: count(e.downloads),
      token: id,
    })
  }
  return out
}

const subsource: Provider = {
  id: 'subsource',
  ready: (c) => hasCredentials('subsource', c),
  async search(q, c, io) {
    if (!q.imdbId) return []
    const headers = { 'X-API-Key': c.subSourceKey!.trim(), Accept: 'application/json' }
    const movieId = parseSubSourceMovie(await call('subsource', io, subSourceMovieURL(q.imdbId, q.season), { headers }))
    if (!movieId) return []
    const episode = q.season !== undefined && q.episode !== undefined ? { season: q.season, episode: q.episode } : undefined
    const perLanguage = await Promise.all(
      q.languages.map(async (code) => parseSubSource(await call('subsource', io, subSourceListURL(movieId, subtitleLanguageName(code).toLowerCase()), { headers }), code, episode)),
    )
    return perLanguage.flat()
  },
  async locate(result, c) {
    return { url: `${ssBase}/subtitles/${encodeURIComponent(result.token)}/download`, headers: { 'X-API-Key': c.subSourceKey!.trim() } }
  },
}

export const providers: Record<ProviderId, Provider> = { opensubtitles: openSubtitles, subdl, wyzie, subsource }
