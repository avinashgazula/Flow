/* Artwork for titles a tracker named. A watchlist, history or resume point that comes from Trakt, Simkl or MDBList
   arrives as a stand-in (a name and a year); this gives the stand-ins their poster and overview from TMDB. Shared by
   every tracker's engine. */

import { libraryStore, type Library } from '../store/library'
import { tmdbPath, type MediaItem } from '../tmdb/types'
import { isStub } from '../trakt/merge'

const truncate = (text: string) => (text.length > 240 ? `${text.slice(0, 237)}…` : text)

/** `apply` runs the change to the library, so the engine can tell it from one the viewer made and not send it back.
 *  A catalogue that can't be reached is not an error here: the stand-ins stay. */
export async function hydrateStubs(apply: (change: () => void) => void): Promise<void> {
  const lib = libraryStore.get()
  const wanted = new Map<string, MediaItem>()
  for (const entry of [...lib.watchlist, ...lib.history.slice(0, 60), ...Object.values(lib.progress)]) if (isStub(entry.item)) wanted.set(`${entry.item.type}:${entry.item.id}`, entry.item)
  const queue = [...wanted.values()].slice(0, 40)
  const fresh = new Map<string, MediaItem>()
  // TMDB's client is fetched only when there is artwork to look for.
  const { item: tmdbItem, tmdb } = await import('../tmdb/client')
  const worker = async () => {
    for (let stub = queue.shift(); stub; stub = queue.shift()) {
      try {
        const found = tmdbItem(await tmdb(`/${tmdbPath(stub.type)}/${stub.id}`), stub.type)
        if (found) fresh.set(`${stub.type}:${stub.id}`, { ...found, overview: truncate(found.overview) || stub.overview })
      } catch {
        // No key, offline or an id TMDB doesn't know: the stand-in stays.
        return
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  if (!fresh.size) return
  const swap = <T extends { item: MediaItem }>(e: T): T => (isStub(e.item) && fresh.has(`${e.item.type}:${e.item.id}`) ? { ...e, item: fresh.get(`${e.item.type}:${e.item.id}`)! } : e)
  apply(() =>
    libraryStore.set((l: Library) => ({
      watchlist: l.watchlist.map(swap),
      history: l.history.map(swap),
      progress: Object.fromEntries(Object.entries(l.progress).map(([k, p]) => [k, swap(p)])),
    })),
  )
}
