import { Link, type LinkProps } from '@tanstack/react-router'
import { useRef, type ReactNode } from 'react'
import { Icon } from './Icon'
import s from './Shelf.module.css'

/** A titled, horizontally scrolling row (ShelfView on the other platforms). Off-screen shelves skip
 *  layout and paint entirely (content-visibility), so a long Home costs no more than what's visible. */
export function Shelf({ title, seeAll, children, loading, kind = 'poster' }: { title: string; seeAll?: LinkProps; children?: ReactNode; loading?: boolean; kind?: 'poster' | 'backdrop' }) {
  const row = useRef<HTMLDivElement>(null)
  const scroll = (direction: 1 | -1) => {
    const el = row.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' })
  }
  return (
    <section className={`${s.shelf} ${kind === 'backdrop' ? s.backdropShelf : ''}`}>
      <header className={s.header}>
        {seeAll ? (
          <Link {...seeAll} className={s.title}>
            {title}
            <Icon name="chevronRight" size={16} strokeWidth={2.6} />
          </Link>
        ) : (
          <h2 className={s.title}>{title}</h2>
        )}
        <div className={s.arrows}>
          <button className="btn btn-glass btn-circle btn-compact" onClick={() => scroll(-1)} aria-label={`Scroll ${title} back`}>
            <Icon name="chevronLeft" size={16} strokeWidth={2.6} />
          </button>
          <button className="btn btn-glass btn-circle btn-compact" onClick={() => scroll(1)} aria-label={`Scroll ${title} forward`}>
            <Icon name="chevronRight" size={16} strokeWidth={2.6} />
          </button>
        </div>
      </header>
      <div className={s.row} ref={row}>
        {loading ? <Placeholders kind={kind} /> : children}
      </div>
    </section>
  )
}

function Placeholders({ kind }: { kind: 'poster' | 'backdrop' }) {
  return (
    <>
      {Array.from({ length: kind === 'poster' ? 8 : 4 }, (_, i) => (
        <div key={i} className={kind === 'poster' ? s.ghostPoster : s.ghostBackdrop} />
      ))}
    </>
  )
}
