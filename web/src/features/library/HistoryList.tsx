import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef } from 'react'
import { Plate, type PrintPart } from '../../components/Frame'
import { markZoomSource } from '../../components/zoom'
import { prefetchDetail, q } from '../../lib/queries'
import type { HistoryEntry } from '../../lib/store/library'
import { formatRuntime, userLocale, useMinuteTick } from '../../lib/time'
import type { Episode } from '../../lib/tmdb/types'
import { useMeasuredBox } from '../explore/useMeasuredBox'
import { pickPrint } from '../home/logic'
import { episodeLabel, type HistoryRow as Row } from './logic'
import s from './LibraryScreen.module.css'

const headerHeight = 56
/** A 144 px frame is 81 px tall, its strip 26, and the row has 8 px above and below. */
const entryHeight = 124

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
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rows])

  return (
    <div ref={ref} className={s.historyList} style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((v) => {
        const row = rows[v.index]!
        return (
          <div key={v.key} className={s.historySlot} style={{ transform: `translateY(${v.start - top}px)`, height: v.size }}>
            {row.kind === 'header' ? <h3 className={s.dayHeading}>{row.label}</h3> : <HistoryItem entry={row.entry} />}
          </div>
        )
      })}
    </div>
  )
}

/** One watched title or episode: a frame with its strip (a film's runtime and rating, an episode's code and
 *  length), what it was, and when. */
export function HistoryItem({ entry }: { entry: HistoryEntry }) {
  const { item, episode } = entry
  const now = useMinuteTick()
  const film = item.type === 'movie'
  const detail = useQuery({ ...q.detail(item.type, item.id), enabled: film }).data
  const season = useSeason(item.id, episode)
  const found = episode && season?.find((e) => e.number === episode.episode)
  const recorded = (episode as { name?: string } | undefined)?.name
  const print: PrintPart[] = episode
    ? [`S${episode.season} E${episode.episode}`, found?.runtime ? formatRuntime(found.runtime * 60) : ''].filter(Boolean)
    : pickPrint(item, detail && detail.runtime ? detail : undefined, now)
  const meta = episode ? episodeLabel(episode, recorded ?? found?.name) : [item.year, film ? 'Film' : 'Series'].filter(Boolean).join(' · ')
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
      <span className={s.historyPlate}>
        <Plate shape="still" artPath={item.backdrop} sizes="144px" print={print} fallback={item.title} hideStrip />
      </span>
      <span className={s.historyText}>
        <span className={s.historyTitle}>{item.title}</span>
        <span className={s.historyMeta}>{meta}</span>
      </span>
      <time className={`${s.historyTime} num`} dateTime={new Date(entry.watchedAt).toISOString()}>
        {when(entry.watchedAt)}
      </time>
    </Link>
  )
}

/** The season's episodes, for names and lengths: cached, and shared by every episode of it in the list. */
function useSeason(showId: number, episode: HistoryEntry['episode']): Episode[] | undefined {
  return useQuery({ ...q.season(showId, episode?.season ?? 0), enabled: !!episode }).data
}

function when(t: number) {
  const d = new Date(t)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(userLocale, { hour: 'numeric', minute: '2-digit' })
  const sameYear = d.getFullYear() === today.getFullYear()
  return d.toLocaleDateString(userLocale, sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}
