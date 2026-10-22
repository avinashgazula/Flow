import { prefetchDetail } from '../lib/queries'
import type { MediaItem } from '../lib/tmdb/types'
import { pickPrint, spokenPick } from '../features/home/logic'
import { FrameCard } from './Frame'
import s from './PosterRow.module.css'

/** Posters of other titles, each with a print-only strip (what it is, and its rating): the facts a
 *  list knows. */
function Posters({ items, now }: { items: MediaItem[]; now: number }) {
  return items.map((m) => (
    <FrameCard
      key={`${m.type}${m.id}`}
      shape="poster"
      artPath={m.poster}
      sizes="(max-width: 720px) 30vw, 150px"
      print={pickPrint(m, undefined, now)}
      fallback={m.title}
      title={m.title}
      meta={m.year ? String(m.year) : undefined}
      label={spokenPick(m)}
      link={{ to: '/title/$type/$id', params: { type: m.type, id: m.id } }}
      onIntent={() => prefetchDetail(m)}
    />
  ))
}

/** One row of posters at one size, like Home's: a scrolling row on phones, then five across and seven
 *  from 1100px (the rest are the phone's scroll). Renders nothing for an empty list. */
export function PosterRow({ title, items, now }: { title: string; items: MediaItem[]; now: number }) {
  if (items.length === 0) return null
  return (
    <section className={s.section} aria-label={title}>
      <h2 className={s.title}>{title}</h2>
      <ul className={s.row}>
        <Posters items={items.slice(0, 12)} now={now} />
      </ul>
    </section>
  )
}

/** Every poster, wrapping at one size; off-screen ones skip layout and paint until near. */
export function PosterWall({ items, now, label }: { items: MediaItem[]; now: number; label: string }) {
  return (
    <ul className={s.wall} aria-label={label}>
      <Posters items={items} now={now} />
    </ul>
  )
}
