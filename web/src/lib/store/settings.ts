import type { SportsSettings } from '../sports/types'
import { defaultLiveTV, type LiveTVSettings } from '../livetv/types'
import type { RatingSource } from '../ratings/sources'
import type { SourceOrdering } from '../sources/sourceSettings'
import type { SubtitleOptions } from '../subtitles/options'
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

/** A WebDAV share, as the apps' WebDAVConfig: its address, an optional login and the two folders Marquee scans. */
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

/** The typeface choice of the old design. Marquee is set in Index's four faces now and nothing reads this; the
 *  ids stay valid so a backup or a synced setting from before still loads. */
export type FontChoice = 'system' | 'inter' | 'geist' | 'manrope' | 'ioskeley'

/** When subtitles turn on by themselves: never, only when the audio isn't in the viewer's own
 *  language (the first subtitle language), for every title, or only the forced ones the file carries.
 *  As FlowKit's AutoSubtitleMode (automatic, always, forcedOnly, never). */
export type SubtitleMode = 'off' | 'foreign' | 'always' | 'forced'

/** What happens when an intro, recap or the credits begins: a Skip button, skipping by itself, or nothing.
 *  As FlowKit's SkipBehaviour. */
export type SkipBehaviour = 'off' | 'button' | 'automatic'

/** The apps that take a stream's link (ExternalPlayer in the apps' settings): "none" is Marquee's own player. */
export type ExternalPlayerId = 'none' | 'infuse' | 'vlc' | 'outplayer' | 'senPlayer' | 'vidHub' | 'cineUltra' | 'moonPlayer' | 'iina' | 'mpv'

/** A Trakt sign-in in the shape Marquee Sync and the apps keep it (docs/SYNC.md, accounts). `redirectURI` is the
 *  one the token was issued against; a refresh quotes it back. */
export interface TraktToken {
  accessToken: string
  refreshToken: string | null
  /** ISO 8601, or null when Trakt gave no lifetime. */
  expiresAt: string | null
  redirectURI: string | null
}

/** The service that keeps watch history, as the apps' TrackerKind. */
export type TrackerKind = 'trakt' | 'simkl' | 'publicMetaDB' | 'mdblist' | 'local'

/** A place a list can be saved, as the apps' ListDestination (PublicMetaDB and a media server are apps only). */
export type ListDestination = 'trakt' | 'simkl' | 'mdblist' | 'local'

/** How large a title page's text is set, as the apps' DetailTextSize (Default is the page's own size). */
export type DetailTextSize = 'small' | 'standard' | 'large' | 'extraLarge'

