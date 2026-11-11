import { isLiveTVSettings } from '../../lib/livetv/validate'
import { isSportsSettings } from '../../lib/sports/types'
import { lastSourceStore } from '../../lib/sources/lastSource'
import { ratingSources } from '../../lib/ratings/sources'
import { proxyProblem } from '../../lib/sources/proxy'
import { baseURLProblem } from '../../lib/sources/skipBase'
import { isSourceOrdering, normaliseSourceOrdering } from '../../lib/sources/sourceSettings'
import { isSubtitleOptions, normaliseSubtitleOptions } from '../../lib/subtitles/options'
import { defaultSettings, settingsStore, type ExternalPlayerId, type Settings } from '../../lib/store/settings'
import { externalPlayerIds } from '../player/externalPlayers'
import { libraryStore, type Library } from '../../lib/store/library'
import { isTabOrder } from '../../lib/tabs'
import { isShelfList } from '../../lib/shelves'
import { isSubtitleStyle, normaliseSubtitleStyle } from '../../lib/store/subtitleStyle'
import { noExtras, setupExtrasStore } from '../../lib/setup/extras'

/* Export and import of everything Marquee keeps in this browser, as one JSON file. */

export const backupFormat = 'flow-web-backup'

export interface Backup {
  format: typeof backupFormat
  version: 1
  exportedAt: string
  settings: Partial<Settings>
  library: Partial<Library>
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const isHeroSource = (v: unknown) => ['trending', 'popular', 'watchlist'].includes(v as string)
const isSkipBehaviour = (v: unknown) => ['off', 'button', 'automatic'].includes(v as string)

/** The settings' keys that import accepts, with the type each must have. Anything else in the file is ignored. */
const settingTypes: { [K in keyof Settings]: (v: unknown) => boolean } = {
  tmdbKey: (v) => typeof v === 'string',
  traktClientID: (v) => typeof v === 'string',
  simklClientID: (v) => typeof v === 'string',
  traktAccount: (v) => v === null || (isObject(v) && typeof v.accessToken === 'string' && v.accessToken.length > 0 && [v.refreshToken, v.expiresAt, v.redirectURI].every((x) => x === null || typeof x === 'string')),
  simklAccount: (v) => v === null || (isObject(v) && typeof v.accessToken === 'string' && v.accessToken.length > 0 && [v.refreshToken, v.expiresAt, v.redirectURI].every((x) => x === null || typeof x === 'string')),
  tracker: (v) => ['trakt', 'simkl', 'publicMetaDB', 'mdblist', 'local'].includes(v as string),
  demo: (v) => typeof v === 'boolean',
  onboarded: (v) => typeof v === 'boolean',
  language: (v) => typeof v === 'string' && v.length > 0,
  region: (v) => typeof v === 'string' && v.length > 0,
  includeAdult: (v) => typeof v === 'boolean',
  addons: (v) => Array.isArray(v) && v.every((a) => isObject(a) && typeof a.url === 'string' && typeof a.name === 'string' && typeof a.enabled === 'boolean'),
  servers: (v) => Array.isArray(v) && v.every((s) => isObject(s) && typeof s.id === 'string' && typeof s.url === 'string' && typeof s.token === 'string' && ['jellyfin', 'emby', 'plex'].includes(s.kind as string)),
  // Media Servers' options and WebDAV shares (logins included, like the servers' tokens).
  showBadgeOnPosters: (v) => typeof v === 'boolean',
  onlyShowServerContent: (v) => typeof v === 'boolean',
  useServerArtwork: (v) => typeof v === 'boolean',
  trackOnlyWithTracker: (v) => typeof v === 'boolean',
  watchlistDestination: (v) => ['trakt', 'simkl', 'mdblist', 'local'].includes(v as string),
  favouritesDestination: (v) => ['trakt', 'simkl', 'mdblist', 'local'].includes(v as string),
  syncInterval: (v) => [0, 900, 3600, 10800, 43200, 86400].includes(v as number),
  scrobble: (v) => typeof v === 'boolean',
  serverHomeRowIDs: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0),
  webDAV: (v) =>
    Array.isArray(v) &&
    v.every((x) => isObject(x) && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.url === 'string' && typeof x.moviesPath === 'string' && typeof x.showsPath === 'string' && typeof x.enabled === 'boolean' && [x.username, x.password].every((f) => f === undefined || typeof f === 'string')),
  audioLanguages: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0),
  subtitleLanguages: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  subtitleMode: (v) => ['off', 'foreign', 'always', 'forced'].includes(v as string),
  // The apps' keys (fontScale, font, weight, color, edgeStyle, background, backgroundOpacity, verticalPosition).
  subtitleStyle: isSubtitleStyle,
  autoplayNext: (v) => typeof v === 'boolean',
  stillWatchingAfterEpisodes: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10,
  upNextWaitsForEnd: (v) => typeof v === 'boolean',
  skipIntro: isSkipBehaviour,
  skipRecap: isSkipBehaviour,
  skipCredits: isSkipBehaviour,
  introDBKey: (v) => typeof v === 'string',
  publicMetaDBKey: (v) => typeof v === 'string',
  mdblistKey: (v) => typeof v === 'string',
  tvdbKey: (v) => typeof v === 'string',
  rpdbKey: (v) => typeof v === 'string',
  episodeSource: (v) => ['tvdb', 'tmdb', 'trakt'].includes(v as string),
  ratingsShown: (v) => Array.isArray(v) && v.every((x) => (ratingSources as readonly unknown[]).includes(x)),
  tapRatingOpensReviews: (v) => typeof v === 'boolean',
  posterEnhancement: (v) => v === 'off' || v === 'rpdb',
  seerr: (v) => isObject(v) && typeof v.url === 'string' && typeof v.key === 'string',
  openSubtitlesKey: (v) => typeof v === 'string',
  openSubtitlesUsername: (v) => typeof v === 'string',
  openSubtitlesPassword: (v) => typeof v === 'string',
  subdlKey: (v) => typeof v === 'string',
  subSourceKey: (v) => typeof v === 'string',
  wyzieKey: (v) => typeof v === 'string',
  // Subtitle Type, Anime Audio, Keep Original ASS Styling and the services that are on; fields a backup lacks take their defaults.
  subtitleOptions: isSubtitleOptions,
  showUnreleasedTitles: (v) => typeof v === 'boolean',
  airDatesInLocalTimeZone: (v) => typeof v === 'boolean',
  prefetchOnDetail: (v) => typeof v === 'boolean',
  // Empty restores the public address; anything else has to be one Marquee can ask.
  introDBBaseURL: (v) => typeof v === 'string' && baseURLProblem(v) === undefined,
  publicMetaDBBaseURL: (v) => typeof v === 'string' && baseURLProblem(v) === undefined,
  postCreditsAlert: (v) => typeof v === 'boolean',
  becauseYouWatched: (v) => typeof v === 'boolean',
  xrayWhenPaused: (v) => typeof v === 'boolean',
  neverUseDolbyVision: (v) => typeof v === 'boolean',
  preferHDR: (v) => typeof v === 'boolean',
  volumeBoostDB: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 12,
  externalPlayer: (v) => externalPlayerIds.includes(v as ExternalPlayerId),
  askToResume: (v) => typeof v === 'boolean',
  watchedThresholdPercent: (v) => [80, 85, 90, 95].includes(v as number),
  seekBackwardSeconds: (v) => [5, 10, 15, 30].includes(v as number),
  seekForwardSeconds: (v) => [5, 10, 15, 30].includes(v as number),
  nextEpisodeCountdownSeconds: (v) => [5, 10, 15, 20, 30].includes(v as number),
  rememberTracksPerShow: (v) => typeof v === 'boolean',
  tryNextSourceOnFailure: (v) => typeof v === 'boolean',
  showLoadingProgress: (v) => typeof v === 'boolean',
  matroskaPlayback: (v) => v === 'remux' || v === 'external',
  decodeLosslessAudio: (v) => typeof v === 'boolean',
  cellularResolutionCap: (v) => ['2160p', '1440p', '1080p', '720p', '480p'].includes(v as string),
  subtitleAutoSync: (v) => typeof v === 'boolean',
  skipDetailsOnContinueWatching: (v) => typeof v === 'boolean',
  pictureInPicture: (v) => typeof v === 'boolean',
  autoRotate: (v) => typeof v === 'boolean',
  defaultSubtitleOffset: (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10,
  preferredQuality: (v) => ['2160p', '1080p', '720p', 'any'].includes(v as string),
  rememberLastSource: (v) => typeof v === 'boolean',
  // Fields a backup lacks take their defaults, so a file from before this setting (or from the apps) still imports.
  sources: isSourceOrdering,
  // Retired setting (the typeface picker): still accepted, so a backup from before it went imports clean.
  font: (v) => ['system', 'inter', 'geist', 'manrope', 'ioskeley'].includes(v as string),
  tabOrder: isTabOrder,
  // Empty clears the proxy; anything else has to be an address Marquee can call.
  streamProxy: (v) => typeof v === 'string' && proxyProblem(v) === undefined,
  showAboutSection: (v) => typeof v === 'boolean',
  showWhereToWatch: (v) => typeof v === 'boolean',
  showReviews: (v) => typeof v === 'boolean',
  showEpisodeSpoilers: (v) => typeof v === 'boolean',
  showSpecialsSeason: (v) => typeof v === 'boolean',
  detailTextSize: (v) => ['small', 'standard', 'large', 'extraLarge'].includes(v as string),
  // Providers (with their logins), the guide's refresh time and the favourite channels, as the apps keep them.
  liveTV: isLiveTVSettings,
  // Followed teams, TheSportsDB's key and the two switches; a missing field takes its default.
  sports: isSportsSettings,
  // Home: the shelf list (the apps' ShelfConfig, in the website's shape) and the switches around it.
  shelves: isShelfList,
  heroSource: isHeroSource,
  heroSecondarySource: (v) => v === null || isHeroSource(v),
  heroAutoAdvance: (v) => typeof v === 'boolean',
  contentShelfLength: (v) => [10, 20, 30, 40].includes(v as number),
  showContinueWatching: (v) => typeof v === 'boolean',
  continueWatchingLimit: (v) => v === null || [5, 10, 20].includes(v as number),
  showUpcoming: (v) => typeof v === 'boolean',
  includeWatchlistPremieres: (v) => typeof v === 'boolean',
  upcomingWithinDays: (v) => [3, 7, 14, 30].includes(v as number),
  filmDates: (v) => v === 'digital' || v === 'theatrical',
  showWatchedBadges: (v) => typeof v === 'boolean',
  showEpisodesRemaining: (v) => typeof v === 'boolean',
  heroStyle: (v) => v === 'card' || v === 'fullscreen',
  showPosterTitles: (v) => typeof v === 'boolean',
  showReleaseYear: (v) => typeof v === 'boolean',
  showContinueWatchingReleaseDate: (v) => typeof v === 'boolean',
  startTab: (v) => typeof v === 'string' && v.length > 0 && v.length <= 40,
}

