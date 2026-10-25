/* Sending the queue of changes to Trakt. Changes are grouped into as few requests as Trakt's endpoints allow.
   A request that fails for a reason that will pass (offline, Trakt down, busy, signed out) leaves its changes
   queued to try again; one Trakt rejects outright is dropped so it can't block the changes behind it. */

import type { Entry, TraktClient } from './client'
import { TraktError } from './client'
import type { Op } from './store'

const keyOf = (o: { type: string; id: number }) => `${o.type}:${o.id}`

type Api = Pick<TraktClient, 'addToWatchlist' | 'removeFromWatchlist' | 'addHistory' | 'removeHistory' | 'rate' | 'unrate' | 'playback' | 'deletePlayback'>

export interface FlushResult {
  /** What is still to send. */
  remaining: Op[]
  /** Why sending stopped, when it did. */
  error?: TraktError
  /** Trakt's resume-point ids learned on the way. */
  ids: Record<string, number>
}

export async function flushOps(api: Api, ops: Op[], known: Record<string, number> = {}): Promise<FlushResult> {
  const ids = { ...known }
  let remaining = ops

  /** One request for a group. Returns why sending should stop, if it should. */
  async function send(group: Op[], call: () => Promise<unknown>): Promise<TraktError | undefined> {
    if (!group.length) return undefined
    try {
      await call()
    } catch (error) {
      if (!(error instanceof TraktError)) throw error
      // Trakt looked at it and said no: sending it again won't change that.
      if (error.kind !== 'rejected') return error
    }
    remaining = remaining.filter((o) => !group.includes(o))
    return undefined
  }

  const entries = (group: Op[]): Entry[] =>
    group.flatMap((o) =>
      o.kind === 'watchlist' ? [{ type: o.type, id: o.id }] : o.kind === 'watched' ? [{ type: o.type, id: o.id, season: o.season, episode: o.episode, at: o.at }] : o.kind === 'unwatched' ? [{ type: o.type, id: o.id, season: o.season, episode: o.episode }] : o.kind === 'rate' ? [{ type: o.type, id: o.id, rating: o.rating ?? undefined }] : [],
    )

  const adds = ops.filter((o) => o.kind === 'watchlist' && o.on)
  const removes = ops.filter((o) => o.kind === 'watchlist' && !o.on)
  const watched = ops.filter((o) => o.kind === 'watched')
  const unwatched = ops.filter((o) => o.kind === 'unwatched')
  const rated = ops.filter((o) => o.kind === 'rate' && o.rating !== null)
  const unrated = ops.filter((o) => o.kind === 'rate' && o.rating === null)
  const unplay = ops.filter((o) => o.kind === 'unplayback')

  const steps: [Op[], () => Promise<unknown>][] = [
    [adds, () => api.addToWatchlist(entries(adds))],
    [removes, () => api.removeFromWatchlist(entries(removes))],
    [watched, () => api.addHistory(entries(watched))],
    [unwatched, () => api.removeHistory(entries(unwatched))],
    [rated, () => api.rate(entries(rated))],
    [unrated, () => api.unrate(entries(unrated))],
  ]
  for (const [group, call] of steps) {
    const error = await send(group, call)
    if (error) return { remaining, error, ids }
  }

  // A resume point is removed by Trakt's own id for it, which is the one thing that has to be looked up.
  let looked = false
  for (const op of unplay) {
    const error = await send([op], async () => {
      if (ids[keyOf(op as { type: string; id: number })] === undefined && !looked) {
        looked = true
        for (const r of await api.playback()) ids[`${r.type}:${r.tmdb}`] = r.id
      }
      const key = keyOf(op as { type: string; id: number })
      const id = ids[key]
      if (id !== undefined) {
        await api.deletePlayback(id)
        delete ids[key]
      }
    })
    if (error) return { remaining, error, ids }
  }
  return { remaining, ids }
}
