import { useEffect, useRef, useState } from 'react'
import { searchSources, type PlaybackRequest, type SearchUpdate } from '../../lib/sources'
import { settingsStore } from '../../lib/store/settings'

/* The title page asks every source for the title as soon as the page has its details, so the film-can
   label can say what Play would start. The answer is kept for a few minutes: going back to a title, or
   opening the picker from the label, doesn't ask every add-on again. */

const idle: SearchUpdate = { sources: [], providers: [], torrents: 0, finished: false }
const keep = 5 * 60_000
const answers = new Map<string, { at: number; update: SearchUpdate }>()

const keyOf = (r: PlaybackRequest) => {
  const s = settingsStore.get()
  return [s.demo ? 'demo' : 'live', r.type, r.tmdbId, r.season ?? '', r.episode ?? ''].join(':')
}

/** The cached, finished answer for this request, if there is one. */
export function cachedSources(request: PlaybackRequest): SearchUpdate | undefined {
  const hit = answers.get(keyOf(request))
  return hit && Date.now() - hit.at < keep ? hit.update : undefined
}

/** What every source offers for `request`, ranked best first, filling in as each answers. `enabled` waits
 *  for the title's details (add-ons look titles up by IMDb id). `again` re-asks. */
export function useSourceSearch(request: PlaybackRequest | undefined, enabled: boolean, again = 0): SearchUpdate {
  const [update, setUpdate] = useState<SearchUpdate>(idle)
  const latest = useRef(request)
  latest.current = request
  const key = request ? keyOf(request) : ''

  useEffect(() => {
    const r = latest.current
    if (!enabled || !r) return
    const hit = again === 0 ? cachedSources(r) : undefined
    if (hit) {
      setUpdate(hit)
      return
    }
    const controller = new AbortController()
    setUpdate(idle)
    searchSources(r, {
      signal: controller.signal,
      onUpdate: (u) => {
        setUpdate(u)
        if (u.finished) answers.set(keyOf(r), { at: Date.now(), update: u })
      },
    }).catch(() => {
      // Left the page, or asked again: the newer search reports instead.
    })
    return () => controller.abort()
  }, [enabled, key, again])

  return update
}
