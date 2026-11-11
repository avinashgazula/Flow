import { Link, type LinkProps } from '@tanstack/react-router'
import { useMemo, type ReactNode, type Ref } from 'react'
import type { ImageKind } from '../lib/tmdb/images'
import { Artwork } from './Artwork'
import { markZoomSource } from './zoom'
import { toFacts, type PrintPart } from './printLayout'
import s from './Frame.module.css'

/* Frame: Flow's one repeating object. A still or a poster sits in a 2px ink rule, square, and what decides whether to
   watch it is printed under it in mono capitals ("S3 E7 · 18M LEFT · ENDS 21:30 · 2160P · DV"), then its title in
   Plex Sans Condensed. Progress is a thin red bar along the foot of the picture.

   - Plate: the framed picture, with its progress bar and (unless hidden) its printed line.
   - PrintLine: the printed line alone.
   - FrameCard: a whole item for a list or grid: the plate, the line, a title and one meta line, as one link. In a
     `cell` (Continue Watching) the card is a ruled cell whose words invert to blue; elsewhere the frame's rule does.

   A line always carries something real. No line without facts. */

export { rank, type PrintPart } from './printLayout'

/** The line of facts. It wraps when the room is short and clips its second row, so what is lost is the last fact and
 *  never half of one. The time left is marked in red. */
export function PrintLine({ print = [], hidden }: { print?: PrintPart[]; hidden?: boolean }) {
  const facts = useMemo(() => toFacts(print), [print])
  if (facts.length === 0) return null
  return (
    <span className={s.print} aria-hidden={hidden || undefined}>
      {facts.map((f, i) => (
        <span key={i} className={f.key ? s.key : undefined}>
          {f.text}
        </span>
      ))}
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
  /** 0 to 1: the red bar along the picture's foot. Leave out for a title not started; 0 draws the empty bar. */
  progress?: number
  print?: PrintPart[]
  /** Kept so an older caller still compiles; the printed line has one size. */
  stripSize?: 'lead' | 'title' | 'still' | 'poster'
  /** Shown in the frame when there's no artwork. */
  fallback?: string
  /** The printed line is read by the link's own label: leave it out of a screen reader's second pass. */
  hideStrip?: boolean
  className?: string
}

export function Plate({ shape, artPath, artKind, sizes, priority, progress, print, fallback, hideStrip, className }: PlateProps) {
  return (
    <span className={`${s.plate} ${className ?? ''}`} data-shape={shape}>
      <span className={s.shot}>
        <Artwork zoom path={artPath} kind={artKind ?? (shape === 'still' ? 'backdrop' : 'poster')} alt="" sizes={sizes} priority={priority} className={s.frame} fallback={fallback} />
        {progress !== undefined && (
          <span className={s.bar} aria-hidden="true">
            <i style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} />
          </span>
        )}
      </span>
      {!hideStrip && print && print.length > 0 && <PrintLine print={print} hidden />}
    </span>
  )
}

export interface FrameCardProps extends Omit<PlateProps, 'hideStrip' | 'className'> {
  /** Opens a page: the same props a router Link takes (`to`, `params`, `search`). */
  link?: LinkProps
  /** Or runs something. One of `link` and `onSelect` is needed. */
  onSelect?: () => void
  /** Left out when Show Titles Under Posters is off: the label still names the item. */
  title?: string
  /** One line of plain facts under the title, muted. */
  meta?: string
  /** What a screen reader says: "Breaking Bad, season 3 episode 7, 18 minutes left, ends 9:30 PM". */
  label: string
  /** Pointer rests on it, or it takes keyboard focus: prefetch the page behind it. */
  onIntent?: () => void
  /** The row's <li>, for a caller that wants to know when it nears the screen. */
  itemRef?: Ref<HTMLLIElement>
  /** Can't be played here: dimmed, with the reason in `meta`. */
  dimmed?: boolean
  /** Not actionable yet (an episode that hasn't aired): a button that does nothing. Dims it too. */
  disabled?: boolean
  /** A ruled cell (Continue Watching): picture and words share one 2px border, and the words invert to blue. */
  cell?: boolean
  /** More lines under the meta (inline spans), like an episode's synopsis. */
  extra?: ReactNode
  /** Sits in the item beside the link, for a control that can't live inside it (Remove). */
  children?: ReactNode
}

/** An item in a list or grid: a plate, its printed line, its title and one meta line; the whole of it one link (or
 *  button). Renders an <li>. Hover and focus put a blue rule round the frame (the words turn blue in a cell). */
export function FrameCard({ link, onSelect, title, meta, label, onIntent, itemRef, dimmed, disabled, cell, extra, children, print, ...plate }: FrameCardProps) {
  const inside = (
    <>
      <Plate {...plate} hideStrip />
      {/* The spoken label is the name: it starts with the title, and says the print and meta in full words. */}
      <span className="sr-only">{label}</span>
      <span className={s.words} aria-hidden="true">
        <PrintLine print={print} />
        {title && <span className={s.title}>{title}</span>}
        {meta && <span className={s.meta}>{meta}</span>}
        {extra}
      </span>
    </>
  )
  const shared = {
    className: s.card,
    'data-dimmed': dimmed || disabled ? '' : undefined,
    'data-cell': cell ? '' : undefined,
    onPointerEnter: (e: { pointerType: string }) => e.pointerType === 'mouse' && onIntent?.(),
    onFocus: onIntent,
  }
  return (
    <li className={s.item} ref={itemRef} role="listitem">
      {link ? (
        <Link {...link} {...shared} onClick={markZoomSource} viewTransition>
          {inside}
        </Link>
      ) : (
        <button type="button" {...shared} onClick={onSelect} disabled={disabled}>
          {inside}
        </button>
      )}
      {children}
    </li>
  )
}
