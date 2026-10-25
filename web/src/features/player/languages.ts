/* Which audio track and subtitles a stream starts with. Pure, so the rules are tested without a
   browser: the controller feeds in the tracks the engine found and applies what comes back.

   Order of precedence: what the viewer picked in the player for this title or show, then
   Settings → Playback, then whatever the stream itself marks as default. */

import { baseLanguage, languageCode, resolveAudioLanguages, sameLanguage } from '../../lib/language'
import type { SubtitleMode } from '../../lib/store/settings'
import type { AnimeAudio, SubtitleType } from '../../lib/subtitles/options'

export interface TrackInfo {
  id: string
  label: string
  language?: string
  /** Why it can't be chosen (a DTS track in a browser that can't decode it). */
  unavailable?: string
  /** Plays only by being converted (TrueHD, DTS, Dolby Digital where the browser has no decoder). */
  converted?: boolean
  /** Downloaded from a subtitle service for this viewing, not carried by the file or its source: the file's own
   *  come first, since they're timed to this cut. */
  online?: boolean
  /** Subtitles for the deaf and hard of hearing. Else read from the label. */
  hearingImpaired?: boolean
}

export interface LanguagePreferences {
  /** Two-letter codes in order, with 'original' for the language the title was made in. */
  audioLanguages: string[]
  subtitleLanguages: string[]
  subtitleMode: SubtitleMode
  /** Which kind to take when a language has both. Standard when unset. */
  subtitleType?: SubtitleType
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

/** SDH: dialogue with the sound cues and speakers in it, for the deaf and hard of hearing. */
export const isSDH = (t: TrackInfo): boolean => t.hearingImpaired ?? /\bSDH\b|\bHoH\b|\bCC\b|hearing[- ]impaired|closed caption|\bdeaf\b/i.test(t.label)

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

// MARK: Anime

/** TMDB's Animation genre. */
const animationGenre = 16

/** Anime is Japanese animation: the Animation genre with Japanese as the original language (FlowKit's TrackSelection.isAnime). */
export const isAnime = (genres: readonly number[] | undefined, originalLanguage: string | undefined): boolean => !!genres?.includes(animationGenre) && baseLanguage(originalLanguage) === 'ja'

/** What the Anime Audio setting asks of this title: nothing unless it is anime and Sub or Dub is chosen. */
export const animeRule = (anime: boolean, setting: AnimeAudio | undefined): 'sub' | 'dub' | undefined => (anime && (setting === 'sub' || setting === 'dub') ? setting : undefined)

/** The audio languages in the order they're tried: Sub puts Japanese ahead of the viewer's own (as the apps do);
 *  what was picked by hand for the title still comes before all of them (`pickAudio`'s `choice`). */
export function audioLanguagesFor(languages: string[], rule: 'sub' | 'dub' | undefined): string[] {
  return rule === 'sub' ? ['ja', ...languages.filter((l) => l !== 'ja')] : languages
}

// MARK: Audio

/** The audio track to start on, or undefined when nothing matches (the stream's own default
 *  then stands). A track that can't play here, or is commentary, is never picked. */
export function pickAudio(tracks: TrackInfo[], o: { languages: string[]; original?: string; choice?: TitleChoice }): TrackInfo | undefined {
  const usable = tracks.filter((t) => !t.unavailable && !isCommentary(t))
  const wanted = [o.choice?.audio, ...resolveAudioLanguages(o.languages, o.original)]
  for (const language of wanted) {
    if (!language) continue
    // In the same language, a track the browser plays as it is beats one that has to be converted.
    const hits = usable.filter((t) => sameLanguage(trackLanguage(t), language))
    const hit = hits.find((t) => !t.converted) ?? hits[0]
    if (hit) return hit
  }
  return undefined
}

// MARK: Subtitles

/** Among tracks of one language, the viewer's kind (SDH or standard); otherwise the first. */
const ofKind = (candidates: TrackInfo[], type: SubtitleType): TrackInfo | undefined => candidates.find((t) => isSDH(t) === (type === 'sdh')) ?? candidates[0]

const fullIn = (usable: TrackInfo[], language: string, type: SubtitleType) => ofKind(usable.filter((t) => !isForced(t) && sameLanguage(trackLanguage(t), language)), type)

export type SubtitleDecision =
  | { kind: 'off' }
  | { kind: 'track'; track: TrackInfo }
  /** Subtitles are wanted and the file has none in these languages (best first): look online. `fallback` stays on
   *  meanwhile, and when the search finds nothing (a forced-only track in the language beats none). */
  | { kind: 'search'; languages: string[]; fallback: TrackInfo | null }

export interface SubtitleChoiceInput {
  /** What will be heard (undefined when nobody can say, which never counts as foreign). */
  audioLanguage?: string
  preferences: Pick<LanguagePreferences, 'subtitleLanguages' | 'subtitleMode' | 'subtitleType'>
  choice?: TitleChoice
  /** Set for anime when Anime Audio is Sub (subtitles always) or Dub (none, not even forced ones). */
  anime?: 'sub' | 'dub'
}

/** The subtitle to start with, after FlowKit's TrackSelection.decide: what the viewer picked for this title, then
 *  the mode (with the anime rule laid over it), taking a track in the file before one from a search, the first
 *  language before the next, and the viewer's kind (standard or SDH) within a language. */
export function decideSubtitle(subtitles: TrackInfo[], o: SubtitleChoiceInput): SubtitleDecision {
  const usable = subtitles.filter((t) => !t.unavailable)
  const { choice } = o
  const type = o.preferences.subtitleType ?? 'standard'
  const off: SubtitleDecision = { kind: 'off' }
  if (choice?.subtitle === null) return off

  const general = o.preferences.subtitleLanguages
  const heard = baseLanguage(o.audioLanguage)
  /** A full subtitle: in the file before online, first language before the next. Nothing there means a search. */
  const full = (languages: string[]): SubtitleDecision => {
    for (const pool of [usable.filter((t) => !t.online), usable.filter((t) => t.online)]) {
      for (const language of languages) {
        const hit = fullIn(pool, language, type)
        if (hit) return { kind: 'track', track: hit }
      }
    }
    // Always means always: a track that is only the forced lines beats none while the search runs.
    const fallback = languages.map((language) => ofKind(usable.filter((t) => sameLanguage(trackLanguage(t), language)), type)).find((t) => t) ?? null
    return { kind: 'search', languages, fallback }
  }
  /** A forced subtitle from the file, for scenes in a language the viewer doesn't hear. */
  const forced = (languages: string[]): SubtitleDecision => {
    for (const language of languages) {
      const hit = ofKind(usable.filter((t) => isForced(t) && !t.online && sameLanguage(trackLanguage(t), language)), type)
      if (hit) return { kind: 'track', track: hit }
    }
    return off
  }

  // What the viewer picked in the player for this title beats every setting: their language first, then Settings'.
  // When the file has none of it, Settings apply as they would without the choice.
  if (choice?.subtitle) {
    const picked = full([choice.subtitle, ...general.filter((l) => !sameLanguage(l, choice.subtitle ?? undefined))])
    if (picked.kind === 'track') return picked
  }

  // Dub: the viewer hears their own language, so not even the forced lines are wanted.
  if (o.anime === 'dub') return off
  const mine = general[0]
  const mode = o.anime === 'sub' ? 'always' : o.preferences.subtitleMode
  const foreign = !!heard && !!mine && !sameLanguage(heard, mine)
  const own = heard ? [heard] : []
  switch (mode) {
    case 'always':
      return mine ? full(general) : forced(own)
    case 'forced':
      return forced([...general, ...own.filter((l) => !general.some((g) => sameLanguage(g, l)))])
    case 'foreign':
      return mine && foreign ? full(general) : forced(own)
    default:
      // Even with subtitles off a film's forced track for its own audio stays on: it translates the
      // lines the audio leaves in another language, as Apple's players do.
      return forced(own)
  }
}

/** The track `decideSubtitle` picks from the ones that are here, or null: a search isn't a track yet. */
export function pickSubtitle(subtitles: TrackInfo[], o: SubtitleChoiceInput): TrackInfo | null {
  const decision = decideSubtitle(subtitles, o)
  return decision.kind === 'track' ? decision.track : decision.kind === 'search' ? decision.fallback : null
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
