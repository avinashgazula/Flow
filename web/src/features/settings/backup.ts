import { isLiveTVSettings } from '../../lib/livetv/validate'
import { lastSourceStore } from '../../lib/sources/lastSource'
import { proxyProblem } from '../../lib/sources/proxy'
import { isSourceOrdering, normaliseSourceOrdering } from '../../lib/sources/sourceSettings'
import { defaultSettings, settingsStore, type Settings } from '../../lib/store/settings'
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
  audioLanguages: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0),
  subtitleLanguages: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  subtitleMode: (v) => ['off', 'foreign', 'always'].includes(v as string),
  // The apps' keys (fontScale, font, weight, color, edgeStyle, background, backgroundOpacity, verticalPosition).
  subtitleStyle: isSubtitleStyle,
  autoplayNext: (v) => typeof v === 'boolean',
  stillWatchingAfterEpisodes: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10,
  skipIntro: isSkipBehaviour,
  skipRecap: isSkipBehaviour,
  skipCredits: isSkipBehaviour,
  introDBKey: (v) => typeof v === 'string',
  publicMetaDBKey: (v) => typeof v === 'string',
  preferredQuality: (v) => ['2160p', '1080p', '720p', 'any'].includes(v as string),
  rememberLastSource: (v) => typeof v === 'boolean',
  // Fields a backup lacks take their defaults, so a file from before this setting (or from the apps) still imports.
  sources: isSourceOrdering,
  font: (v) => typefaces.some((f) => f.value === v),
  tabOrder: isTabOrder,
  // Empty clears the proxy; anything else has to be an address Flow can call.
  streamProxy: (v) => typeof v === 'string' && proxyProblem(v) === undefined,
  // Providers (with their logins), the guide's refresh time and the favourite channels, as the apps keep them.
  liveTV: isLiveTVSettings,
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
  showWatchedBadges: (v) => typeof v === 'boolean',
  showEpisodesRemaining: (v) => typeof v === 'boolean',
}

const libraryTypes: { [K in keyof Library]: (v: unknown) => boolean } = {
  progress: isObject,
  watchlist: Array.isArray,
  favourites: Array.isArray,
  history: Array.isArray,
  watchedEpisodes: isObject,
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
      else settings[key] = key === 'subtitleStyle' ? normaliseSubtitleStyle(data.settings[key]) : key === 'sources' ? normaliseSourceOrdering(data.settings[key]) : data.settings[key]
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
  settingsStore.set({ ...defaultSettings })
  libraryStore.set({ progress: {}, watchlist: [], favourites: [], history: [], watchedEpisodes: {} })
  lastSourceStore.set({ byTitle: {} })
}
