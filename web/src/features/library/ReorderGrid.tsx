import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { Icon } from '../../components/Icon'
import { PosterItem } from '../../components/TitleCards'
import { libraryStore, type ListEntry } from '../../lib/store/library'
import { moving, shifting } from '../../lib/watchlistOrder'
import { movedText } from './logic'
import s from './LibraryScreen.module.css'

const sizes = '(max-width: 720px) 34vw, 200px'

/** The watchlist in the viewer's own order, to be rearranged: drag a poster to where it should go, or use the arrows on it,
 *  or hold Alt and press an arrow key on it. Every way keeps one saved order (`library.watchlistOrder`) and says where the
 *  title ended up, so the grid works without a mouse. The posters are not virtualised, as a dragged poster has to
 *  be able to reach any other. `entries` are the whole list, already in the order shown. */
export function ReorderGrid({ entries, arranging }: { entries: ListEntry[]; arranging: boolean }) {
  const keys = entries.map((e) => e.key)
  const list = useRef<HTMLUListElement>(null)
  const [note, setNote] = useState('')
  // The poster being dragged, and the one a drop would land beside, which are marked on their elements directly: they change
  // with every pointer move, and the posters are not worth re-rendering for that.
  const dragging = useRef<string | undefined>(undefined)
  const marked = useRef<HTMLElement | undefined>(undefined)
  // After a move the button that was used keeps the focus, whatever the browser does when its element moves.
  const refocus = useRef<{ key: string; on: 'earlier' | 'later' | 'link' } | undefined>(undefined)

  useLayoutEffect(() => {
    const again = refocus.current
    refocus.current = undefined
    if (!again) return
    const li = list.current?.children[keys.indexOf(again.key)]
    li?.querySelector<HTMLElement>(again.on === 'link' ? 'a' : `button[data-move="${again.on}"]`)?.focus()
  })

  const titleOf = (key: string) => entries.find((e) => e.key === key)?.item.title ?? ''

  function shift(key: string, step: -1 | 1, on: 'earlier' | 'later' | 'link' = step < 0 ? 'earlier' : 'later') {
    const at = keys.indexOf(key)
    if (at < 0) return
    if (at + step < 0 || at + step >= keys.length) {
      setNote(`${titleOf(key)} is already ${step < 0 ? 'first' : 'last'}.`)
      return
    }
    libraryStore.set({ watchlistOrder: shifting(key, step, keys) })
    refocus.current = { key, on }
    setNote(movedText(titleOf(key), at + step, keys.length))
  }

  /** The key of the poster an event happened on. */
  const keyOf = (target: EventTarget | null) => {
    const li = (target as Element | null)?.closest('li')
    const at = li && list.current ? Array.prototype.indexOf.call(list.current.children, li) : -1
    return { li: li as HTMLElement | null, key: keys[at] }
  }

  const clearMarks = () => {
    if (marked.current) delete marked.current.dataset.drop
    marked.current = undefined
    list.current?.querySelectorAll<HTMLElement>('[data-dragging]').forEach((el) => delete el.dataset.dragging)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0
    const { key } = keyOf(e.target)
    if (!step || !key) return
    e.preventDefault()
    // Focus stays on what the key was pressed on: the poster's link, or the button.
    shift(key, step, (e.target as Element).closest('button') ? (step < 0 ? 'earlier' : 'later') : 'link')
  }

  function onDragStart(e: DragEvent) {
    const { li, key } = keyOf(e.target)
    if (!li || !key) return
    dragging.current = key
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
    li.dataset.dragging = ''
  }

  /** Before or after the poster under the pointer, by which half of it the pointer is over. */
  const sideOf = (e: DragEvent, li: HTMLElement) => {
    const box = li.getBoundingClientRect()
    return e.clientX < box.left + box.width / 2 ? 'before' : 'after'
  }

  function onDragOver(e: DragEvent) {
    if (!dragging.current) return
    const { li, key } = keyOf(e.target)
    if (!li || !key) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (marked.current && marked.current !== li) delete marked.current.dataset.drop
    li.dataset.drop = sideOf(e, li)
    marked.current = li
  }

  function onDrop(e: DragEvent) {
    const moved = dragging.current
    const { li, key } = keyOf(e.target)
    clearMarks()
    dragging.current = undefined
    if (!moved || !li || !key) return
    e.preventDefault()
    const before = sideOf(e, li) === 'before' ? key : keys[keys.indexOf(key) + 1]
    const next = moving([moved], before, keys)
    if (next.join() === keys.join()) return
    libraryStore.set({ watchlistOrder: next })
    setNote(movedText(titleOf(moved), next.indexOf(moved), next.length))
  }

  const onDragEnd = () => {
    dragging.current = undefined
    clearMarks()
  }

  return (
    <>
      <p className={`${s.hint} faint`}>{arranging ? 'Use the arrows under a poster to move it earlier or later.' : 'Drag posters to rearrange them, or press Alt with an arrow key on one. On a phone, choose Arrange.'}</p>
      <ul ref={list} className={s.reorder} data-arranging={arranging ? '' : undefined} aria-label="Watchlist, in your order" onKeyDown={onKeyDown} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} onDragLeave={(e) => e.currentTarget === e.target && clearMarks()}>
        {entries.map((e, i) => (
          <PosterItem key={e.key} item={e.item} meta={e.item.year ? String(e.item.year) : undefined} sizes={sizes}>
            <span className={s.move} role="group" aria-label={`Move ${e.item.title}`}>
              <button type="button" className="btn btn-secondary btn-circle btn-compact" data-move="earlier" aria-label={`Move ${e.item.title} earlier, now ${i + 1} of ${entries.length}`} aria-disabled={i === 0 || undefined} onClick={() => shift(e.key, -1)}>
                <Icon name="chevronLeft" size={14} strokeWidth={2.8} />
              </button>
              <button type="button" className="btn btn-secondary btn-circle btn-compact" data-move="later" aria-label={`Move ${e.item.title} later, now ${i + 1} of ${entries.length}`} aria-disabled={i === entries.length - 1 || undefined} onClick={() => shift(e.key, 1)}>
                <Icon name="chevronRight" size={14} strokeWidth={2.8} />
              </button>
            </span>
          </PosterItem>
        ))}
      </ul>
      <p className="sr-only" role="status">
        {note}
      </p>
    </>
  )
}
