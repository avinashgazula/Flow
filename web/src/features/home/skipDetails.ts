import { useSettings } from '../../lib/store/settings'
import type { EpisodeRef } from '../../lib/store/library'
import type { MediaType } from '../../lib/tmdb/types'

/** Settings → Playback → Skip Details on Continue Watching: a Continue Watching card plays straight away instead of opening
 *  the title. On unless switched off, as in the apps. Read by its name from the settings, so this works whether or not the
 *  setting's own helper is there yet. */
export const useSkipDetails = () => useSettings((x) => (x as { skipDetailsOnContinueWatching?: boolean }).skipDetailsOnContinueWatching !== false)

/** Where a Continue Watching card goes: the player, at the episode in progress or the next one, or the title page (as the
 *  apps' card does when Skip Details is off). */
export function continueLink(entry: { item: { type: MediaType; id: number }; progress?: { episode?: EpisodeRef }; episode?: EpisodeRef }, skipDetails: boolean) {
  const { type, id } = entry.item
  const at = entry.progress?.episode ?? entry.episode
  if (skipDetails) return { to: '/watch/$type/$id', params: { type, id }, search: at ? { season: at.season, episode: at.episode } : undefined } as const
  return { to: '/title/$type/$id', params: { type, id }, search: at ? { season: at.season } : undefined } as const
}
