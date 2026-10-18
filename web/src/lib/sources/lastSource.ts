/* The source a title was last played from, remembered so the picker offers it first next time, as
   FlowKit's LastSource. It describes the release, never its link: a debrid or server URL is nobody
   else's business, and settings get exported. For a show it's the release the last episode came
   from, so the next episode is found in the same one. */

import { createStore } from '../store/createStore'
import type { PlaybackRequest, Source } from './types'

export interface LastSource {
  providerId: string
  filename?: string
  bingeGroup?: string
  releaseGroup?: string
  resolution?: Source['resolution']
  quality?: Source['quality']
  hdr?: Source['hdr']
  date: number
}

export const lastSourceStore = createStore<{ byTitle: Record<string, LastSource> }>('lastSources', { byTitle: {} })

export const titleKey = (request: Pick<PlaybackRequest, 'type' | 'tmdbId'>) => `${request.type}:${request.tmdbId}`

export function describeSource(source: Source, date = Date.now()): LastSource {
  return {
    providerId: source.providerId ?? source.provider,
    filename: source.filename,
    bingeGroup: source.bingeGroup,
    releaseGroup: source.releaseGroup,
    resolution: source.resolution,
    quality: source.quality,
    hdr: source.hdr,
    date,
  }
}

const sameList = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x, i) => x === b[i])

/** The playable source in `list` that is this one again: the same file, else (another episode) the
 *  same add-on binge group, else the same release from the same provider. Undefined when nothing is
 *  close enough, so the ranking stands. */
export function matchLastSource(last: LastSource | undefined, list: Source[]): Source | undefined {
  if (!last) return undefined
  const candidates = list.filter((s) => !s.unsupported && (s.providerId ?? s.provider) === last.providerId)
  if (last.filename) {
    const same = candidates.find((s) => s.filename === last.filename)
    if (same) return same
  }
  if (last.bingeGroup) {
    const same = candidates.find((s) => s.bingeGroup === last.bingeGroup)
    if (same) return same
  }
  if (!last.releaseGroup) return undefined
  const group = last.releaseGroup.toLowerCase()
  return candidates.find((s) => s.releaseGroup?.toLowerCase() === group && s.resolution === last.resolution && s.quality === last.quality && sameList(s.hdr, last.hdr))
}

/** Keeps the most recent `limit` titles, so the list never grows without end. */
export function pruned(all: Record<string, LastSource>, limit = 300): Record<string, LastSource> {
  const entries = Object.entries(all)
  if (entries.length <= limit) return all
  return Object.fromEntries(entries.sort(([, a], [, b]) => b.date - a.date).slice(0, limit))
}

export function rememberSource(request: Pick<PlaybackRequest, 'type' | 'tmdbId'>, source: Source) {
  lastSourceStore.set((s) => ({ byTitle: pruned({ ...s.byTitle, [titleKey(request)]: describeSource(source) }) }))
}

export function lastSourceFor(request: Pick<PlaybackRequest, 'type' | 'tmdbId'>, list: Source[]): Source | undefined {
  return matchLastSource(lastSourceStore.get().byTitle[titleKey(request)], list)
}
