import { isLiveTVSettings } from '../livetv/validate'
import type { LiveTVSettings } from '../livetv/types'
import { defaultSports, isSportsSettings, type SportsSettings } from '../sports/types'
import { ratingSources } from '../ratings/sources'
import { normaliseSourceOrdering } from '../sources/sourceSettings'
import { normaliseSubtitleOptions } from '../subtitles/options'
import { parseShelves, shelvesToJSON } from '../shelves'
import { defaultTabOrder } from '../tabs'
import { defaultSettings, type AddonConfig, type ServerConfig, type Settings, type TraktToken, type WebDAVConfig } from '../store/settings'
import { normaliseSubtitleStyle } from '../store/subtitleStyle'
import type { SetupExtras } from './extras'

/* The setup file the apps share (FlowKit's SetupShare and SetupBundle, in Sync/SettingsCodec.swift): `flow-setup`,
   the whole AppSettings as nested JSON, with the Credentials beside it when the person chose to include keys and
   passwords. This file maps the website's flat settings to that shape and back. Pure functions, so the rules are
   tested without a browser.

   Reading is lenient, as the apps' is: a field the file lacks leaves the website's value alone, and one that can't be
   read is skipped and counted. What the website has no setting for is kept (see extras.ts) and written back on export.
   What only the website has (the typeface, the stream proxy, the audio language list with "original" in it) travels
   under `settings.web`, which the apps ignore.

   The apps decode a list's items without defaults, so every field an item needs must be in the file: `withRequired`. */

export const setupFormat = 'flow-setup'
export const setupVersion = 1

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const text = (v: unknown) => (isString(v) && v.trim() ? v.trim() : undefined)
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObject) : [])
const strings = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every(isString) ? v : undefined)
const validURL = (v: unknown): v is string => {
  if (!isString(v)) return false
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol)
  } catch {
    return false
  }
}

export interface SetupBundle {
  format: typeof setupFormat
  version: number
  exportedAt: string
  settings: Json
  credentials?: Json
}

// MARK: Values that differ in spelling

/** The apps call the Live TV tab `liveTV`; the website's id is `live`. */
const appTab = (id: string) => (id === 'live' ? 'liveTV' : id)
const webTab = (id: unknown) => (id === 'liveTV' ? 'live' : id)
const knownTab = (id: unknown): id is string => isString(id) && defaultTabOrder.includes(id)

const modeToApp = { off: 'never', foreign: 'automatic', always: 'always', forced: 'forcedOnly' } as const
const modeFromApp: Record<string, Settings['subtitleMode']> = { never: 'off', automatic: 'foreign', always: 'always', forcedOnly: 'forced' }

/** The apps' two public-service addresses, which the website writes as empty ("the public address"). */
const publicDefaults = { introDBBaseURL: 'https://api.introdb.app', publicMetaDBBaseURL: 'https://publicmetadb.com' } as const
const publicAddress = (key: keyof typeof publicDefaults) => (v: unknown) => (isString(v) && v.trim().replace(/\/+$/, '') === publicDefaults[key] ? '' : v)

const quality = (h: unknown): Settings['preferredQuality'] | undefined => ({ 2160: '2160p', 1080: '1080p', 720: '720p' } as Record<number, Settings['preferredQuality']>)[h as number]
const cap = (h: unknown): Settings['cellularResolutionCap'] | undefined => ({ 2160: '2160p', 1440: '1440p', 1080: '1080p', 720: '720p', 480: '480p' } as Record<number, Settings['cellularResolutionCap']>)[h as number]
const height = (label: string) => Number.parseInt(label, 10)

// MARK: One-to-one fields

