/* The subtitle settings beyond language and style, with FlowKit's names and values (SubtitleTypePreference,
   AnimeAudio, SubtitleSettings.keepASSStyling and enabledProviders). They live in one optional object on
   the settings, absent until the viewer changes something, so nothing here loads with the first page. */

import type { Settings } from '../store/settings'
import { providerIds, type Credentials, type ProviderId } from './types'

/** Which kind of subtitle is chosen when a language has both: plain dialogue, or SDH (sound cues and speakers too). */
export type SubtitleType = 'standard' | 'sdh'
export const subtitleTypes: { value: SubtitleType; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'sdh', label: 'SDH' },
]

/** For anime (Japanese animation): Sub plays Japanese audio with subtitles, Dub plays the viewer's language without them. */
export type AnimeAudio = 'noPreference' | 'sub' | 'dub'
export const animeAudios: { value: AnimeAudio; label: string }[] = [
  { value: 'noPreference', label: 'No Preference' },
  { value: 'sub', label: 'Sub' },
  { value: 'dub', label: 'Dub' },
]

export interface SubtitleOptions {
  type: SubtitleType
  animeAudio: AnimeAudio
  /** Draw ASS/SSA subtitles the way their author styled them, with libass. */
  keepASSStyling: boolean
  /** The services that are asked, as the apps' `enabledProviders`. */
  providers: ProviderId[]
}

export const defaultSubtitleOptions: SubtitleOptions = { type: 'standard', animeAudio: 'noPreference', keepASSStyling: false, providers: [...providerIds] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** True for an object whose fields, where present, are what they should be. Missing ones take their defaults. */
export function isSubtitleOptions(v: unknown): v is Partial<SubtitleOptions> {
  if (!isObject(v)) return false
  return (
    (v.type === undefined || subtitleTypes.some((t) => t.value === v.type)) &&
    (v.animeAudio === undefined || animeAudios.some((a) => a.value === v.animeAudio)) &&
    (v.keepASSStyling === undefined || typeof v.keepASSStyling === 'boolean') &&
    (v.providers === undefined || (Array.isArray(v.providers) && v.providers.every((p) => providerIds.includes(p as ProviderId))))
  )
}

/** The saved options with every missing field at its default. */
export function normaliseSubtitleOptions(saved: unknown): SubtitleOptions {
  if (!isSubtitleOptions(saved)) return defaultSubtitleOptions
  return {
    type: saved.type ?? defaultSubtitleOptions.type,
    animeAudio: saved.animeAudio ?? defaultSubtitleOptions.animeAudio,
    keepASSStyling: saved.keepASSStyling ?? defaultSubtitleOptions.keepASSStyling,
    providers: saved.providers ? [...new Set(saved.providers)] : [...defaultSubtitleOptions.providers],
  }
}

/** What each service needs: a key. (Wyzie used to need none; it asks for a free one now.) */
const needs: Record<ProviderId, (c: Credentials) => string | undefined> = {
  opensubtitles: (c) => c.openSubtitlesKey,
  subdl: (c) => c.subdlKey,
  wyzie: (c) => c.wyzieKey,
  subsource: (c) => c.subSourceKey,
}

/** True when the viewer has given this service what it needs. */
export const hasCredentials = (id: ProviderId, c: Credentials): boolean => !!needs[id](c)?.trim()

/** The services the viewer turned on and has a key for, in the apps' order. */
export const usableProviders = (c: Credentials, enabled: readonly ProviderId[] = providerIds): ProviderId[] => providerIds.filter((id) => enabled.includes(id) && hasCredentials(id, c))

/** The keys and logins as the search wants them. */
export const credentialsOf = (s: Settings): Credentials => ({
  openSubtitlesKey: s.openSubtitlesKey,
  openSubtitlesUsername: s.openSubtitlesUsername,
  openSubtitlesPassword: s.openSubtitlesPassword,
  subdlKey: s.subdlKey,
  subSourceKey: s.subSourceKey,
  wyzieKey: s.wyzieKey,
})
