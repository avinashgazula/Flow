import type { EpisodeRef } from '../../lib/store/library'

/* Mark Watched Up to Here, as the apps' episode menu: the episode and every one before it in its season. */

/** The episodes of a season from the first through `upTo`, in order. Specials, which can start at 0, keep their 0. An
 *  episode the list doesn't hold isn't invented, so a gap in TMDB's numbering stays a gap. */
export function episodesUpTo(episodes: readonly { season: number; number: number }[], upTo: { season: number; number: number }): EpisodeRef[] {
  return episodes
    .filter((e) => e.season === upTo.season && e.number <= upTo.number)
    .sort((a, b) => a.number - b.number)
    .map((e) => ({ season: e.season, episode: e.number }))
}