interface Field {
  /** The website's setting. */
  web: keyof Settings
  /** Where the apps keep it: `section.name`. */
  path: string
  /** What the website treats as the value while its own is absent (the "Absent is…" notes in settings.ts). */
  absent?: unknown
  /** From the website's value to the apps', and back. A read that gives undefined means the value is unreadable. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write?: (v: any) => unknown
  read?: (v: unknown) => unknown
}

const same = (web: keyof Settings, path: string, absent?: unknown): Field => ({ web, path, absent })

const fields: Field[] = [
  // general
  { web: 'startTab', path: 'general.startTab', absent: 'home', write: appTab, read: (v) => (knownTab(webTab(v)) ? webTab(v) : undefined) },
  same('showPosterTitles', 'general.showPosterTitles', true),
  same('heroAutoAdvance', 'general.heroAutoAdvance'),
  same('heroSource', 'general.heroSource'),
  same('showWatchedBadges', 'general.showWatchedBadges'),
  { web: 'tabOrder', path: 'general.tabOrder', write: (v: string[]) => v.map(appTab), read: (v) => (Array.isArray(v) ? v.map(webTab).filter(knownTab) : undefined) },
  same('showAboutSection', 'general.showAboutSection'),
  same('showWhereToWatch', 'general.showWhereToWatch'),
  same('showReviews', 'general.showReviews'),
  same('showEpisodeSpoilers', 'general.showEpisodeSpoilers'),
  same('showSpecialsSeason', 'general.showSpecialsSeason'),
  same('detailTextSize', 'general.detailTextSize'),
  same('contentShelfLength', 'general.contentShelfLength'),
  same('showContinueWatching', 'general.showContinueWatching'),
  // No limit is written as null: the apps read it as "none", and the key stays in the file so it is not kept twice.
  same('continueWatchingLimit', 'general.continueWatchingLimit'),
  same('showContinueWatchingReleaseDate', 'general.showContinueWatchingReleaseDate', true),
  same('showUpcoming', 'general.showUpcoming'),
  same('includeWatchlistPremieres', 'general.includeWatchlistPremieres'),
  same('filmDates', 'general.filmDates', 'digital'),
  same('upcomingWithinDays', 'general.upcomingWithinDays'),
  same('heroStyle', 'general.heroStyle', 'card'),
  same('heroSecondarySource', 'general.heroSecondarySource'),
  same('showReleaseYear', 'general.showReleaseYear', false),
  same('showEpisodesRemaining', 'general.showEpisodesRemaining'),
  // account
  { web: 'introDBBaseURL', path: 'account.introDBBaseURL', absent: '', write: (v: string) => v.trim() || publicDefaults.introDBBaseURL, read: publicAddress('introDBBaseURL') },
  { web: 'publicMetaDBBaseURL', path: 'account.publicMetaDBBaseURL', absent: '', write: (v: string) => v.trim() || publicDefaults.publicMetaDBBaseURL, read: publicAddress('publicMetaDBBaseURL') },
  // metadata
  same('language', 'metadata.language'),
  same('region', 'metadata.region'),
  same('includeAdult', 'metadata.includeAdult'),
  same('episodeSource', 'metadata.episodeSource', 'tvdb'),
  same('airDatesInLocalTimeZone', 'metadata.airDatesInLocalTimeZone', true),
  same('showUnreleasedTitles', 'metadata.showUnreleasedTitles', true),
  same('prefetchOnDetail', 'metadata.prefetchOnDetail', true),
  same('posterEnhancement', 'metadata.posterEnhancement', 'off'),
  // The apps also list MyAnimeList, which the website has no score for.
  { web: 'ratingsShown', path: 'metadata.ratingsShown', absent: [...ratingSources], read: (v) => (Array.isArray(v) ? v.filter((x) => (ratingSources as readonly unknown[]).includes(x)) : undefined) },
  same('tapRatingOpensReviews', 'metadata.tapRatingOpensReviews', true),
  // media servers (the lists are below)
  same('showBadgeOnPosters', 'mediaServers.showBadgeOnPosters', true),
  same('onlyShowServerContent', 'mediaServers.onlyShowServerContent', false),
  same('useServerArtwork', 'mediaServers.useServerArtwork', false),
  same('trackOnlyWithTracker', 'mediaServers.trackOnlyWithTracker', false),
  same('serverHomeRowIDs', 'mediaServers.serverHomeRowIDs', []),
  // playback
  same('autoplayNext', 'playback.autoPlayNextEpisode'),
  same('nextEpisodeCountdownSeconds', 'playback.nextEpisodeCountdownSeconds', 10),
  same('skipIntro', 'playback.skipIntro'),
  same('skipRecap', 'playback.skipRecap'),
  same('skipCredits', 'playback.skipCredits'),
  same('askToResume', 'playback.askToResume', true),
  same('externalPlayer', 'playback.externalPlayer', 'none'),
  same('seekForwardSeconds', 'playback.seekForwardSeconds', 10),
  same('seekBackwardSeconds', 'playback.seekBackwardSeconds', 10),
  same('watchedThresholdPercent', 'playback.watchedThresholdPercent', 90),
  same('matroskaPlayback', 'playback.matroskaPlayback', 'remux'),
  same('tryNextSourceOnFailure', 'playback.tryNextSourceOnFailure', true),
  same('postCreditsAlert', 'playback.postCreditsAlert', true),
  same('becauseYouWatched', 'playback.becauseYouWatched', true),
  same('upNextWaitsForEnd', 'playback.upNextWaitsForEnd', false),
  same('volumeBoostDB', 'playback.volumeBoostDB', 0),
  same('decodeLosslessAudio', 'playback.decodeLosslessAudio', true),
  same('rememberTracksPerShow', 'playback.rememberTracksPerShow', true),
  same('preferHDR', 'playback.preferHDR', true),
  same('neverUseDolbyVision', 'playback.neverUseDolbyVision', false),
  same('showLoadingProgress', 'playback.showLoadingProgress', true),
  same('xrayWhenPaused', 'playback.xrayWhenPaused', true),
  same('stillWatchingAfterEpisodes', 'playback.stillWatchingAfterEpisodes'),
  // The apps' "no cap" is 4K, which is also what the website's absent cap means.
  { web: 'cellularResolutionCap', path: 'playback.cellularResolutionCap', absent: '2160p', write: height, read: cap },
  // 4K is the apps' default cap and means "no limit"; the website's "Any" is written as it. Reading 4K gives 4K.
  { web: 'preferredQuality', path: 'playback.preferredResolutionCap', write: (v: string) => (v === 'any' ? 2160 : height(v)), read: quality },
  // subtitles
  same('subtitleLanguages', 'subtitles.preferredLanguages'),
  same('defaultSubtitleOffset', 'subtitles.defaultOffsetSeconds', 0),
  { web: 'subtitleMode', path: 'subtitles.autoSelect', write: (v: keyof typeof modeToApp) => modeToApp[v], read: (v) => (isString(v) ? modeFromApp[v] : undefined) },
  // sources
  same('rememberLastSource', 'sources.rememberLastSource'),
]

const get = (root: Json, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (isObject(o) ? o[k] : undefined), root)
function put(root: Json, path: string, value: unknown) {
  const keys = path.split('.')
  let at = root
  for (const k of keys.slice(0, -1)) at = (at[k] = isObject(at[k]) ? at[k] : {}) as Json
  at[keys[keys.length - 1]!] = value
}

// MARK: Exporting

const subtitleStyleKeys = ['fontScale', 'font', 'weight', 'color', 'edgeStyle', 'background', 'backgroundOpacity', 'verticalPosition'] as const

/** The credentials the website holds, under the apps' names. Tokens are never exported (the apps leave them out too). */
const credentialKeys = [
  ['tmdbKey', 'tmdbAPIKey'],
  ['tvdbKey', 'tvdbAPIKey'],
  ['mdblistKey', 'mdblistAPIKey'],
  ['publicMetaDBKey', 'publicMetaDBAPIKey'],
  ['introDBKey', 'introDBAPIKey'],
  ['openSubtitlesKey', 'openSubtitlesAPIKey'],
  ['openSubtitlesUsername', 'openSubtitlesUsername'],
  ['openSubtitlesPassword', 'openSubtitlesPassword'],
  ['subdlKey', 'subdlAPIKey'],
  ['subSourceKey', 'subSourceAPIKey'],
  ['wyzieKey', 'wyzieAPIKey'],
  ['rpdbKey', 'rpdbAPIKey'],
  ['traktClientID', 'traktClientID'],
  ['simklClientID', 'simklClientID'],
] as const

/** An object without its undefined and empty fields: the apps' encoder leaves a nil out, and so does this. */
const defined = (o: Json): Json => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''))

