import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { prefetchDetail, q } from '../lib/queries'
import { lastSourceStore } from '../lib/sources/lastSource'
import { useStore } from '../lib/store/createStore'
import type { Progress } from '../lib/store/library'
import { formatLeftShort, userLocale, useMinuteTick } from '../lib/time'
import type { MediaItem } from '../lib/tmdb/types'
import { useNearScreen } from '../lib/useNearScreen'
import { episodeLine, pickPrint, resumePrint, secondsLeft, spokenPick, spokenResume, watchedFraction, type PickDetail } from '../features/home/logic'
import { FrameCard } from './Frame'

/* The two kinds of item every browsing screen lists: a title not started (a poster with print only) and
   a title started (a still whose perforations are how far you are). Home, Explore, Search and Library use
   these, so one title looks the same wherever it turns up. */

export const posterSizes = '(max-width: 720px) 112px, 200px'

/** The title's detail (runtime, seasons), fetched once the item has stayed near the screen for a moment:
 *  a grid scrolled past quickly asks for nothing it didn't stop at. A detail that is only what the list
 *  already knew (no runtime, no seasons) doesn't count, so print never claims more than it knows. */
export function useSeenDetail(item: Pick<MediaItem, 'type' | 'id'>) {
  const [near, ref] = useNearScreen<HTMLLIElement>()
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!near) return
    const timer = setTimeout(() => setSettled(true), 250)
    return () => clearTimeout(timer)
  }, [near])
  const { data } = useQuery({ ...q.detail(item.type, item.id), enabled: settled })
  const detail: PickDetail | undefined = data && (data.runtime || data.seasons.length) ? data : undefined
  return [ref, detail] as const
}

/** A title you haven't started: poster, and print only (runtime and rating, or seasons and rating, or NEW EP
 *  when an episode just aired), then the title and an optional line of facts under it. */
export function PosterItem({ item, meta, sizes = posterSizes, children }: { item: MediaItem; meta?: string; sizes?: string; children?: ReactNode }) {
  const now = useMinuteTick()
  const [itemRef, detail] = useSeenDetail(item)
  return (
    <FrameCard
      link={{ to: '/title/$type/$id', params: { type: item.type, id: item.id } }}
      itemRef={itemRef}
      shape="poster"
      artPath={item.poster}
      sizes={sizes}
      print={pickPrint(item, detail, now)}
      title={item.title}
      meta={meta}
      label={spokenPick(item, detail)}
      fallback={item.title}
      onIntent={() => prefetchDetail(item)}
    >
      {children}
    </FrameCard>
  )
}

/** Something started, as a still: perforations for how far, print for the episode, the minutes left in
 *  yellow, when it would end, and the format it last played in. */
export function ResumeItem({ p, sizes, children }: { p: Progress; sizes: string; children?: ReactNode }) {
  const now = useMinuteTick()
  const last = useStore(lastSourceStore, (st) => st.byTitle[p.key])
  const still = p.episode?.still
  return (
    <FrameCard
      link={{ to: '/title/$type/$id', params: { type: p.item.type, id: p.item.id }, search: p.episode ? { season: p.episode.season } : undefined }}
      shape="still"
      artPath={still ?? p.item.backdrop}
      artKind={still ? 'still' : 'backdrop'}
      sizes={sizes}
      progress={watchedFraction(p)}
      print={resumePrint(p, now, last, userLocale)}
      title={p.item.title}
      meta={episodeLine(p.episode) ?? formatLeftShort(secondsLeft(p))}
      label={spokenResume(p, now, userLocale, last)}
      fallback={p.item.title}
      onIntent={() => prefetchDetail(p.item)}
    >
      {children}
    </FrameCard>
  )
}
