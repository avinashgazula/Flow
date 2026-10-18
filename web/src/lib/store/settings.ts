import { createStore, useStore } from './createStore'

export interface AddonConfig {
  /** Manifest URL, e.g. https://example.com/manifest.json */
  url: string
  name: string
  enabled: boolean
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
}

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
  /** Subtitle language codes in order of preference. */
  subtitleLanguages: string[]
  autoplayNext: boolean
  preferredQuality: '2160p' | '1080p' | '720p' | 'any'
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
  subtitleLanguages: [browserLanguage.slice(0, 2)],
  autoplayNext: true,
  preferredQuality: '1080p',
}

export const settingsStore = createStore<Settings>('settings', defaultSettings)

/** `?demo` in the address (or the onboarding button) turns sample data on, like -FlowDemo YES. */
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')) {
  settingsStore.set({ demo: true, onboarded: true })
}

export const useSettings = <S,>(selector: (s: Settings) => S) => useStore(settingsStore, selector)
export const hasCatalog = (s: Settings) => s.demo || s.tmdbKey.length > 0