/** The website's settings as the apps' `settings` and `credentials` objects. */
function build(s: Settings, includeSecrets: boolean): { settings: Json; credentials: Json } {
  const settings: Json = {}
  for (const f of fields) {
    const raw = s[f.web] === undefined ? f.absent : s[f.web]
    if (raw === undefined) continue
    put(settings, f.path, f.write ? f.write(raw) : raw)
  }
  // The tracker the website uses when none was chosen is the first sign-in, as the apps adopt one that arrives.
  put(settings, 'account.tracker', s.tracker ?? (s.traktAccount ? 'trakt' : s.simklAccount ? 'simkl' : 'local'))

  put(settings, 'shelves', JSON.parse(shelvesToJSON(s.shelves)))

  put(settings, 'mediaServers.servers', s.servers.filter((v) => validURL(v.url)).map((v) => defined({ id: v.id, kind: v.kind, name: v.name, baseURL: v.url, enabled: v.enabled, username: v.username, machineID: v.machineId, ...(includeSecrets ? { userID: v.userId, accessToken: v.token } : {}) })))
  put(settings, 'mediaServers.serverHomeRows', (s.serverHomeRowIDs ?? []).length > 0)
  // Without secrets the key is empty, as the apps write it; the address stays so the other side knows where it was.
  if (s.seerr && validURL(s.seerr.url)) put(settings, 'mediaServers.seerr', { baseURL: s.seerr.url, apiKey: includeSecrets ? s.seerr.key : '' })

  put(settings, 'webDAV', (s.webDAV ?? []).filter((v) => validURL(v.url)).map((v) => defined({ id: v.id, name: v.name, baseURL: v.url, username: v.username, moviesPath: v.moviesPath, showsPath: v.showsPath, enabled: v.enabled, ...(includeSecrets ? { password: v.password } : {}) })))

  put(settings, 'liveTV', {
    providers: s.liveTV.providers.filter((p) => validURL(p.url)).map((p) => defined({ id: p.id, name: p.name, kind: p.kind, url: p.url, epgURL: validURL(p.epgURL) ? p.epgURL : undefined, username: p.username, enabled: p.enabled, useForVOD: p.useForVOD, userAgent: p.userAgent, ...(includeSecrets ? { password: p.password } : {}) })),
    epgRefreshHours: s.liveTV.epgRefreshHours,
    favouriteChannelIDs: s.liveTV.favouriteChannelIDs,
    recentChannelIDs: s.liveTV.recentChannelIDs,
    hideEmptyGroups: s.liveTV.hideEmptyGroups,
  })

  const o = normaliseSourceOrdering(s.sources)
  put(settings, 'sources', {
    ...(isObject(settings.sources) ? settings.sources : {}),
    useCustomOrdering: o.useCustomOrdering,
    categoryOrder: o.categoryOrder,
    providerOrder: o.providerOrder,
    addons: s.addons.filter((a) => validURL(a.url)).map((a) => ({ manifestURL: a.url, name: a.name, enabled: a.enabled })),
    sortRules: o.sortRules,
    filters: o.filters,
    resultCap: o.resultCap,
    appearance: { showRawText: o.appearance.showRawText, titleDisplay: o.appearance.titleDisplay, badgePack: o.appearance.badges === 'all' ? 'colored' : o.appearance.badges, showSize: o.appearance.showSize, compact: o.appearance.compact },
    autoPlayFirstSource: o.autoPlayFirstSource,
    timeoutSeconds: o.timeoutSeconds,
    preferPlayableAudio: o.preferPlayableAudio,
    playFromLibraryOnly: o.playFromLibraryOnly,
  })

  const style = normaliseSubtitleStyle(s.subtitleStyle)
  for (const key of subtitleStyleKeys) put(settings, `subtitles.${key}`, style[key])
  const options = normaliseSubtitleOptions(s.subtitleOptions)
  put(settings, 'subtitles.subtitleType', options.type)
  put(settings, 'subtitles.keepASSStyling', options.keepASSStyling)
  put(settings, 'subtitles.enabledProviders', options.providers)
  put(settings, 'playback.animeAudio', options.animeAudio)
  // The apps keep a first and a fallback audio language; the website's list may start with "original", kept under `web`.
  const audio = s.audioLanguages.filter((l) => l !== 'original')
  if (audio[0]) put(settings, 'playback.preferredAudioLanguage', audio[0])
  if (audio[1]) put(settings, 'playback.audioFallbackLanguage', audio[1])

  put(settings, 'sports', { ...defaultSports, ...s.sports, followedTeams: (s.sports?.followedTeams ?? []).map((t) => defined({ ...t, badgeURL: validURL(t.badgeURL) ? t.badgeURL : undefined })) })

  put(settings, 'web', { font: s.font, audioLanguages: s.audioLanguages, preferredQuality: s.preferredQuality, ...(includeSecrets && s.streamProxy ? { streamProxy: s.streamProxy } : {}) })

  const credentials: Json = {}
  for (const [web, app] of credentialKeys) {
    const v = s[web]
    // The key baked into a build is the site's, not the person's.
    if (isString(v) && v.trim() && !(web === 'tmdbKey' && v === defaultSettings.tmdbKey)) credentials[app] = v.trim()
  }
  return { settings, credentials }
}

