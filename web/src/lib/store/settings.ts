import { defaultLiveTV, type LiveTVSettings } from '../livetv/types'
import type { SourceOrdering } from '../sources/sourceSettings'
import type { AddonManifest } from '../sources/types'
import { defaultShelves, type HeroSource, type ShelfConfig } from '../shelfDefaults'
import { defaultTabOrder } from '../tabs'
import { createStore, useStore } from './createStore'
import { defaultSubtitleStyle, type SubtitleStyle } from './subtitleStyleDefault'

export interface AddonConfig {
  /** Manifest URL, e.g. https://example.com/manifest.json */
  url: string
  name: string
  enabled: boolean
  /** The manifest as it was when installed: logo, types and which ids it serves. */
  manifest?: AddonManifest
}

export interface ServerConfig {
  id: string
  kind: 'jellyfin' | 'emby' | 'plex'
  name: string
  url: string
  /** Access token, kept on this device only. */
  token: string
  userId?: string
  enabled: boolean
  /** The account signed in, shown under the server's name. */
  username?: string
  /** Plex's machine identifier, so a server found again on a new address isn't added twice. */
  machineId?: string
}

/** A WebDAV share, as the apps' WebDAVConfig: its address, an optional login and the two folders Flow scans. */
export interface WebDAVConfig {
  id: string
  name: string
  url: string
  username?: string
  /** Kept on this device only, and sent only to the share it belongs to. */
  password?: string
  /** Folders under the share's address, "/Movies" and "/TV Shows" unless the viewer says otherwise. */
  moviesPath: string
  showsPath: string
  enabled: boolean
}

/** The typefaces Settings offers. The ids are also the keys in index.html's pre-paint script and the
 *  `[data-font]` rules in styles/tokens.css. */
export type FontChoice = 'system' | 'inter' | 'geist' | 'manrope' | 'ioskeley'

/** When subtitles turn on by themselves: never, only when the audio isn't in the viewer's own
 *  language (the first subtitle language), or for every title. */
export type SubtitleMode = 'off' | 'foreign' | 'always'

/** What happens when an intro, recap or the credits begins: a Skip button, skipping by itself, or nothing.
 *  As FlowKit's SkipBehaviour. */
export type SkipBehaviour = 'off' | 'button' | 'automatic'

/** The apps that take a stream's link (ExternalPlayer in the apps' settings): "none" is Flow's own player. */
export type ExternalPlayerId = 'none' | 'infuse' | 'vlc' | 'outplayer' | 'senPlayer' | 'vidHub' | 'cineUltra' | 'moonPlayer' | 'iina' | 'mpv'

/** A Trakt sign-in in the shape Flow Sync and the apps keep it (docs/SYNC.md, accounts). `redirectURI` is the
 *  one the token was issued against; a refresh quotes it back. */
export interface TraktToken {
  accessToken: string
  refreshToken: string | null
  /** ISO 8601, or null when Trakt gave no lifetime. */
  expiresAt: string | null
  redirectURI: string | null
}

/** How large a title page's text is set, as the apps' DetailTextSize (Default is the page's own size). */
export type DetailTextSize = 'small' | 'standard' | 'large' | 'extraLarge'

