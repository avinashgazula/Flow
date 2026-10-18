import { Link } from '@tanstack/react-router'
import type { MouseEvent } from 'react'
import { prefetchDetail } from '../lib/queries'
import type { MediaItem } from '../lib/tmdb/types'
import { Artwork } from './Artwork'
import s from './Cards.module.css'

/** Names the tapped card's artwork for the View Transitions zoom into its page, like the TV app's
 *  card that grows into the title. Only one element may hold the name, so it's cleared afterwards. */
export function markZoomSource(event: MouseEvent<HTMLElement>) {
  const art = event.currentTarget.querySelector<HTMLElement>('[data-zoom]')
  if (!art || !document.startViewTransition) return
  // The page being left may hold the name already (a title page's own artwork).
  document.querySelectorAll<HTMLElement>('[style*="title-art"]').forEach((el) => (el.style.viewTransitionName = ''))
  art.style.viewTransitionName = 'title-art'
  setTimeout(() => (art.style.viewTransitionName = ''), 700)
}

export const posterSizes = '(max-width: 720px) 34vw, (max-width: 1400px) 16vw, 220px'

export function PosterCard({ item, width, showTitle = true }: { item: MediaItem; width?: number | string; showTitle?: boolean }) {
  return (
    <Link
      to="/title/$type/$id"
      params={{ type: item.type, id: item.id }}
      className={s.poster}
      style={width ? { width } : undefined}
      onPointerEnter={() => prefetchDetail(item)}
      onFocus={() => prefetchDetail(item)}
      onClick={markZoomSource}
      viewTransition
    >
      <Artwork zoom path={item.poster} kind="poster" alt="" sizes={posterSizes} className={s.posterArt} fallback={item.title} />
      {showTitle && (
        <span className={s.caption}>
          <span className={s.title}>{item.title}</span>
          {item.year && <span className={s.meta}>{item.year}</span>}
        </span>
      )}
      <span className="sr-only">{item.title}</span>
    </Link>
  )
}

export function BackdropCard({
  item,
  label,
  sublabel,
  progress,
  to,
}: {
  item: MediaItem
  label?: string
  sublabel?: string
  /** 0…1, drawn as a bar along the bottom of the artwork. */
  progress?: number
  to?: { season: number; episode: number }
}) {
  return (
    <Link
      to="/title/$type/$id"
      params={{ type: item.type, id: item.id }}
      search={to ? { season: to.season } : undefined}
      className={s.backdrop}
      onPointerEnter={() => prefetchDetail(item)}
      onFocus={() => prefetchDetail(item)}
      onClick={markZoomSource}
      viewTransition
    >
      <div className={s.backdropArtWrap}>
        <Artwork zoom path={item.backdrop} kind="backdrop" alt="" sizes="(max-width: 720px) 72vw, 360px" className={s.backdropArt} fallback={item.title} />
        {progress !== undefined && (
          <span className={s.progress}>
            <span style={{ transform: `scaleX(${Math.max(0.03, Math.min(1, progress))})` }} />
          </span>
        )}
      </div>
      <span className={s.caption}>
        <span className={s.title}>{label ?? item.title}</span>
        {sublabel && <span className={s.meta}>{sublabel}</span>}
      </span>
    </Link>
  )
}