// MARK: Keeping what the website doesn't model

const identity = (item: Json): unknown => item.id ?? item.manifestURL
const idKey = (item: Json) => (item.id !== undefined ? 'id' : 'manifestURL')
const keyed = (v: unknown): v is Json[] => Array.isArray(v) && v.length > 0 && v.every((x) => isObject(x) && identity(x) !== undefined)

/** What `from` has that `taken` doesn't: the fields the website did not read. Lists of items with an id are compared item by item. */
export function leftovers(from: unknown, taken: unknown): unknown {
  if (isObject(from) && isObject(taken)) {
    const out: Json = {}
    for (const [k, v] of Object.entries(from)) {
      if (!(k in taken)) out[k] = v
      else {
        const rest = leftovers(v, taken[k])
        if (rest !== undefined) out[k] = rest
      }
    }
    return Object.keys(out).length ? out : undefined
  }
  if (keyed(from) && keyed(taken)) {
    const mine = new Map(taken.map((x) => [identity(x), x]))
    const out: Json[] = []
    for (const item of from) {
      const match = mine.get(identity(item))
      const rest = match ? leftovers(item, match) : item
      // The id stays so the rest can be matched to its item later.
      if (rest !== undefined) out.push({ ...(rest as Json), [idKey(item)]: identity(item) })
    }
    return out.length ? out : undefined
  }
  return undefined
}

