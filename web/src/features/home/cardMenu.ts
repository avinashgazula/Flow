/* What the menu on a poster or still offers, as the apps' context menus do. A Continue Watching card has Go to Details,
   Mark as Watched and Remove from Continue Watching. Any other title (a poster on Explore, Search, Library, a person's
   page, a collection, a row of similar titles) has the apps' MediaContextMenu: Play, the watchlist toggle, Mark as
   Watched (or Unwatched), the Favourites toggle, Shuffle Play for a series and Share, after Go to Details, which the
   apps leave to a tap but a keyboard needs. Only an item with a resume point can be removed, because a next episode
   is not stored anywhere to be taken out. */

export type CardAction = 'details' | 'play' | 'watched' | 'unwatched' | 'watchlist' | 'unwatchlist' | 'favourite' | 'unfavourite' | 'shuffle' | 'share' | 'remove'

export const cardActionLabels: Record<CardAction, string> = {
  details: 'Go to Details',
  play: 'Play',
  watched: 'Mark as Watched',
  unwatched: 'Mark as Unwatched',
  watchlist: 'Add to Watchlist',
  unwatchlist: 'Remove from Watchlist',
  favourite: 'Add to Favourites',
  unfavourite: 'Remove from Favourites',
  shuffle: 'Shuffle Play',
  share: 'Share',
  remove: 'Remove from Continue Watching',
}

export type CardContext = { kind: 'continue'; hasProgress: boolean } | { kind: 'title'; show: boolean; watched: boolean; onWatchlist: boolean; favourite: boolean }

export function cardActions(ctx: CardContext): CardAction[] {
  if (ctx.kind === 'continue') return ['details', 'watched', ...(ctx.hasProgress ? (['remove'] as const) : [])]
  return [
    'details',
    'play',
    ctx.onWatchlist ? 'unwatchlist' : 'watchlist',
    ctx.watched ? 'unwatched' : 'watched',
    ctx.favourite ? 'unfavourite' : 'favourite',
    ...(ctx.show ? (['shuffle'] as const) : []),
    'share',
  ]
}

/** The page a title is shared as: its TMDB page, which opens anywhere, as the apps share it. */
export const tmdbPage = (item: { type: 'movie' | 'show'; id: number }) => `https://www.themoviedb.org/${item.type === 'movie' ? 'movie' : 'tv'}/${item.id}`

/** "Dune: Part Two (2024)", the message shared with the link. */
export const shareMessage = (item: { title: string; year?: number }) => (item.year ? `${item.title} (${item.year})` : item.title)
