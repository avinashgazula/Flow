import type { QueryClient } from '@tanstack/react-query'
import { q } from '../../lib/queries'
import { libraryStore, mediaKey, type EpisodeRef } from '../../lib/store/library'
import { titleLibrary } from '../../lib/store/titleLibrary'
import type { MediaItem } from '../../lib/tmdb/types'
import { pickShuffle, watchedEpisodes } from '../../lib/watching'
import { airedRefs, todayOf } from '../detail/logic'
import { fetchEpisodes } from '../detail/shows'

/* Shuffle Play from a poster's menu, as the title page's Shuffle does: a random aired episode not yet picked in this round,
   preferring one not yet watched. Its own module, so the card menu loads none of this until Shuffle is chosen. */
export async function shuffleEpisode(client: QueryClient, item: MediaItem): Promise<EpisodeRef | undefined> {
  const detail = await client.fetchQuery(q.detail('show', item.id))
  const aired = airedRefs(await fetchEpisodes(detail), todayOf(Date.now()))
  const key = mediaKey(item.type, item.id)
  const lib = libraryStore.get()
  const pick = pickShuffle(aired, lib.shuffled?.[key] ?? [], watchedEpisodes(lib, item.id))
  if (!pick) return undefined
  titleLibrary.rememberShuffled(item, pick.played)
  return pick.pick
}