const libraryTypes: { [K in keyof Library]: (v: unknown) => boolean } = {
  progress: isObject,
  watchlist: Array.isArray,
  favourites: Array.isArray,
  history: Array.isArray,
  watchedEpisodes: isObject,
  ratings: isObject,
  rewatches: isObject,
  shuffled: isObject,
  watchlistOrder: (v) => Array.isArray(v) && v.every((k) => typeof k === 'string'),
}

/** The settings in `raw` that import accepts, and the keys it had to skip. Shared by the backup and the apps' setup file. */
export function readSettings(raw: Record<string, unknown>): { settings: Partial<Settings>; skipped: string[] } {
  const skipped: string[] = []
  const settings: Record<string, unknown> = {}
  for (const [key, valid] of Object.entries(settingTypes)) {
    if (!(key in raw)) continue
    if (!valid(raw[key])) skipped.push(key)
    // A style missing some fields takes their defaults, and the apps' older "shadow" background reads as none.
    else settings[key] = key === 'subtitleStyle' ? normaliseSubtitleStyle(raw[key]) : key === 'sources' ? normaliseSourceOrdering(raw[key]) : key === 'subtitleOptions' ? normaliseSubtitleOptions(raw[key]) : raw[key]
  }
  return { settings: settings as Partial<Settings>, skipped }
}

