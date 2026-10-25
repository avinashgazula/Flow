/* What a film adds at its end, as the apps do (PlaybackSession.alertCreditsScenes and offerSuggestions): a quiet
   note when the credits begin if a scene is waiting during or after them, and "Because You Watched" as the
   credits roll and when the film ends. When the credits start, and what to suggest, are decided here. */

import type { MediaItem } from '../../lib/tmdb/types'

/** Shorter than this isn't a film worth the extras (a trailer, a clip): half an hour, as in the apps. */
export const minimumLength = 1800
/** At most this many suggestions. */
export const suggestionCount = 8

/** The alert, as the credits begin (a credits segment, else the last six percent) and until the last ten seconds. */
export function alertDue({ time, duration, creditsStart, minLength = minimumLength }: { time: number; duration: number; creditsStart?: number; minLength?: number }): boolean {
  if (!(duration > minLength)) return false
  return time >= (creditsStart ?? duration * 0.94) && time < duration - 10
}

/** Where the suggestions come up: with the credits (a segment, else the last three minutes, or the last four percent of a short film:
 *  whichever is later) and not in the last five seconds. */
export function suggestionsStart(duration: number, creditsStart?: number): number {
  return creditsStart ?? Math.max(duration * 0.96, duration - 180)
}

export type SuggestionsMoment = 'before' | 'due' | 'late'

/** Before the credits; in them (offer the card once); or in the last five seconds, when offering it would be rude. */
export function suggestionsMoment({ time, duration, creditsStart, minLength = minimumLength }: { time: number; duration: number; creditsStart?: number; minLength?: number }): SuggestionsMoment {
  if (!(duration > minLength) || time < suggestionsStart(duration, creditsStart)) return 'before'
  return time < duration - 5 ? 'due' : 'late'
}

/** What to suggest after this film: its recommendations, then films like it, without the film itself, without
 *  repeats, without films already seen, and only ones with a picture to show. */
export function pickSuggestions(film: { id: number; recommendations: MediaItem[]; similar: MediaItem[] }, watched: (item: MediaItem) => boolean): MediaItem[] {
  const seen = new Set<number>([film.id])
  return [...film.recommendations, ...film.similar].filter((m) => m.type === 'movie' && !!m.backdrop && !watched(m) && !seen.has(m.id) && !!seen.add(m.id)).slice(0, suggestionCount)
}
