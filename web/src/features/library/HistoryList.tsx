import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef } from 'react'
import { Artwork } from '../../components/Artwork'
import { markZoomSource } from '../../components/Cards'
import { prefetchDetail, q } from '../../lib/queries'
import type { HistoryEntry } from '../../lib/store/library'
import { useMeasuredBox } from '../explore/useMeasuredBox'
import { episodeLabel, type HistoryRow as Row } from './logic'
import s from './LibraryScreen.module.css'

const headerHeight = 56
const entryHeight = 84

/** All of History, under day headings, holding only the rows near the viewport: hundreds of entries
 *  scroll as lightly as ten. */
export function HistoryList({ rows }: { rows: Row[] }) {
  'use no memo' // The virtualizer mutates itself between renders; memoising around it would freeze the rows.
  const ref = useRef<HTMLDivElement>(null)
  const { top } = useMeasuredBox(ref)
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? headerHeight : entryHeight),
    overscan: 6,
    scrollMargin: top,
    getItemKey: (i) => {
      const row = rows[i]!
      return row.kind === 'header' ? `h:${row.label}` : `e:${row.entry.key}:${row.entry.watchedAt}`
    },
  })
  // Filtering changes which row sits at each index, and so the heights.
  useLayoutEffect(() => virtualizer.measure(), [virtualizer, rows])

  return (
    <div ref={ref} className={s.historyList} style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((v) => {
        const row = rows[v.index]!
        return (
          <div key={v.key} className={s.historySlot} style={{ transform: `translateY(${v.start - top}px)`, height: v.size }}>
            {row.kind === 'header' ? (
              <h3 className={s.dayHeading}>{row.label}</h3>
            ) : (
              <HistoryItem entry={row.entry} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** One watched title or episode: a still, what it was, and when. */
export function HistoryItem({ entry }: { entry: HistoryEntry }) {
  const { item, episode } = entry
  return (
    <Link
      to="/title/$type/$id"
      params={{ type: item.type, id: item.id }}
      search={episode ? { season: episode.season } : undefined}
      className={s.historyItem}
      onPointerEnter={() => prefetchDetail(item)}
      onFocus={() => prefetchDetail(item)}
      onClick={markZoomSource}
      viewTransition
    >
      <Artwork zoom path={item.backdrop} kind="backdrop" alt="" sizes="120px" className={s.historyArt} fallback={item.title} />
      <span className={s.historyText}>
        <span className={s.historyTitle}>{item.title}</span>
        <span className={s.historyMeta}>{episode ? <EpisodeLine showId={item.id} episode={episode} /> : [item.year, item.type === 'movie' ? 'Movie' : 'Series'].filter(Boolean).join(' · ')}</span>
      </span>
      <time className={s.historyTime} dateTime={new Date(entry.watchedAt).toISOString()}>
        {when(entry.watchedAt)}
      </time>
    </Link>
  )
}

/** The episode's name comes with it when the player recorded one; otherwise from the season, which
 *  is cached and shared by every episode of it in the list. */
function EpisodeLine({ showId, episode }: { showId: number; episode: HistoryEntry['episode'] & {} }) {
  const recorded = (episode as { name?: string }).name
  const { data } = useQuery({ ...q.season(showId, episode.season), enabled: !recorded })
  const name = recorded ?? data?.find((e) => e.number === episode.episode)?.name
  return <>{episodeLabel(episode, name)}</>
}

function when(t: number) {
  const d = new Date(t)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const sameYear = d.getFullYear() === today.getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}
