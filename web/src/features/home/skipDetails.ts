import type { EpisodeRef } from '../../lib/store/library'
import type { MediaType } from '../../lib/tmdb/types'

/** Where a Continue Watching card goes: the player, at the episode in progress or the next one, or the title page (as the
 *  apps' card does when Skip Details is off). */
export function continueLink(entry: { item: { type: MediaType; id: number }; progress?: { episode?: EpisodeRef }; episode?: EpisodeRef }, skipDetails: boolean) {
  const { type, id } = entry.item
  const at = entry.progress?.episode ?? entry.episode
  if (skipDetails) return { to: '/watch/$type/$id', params: { type, id }, search: at ? { season: at.season, episode: at.episode } : undefined } as const
  return { to: '/title/$type/$id', params: { type, id }, search: at ? { season: at.season } : undefined } as const
}
