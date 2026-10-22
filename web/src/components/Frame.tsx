import { Link, type LinkProps } from '@tanstack/react-router'
import type { ReactNode, Ref } from 'react'
import type { ImageKind } from '../lib/tmdb/images'
import { Artwork } from './Artwork'
import { markZoomSource } from './Cards'
import s from './Frame.module.css'

/* Frame and edge strip: Flow's one repeating object, after the printed edge of 35mm film. A still or a
   poster (the frame) has a strip attached under it. The strip's perforations are the progress meter: they
   fill in film-stock yellow as you watch. Its edge print says the facts that decide what to watch:
   "S3 E7 · 18 MIN LEFT · ENDS 21:30 · 2160P · DV".

   - EdgeStrip: the strip alone, to sit under any frame (the title page's still, the player's scrubber).
   - Plate: a frame with its strip, one object (radius 6 on top, 6 below).
   - FrameCard: a whole item for a list or grid: the plate, then a title and one meta line, as one link.

   A strip always carries something real: progress, facts, or both. No strip without facts. */

/** One piece of edge print. A plain string is print; `{ key }` is the fact that matters most (time left,
 *  NEW), which is the one thing in yellow. */
export type PrintPart = string | { key: string }

/** How many perforations a strip draws (CSS sets the width: `--perfs` in Frame.module.css). */
export type StripSize = 'lead' | 'still'

export function EdgeStrip({ progress, print = [], size = 'still', hidden }: { progress?: number; print?: PrintPart[]; size?: StripSize; hidden?: boolean }) {
  const parts = print.filter((p) => (typeof p === 'string' ? p : p.key))
  if (progress === undefined && parts.length === 0) return null
  return (
    <span className={s.strip} data-size={size} aria-hidden={hidden || undefined}>
      {progress !== undefined && (
        <span className={s.perfs}>
          {/* --p is how much is watched, 0 to 1; CSS rounds it up to whole perforations. */}
          <span className={s.watched} style={{ '--p': Math.max(0, Math.min(1, progress)) } as React.CSSProperties} />
        </span>
      )}
      {parts.length > 0 && (
        <span className={s.print}>
          {parts.map((p, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {typeof p === 'string' ? p : <em>{p.key}</em>}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

export interface PlateProps {
  /** A still is 16:9, a poster 2:3. The size comes from the parent: the plate fills its width. */
  shape: 'still' | 'poster'
  artPath?: string
  /** Which TMDB size ladder `artPath` comes from. Defaults to backdrop for stills, poster for posters. */
  artKind?: ImageKind
  /** CSS `sizes`: how wide the frame renders. */
  sizes: string
  /** The first screen's largest image: fetched at once, never lazily. */
  priority?: boolean
  /** 0 to 1: perforations fill as you watch. Leave out for a title not started: print only. */
  progress?: number
  print?: PrintPart[]
  stripSize?: StripSize
  /** Shown in the frame when there's no artwork. */
  fallback?: string
  /** The strip is read by the link's own label: hide it from a screen reader's second pass. */
  hideStrip?: boolean
  className?: string
}

export function Plate({ shape, artPath, artKind, sizes, priority, progress, print, stripSize, fallback, hideStrip, className }: PlateProps) {
  const strip = progress !== undefined || (print && print.length > 0)
  return (
    <span className={`${s.plate} ${className ?? ''}`} data-shape={shape} data-strip={strip ? '' : undefined}>
      <Artwork zoom path={artPath} kind={artKind ?? (shape === 'still' ? 'backdrop' : 'poster')} alt="" sizes={sizes} priority={priority} className={s.frame} fallback={fallback} />
      <EdgeStrip progress={progress} print={print} size={stripSize} hidden={hideStrip} />
    </span>
  )
}

export interface FrameCardProps extends Omit<PlateProps, 'hideStrip' | 'className'> {
  /** Opens a page: the same props a router Link takes (`to`, `params`, `search`). */
  link?: LinkProps
  /** Or runs something. One of `link` and `onSelect` is needed. */
  onSelect?: () => void
  title: string
  /** One line of plain facts under the title, ink-2. */
  meta?: string
  /** What a screen reader says: "Breaking Bad, season 3 episode 7, 18 minutes left, ends 9:30 PM". */
  label: string
  /** Pointer rests on it, or it takes keyboard focus: prefetch the page behind it. */
  onIntent?: () => void
  /** The row's <li>, for a caller that wants to know when it nears the screen. */
  itemRef?: Ref<HTMLLIElement>
  /** Can't be played here: dimmed, with the reason in `meta`. */
  dimmed?: boolean
  children?: ReactNode
}

/** An item in a list or grid: a plate, its title, one meta line; the whole of it one link (or button).
 *  Renders an <li>. Hover lifts the plate 2 px and brightens the print; focus rings the plate in yellow. */
export function FrameCard({ link, onSelect, title, meta, label, onIntent, itemRef, dimmed, ...plate }: FrameCardProps) {
  const inside = (
    <>
      <Plate {...plate} hideStrip />
      <span className={s.title}>{title}</span>
      {meta && <span className={s.meta}>{meta}</span>}
    </>
  )
  const shared = {
    className: s.card,
    'data-dimmed': dimmed ? '' : undefined,
    'aria-label': label,
    onPointerEnter: (e: { pointerType: string }) => e.pointerType === 'mouse' && onIntent?.(),
    onFocus: onIntent,
  }
  return (
    <li className={s.item} ref={itemRef}>
      {link ? (
        <Link {...link} {...shared} onClick={markZoomSource} viewTransition>
          {inside}
        </Link>
      ) : (
        <button type="button" {...shared} onClick={onSelect}>
          {inside}
        </button>
      )}
    </li>
  )
}