/** `base` with `over` laid on it: objects merge, lists of items with an id merge item by item (items only `base` has are
 *  dropped, so something removed on the website stays removed), anything else is taken from `over`. */
export function overlaid(base: unknown, over: unknown): unknown {
  if (isObject(base) && isObject(over)) {
    const out: Json = { ...base }
    for (const [k, v] of Object.entries(over)) out[k] = k in base ? overlaid(base[k], v) : v
    return out
  }
  if (keyed(base) && keyed(over)) {
    const was = new Map(base.map((x) => [identity(x), x]))
    return over.map((item) => (was.has(identity(item)) ? overlaid(was.get(identity(item)), item) : item))
  }
  return over
}

/** Fields the apps decode without a default, which the website has no value for. */
function withRequired(settings: Json) {
  for (const v of list(get(settings, 'mediaServers.servers'))) if (v.isRemote === undefined) v.isRemote = true
}

/** Whatever the extras remembered must not carry secrets into a file made without them: the apps clear these fields too. */
function stripSecrets(settings: Json) {
  for (const v of list(get(settings, 'mediaServers.servers'))) (delete v.accessToken, delete v.userID)
  const seerr = get(settings, 'mediaServers.seerr')
  if (isObject(seerr)) seerr.apiKey = ''
  for (const v of list(settings.webDAV)) delete v.password
  for (const v of list(get(settings, 'liveTV.providers'))) delete v.password
  if (isObject(settings.web)) delete settings.web.streamProxy
}

export interface ExportOptions {
  includeSecrets: boolean
  extras?: SetupExtras
  now?: Date
}

/** The setup file's contents for these settings. */
export function exportSetup(s: Settings, { includeSecrets, extras, now = new Date() }: ExportOptions): SetupBundle {
  const built = build(s, includeSecrets)
  const settings = overlaid(extras?.settings ?? {}, built.settings) as Json
  withRequired(settings)
  if (!includeSecrets) stripSecrets(settings)
  const bundle: SetupBundle = { format: setupFormat, version: setupVersion, exportedAt: now.toISOString(), settings }
  if (includeSecrets) bundle.credentials = overlaid(extras?.credentials ?? {}, built.credentials) as Json
  return bundle
}

