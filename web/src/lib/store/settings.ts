import type { AddonManifest } from '../sources/types'
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

export interface Settings {
  /** TMDB v3 API key or v4 read-access token. */
  tmdbKey: string
  /** Sample data: every screen fills without keys or accounts. */
  demo: boolean
  onboarded: boolean
  language: string
  region: string
  includeAdult: boolean
  addons: AddonConfig[]
  servers: ServerConfig[]
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
  /** Up Next waits for the episode to end instead of counting down as its credits start. */
  upNextWaitsForEnd: boolean
  skipIntro: SkipBehaviour
  skipRecap: SkipBehaviour
  skipCredits: SkipBehaviour
  /** IntroDB and PublicMetaDB API keys: where skip times come from for titles your servers don't
   *  mark. Named as in Flow Sync (`introDBAPIKey`, `publicMetaDBAPIKey`). Empty means not asked. */
  introDBKey: string
  publicMetaDBKey: string
  /** Say so as a film's credits begin when it has a scene during or after them (TMDB's stinger keywords). */
  postCreditsAlert: boolean
  /** Suggest films like it as a film's credits roll, and when it ends. */
  becauseYouWatched: boolean
  /** Play Dolby Vision files as their HDR10 picture (MKV files Flow plays itself). */
  neverUseDolbyVision: boolean
  /** Extra loudness in whole decibels, 0 to 12 (the apps' `volumeBoostDB`); played through a Web Audio gain where the browser allows it. */
  volumeBoostDB: number
  /** The app "Open in" leads with in the player's options. It is never opened by itself: a web page can't tell whether the app is installed. */
  externalPlayer: ExternalPlayerId
  preferredQuality: '2160p' | '1080p' | '720p' | 'any'
  /** The picker offers the source a title was last played from first. */
  rememberLastSource: boolean
  /** The typeface the whole site is set in; System is the device's own and downloads nothing. */
  font: FontChoice
  /** Where files from hosts that block web pages are fetched through: a URL with `{url}` for the
   *  encoded file address. Empty means no proxy. */
  streamProxy: string
}

const browserLanguage = typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US'

export const defaultSettings: Settings = {
  tmdbKey: import.meta.env.VITE_TMDB_KEY ?? '',
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
  upNextWaitsForEnd: false,
  skipIntro: 'button',
  skipRecap: 'button',
  skipCredits: 'button',
  introDBKey: '',
  publicMetaDBKey: '',
  postCreditsAlert: true,
  becauseYouWatched: true,
  neverUseDolbyVision: false,
  volumeBoostDB: 0,
  externalPlayer: 'none',
  preferredQuality: '1080p',
  rememberLastSource: true,
  font: 'system',
  streamProxy: '',
}

export const settingsStore = createStore<Settings>('settings', defaultSettings)

/** `?demo` in the address (or the onboarding button) turns sample data on, like -FlowDemo YES. */
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')) {
  settingsStore.set({ demo: true, onboarded: true })
}

export const useSettings = <S,>(selector: (s: Settings) => S) => useStore(settingsStore, selector)
export const hasCatalog = (s: Settings) => s.demo || s.tmdbKey.length > 0
