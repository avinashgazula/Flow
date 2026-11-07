/* What the menu on a Home card offers, as the apps' context menus do: a Continue Watching card has Go to Details, Mark
   as Watched and Remove from Continue Watching; any other title has Go to Details, Mark as Watched (or Unwatched) and
   its watchlist toggle. Only an item with a resume point can be removed, because a next episode is not stored anywhere
   to be taken out. */

export type CardAction = 'details' | 'watched' | 'unwatched' | 'watchlist' | 'unwatchlist' | 'remove'

export const cardActionLabels: Record<CardAction, string> = {
  details: 'Go to Details',
  watched: 'Mark as Watched',
  unwatched: 'Mark as Unwatched',
  watchlist: 'Add to Watchlist',
  unwatchlist: 'Remove from Watchlist',
  remove: 'Remove from Continue Watching',
}

export type CardContext = { kind: 'continue'; hasProgress: boolean } | { kind: 'title'; watched: boolean; onWatchlist: boolean }

export function cardActions(ctx: CardContext): CardAction[] {
  if (ctx.kind === 'continue') return ['details', 'watched', ...(ctx.hasProgress ? (['remove'] as const) : [])]
  return ['details', ctx.watched ? 'unwatched' : 'watched', ctx.onWatchlist ? 'unwatchlist' : 'watchlist']
}
