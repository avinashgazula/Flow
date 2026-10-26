import { isLiveTVSettings } from '../../lib/livetv/validate'
import { isSportsSettings } from '../../lib/sports/types'
import { lastSourceStore } from '../../lib/sources/lastSource'
import { ratingSources } from '../../lib/ratings/sources'
import { proxyProblem } from '../../lib/sources/proxy'
import { isSourceOrdering, normaliseSourceOrdering } from '../../lib/sources/sourceSettings'
import { isSubtitleOptions, normaliseSubtitleOptions } from '../../lib/subtitles/options'
import { defaultSettings, settingsStore, type ExternalPlayerId, type Settings } from '../../lib/store/settings'
import { externalPlayerIds } from '../player/externalPlayers'
import { libraryStore, type Library } from '../../lib/store/library'
import { isTabOrder } from '../../lib/tabs'
import { isShelfList } from '../../lib/shelves'
import { isSubtitleStyle, normaliseSubtitleStyle } from '../../lib/store/subtitleStyle'
import { typefaces } from './options'

/* Export and import of everything Flow keeps in this browser, as one JSON file. */

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
  postCreditsAlert: (v) => typeof v === 'boolean',
  becauseYouWatched: (v) => typeof v === 'boolean',
  neverUseDolbyVision: (v) => typeof v === 'boolean',
  volumeBoostDB: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 12,
  externalPlayer: (v) => externalPlayerIds.includes(v as ExternalPlayerId),
  preferredQuality: (v) => ['2160p', '1080p', '720p', 'any'].includes(v as string),
  rememberLastSource: (v) => typeof v === 'boolean',
  // Fields a backup lacks take their defaults, so a file from before this setting (or from the apps) still imports.
  sources: isSourceOrdering,
  font: (v) => typefaces.some((f) => f.value === v),
  tabOrder: isTabOrder,
  // Empty clears the proxy; anything else has to be an address Flow can call.
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
    return { ok: false, error: 'That file isn’t valid JSON. Choose a backup exported from Flow.' }
  }
  if (!isObject(data) || data.format !== backupFormat) return { ok: false, error: 'That doesn’t look like a Flow backup. Choose a file exported from Flow’s Settings.' }
  if (typeof data.version === 'number' && data.version > 1) return { ok: false, error: 'That backup is from a newer version of Flow. Update Flow, then try again.' }

  const skipped: string[] = []
  const settings: Record<string, unknown> = {}
  const library: Record<string, unknown> = {}
  if (isObject(data.settings)) {
    for (const [key, valid] of Object.entries(settingTypes)) {
      if (!(key in data.settings)) continue
      if (!valid(data.settings[key])) skipped.push(key)
      // A style missing some fields takes their defaults, and the apps' older "shadow" background reads as none.
      else settings[key] = key === 'subtitleStyle' ? normaliseSubtitleStyle(data.settings[key]) : key === 'sources' ? normaliseSourceOrdering(data.settings[key]) : key === 'subtitleOptions' ? normaliseSubtitleOptions(data.settings[key]) : data.settings[key]
    }
  }
  if (isObject(data.library)) {
    for (const [key, valid] of Object.entries(libraryTypes)) {
      if (!(key in data.library)) continue
      if (valid(data.library[key])) library[key] = data.library[key]
      else skipped.push(key)
    }
  }
  if (Object.keys(settings).length === 0 && Object.keys(library).length === 0) return { ok: false, error: 'That backup is empty. Choose a file exported from Flow’s Settings.' }
  return { ok: true, settings: settings as Partial<Settings>, library: library as Partial<Library>, skipped }
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
  libraryStore.set({ progress: {}, watchlist: [], favourites: [], history: [], watchedEpisodes: {}, ratings: {}, rewatches: {}, shuffled: {} })
  lastSourceStore.set({ byTitle: {} })
}