/** The file as text. */
export const setupToJSON = (bundle: SetupBundle) => JSON.stringify(bundle, null, 2)

const toBase64URL = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** The compact form the apps paste and scan: flow://setup?d=<base64url of the JSON>. */
export function setupToLink(bundle: SetupBundle): string {
  return `flow://setup?d=${toBase64URL(new TextEncoder().encode(JSON.stringify(bundle)))}`
}

// MARK: Reading

export type ParsedBundle = { ok: true; bundle: SetupBundle } | { ok: false; error: string }

const notASetup = 'That isn’t a Flow setup. Choose a file from Share Setup in the apps or Export Setup on the website, or paste its link.'

/** The file's text, a flow://setup link or bare base64 (what the apps accept), as a setup bundle. */
export function parseSetup(input: string): ParsedBundle {
  let body = input.trim()
  if (!body) return { ok: false, error: notASetup }
  if (!body.startsWith('{')) {
    const link = /[?&]d=([^&\s]+)/.exec(body)
    const payload = (link ? link[1]! : body).replace(/-/g, '+').replace(/_/g, '/')
    try {
      const bin = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))
      body = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
    } catch {
      return { ok: false, error: notASetup }
    }
  }
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return { ok: false, error: notASetup }
  }
  if (!isObject(data) || data.format !== setupFormat || !isObject(data.settings)) return { ok: false, error: notASetup }
  if (typeof data.version === 'number' && data.version > setupVersion) return { ok: false, error: 'That setup is from a newer version of Flow. Update Flow, then try again.' }
  const bundle: SetupBundle = { format: setupFormat, version: typeof data.version === 'number' ? data.version : setupVersion, exportedAt: isString(data.exportedAt) ? data.exportedAt : '', settings: data.settings }
  if (isObject(data.credentials)) bundle.credentials = data.credentials
  return { ok: true, bundle }
}

const token = (v: unknown): TraktToken | undefined => {
  if (!isObject(v) || !text(v.accessToken)) return undefined
  const at = isString(v.expiresAt) ? Date.parse(v.expiresAt) : NaN
  return { accessToken: v.accessToken as string, refreshToken: text(v.refreshToken) ?? null, expiresAt: Number.isFinite(at) ? new Date(at).toISOString() : null, redirectURI: text(v.redirectURI) ?? null }
}

/** The settings a bundle sets, laid over `current`: the secrets the file doesn't carry are kept, as the apps' `apply` does.
 *  Values are not yet checked against the settings' own rules; the caller runs them through the backup's readers. */
