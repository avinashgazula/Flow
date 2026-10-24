import { defaultLiveTV, type LiveTVSettings } from '../livetv/types'
import type { AddonManifest } from '../sources/types'
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

/** The typefaces Settings offers. The ids are also the keys in index.html's pre-paint script and the
 *  `[data-font]` rules in styles/tokens.css. */
export type FontChoice = 'system' | 'inter' | 'geist' | 'manrope' | 'ioskeley'

/** When subtitles turn on by themselves: never, only when the audio isn't in the viewer's own
 *  language (the first subtitle language), or for every title. */
export type SubtitleMode = 'off' | 'foreign' | 'always'

/** What happens when an intro, recap or the credits begins: a Skip button, skipping by itself, or nothing.
 *  As FlowKit's SkipBehaviour. */
export type SkipBehaviour = 'off' | 'button' | 'automatic'

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
  skipIntro: SkipBehaviour
  skipRecap: SkipBehaviour
  skipCredits: SkipBehaviour
  /** IntroDB and PublicMetaDB API keys: where skip times come from for titles your servers don't
   *  mark. Named as in Flow Sync (`introDBAPIKey`, `publicMetaDBAPIKey`). Empty means not asked. */
  introDBKey: string
  publicMetaDBKey: string
  preferredQuality: '2160p' | '1080p' | '720p' | 'any'
  /** The picker offers the source a title was last played from first. */
  rememberLastSource: boolean
  /** The typeface the whole site is set in; System is the device's own and downloads nothing. */
  font: FontChoice
  /** The order of the sections in the top bar and the phone's tab bar, by id (lib/tabs.ts). A section this
   *  list doesn't name yet takes its default place. */
  tabOrder: string[]
  /** Where files from hosts that block web pages are fetched through: a URL with `{url}` for the
   *  encoded file address. Empty means no proxy. */
  streamProxy: string
  /** IPTV providers, the guide's refresh time and the favourite channels (FlowKit's LiveTVSettings). */
  liveTV: LiveTVSettings
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
  liveTV: defaultLiveTV,
}

export const settingsStore = createStore<Settings>('settings', defaultSettings)

/** `?demo` in the address (or the onboarding button) turns sample data on, like -FlowDemo YES. */
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')) {
  settingsStore.set({ demo: true, onboarded: true })
}

export const useSettings = <S,>(selector: (s: Settings) => S) => useStore(settingsStore, selector)
export const hasCatalog = (s: Settings) => s.demo || s.tmdbKey.length > 0
