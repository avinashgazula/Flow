import { useQueryClient } from '@tanstack/react-query'
import ContextMenu, { type MenuItem } from '../../components/ContextMenu'
import type { IconName } from '../../components/Icon'
import { q } from '../../lib/queries'
import { library, libraryStore, mediaKey, useLibrary } from '../../lib/store/library'
import type { CardMenuProps } from './LazyCardMenu'
import { cardActionLabels, cardActions, shareMessage, tmdbPage, type CardAction } from './cardMenu'
import { airedEpisodes, nextUp, showStatus } from './continue'
import { watchedMovieKeys, watchedShowsOf } from './marks'

/* The menu on a poster or still (the apps' long-press menu): a Continue Watching card with Go to Details, Mark as
   Watched and Remove from Continue Watching; any other title with Play, the watchlist, Mark as Watched or Unwatched,
   Favourites, Shuffle Play for a series, and Share (see cardMenu.ts). It loads after the page has painted, as its own
   chunk: the cards are drawn without it and gain the More button a moment later, wherever a poster is drawn. */

const icons: Record<Exclude<CardAction, 'shuffle'>, IconName> = {
  details: 'info',
  play: 'play',
  watched: 'check',
  unwatched: 'close',
  watchlist: 'bookmark',
  unwatchlist: 'bookmark',
  favourite: 'heart',
  unfavourite: 'heart',
  share: 'share',
  remove: 'trash',
}

const shuffleGlyph = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h3.5c5 0 4.5 10 9.5 10H20M4 17h3.5c1.8 0 2.9-1.2 3.8-2.7M13 9.2c.9-1.4 2.3-2.2 4-2.2H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5" />
  </svg>
)

/** `entry` is given for a Continue Watching card: where the viewer left off, or the next episode to watch. Go to Details
 *  follows the card's own link, so it opens exactly what the card does (a series at the season in hand). */
export default function CardMenu({ item, entry, play: open }: CardMenuProps) {
  const client = useQueryClient()
  const key = mediaKey(item.type, item.id)
  const history = useLibrary((l) => l.history)
  const marks = useLibrary((l) => l.watchedEpisodes)
  const rewatches = useLibrary((l) => l.rewatches)
  const onWatchlist = useLibrary((l) => l.watchlist.some((e) => e.key === key))
  const favourite = useLibrary((l) => l.favourites.some((e) => e.key === key))

  // A series is watched when every aired episode is, which needs its seasons: read what is cached, never ask for them here.
  const cached = item.type === 'show' ? client.getQueryData(q.detail('show', item.id).queryKey) : undefined
  const watched = item.type === 'movie' ? watchedMovieKeys(history).has(key) : !!cached && showStatus(watchedShowsOf(marks, rewatches).get(item.id) ?? [], cached, Date.now()).complete
  const episode = entry?.progress?.episode ?? entry?.episode

  const play = (season?: number, number?: number) => open?.(item.type, item.id, season === undefined ? undefined : { season, episode: number! })
  const flash = async (text: string) => (await import('../../components/flash')).flash(text)

  const run: Record<CardAction, (card: HTMLElement | null) => void | Promise<void>> = {
    details: (card) => void card?.querySelector('a')?.click(),
    play: async () => {
      if (item.type === 'movie') return play()
      // A series plays where it was left, else its next episode, else its first.
      const left = libraryStore.get().progress[key]?.episode
      if (left) return play(left.season, left.episode)
      const detail = await client.fetchQuery(q.detail('show', item.id))
      const aired = airedEpisodes(detail, Date.now())
      const at = nextUp(watchedShowsOf(marks, rewatches).get(item.id) ?? [], aired) ?? aired[0]
      if (at) play(at.season, at.episode)
      else flash('Nothing has aired yet.')
    },
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
    favourite: () => library.toggleFavourite(item),
    unfavourite: () => library.toggleFavourite(item),
    // As the title page's Shuffle: a random episode not yet picked this round, preferring one not yet watched.
    shuffle: async () => {
      const { shuffleEpisode } = await import('./shuffle')
      const pick = await shuffleEpisode(client, item)
      if (!pick) return flash('Nothing to shuffle yet.')
      play(pick.season, pick.episode)
    },
    share: async () => {
      const url = tmdbPage(item)
      if (navigator.share) return void (await navigator.share({ title: item.title, text: shareMessage(item), url }).catch(() => {}))
      const copied = await navigator.clipboard?.writeText(url).then(() => true, () => false)
      flash(copied ? 'Link copied.' : 'Couldn’t copy the link. Open the title and copy it from the address bar.')
    },
    remove: () => library.removeProgress(key),
  }

  const actions = cardActions(entry ? { kind: 'continue', hasProgress: !!entry.progress } : { kind: 'title', show: item.type === 'show', watched, onWatchlist, favourite })
  const items: MenuItem[] = actions.map((id) => ({ id, label: cardActionLabels[id], ...(id === 'shuffle' ? { glyph: shuffleGlyph } : { icon: icons[id] }), onSelect: (card) => void run[id](card) }))
  return <ContextMenu label={`More options for ${item.title}`} items={items} />
}