export function settingsFromSetup(bundle: SetupBundle, current: Settings): Partial<Settings> {
  const src = bundle.settings
  const patch: Record<string, unknown> = {}

  for (const f of fields) {
    const raw = get(src, f.path)
    if (raw === undefined) continue
    const value = f.read ? f.read(raw) : raw
    if (value !== undefined) patch[f.web] = value
  }
  // The apps leave a limit out when there is none; a setup that has the section but no limit means none.
  if (isObject(src.general)) {
    if (!('continueWatchingLimit' in src.general)) patch.continueWatchingLimit = null
    if (!('heroSecondarySource' in src.general)) patch.heroSecondarySource = null
  }
  const tracker = get(src, 'account.tracker')
  if (isString(tracker)) patch.tracker = tracker

  if (Array.isArray(src.shelves)) {
    const parsed = parseShelves(JSON.stringify(src.shelves))
    if (parsed.ok) patch.shelves = parsed.shelves
  }

  const media = src.mediaServers
  if (isObject(media)) {
    if (Array.isArray(media.servers)) {
      const have = new Map(current.servers.map((v) => [v.id, v]))
      patch.servers = list(media.servers)
        .filter((v) => isString(v.id) && validURL(v.baseURL) && ['jellyfin', 'emby', 'plex'].includes(v.kind as string))
        .map((v): ServerConfig => {
          const old = have.get(v.id as string)
          const userId = text(v.userID) ?? old?.userId
          return {
            id: v.id as string,
            kind: v.kind as ServerConfig['kind'],
            name: text(v.name) ?? (v.baseURL as string),
            url: v.baseURL as string,
            // A token the file doesn't carry stays with the server it belongs to.
            token: text(v.accessToken) ?? old?.token ?? '',
            enabled: v.enabled !== false,
            ...(userId ? { userId } : {}),
            ...(text(v.username) ? { username: text(v.username) } : {}),
            ...(text(v.machineID) ? { machineId: text(v.machineID) } : {}),
          }
        })
    }
    const seerr = media.seerr
    if (isObject(seerr) && validURL(seerr.baseURL)) {
      // A key the file leaves out stays, when it is the same Seerr.
      const key = text(seerr.apiKey) ?? (current.seerr?.url === seerr.baseURL ? current.seerr.key : undefined)
      if (key) patch.seerr = { url: seerr.baseURL, key }
    } else if (!isObject(seerr)) patch.seerr = undefined
  }

  if (Array.isArray(src.webDAV)) {
    patch.webDAV = list(src.webDAV)
      .filter((v) => isString(v.id) && validURL(v.baseURL) && isString(v.moviesPath) && isString(v.showsPath))
      .map((v): WebDAVConfig => {
        const old = current.webDAV?.find((x) => x.id === v.id && x.url === v.baseURL)
        const password = text(v.password) ?? old?.password
        return {
          id: v.id as string,
          name: text(v.name) ?? (v.baseURL as string),
          url: v.baseURL as string,
          moviesPath: v.moviesPath as string,
          showsPath: v.showsPath as string,
          enabled: v.enabled !== false,
          ...(text(v.username) ? { username: text(v.username) } : {}),
          // A password the file leaves out comes back from the same share, at the same address, already here.
          ...(password ? { password } : {}),
        }
      })
  }

  const tv = src.liveTV
  if (isObject(tv)) {
    const providers = list(tv.providers)
      .filter((p) => isString(p.id) && validURL(p.url) && (p.kind === 'm3u' || p.kind === 'xtream'))
      .map((p) => {
        const old = current.liveTV.providers.find((x) => x.id === p.id && x.url === p.url)
        return defined({ id: p.id, name: text(p.name) ?? p.url, kind: p.kind, url: p.url, epgURL: validURL(p.epgURL) ? p.epgURL : undefined, username: text(p.username), password: text(p.password) ?? old?.password, enabled: p.enabled !== false, useForVOD: p.useForVOD === true, userAgent: text(p.userAgent) })
      })
    const next = {
      providers: Array.isArray(tv.providers) ? providers : current.liveTV.providers,
      epgRefreshHours: typeof tv.epgRefreshHours === 'number' ? tv.epgRefreshHours : current.liveTV.epgRefreshHours,
      favouriteChannelIDs: strings(tv.favouriteChannelIDs) ?? current.liveTV.favouriteChannelIDs,
      recentChannelIDs: strings(tv.recentChannelIDs) ?? current.liveTV.recentChannelIDs,
      hideEmptyGroups: typeof tv.hideEmptyGroups === 'boolean' ? tv.hideEmptyGroups : current.liveTV.hideEmptyGroups,
    }
    if (isLiveTVSettings(next)) patch.liveTV = next as LiveTVSettings
  }

  const sources = src.sources
  if (isObject(sources)) {
    // The apps can ask for 1440p and up; the nearest the website offers below it is 1080p.
    const filters = isObject(sources.filters) && sources.filters.minResolution === 1440 ? { ...sources.filters, minResolution: 1080 } : sources.filters
    patch.sources = normaliseSourceOrdering({ ...sources, filters })
    if (Array.isArray(sources.addons)) {
      const have = new Map(current.addons.map((a) => [a.url, a]))
      patch.addons = list(sources.addons)
        .filter((a) => validURL(a.manifestURL))
        .map((a): AddonConfig => {
          const manifest = have.get(a.manifestURL as string)?.manifest
          return { ...(manifest ? { manifest } : {}), url: a.manifestURL as string, name: text(a.name) ?? (a.manifestURL as string), enabled: a.enabled !== false }
        })
    }
  }

  const subs = src.subtitles
  const playback = src.playback
  const animeAudio = isObject(playback) ? playback.animeAudio : undefined
  if (isObject(subs)) {
    const style: Json = { ...current.subtitleStyle }
    for (const key of subtitleStyleKeys) if (subs[key] !== undefined) style[key] = subs[key]
    patch.subtitleStyle = style
    const options: Json = { ...normaliseSubtitleOptions(current.subtitleOptions) }
    // The older switches the apps migrate on load: Load Automatically means always, Prefer Hearing Impaired means SDH.
    if (subs.autoEnable === true) patch.subtitleMode = 'always'
    if (subs.subtitleType !== undefined) options.type = subs.subtitleType
    if (subs.hearingImpaired === true) options.type = 'sdh'
    if (subs.keepASSStyling !== undefined) options.keepASSStyling = subs.keepASSStyling
    if (subs.enabledProviders !== undefined) options.providers = subs.enabledProviders
    if (animeAudio !== undefined) options.animeAudio = animeAudio
    patch.subtitleOptions = options
  } else if (animeAudio !== undefined) patch.subtitleOptions = { ...normaliseSubtitleOptions(current.subtitleOptions), animeAudio }

  if (isObject(playback)) {
    const audio = [text(playback.preferredAudioLanguage), text(playback.audioFallbackLanguage)].filter((l): l is string => l !== undefined)
    if (audio.length) patch.audioLanguages = audio
  }

  if (isObject(src.sports)) {
    const sp = src.sports
    const next = {
      ...defaultSports,
      ...(current.sports ?? {}),
      ...(Array.isArray(sp.followedTeams) ? { followedTeams: list(sp.followedTeams).filter((t) => isString(t.id) && t.id && isString(t.name) && t.name).map((t) => defined({ id: t.id, name: t.name, league: text(t.league), sport: text(t.sport), badgeURL: validURL(t.badgeURL) ? t.badgeURL : undefined, country: text(t.country) })) } : {}),
      ...(isString(sp.apiKey) ? { apiKey: sp.apiKey.trim() || defaultSports.apiKey } : {}),
      ...(typeof sp.showScoreSpoilers === 'boolean' ? { showScoreSpoilers: sp.showScoreSpoilers } : {}),
      ...(typeof sp.chooseChannelOnTap === 'boolean' ? { chooseChannelOnTap: sp.chooseChannelOnTap } : {}),
    }
    if (isSportsSettings(next)) patch.sports = next as SportsSettings
  }

  // What only the website has. The apps drop it, so it is there only when the website wrote the file.
  const web = src.web
  if (isObject(web)) {
    if (web.font !== undefined) patch.font = web.font
    if (strings(web.audioLanguages)?.length) patch.audioLanguages = web.audioLanguages
    if (web.preferredQuality !== undefined) patch.preferredQuality = web.preferredQuality
    if (isString(web.streamProxy)) patch.streamProxy = web.streamProxy
  }

  const creds = bundle.credentials
  if (isObject(creds)) {
    // Only a secret the file really carries replaces the one here.
    for (const [web, app] of credentialKeys) if (text(creds[app])) patch[web] = text(creds[app])
    const trakt = token(creds.traktToken)
    const simkl = token(creds.simklToken)
    if (trakt) patch.traktAccount = trakt
    if (simkl) patch.simklAccount = simkl
  }
  return patch as Partial<Settings>
}

