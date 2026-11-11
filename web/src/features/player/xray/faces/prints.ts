import { createStore, getMany, setMany, type UseStore } from 'idb-keyval'
import type { CastMember } from '../../../../lib/tmdb/types'
import type { CastPrint } from './match'

/* The cast's prints, worked out once and kept. An actor's profile photo gives one print; it is stored in IndexedDB by the
   TMDB person, the photo's file name and the version of the models, so a new photo or a new model makes a new one and
   nothing else ever does. A photo with no face in it is stored as null, so it isn't tried again on every title. */

/** Changes whenever a model or the way a print is made does, which sets every stored print aside. */
export const printVersion = 'yunet-2026may.sface-2021dec-int8bq.1'

/** How many of a title's cast are looked up: the billed actors, in billing order. The rest are seldom the face in a frame. */
export const castLimit = 24

/** TMDB's tall profile size: faces in the standard 185-pixel photo are too small for a good print. */
export const photoURL = (profile: string) => (profile.startsWith('http') ? profile : `https://image.tmdb.org/t/p/h632${profile}`)

type Member = Pick<CastMember, 'id' | 'profile'>

export const keyOf = (m: Required<Member>) => `${printVersion}:${m.id}:${m.profile}`

/** Where prints are kept. `null` is a photo with no face. Anything can fail (private windows have no IndexedDB), and then
 *  prints are only kept for the visit. */
export interface PrintStore {
  read(keys: string[]): Promise<(Float32Array | null | undefined)[]>
  write(entries: [string, Float32Array | null][]): Promise<void>
}

let db: UseStore | undefined
export const browserStore: PrintStore = {
  async read(keys) {
    try {
      db ??= createStore('flow-faces', 'prints')
      return await getMany<Float32Array | null>(keys, db)
    } catch {
      return keys.map(() => undefined)
    }
  },
  async write(entries) {
    try {
      db ??= createStore('flow-faces', 'prints')
      await setMany(entries, db)
    } catch {
      /* The prints are still used this time. */
    }
  },
}

export interface Collected {
  prints: CastPrint[]
  /** Members whose photo couldn't be fetched or read this time (not ones with no face), which will be tried again next time. */
  failed: number
}

/** The prints of a title's cast: from the store where there already, otherwise made by `compute` (which takes a photo's address)
 *  and stored. Members without a profile photo are skipped, and the limit counts those that have one. */
export async function collectPrints(
  cast: readonly Member[],
  compute: (url: string) => Promise<Float32Array | null>,
  { store = browserStore, limit = castLimit, parallel = 4, signal }: { store?: PrintStore; limit?: number; parallel?: number; signal?: AbortSignal } = {},
): Promise<Collected> {
  const members = cast.filter((m): m is Required<Member> => !!m.profile).slice(0, limit)
  const kept = await store.read(members.map(keyOf))
  const prints: CastPrint[] = []
  const todo: Required<Member>[] = []
  members.forEach((m, i) => {
    const hit = kept[i]
    if (hit === undefined) todo.push(m)
    else if (hit) prints.push({ id: m.id, print: hit })
  })
  let failed = 0
  const fresh: [string, Float32Array | null][] = []
  let at = 0
  const run = async () => {
    while (at < todo.length && !signal?.aborted) {
      const m = todo[at++]!
      try {
        const print = await compute(photoURL(m.profile))
        fresh.push([keyOf(m), print])
        if (print) prints.push({ id: m.id, print })
      } catch {
        failed++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, todo.length) }, run))
  if (fresh.length > 0) await store.write(fresh)
  // Billing order, whichever photo came back first.
  const order = new Map(members.map((m, i) => [m.id, i]))
  prints.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  return { prints, failed }
}