export interface Settings {
  /** TMDB v3 API key or v4 read-access token. */
  tmdbKey: string
  /** The Client ID of the owner's own Trakt app. Trakt issues no secret for PKCE apps, so this is all it takes. */
  traktClientID: string
  /** The Client ID of the owner's Simkl app. Simkl signs in with a code, so there is no secret and no redirect. */
  simklClientID: string
  /** Who the website is signed in to Trakt as. Travels through Marquee Sync, so any device's sign-in arrives here. */
  traktAccount: TraktToken | null
  /** The same for Simkl: its token has no refresh token or expiry, and travels through Marquee Sync like Trakt's. */
  simklAccount: TraktToken | null
  /** The one service that tracks (Settings → Account → Tracking With). Absent means never chosen: the first sign-in
   *  (Trakt, then Simkl) tracks, as when the apps adopt a sign-in that arrives through Sync. */
  tracker?: TrackerKind
  /** Where Add to Watchlist and the heart button save (Settings → Account), as the apps' `watchlistDestination` and
   *  `favouritesDestination`. Absent: the watchlist follows Tracking With, and favourites stay on this device. */
  watchlistDestination?: ListDestination
  favouritesDestination?: ListDestination
  /** How often history syncs by itself, in seconds (the apps' `syncInterval`): 0 is whenever Marquee opens or is
   *  returned to, then 900, 3600, 10800, 43200 or 86400. Absent is three hours. Sync Now always syncs. */
  syncInterval?: number
  /** Tell the tracking service what is playing while it plays (the apps' `scrobble`). Absent is on. */
  scrobble?: boolean
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
  /** After this many episodes play one after another with nobody touching anything, Marquee asks
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
   *  mark. Named as in Marquee Sync (`introDBAPIKey`, `publicMetaDBAPIKey`). Empty means not asked. */
  introDBKey: string
  publicMetaDBKey: string
  // Ratings, requests and episode numbering (Settings → Metadata and Requests). Like the fields above they are left out of
  // the defaults, which keeps the first visit's code small; absent means the apps' default, noted on each.
  /** MDBList, TVDB and RatingPosterDB API keys, named as in Marquee Sync (`mdblistAPIKey`, `tvdbAPIKey`, `rpdbAPIKey`). */
  mdblistKey?: string
  tvdbKey?: string
  rpdbKey?: string
  /** Where episode numbering comes from. Absent is TVDB, the apps' default; without its key that is TMDB's. */
  episodeSource?: 'tvdb' | 'tmdb' | 'trakt'
  /** The scores a title page shows, in order. Absent is all of them. */
  ratingsShown?: RatingSource[]
  /** A score opens that site's page for the title. Absent is on: on the web it is a plain link. */
  tapRatingOpensReviews?: boolean
  /** Rated posters from RatingPosterDB (needs its key). Absent is off. */
  posterEnhancement?: 'off' | 'rpdb'
  /** The Seerr, Overseerr or Jellyseerr instance Request asks. Part of Marquee Sync (the requests section). */
  seerr?: { url: string; key: string }
  /** The subtitle services' keys and logins (Settings → Playback), named as in Marquee Sync (`openSubtitlesAPIKey`,
   *  `openSubtitlesUsername`, `openSubtitlesPassword`, `subdlAPIKey`, `subSourceAPIKey`). Absent until set, which keeps
   *  them out of the code that loads first; the website sends no login to OpenSubtitles (see lib/subtitles/providers.ts). */
  openSubtitlesKey?: string
  openSubtitlesUsername?: string
  openSubtitlesPassword?: string
  subdlKey?: string
  subSourceKey?: string
  /** Wyzie asks for a free key now; it syncs as `wyzieAPIKey`. */
  wyzieKey?: string
  /** Subtitle Type, Anime Audio, Keep Original ASS Styling and which services are on. Absent until the viewer
   *  changes something; read it through `normaliseSubtitleOptions`. */
  subtitleOptions?: SubtitleOptions
  /** Settings → Metadata and Account, as the apps' `metadata.*` and `account.*` fields. Absent means the apps' default, noted on each. */
  /** Show Unreleased Titles: off drops titles that can't be played yet from Home, Explore and the trending rows. On when absent. */
  showUnreleasedTitles?: boolean
  /** Air Dates in My Time Zone: an episode with a known air time (Trakt's) is dated in the viewer's day. On when absent. */
  airDatesInLocalTimeZone?: boolean
  /** Prefetch on Detail View: a title page asks the sources as it opens, so Play is quick. On when absent. */
  prefetchOnDetail?: boolean
  /** Where IntroDB and PublicMetaDB are asked, for a deployment of your own. Absent or empty is the public address. */
  introDBBaseURL?: string
  publicMetaDBBaseURL?: string
  /** Say so as a film's credits begin when it has a scene during or after them (TMDB's stinger keywords). */
  postCreditsAlert?: boolean
  /** Suggest films like it as a film's credits roll, and when it ends. */
  becauseYouWatched?: boolean
  /** X-Ray (who's in the scene, the cast and crew, the scenes) opens beside the picture whenever playback is paused; the
   *  apps' `playback.xrayWhenPaused`. Absent means on. */
  xrayWhenPaused?: boolean
  /** Play Dolby Vision files as their HDR10 picture (MKV files Marquee plays itself). */
  neverUseDolbyVision?: boolean
  /** Rank HDR releases first when the screen shows HDR (the apps' `preferHDR`, on unless set); off ranks SDR first. */
  preferHDR?: boolean
  /** Extra loudness in whole decibels, 0 to 12 (the apps' `volumeBoostDB`); played through a Web Audio gain where the browser allows it. */
  volumeBoostDB?: number
  /** The app "Open in" leads with in the player's options. It is never opened by itself: a web page can't tell whether the app is installed. */
  externalPlayer?: ExternalPlayerId
  // Resume, seeking and failing over (Settings → Playback → Resume & Progress and Formats). Absent means the apps' default,
  // noted on each; features/player/preferences.ts reads them.
  /** Ask Resume or Start Over before playing from a saved place (the apps' `askToResume`). Absent is on; off resumes quietly. */
  askToResume?: boolean
  /** Played this far, a title counts as watched (`watchedThresholdPercent`): 80, 85, 90 or 95. Absent is 90. */
  watchedThresholdPercent?: number
  /** The Back and Forward buttons, double-tap and arrow keys (`seekBackwardSeconds`, `seekForwardSeconds`): 5, 10, 15 or 30. Absent is 10. */
  seekBackwardSeconds?: number
  seekForwardSeconds?: number
  /** Seconds on Up Next's countdown (`nextEpisodeCountdownSeconds`): 5, 10, 15, 20 or 30. Absent is 10. */
  nextEpisodeCountdownSeconds?: number
  /** A show starts every episode with the audio and subtitle languages picked in its first (`rememberTracksPerShow`). Absent is on. */
  rememberTracksPerShow?: boolean
  /** A source that fails to start gives way to the next one without asking (`tryNextSourceOnFailure`). Absent is on. */
  tryNextSourceOnFailure?: boolean
  /** The progress bar on the loading screen (`showLoadingProgress`). Absent is on. */
  showLoadingProgress?: boolean
  /** MKV files play in Marquee, or are handed to the external player above (`matroskaPlayback`). Absent is in Marquee. */
  matroskaPlayback?: 'remux' | 'external'
  /** Decode DTS and Dolby TrueHD while playing (`decodeLosslessAudio`). Absent is on. */
  decodeLosslessAudio?: boolean
  /** The tallest picture picked for you while the browser reports Data Saver or a slow connection (`cellularResolutionCap`). Absent is no cap. */
  cellularResolutionCap?: CellularCap
  /** Subtitle Sync Offset: where every title's subtitle delay starts, in seconds (`subtitles.defaultOffsetSeconds`). Absent is none. */
  defaultSubtitleOffset?: number
  /** Subtitle Auto-sync is offered in the player's Subtitle Delay page (`subtitles.autoSync`). Absent is off, as in the apps. */
  subtitleAutoSync?: boolean
  /** Tapping a Continue Watching card plays at once instead of opening the title (`playback.skipDetailsOnContinueWatching`). Absent is on. Read it with `useSkipDetails`. */
  skipDetailsOnContinueWatching?: boolean
  /** The player's Picture in Picture button (`playback.pictureInPicture`). Absent is on. */
  pictureInPicture?: boolean
  /** Full screen turns a phone to landscape where the browser allows it (`playback.autoRotate`). Absent is on. */
  autoRotate?: boolean
  preferredQuality: '2160p' | '1080p' | '720p' | 'any'
  /** The picker offers the source a title was last played from first. */
  rememberLastSource: boolean
  /** How found sources are ordered, filtered and shown (Settings → Sources), as FlowKit's `sources` settings.
   *  Absent until the viewer changes something; read it through `normaliseSourceOrdering`, which supplies the
   *  defaults. That keeps the defaults out of the code that loads first. */
  sources?: SourceOrdering
  /** Retired (see FontChoice): kept so saved settings, backups and syncs that carry it stay valid. */
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
  /** Followed teams, TheSportsDB's key and how a game opens (the apps' `sports`). Absent until the first change; read it
   *  through `sportsSettings`, which supplies the defaults, so none of this loads with the first page. */
  sports?: SportsSettings
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
  /** Which release a watchlisted film is dated by in Upcoming (the apps' Film Dates). Digital when absent. */
  filmDates?: 'digital' | 'theatrical'
  /** WATCHED on a poster's strip, and the episodes of a series left. */
  showWatchedBadges: boolean
  showEpisodesRemaining: boolean
  // Home and posters, as the apps' `general.*`. Left out of the defaults like the fields above; absent means the apps' default, noted on each.
  /** The top pick as a framed still beside Up Next (Card, the default) or as the backdrop edge to edge (Fullscreen). */
  heroStyle?: 'card' | 'fullscreen'
  /** The title under each poster. Absent is on. */
  showPosterTitles?: boolean
  /** The release year under a poster's title, or alone when titles are hidden. Absent is off. */
  showReleaseYear?: boolean
  /** The release year ends a Continue Watching card's line of facts. Absent is on. */
  showContinueWatchingReleaseDate?: boolean
  /** The tab the site opens on, by id (lib/tabs.ts). Absent is Home. */
  startTab?: string
}

/** The pictures Resolution on Cellular can cap at, as heights in the names the sources use. */
export type CellularCap = '2160p' | '1440p' | '1080p' | '720p' | '480p'

const browserLanguage = typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US'

export const defaultSettings: Settings = {
  tmdbKey: import.meta.env.VITE_TMDB_KEY ?? '',
  traktClientID: '',
  simklClientID: '',
  traktAccount: null,
  simklAccount: null,
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
  showUpcoming: false,
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

/** Whether a Continue Watching card should play straight away (true, the apps' default) or open the title. Home's
 *  Lead and Continue cards read this to choose their link. */
export const useSkipDetails = () => useSettings((x) => x.skipDetailsOnContinueWatching !== false)
