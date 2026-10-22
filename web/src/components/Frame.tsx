import { Link, type LinkProps } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import type { ImageKind } from '../lib/tmdb/images'
import { Artwork } from './Artwork'
import { markZoomSource } from './zoom'
import { composeStrip, toFacts, type Fact, type PrintPart, type StripKind } from './stripLayout'
import s from './Frame.module.css'

/* Frame and edge strip: Flow's one repeating object, after the printed edge of 35mm film. A still or a
   poster (the frame) has a strip attached under it. The strip's perforations are the progress meter: they
   fill in film-stock yellow as you watch. Its edge print says the facts that decide what to watch:
   "S3 E7 · 18M LEFT · ENDS 21:30 · 2160P · DV".

   - EdgeStrip: the strip alone, to sit under any frame (the title page's still, the player's scrubber).
   - Plate: a frame with its strip, one object (radius 6 on top, 6 below).
   - FrameCard: a whole item for a list or grid: the plate, then a title and one meta line, as one link.

   A strip always carries something real: progress, facts, or both. No strip without facts. */

export { rank, type PrintPart } from './stripLayout'

/** How a strip counts perforations and composes its print: see stripLayout. A lead and a title's still fill
 *  their width; stills and posters keep the same count in every strip of a row. */
export type StripSize = StripKind

/** The strip's own room inside its padding, and the layout that fits it. Measured on the strip, so a card in
 *  a grid of any width gets the print that fits it. After drawing, the printed line is checked once and one
 *  more fact dropped if the estimate was kind (a face that hadn't loaded yet, a locale's longer time). */
function useStripLayout(facts: Fact[], kind: StripKind, active: boolean) {
  const strip = useRef<HTMLSpanElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState(0)
  const [bump, setBump] = useState({ key: '', n: 0 })
  const [fontsAt, setFontsAt] = useState(0)
  const signature = facts.map((f) => `${f.text}|${f.rank}`).join('/')

  useLayoutEffect(() => {
    const el = strip.current
    if (!el) return
    const read = () => {
      const css = getComputedStyle(el)
      setWidth(Math.floor(el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(read)
    watch.observe(el)
    return () => watch.disconnect()
  }, [active])

  // The face arrives after the first paint on a cold load, and its widths differ from the fallback's.
  useEffect(() => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts
    if (!fonts) return
    const again = () => setFontsAt((n) => n + 1)
    fonts.addEventListener?.('loadingdone', again)
    return () => fonts.removeEventListener?.('loadingdone', again)
  }, [])

  const layout = useMemo(() => (width > 0 ? composeStrip({ width, facts, kind }) : undefined), [width, signature, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  // Facts dropped beyond the estimate belong to this width, this print and this face only.
  const key = `${width}|${signature}|${kind}|${fontsAt}`
  const extra = bump.key === key ? bump.n : 0
  const shown = layout && extra > 0 ? { ...layout, facts: dropLeast(layout.facts, extra) } : layout
  useLayoutEffect(() => {
    const el = text.current
    if (el && shown && el.scrollWidth > el.clientWidth + 1 && shown.facts.length > 1) setBump({ key, n: extra + 1 })
  })
  return { strip, text, layout: shown }
}

/** Without its `n` least important facts (never the last one standing). */
function dropLeast(facts: Fact[], n: number): Fact[] {
  let list = facts
  for (let i = 0; i < n && list.length > 1; i++) {
    let drop = 0
    list.forEach((f, j) => {
      if (f.rank >= list[drop]!.rank) drop = j
    })
    list = list.filter((_, j) => j !== drop)
  }
  return list
}

export function EdgeStrip({ progress, print = [], size = 'still', hidden }: { progress?: number; print?: PrintPart[]; size?: StripSize; hidden?: boolean }) {
  const facts = useMemo(() => toFacts(print), [print])
  const { strip, text, layout } = useStripLayout(facts, size, progress !== undefined || facts.length > 0)
  if (progress === undefined && facts.length === 0) return null
  // Until the strip has been measured it is drawn with all its print and no perforations.
  const perfs = layout?.perfs ?? 0
  const shown = layout?.facts ?? facts
  return (
    <span ref={strip} className={s.strip} data-size={size} aria-hidden={hidden || undefined} style={{ '--perfs': perfs } as React.CSSProperties}>
      {perfs > 0 && (
        <span className={s.perfs}>
          {/* --p is how much is watched, 0 to 1; CSS rounds it up to whole perforations. A title not started
              keeps its perforations, all unfilled: it is still a reel. */}
          {progress !== undefined && progress > 0 && <span className={s.watched} style={{ '--p': Math.max(0, Math.min(1, progress)) } as React.CSSProperties} />}
        </span>
      )}
      {shown.length > 0 && (
        <span ref={text} className={s.print}>
          {shown.map((f, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {f.key ? <em>{f.text}</em> : f.text}
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
      <EdgeStrip progress={progress} print={print} size={stripSize ?? (shape === 'poster' ? 'poster' : 'still')} hidden={hideStrip} />
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
  /** Not actionable yet (an episode that hasn't aired): a button that does nothing. Dims it too. */
  disabled?: boolean
  /** More lines under the meta (inline spans), like an episode's synopsis. */
  extra?: ReactNode
  /** Sits in the item beside the link, for a control that can't live inside it (Remove). */
  children?: ReactNode
}

/** An item in a list or grid: a plate, its title, one meta line; the whole of it one link (or button).
 *  Renders an <li>. Hover lifts the plate 2 px and brightens the print; focus rings the plate in yellow. */
export function FrameCard({ link, onSelect, title, meta, label, onIntent, itemRef, dimmed, disabled, extra, children, ...plate }: FrameCardProps) {
  const inside = (
    <>
      <Plate {...plate} hideStrip />
      <span className={s.title}>{title}</span>
      {meta && <span className={s.meta}>{meta}</span>}
      {extra}
    </>
  )
  const shared = {
    className: s.card,
    'data-dimmed': dimmed || disabled ? '' : undefined,
    'aria-label': label,
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
