import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'
import { drifted, nextItem, placeMenu, pointAnchor, pressMs, type Anchor } from './menuPlace'
import s from './ContextMenu.module.css'

/* A flat Film Base 2 menu for an item in a list, reached three ways: a More button (shown on hover or focus for a mouse,
   always on a touch screen), a right-click, and a long press. The button is a real tab stop, so the keyboard has
   it too. The menu is a `menu` with arrow keys, Home and End, Escape to close and give focus back, and it closes
   on any outside press, scroll or resize. It opens beside the card it belongs to, which is the nearest <li>. */

export interface MenuItem {
  id: string
  label: string
  icon?: IconName
  /** `card` is the item the menu belongs to, for an action that is the card's own (its link). */
  onSelect: (card: HTMLElement | null) => void
}

export default function ContextMenu({ label, items, className }: { label: string; items: MenuItem[]; className?: string }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<Anchor | null>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const openRef = useRef(false)
  openRef.current = open !== null

  const close = useCallback((giveFocusBack = false) => {
    setOpen(null)
    setAt(null)
    if (giveFocusBack) trigger.current?.focus()
  }, [])

  // The card is the menu's other trigger: a right-click on it, or a long press with a finger.
  useEffect(() => {
    const host = trigger.current?.closest('li')
    if (!host) return
    let timer = 0
    let from = { x: 0, y: 0 }
    let swallow = false
    const stop = () => window.clearTimeout(timer)
    const onContext = (e: MouseEvent) => {
      if ((e.target as Element).closest('[role="menu"]')) return
      e.preventDefault()
      if (openRef.current) return
      const rect = trigger.current!.getBoundingClientRect()
      // A keyboard's menu key reports no position: open beside the button instead.
      setOpen(e.clientX === 0 && e.clientY === 0 ? rect : pointAnchor(e.clientX, e.clientY))
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || (e.target as Element).closest('button')) return
      from = { x: e.clientX, y: e.clientY }
      stop()
      timer = window.setTimeout(() => {
        swallow = true
        setOpen(pointAnchor(from.x, from.y))
        // The lift of the finger after a long press must not open the title as well.
        window.setTimeout(() => (swallow = false), 600)
      }, pressMs)
    }
    const onMove = (e: PointerEvent) => drifted(from, { x: e.clientX, y: e.clientY }) && stop()
    const onClick = (e: MouseEvent) => {
      if (!swallow) return
      e.preventDefault()
      e.stopPropagation()
      swallow = false
    }
    host.addEventListener('contextmenu', onContext)
    host.addEventListener('pointerdown', onDown)
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerup', stop)
    host.addEventListener('pointercancel', stop)
    host.addEventListener('click', onClick, true)
    return () => {
      stop()
      host.removeEventListener('contextmenu', onContext)
      host.removeEventListener('pointerdown', onDown)
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerup', stop)
      host.removeEventListener('pointercancel', stop)
      host.removeEventListener('click', onClick, true)
    }
  }, [])

  // Once drawn, measure the menu and put it where it fits.
  useLayoutEffect(() => {
    if (!open || !menu.current) return
    const box = menu.current.getBoundingClientRect()
    setAt(placeMenu(open, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight }))
  }, [open])

  // A hidden element can't take focus, so the first item waits until the menu is in place.
  useLayoutEffect(() => {
    if (at) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [at])

  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) close()
    }
    const away = (e: Event) => !menu.current?.contains(e.target as Node) && close()
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away as EventListener)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away as EventListener)
    }
  }, [open, close])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      return close(true)
    }
    if (e.key === 'Tab') return close()
    const buttons = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const to = nextItem(buttons.indexOf(document.activeElement as HTMLElement), e.key, buttons.length)
    if (to === undefined) return
    e.preventDefault()
    buttons[to]?.focus()
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`${s.trigger} ${className ?? ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onClick={() => (open ? close() : setOpen(trigger.current!.getBoundingClientRect()))}
      >
        <Icon name="more" size={18} strokeWidth={2.6} />
      </button>
      {open &&
        createPortal(
          <div ref={menu} role="menu" aria-label={label} className={s.menu} style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' }} onKeyDown={onKey}>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={s.item}
                onClick={() => {
                  const card = trigger.current?.closest('li') ?? null
                  close(true)
                  item.onSelect(card)
                }}
              >
                {item.icon && <Icon name={item.icon} size={18} />}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
