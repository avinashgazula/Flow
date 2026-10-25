/* "What Did They Say?": ten seconds back, with subtitles showing just for that stretch (as the apps do:
   PlaybackSession.replayWithSubtitles). Pure, so the choices are tested; the controller seeks and switches. */

import { sameLanguage } from '../../lib/language'
import { isForced, trackLanguage, type TrackInfo } from './languages'

export const replaySeconds = 10
/** Never keep them on longer than this, in case the viewer paused or went elsewhere. */
const longestMs = 20_000
/** Playback this far past the moment it was asked ends the replay: a moment, as the apps wait. */
const pastSeconds = 0.75

export type ReplayPlan =
  /** Subtitles are already on, so going back is enough. */
  | { kind: 'seek' }
  /** Go back and turn this track on until the replay is over. */
  | { kind: 'show'; track: TrackInfo }
  /** The video has no subtitles to show. */
  | { kind: 'none' }

/** Forced subtitles (signs, foreign lines) don't count as subtitles being on; full ones do. Otherwise the
 *  first full track in the viewer's languages, else the first full one there is. */
export function planReplay(subtitles: TrackInfo[], currentId: string | null, languages: string[]): ReplayPlan {
  const current = currentId ? subtitles.find((t) => t.id === currentId) : undefined
  if (current && !isForced(current)) return { kind: 'seek' }
  const full = subtitles.filter((t) => !t.unavailable && !isForced(t))
  const track = languages.map((language) => full.find((t) => sameLanguage(trackLanguage(t), language))).find(Boolean) ?? full[0]
  return track ? { kind: 'show', track } : { kind: 'none' }
}

/** Whether the replay's subtitles should go off again: playback is a moment past where it was asked, the
 *  viewer jumped back further than the replay went, or it has been twenty seconds. */
export function replayDone({ startedAt, now, time, until }: { startedAt: number; now: number; time: number; until: number }): boolean {
  return now - startedAt > longestMs || time >= until + pastSeconds || time < until - replaySeconds - 2
}