/** What a setup holds, for the review before it replaces anything. */
export interface SetupSummary {
  shelves: number
  servers: number
  webDAV: number
  providers: number
  addons: number
  hasKeys: boolean
  exportedAt?: Date
}

export function summariseSetup(bundle: SetupBundle): SetupSummary {
  const count = (path: string) => {
    const v = get(bundle.settings, path)
    return Array.isArray(v) ? v.length : 0
  }
  const at = Date.parse(bundle.exportedAt)
  return {
    shelves: count('shelves'),
    servers: count('mediaServers.servers'),
    webDAV: count('webDAV'),
    providers: count('liveTV.providers'),
    addons: count('sources.addons'),
    hasKeys: isObject(bundle.credentials) && Object.keys(bundle.credentials).length > 0,
    ...(Number.isFinite(at) ? { exportedAt: new Date(at) } : {}),
  }
}

/** The extras to keep once `bundle` has been applied: what it holds that the website's own export would not write. */
export function extrasFrom(bundle: SetupBundle, applied: Settings): SetupExtras {
  const mine = build(applied, true)
  return {
    settings: (leftovers(bundle.settings, mine.settings) as Json | undefined) ?? {},
    credentials: (leftovers(bundle.credentials ?? {}, mine.credentials) as Json | undefined) ?? {},
  }
}
