import { Children, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import s from './ChipRow.module.css'

/** A row of chips that scrolls sideways and says so: it bleeds to the page edge so a chip is cut off there,
 *  fades on each side that has more, and on a desktop has a button for each. Only while there is more to
 *  scroll, so a row that fits looks like any other. The chips stay ordinary buttons in the page's tab order,
 *  and focusing one scrolls it into view, so keyboard users reach every chip without the arrows. */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ before: false, after: false })
  const count = Children.count(children)

  const measure = useCallback(() => {
    const el = row.current
    if (!el) return
    const before = el.scrollLeft > 1
    const after = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setMore((m) => (m.before === before && m.after === after ? m : { before, after }))
  }, [])

  // Land with the selected chip in view: a "See All" from Home can pick one far along the row.
  useLayoutEffect(() => {
    const el = row.current
    const chip = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (el && chip && chip.offsetLeft + chip.offsetWidth > el.clientWidth) el.scrollLeft = chip.offsetLeft - el.clientWidth / 2 + chip.offsetWidth / 2
    measure()
  }, [count, measure])

  useLayoutEffect(() => {
    const el = row.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [measure])

  const scroll = (direction: 1 | -1) => row.current?.scrollBy({ left: direction * row.current.clientWidth * 0.7, behavior: 'smooth' })

  return (
    <div className={s.wrap}>
      <div className={s.row} role="group" aria-label={label} ref={row} onScroll={measure} data-before={more.before || undefined} data-after={more.after || undefined}>
        {children}
      </div>
      {/* For a mouse; the chips themselves are the keyboard's way along the row. */}
      {more.before && (
        <button type="button" className={`btn btn-secondary btn-circle btn-compact ${s.arrow} ${s.back}`} onClick={() => scroll(-1)} tabIndex={-1} aria-label={`Scroll ${label.toLowerCase()} back`}>
          <Icon name="chevronLeft" size={16} strokeWidth={2.6} />
        </button>
      )}
      {more.after && (
        <button type="button" className={`btn btn-secondary btn-circle btn-compact ${s.arrow} ${s.forward}`} onClick={() => scroll(1)} tabIndex={-1} aria-label={`Scroll ${label.toLowerCase()} forward`}>
          <Icon name="chevronRight" size={16} strokeWidth={2.6} />
        </button>
      )}
    </div>
  )
}