export function createBackup(settings: Settings, library: Library, now = new Date()): Backup {
  return { format: backupFormat, version: 1, exportedAt: now.toISOString(), settings, library }
}

/** Reads a backup file's text. Returns what it can use, and the keys it had to skip, or an error
 *  that says what to try instead. */
export function parseBackup(text: string): { ok: true; settings: Partial<Settings>; library: Partial<Library>; skipped: string[] } | { ok: false; error: string } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file isn’t valid JSON. Choose a backup exported from Marquee.' }
  }
  if (!isObject(data) || data.format !== backupFormat) return { ok: false, error: 'That doesn’t look like a Marquee backup. Choose a file exported from Marquee’s Settings.' }
  if (typeof data.version === 'number' && data.version > 1) return { ok: false, error: 'That backup is from a newer version of Marquee. Update Marquee, then try again.' }

  const skipped: string[] = []
  const library: Record<string, unknown> = {}
  const { settings, skipped: unreadable } = readSettings(isObject(data.settings) ? data.settings : {})
  skipped.push(...unreadable)
  if (isObject(data.library)) {
    for (const [key, valid] of Object.entries(libraryTypes)) {
      if (!(key in data.library)) continue
      if (valid(data.library[key])) library[key] = data.library[key]
      else skipped.push(key)
    }
  }
  if (Object.keys(settings).length === 0 && Object.keys(library).length === 0) return { ok: false, error: 'That backup is empty. Choose a file exported from Marquee’s Settings.' }
  return { ok: true, settings, library: library as Partial<Library>, skipped }
}

export function applyBackup(parsed: { settings: Partial<Settings>; library: Partial<Library> }) {
  if (Object.keys(parsed.settings).length) settingsStore.set(parsed.settings)
  if (Object.keys(parsed.library).length) libraryStore.set(parsed.library)
}

/** Back to a fresh install: settings, library and remembered sources. The caller clears the query cache. */
export function resetEverything() {
  // Settings the defaults leave out (WebDAV logins, the source order…) have to be cleared by name, or the merge keeps them.
  const optional = Object.fromEntries(Object.keys(settingsStore.get()).filter((k) => !(k in defaultSettings)).map((k) => [k, undefined]))
  settingsStore.set({ ...optional, ...defaultSettings })
  libraryStore.set({ progress: {}, watchlist: [], favourites: [], history: [], watchedEpisodes: {}, ratings: {}, rewatches: {}, shuffled: {}, watchlistOrder: [] })
  lastSourceStore.set({ byTitle: {} })
  setupExtrasStore.set(noExtras)
}