export interface Settings {
  /** TMDB v3 API key or v4 read-access token. */
  tmdbKey: string
  /** The Client ID of the owner's own Trakt app. Trakt issues no secret for PKCE apps, so this is all it takes. */
  traktClientID: string
  /** Simkl's Client ID. The website doesn't sign in to Simkl yet; the field keeps the apps' value through Sync. */
  simklClientID: string
  /** Who the website is signed in to Trakt as. Travels through Flow Sync, so any device's sign-in arrives here. */
  traktAccount: TraktToken | null
  /** Sample data: every screen fills without keys or accounts. */
  demo: boolean
  onboarded: boolean
  language: string
  region: string
  includeAdult: boolean
  addons: AddonConfig[]
  servers: ServerConfig[]
  /** Settings → Media Servers, with the apps' names (`mediaServers.*`). Absent means the default, which keeps
   *  them out of the code that loads first: Show Badge on Posters is on, the other three off. */
  showBadgeOnPosters?: boolean
  onlyShowServerContent?: boolean
  useServerArtwork?: boolean
  /** Ignore the servers' own watched state and resume points, and stop telling them what plays. */
  trackOnlyWithTracker?: boolean
  /** The servers whose libraries get rows of their own on Home (Settings → Shelves → Server Home Rows). */
  serverHomeRowIDs?: string[]
  /** WebDAV shares (Settings → Media Servers). Absent means none. */
  webDAV?: WebDAVConfig[]
  /** Audio languages in order of preference: two-letter codes, and 'original' for the language the
   *  title was made in (TMDB's original language). */
  audioLanguages: string[]
  /** Subtitle language codes in order of preference. The first is "my language" for `subtitleMode`. */
  subtitleLanguages: string[]
  subtitleMode: SubtitleMode
  /** How subtitles look. The keys are the apps' (`subtitles.fontScale` and the rest in FlowKit). */
  subtitleStyle: SubtitleStyle
  autoplayNext: boolean
  /** After this many episodes play one after another with nobody touching anything, Flow asks
   *  before starting the next. Zero never asks. As the apps' `stillWatchingAfterEpisodes`. */
  stillWatchingAfterEpisodes: number
  /** Absent means off, except for the post-credits alert and Because You Watched, where it means on (these six are
   *  left out of the defaults to keep the first visit's code small).
   *  Up Next waits for the episode to end instead of counting down as its credits start. */
  upNextWaitsForEnd?: boolean
  skipIntro: SkipBehaviour
  skipRecap: SkipBehaviour
  skipCredits: SkipBehaviour
  /** IntroDB and PublicMetaDB API keys: where skip times come from for titles your servers don't
   *  mark. Named as in Flow Sync (`introDBAPIKey`, `publicMetaDBAPIKey`). Empty means not asked. */
  introDBKey: string
  publicMetaDBKey: string
  /** Say so as a film's credits begin when it has a scene during or after them (TMDB's stinger keywords). */
  postCreditsAlert?: boolean
  /** Suggest films like it as a film's credits roll, and when it ends. */
  becauseYouWatched?: boolean
  /** Play Dolby Vision files as their HDR10 picture (MKV files Flow plays itself). */
  neverUseDolbyVision?: boolean
  /** Extra loudness in whole decibels, 0 to 12 (the apps' `volumeBoostDB`); played through a Web Audio gain where the browser allows it. */
  volumeBoostDB?: number
  /** The app "Open in" leads with in the player's options. It is never opened by itself: a web page can't tell whether the app is installed. */
  externalPlayer?: ExternalPlayerId
  preferredQuality: '2160p' | '1080p' | '720p' | 'any'
  /** The picker offers the source a title was last played from first. */
  rememberLastSource: boolean
  /** How found sources are ordered, filtered and shown (Settings → Sources), as FlowKit's `sources` settings.
   *  Absent until the viewer changes something; read it through `normaliseSourceOrdering`, which supplies the
   *  defaults. That keeps the defaults out of the code that loads first. */
  sources?: SourceOrdering
  /** The typeface the whole site is set in; System is the device's own and downloads nothing. */
  font: FontChoice
  /** The order of the sections in the top bar and the phone's tab bar, by id (lib/tabs.ts). A section this
   *  list doesn't name yet takes its default place. */
  tabOrder: string[]
  /** Where files from hosts that block web pages are fetched through: a URL with `{url}` for the
   *  encoded file address. Empty means no proxy. */
  streamProxy: string
  /** Title pages, as the apps' Detail Views: About adds status, language, country, money and companies to the
   *  essentials (which are always there); Where to Watch and Reviews are sections; Episode Spoilers off blurs the
   *  still and hides the synopsis of an aired episode not yet watched; Specials Season lists season 0. */
  showAboutSection: boolean
  showWhereToWatch: boolean
  showReviews: boolean
  showEpisodeSpoilers: boolean
  showSpecialsSeason: boolean
  detailTextSize: DetailTextSize
  /** IPTV providers, the guide's refresh time and the favourite channels (FlowKit's LiveTVSettings). */
  liveTV: LiveTVSettings
  /** Home's shelves, in order: built-in rows, Discover shelves and (later) lists, as the apps' `shelves`. */
  shelves: ShelfConfig[]
  /** Where Home's top pick comes from when nothing is in progress, and a second source mixed in. */
  heroSource: HeroSource
  heroSecondarySource: HeroSource | null
  /** The lead turns through its picks by itself (never while something is in progress, or with reduced motion). */
  heroAutoAdvance: boolean
  /** How many titles each catalogue shelf holds. */
  contentShelfLength: number
  showContinueWatching: boolean
  /** Most recent kept in Continue Watching; null keeps all. */
  continueWatchingLimit: number | null
  showUpcoming: boolean
  /** Upcoming also lists season premieres of shows on the watchlist. */
  includeWatchlistPremieres: boolean
  upcomingWithinDays: number
  /** WATCHED on a poster's strip, and the episodes of a series left. */
  showWatchedBadges: boolean
  showEpisodesRemaining: boolean
}

const browserLanguage = typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US'

export const defaultSettings: Settings = {
  tmdbKey: import.meta.env.VITE_TMDB_KEY ?? '',
  traktClientID: '',
  simklClientID: '',
  traktAccount: null,
  demo: false,
  onboarded: false,
  language: browserLanguage.includes('-') ? browserLanguage : `${browserLanguage}-US`,
  region: browserLanguage.split('-')[1]?.toUpperCase() ?? 'US',
  includeAdult: false,
  addons: [],
  servers: [],
  audioLanguages: ['original', browserLanguage.slice(0, 2).toLowerCase()],
  subtitleLanguages: [browserLanguage.slice(0, 2).toLowerCase()],
  subtitleMode: 'foreign',
  subtitleStyle: defaultSubtitleStyle,
  autoplayNext: true,
  stillWatchingAfterEpisodes: 3,
  skipIntro: 'button',
  skipRecap: 'button',
  skipCredits: 'button',
  introDBKey: '',
  publicMetaDBKey: '',
  preferredQuality: '1080p',
  rememberLastSource: true,
  font: 'system',
  tabOrder: [...defaultTabOrder],
  streamProxy: '',
  showAboutSection: true,
  showWhereToWatch: true,
  showReviews: true,
  showEpisodeSpoilers: true,
  showSpecialsSeason: true,
  detailTextSize: 'standard',
  liveTV: defaultLiveTV,
  shelves: defaultShelves,
  heroSource: 'trending',
  heroSecondarySource: null,
  heroAutoAdvance: true,
  contentShelfLength: 20,
  showContinueWatching: true,
  continueWatchingLimit: null,
  showUpcoming: true,
  includeWatchlistPremieres: false,
  upcomingWithinDays: 7,
  showWatchedBadges: true,
  showEpisodesRemaining: true,
}

export const settingsStore = createStore<Settings>('settings', defaultSettings)

/** `?demo` in the address (or the onboarding button) turns sample data on, like -FlowDemo YES. */
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')) {
  settingsStore.set({ demo: true, onboarded: true })
}

export const useSettings = <S,>(selector: (s: Settings) => S) => useStore(settingsStore, selector)
export const hasCatalog = (s: Settings) => s.demo || s.tmdbKey.length > 0
