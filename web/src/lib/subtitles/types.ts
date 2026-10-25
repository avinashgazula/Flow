/* Subtitle search: what is asked of the four services and what comes back. Ported from FlowKit's
   Subtitles.swift (SubtitleTrackInfo, the providers and SubtitleSearch), with the same ids, names and ranking. */

export type ProviderId = 'opensubtitles' | 'subdl' | 'wyzie' | 'subsource'

/** In the order the apps list them. */
export const providerIds: readonly ProviderId[] = ['opensubtitles', 'subdl', 'wyzie', 'subsource']

export const providerNames: Record<ProviderId, string> = { opensubtitles: 'OpenSubtitles', subdl: 'SubDL', wyzie: 'Wyzie', subsource: 'SubSource' }

/** The title being watched, as the services want to be asked about it. */
export interface SubtitleQuery {
  type: 'movie' | 'show'
  tmdbId: number
  imdbId?: string
  /** Both set for an episode. */
  season?: number
  episode?: number
  /** Two-letter codes, most wanted first. */
  languages: string[]
}

/** The keys and logins the viewer saved. A service without its key isn't asked. */
export interface Credentials {
  openSubtitlesKey?: string
  openSubtitlesUsername?: string
  openSubtitlesPassword?: string
  subdlKey?: string
  subSourceKey?: string
  wyzieKey?: string
}

/** One subtitle a service offers (FlowKit's SubtitleTrackInfo). */
export interface SubtitleResult {
  /** "os-123", "subdl-/subtitle/1-2.zip": unique across services. */
  id: string
  provider: ProviderId
  /** As the service writes it ("en", "pt-BR"). */
  language: string
  languageName: string
  release: string
  hearingImpaired: boolean
  downloads?: number
  /** What the service needs back to hand the file over: a file id, a path, a link. */
  token: string
}

export type SubtitleFailure =
  /** The key was refused, or the service says it isn't allowed. */
  | 'key'
  /** The service sends no CORS headers, so a web page can't read what it says. */
  | 'blocked'
  /** A daily limit or rate limit. */
  | 'limit'
  | 'network'
  | 'other'

/** A failure with words for the viewer: what happened and what to do next. */
export class SubtitleError extends Error {
  constructor(
    message: string,
    readonly kind: SubtitleFailure = 'other',
  ) {
    super(message)
    this.name = 'SubtitleError'
  }
}

/** The way a provider's calls are made: `fetch`, or a stand-in in tests. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>
