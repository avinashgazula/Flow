import type { HistoryEntry, Progress } from '../../lib/store/library'
import type { MediaItem } from '../../lib/tmdb/types'
import { followedShows } from './continue'

/* "Continue Watching" as an action (the apps' resumeLatest, the Mac menu's Option-Command-P, the PWA shortcut): the
   most recently watched thing. What has a resume point is a candidate, and so is the next episode of a series that was
   watched through to an episode's end; the newest wins. A next episode needs the series' seasons to be known, so the
   caller asks for them one candidate at a time, newest first, and takes the first that has somewhere to go. */

export type Candidate = { kind: 'resume'; progress: Progress; at: number } | { kind: 'next'; item: MediaItem; at: number }

/** How many series' next episodes are looked for before giving up: the apps look at a handful too. */
export const followedLimit = 5

export function candidates(progress: Record<string, Progress>, history: readonly HistoryEntry[]): Candidate[] {
  const resumes = Object.values(progress)
  const started = new Set(resumes.map((p) => p.key))
  return [
    ...resumes.map((p): Candidate => ({ kind: 'resume', progress: p, at: p.updatedAt })),
    ...followedShows(history, started, followedLimit).map((f): Candidate => ({ kind: 'next', item: f.item, at: f.watchedAt })),
  ].sort((a, b) => b.at - a.at)
}

/** The sentence when there is nothing to continue. */
export const nothingToContinue = 'Nothing to continue yet. What you start watching shows up here.'
