/* Which audio track and subtitles a stream starts with. Pure, so the rules are tested without a
   browser: the controller feeds in the tracks the engine found and applies what comes back.

   Order of precedence: what the viewer picked in the player for this title or show, then
   Settings → Playback, then whatever the stream itself marks as default. */

import { baseLanguage, languageCode, resolveAudioLanguages, sameLanguage } from '../../lib/language'
import type { SubtitleMode } from '../../lib/store/settings'

export interface TrackInfo {
  id: string
  label: string
  language?: string
  /** Why it can't be chosen (a DTS track in a browser that can't decode it). */
  unavailable?: string
}

export interface LanguagePreferences {
  /** Two-letter codes in order, with 'original' for the language the title was made in. */
  audioLanguages: string[]
  subtitleLanguages: string[]
  subtitleMode: SubtitleMode
}

/** What the viewer picked by hand for a title: languages, so they carry over to the next episode
 *  (whose tracks have other ids). Null for subtitles means they turned them off. */
export interface TitleChoice {
  audio?: string
  subtitle?: string | null
}

/** Commentary and audio-description tracks are never a default: they sound like the film, with
 *  someone talking over it. */
export const isCommentary = (t: TrackInfo): boolean => /commentar|audio description|descriptive|visually impaired|\bAD\b/i.test(t.label)

/** Forced subtitles carry only the lines a viewer couldn't follow in the audio's own language. */
export const isForced = (t: TrackInfo): boolean => /\bforced\b/i.test(t.label)

/** The language of a track: its tag, else the name it's labelled with ("English (SDH)"). */
export function trackLanguage(t: TrackInfo): string | undefined {
  return baseLanguage(t.language) ?? languageCode(t.label.split(/[\s(·,-]/)[0] ?? '')
}

/** The language a release says its audio is in, when it names exactly one: "English" gives "en".
 *  A dual-audio or multi release could be playing either, so it says nothing. */
export function releaseLanguage(languages?: string[]): string | undefined {
  const named = languages?.filter((l) => l !== 'Multi')
  return named?.length === 1 && named.length === languages?.length ? languageCode(named[0]!) : undefined
}

/** The audio track to start on, or undefined when nothing matches (the stream's own default
 *  then stands). A track that can't play here, or is commentary, is never picked. */
export function pickAudio(tracks: TrackInfo[], o: { languages: string[]; original?: string; choice?: TitleChoice }): TrackInfo | undefined {
  const usable = tracks.filter((t) => !t.unavailable && !isCommentary(t))
  const wanted = [o.choice?.audio, ...resolveAudioLanguages(o.languages, o.original)]
  for (const language of wanted) {
    if (!language) continue
    const hit = usable.find((t) => sameLanguage(trackLanguage(t), language))
    if (hit) return hit
  }
  return undefined
}

const fullIn = (usable: TrackInfo[], language: string) => usable.find((t) => !isForced(t) && sameLanguage(trackLanguage(t), language))

/** The subtitle to start with, or null for none. `audioLanguage` is what will be heard (undefined
 *  when nobody can say, which never counts as foreign). */
export function pickSubtitle(subtitles: TrackInfo[], o: { audioLanguage?: string; preferences: Pick<LanguagePreferences, 'subtitleLanguages' | 'subtitleMode'>; choice?: TitleChoice }): TrackInfo | null {
  const usable = subtitles.filter((t) => !t.unavailable)
  const { choice } = o
  if (choice?.subtitle === null) return null
  if (choice?.subtitle) {
    const chosen = fullIn(usable, choice.subtitle) ?? usable.find((t) => sameLanguage(trackLanguage(t), choice.subtitle ?? undefined))
    if (chosen) return chosen
  }

  const { subtitleLanguages, subtitleMode } = o.preferences
  const mine = subtitleLanguages[0]
  const heard = baseLanguage(o.audioLanguage)
  const foreign = !!heard && !!mine && !sameLanguage(heard, mine)
  const wanted = !!mine && (subtitleMode === 'always' || (subtitleMode === 'foreign' && foreign))
  if (wanted) {
    for (const language of subtitleLanguages) {
      const hit = fullIn(usable, language)
      if (hit) return hit
    }
    // Always means always: a track that is only the forced lines beats none.
    if (subtitleMode === 'always') {
      for (const language of subtitleLanguages) {
        const hit = usable.find((t) => sameLanguage(trackLanguage(t), language))
        if (hit) return hit
      }
    }
    return null
  }
  // Even with subtitles off a film's forced track for its own audio stays on: it translates the
  // lines the audio leaves in another language, as Apple's players do.
  return heard ? (usable.find((t) => isForced(t) && sameLanguage(trackLanguage(t), heard)) ?? null) : null
}

export { resolveAudioLanguages }

// MARK: Memory

export type TitleChoices = Record<string, TitleChoice & { at: number }>

/** The saved choices with `patch` merged into the one for `key`. The oldest go once there are
 *  more than `limit` titles, so this never grows without end. */
export function mergeChoice(all: TitleChoices, key: string, patch: TitleChoice, now = Date.now(), limit = 100): TitleChoices {
  const next = { ...all, [key]: { ...all[key], ...patch, at: now } }
  const kept = Object.entries(next).sort((a, b) => b[1].at - a[1].at).slice(0, limit)
  return Object.fromEntries(kept)
}
