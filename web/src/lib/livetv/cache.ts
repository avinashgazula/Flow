import { del, get, set } from 'idb-keyval'
import type { Channel, EPG } from './types'

/* What was downloaded last, in IndexedDB, so Live TV opens on the channels and the guide at once and
   only goes back to the providers once the refresh time has passed. IndexedDB can be missing or refuse
   (private windows), and then Live TV just downloads every time. */

export interface LiveCache {
  /** When it was downloaded, in milliseconds since the epoch. */
  at: number
  channels: Channel[]
  /** Empty when no provider had a guide. */
  epg: EPG
}

const prefix = 'flow.livetv.v1.'

/** FNV-1a: a short, stable name for a set of providers. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(16)
}

export async function readCache(key: string): Promise<LiveCache | undefined> {
  try {
    const cached = await get<LiveCache>(prefix + key)
    return cached && Array.isArray(cached.channels) && cached.epg && typeof cached.at === 'number' ? cached : undefined
  } catch {
    return undefined
  }
}

export async function writeCache(key: string, value: LiveCache) {
  try {
    await set(prefix + key, value)
  } catch {
    // Not saved: the next visit downloads again.
  }
}

export async function clearCache(key: string) {
  try {
    await del(prefix + key)
  } catch {
    // Nothing to remove.
  }
}

/** Whether something downloaded at `at` is still new enough. A guide that came back empty is tried again
 *  after an hour, however long the refresh time is. */
export function isFresh(at: number, refreshHours: number, now: number, hasGuide = true): boolean {
  const hours = hasGuide ? refreshHours : Math.min(refreshHours, 1)
  return now - at < hours * 3_600_000 && at <= now + 60_000
}
