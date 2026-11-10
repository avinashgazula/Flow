import type { ReactNode } from 'react'
import { rank } from './stripLayout'
import { prefetchDetail } from '../lib/queries'
import { posterOf } from '../lib/ratings/posters'
import type { MediaItem } from '../lib/tmdb/types'
import { pickPrint, spokenPick } from '../features/home/logic'
import { LazyCardMenu } from '../features/home/LazyCardMenu'
import { FrameCard } from './Frame'
import s from './PosterRow.module.css'

/** Posters of other titles, each with a print-only strip (what it is, and its rating): the facts a
 *  list knows. */
function Posters({ items, now, current }: { items: MediaItem[]; now: number; current?: { type: string; id: number } }) {
  return items.map((m) =>
    // The title the viewer is on (a collection's own film) is a poster that says so, and goes nowhere.
    current && m.type === current.type && m.id === current.id ? (
      <FrameCard
        key={`${m.type}${m.id}`}
        shape="poster"
        artPath={posterOf(m)}
        sizes="(max-width: 720px) 30vw, 150px"
        print={[{ text: 'Current', rank: rank.left }]}
        fallback={m.title}
        title={m.title}
        meta={m.year ? String(m.year) : undefined}
        label={`${spokenPick(m)}, the title you are on`}
        onSelect={() => window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}
      />
    ) : (
    <FrameCard
      key={`${m.type}${m.id}`}
      shape="poster"
      artPath={posterOf(m)}
      sizes="(max-width: 720px) 30vw, 150px"
      print={pickPrint(m, undefined, now)}
      fallback={m.title}
      title={m.title}
      meta={m.year ? String(m.year) : undefined}
      label={spokenPick(m)}
      link={{ to: '/title/$type/$id', params: { type: m.type, id: m.id } }}
      onIntent={() => prefetchDetail(m)}
    >
      <LazyCardMenu item={m} />
    </FrameCard>
    ),
  )
}

/** One row of posters at one size, like Home's: a scrolling row on phones, then five across and seven
 *  from 1100px (the rest are the phone's scroll). Renders nothing for an empty list. */
export function PosterRow({ title, items, now, current, action }: { title: string; items: MediaItem[]; now: number; current?: { type: string; id: number }; action?: ReactNode }) {
  if (items.length === 0) return null
  return (
    <section className={s.section} aria-label={title}>
      {action ? (
        <div className={s.head}>
          <h2 className={s.title}>{title}</h2>
          {action}
        </div>
      ) : (
        <h2 className={s.title}>{title}</h2>
      )}
      <ul className={s.row}>
        <Posters items={items.slice(0, 12)} now={now} current={current} />
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
