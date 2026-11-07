import { useQueryClient } from '@tanstack/react-query'
import ContextMenu, { type MenuItem } from '../../components/ContextMenu'
import type { IconName } from '../../components/Icon'
import { q } from '../../lib/queries'
import { library, mediaKey, useLibrary } from '../../lib/store/library'
import type { CardMenuProps } from './LazyCardMenu'
import { cardActionLabels, cardActions, type CardAction } from './cardMenu'
import { airedEpisodes, showStatus } from './continue'
import { watchedMovieKeys, watchedShowsOf } from './marks'

/* The menu on a Home card (the apps' long-press menu): a Continue Watching card with Go to Details, Mark as Watched and
   Remove from Continue Watching, any other title with Go to Details, Mark as Watched or Unwatched, and the watchlist.
   It loads after the page has painted, as its own chunk: the cards are drawn without it and gain the More button a
   moment later. */

const icons: Record<CardAction, IconName> = { details: 'info', watched: 'check', unwatched: 'close', watchlist: 'bookmark', unwatchlist: 'bookmark', remove: 'trash' }

/** `entry` is given for a Continue Watching card: where the viewer left off, or the next episode to watch. Go to Details
 *  follows the card's own link, so it opens exactly what the card does (a series at the season in hand) and this chunk
 *  needs no router of its own. */
export default function CardMenu({ item, entry }: CardMenuProps) {
  const client = useQueryClient()
  const key = mediaKey(item.type, item.id)
  const history = useLibrary((l) => l.history)
  const marks = useLibrary((l) => l.watchedEpisodes)
  const rewatches = useLibrary((l) => l.rewatches)
  const onWatchlist = useLibrary((l) => l.watchlist.some((e) => e.key === key))

  // A series is watched when every aired episode is, which needs its seasons: read what is cached, never ask for them here.
  const cached = item.type === 'show' ? client.getQueryData(q.detail('show', item.id).queryKey) : undefined
  const watched = item.type === 'movie' ? watchedMovieKeys(history).has(key) : !!cached && showStatus(watchedShowsOf(marks, rewatches).get(item.id) ?? [], cached, Date.now()).complete
  const episode = entry?.progress?.episode ?? entry?.episode

  const run: Record<CardAction, (card: HTMLElement | null) => void | Promise<void>> = {
    details: (card) => void card?.querySelector('a')?.click(),
    watched: async () => {
      // On a Continue Watching card it is the episode or film in hand; on a poster, the whole film or series.
      if (entry) return library.markWatched(item, episode)
      if (item.type === 'movie') return library.markWatched(item)
      const detail = await client.fetchQuery(q.detail('show', item.id))
      ;(await import('../../lib/store/titleLibrary')).titleLibrary.markEpisodesWatched(item, airedEpisodes(detail, Date.now()))
    },
    unwatched: async () => {
      const { titleLibrary } = await import('../../lib/store/titleLibrary')
      if (item.type === 'movie') return titleLibrary.markUnwatched(item)
      titleLibrary.markUnwatched(item, airedEpisodes(await client.fetchQuery(q.detail('show', item.id)), Date.now()))
    },
    watchlist: () => library.toggleWatchlist(item),
    unwatchlist: () => library.toggleWatchlist(item),
    remove: () => library.removeProgress(key),
  }

  const actions = cardActions(entry ? { kind: 'continue', hasProgress: !!entry.progress } : { kind: 'title', watched, onWatchlist })
  const items: MenuItem[] = actions.map((id) => ({ id, label: cardActionLabels[id], icon: icons[id], onSelect: (card) => void run[id](card) }))
  return <ContextMenu label={`More options for ${item.title}`} items={items} />
}
