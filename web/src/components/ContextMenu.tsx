import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'
import { drifted, nextItem, placeMenu, pointAnchor, pressMs, type Anchor } from './menuPlace'
import s from './ContextMenu.module.css'

/* A flat ruled menu for an item in a list, reached three ways: a More button (shown on hover or focus for a mouse,
   always on a touch screen), a right-click, and a long press. The button is a real tab stop, so the keyboard has
   it too. The menu is a `menu` with arrow keys, Home and End, Escape to close and give focus back, and it closes
   on any outside press, scroll or resize. It opens beside the card it belongs to, which is the nearest <li>.
   The source picker's rows use the same panel and triggers without a button (see MenuPanel, useMenuTriggers). */

export interface MenuItem {
  id: string
  label: string
  icon?: IconName
  /** A drawing of its own, for an action the icon set (which every page carries) has no glyph for. */
  glyph?: ReactNode
  /** `card` is the item the menu belongs to, for an action that is the card's own (its link). */
  onSelect: (card: HTMLElement | null) => void
}

/** Calls `onOpen` for a right-click (or the keyboard's menu key, which reports no position: `keyAnchor` says where
 *  then) and for a long press, anywhere in the host. The lift of the finger after a long press must not also open
 *  whatever is under it, so the next click is swallowed. */
export function useMenuTriggers(host: () => Element | null | undefined, onOpen: (anchor: Anchor, target: Element) => void, keyAnchor: (target: Element) => Anchor) {
  const latest = useRef({ onOpen, keyAnchor })
  latest.current = { onOpen, keyAnchor }
  useEffect(() => {
    const el = host()
    if (!el) return
    let timer = 0
    let from = { x: 0, y: 0 }
    let swallow = false
    const stop = () => window.clearTimeout(timer)
    const onContext = (e: Event) => {
      const m = e as MouseEvent
      const target = m.target as Element
      if (target.closest('[role="menu"]')) return
      m.preventDefault()
      latest.current.onOpen(m.clientX === 0 && m.clientY === 0 ? latest.current.keyAnchor(target) : pointAnchor(m.clientX, m.clientY), target)
    }
    const onDown = (e: Event) => {
      const p = e as PointerEvent
      const target = p.target as Element
      if (p.pointerType === 'mouse' || target.closest('button')) return
      from = { x: p.clientX, y: p.clientY }
      stop()
      timer = window.setTimeout(() => {
        swallow = true
        latest.current.onOpen(pointAnchor(from.x, from.y), target)
        window.setTimeout(() => (swallow = false), 600)
      }, pressMs)
    }
    const onMove = (e: Event) => {
      const p = e as PointerEvent
      if (drifted(from, { x: p.clientX, y: p.clientY })) stop()
    }
    const onClick = (e: Event) => {
      if (!swallow) return
      e.preventDefault()
      e.stopPropagation()
      swallow = false
    }
    el.addEventListener('contextmenu', onContext)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', stop)
    el.addEventListener('pointercancel', stop)
    el.addEventListener('click', onClick, true)
    return () => {
      stop()
      el.removeEventListener('contextmenu', onContext)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', stop)
      el.removeEventListener('pointercancel', stop)
      el.removeEventListener('click', onClick, true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The open menu: in a portal over everything, put where it fits once measured, first item focused, arrow keys, Escape,
 *  closed by any outside press, scroll or resize. `keep` is the control that opened it, whose own press toggles it. */
export function MenuPanel({ label, items, anchor, onClose, keep, card }: { label: string; items: MenuItem[]; anchor: Anchor; onClose: (giveFocusBack?: boolean) => void; keep?: RefObject<Element | null>; card?: () => HTMLElement | null }) {
  const menu = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)

  // Once drawn, measure the menu and put it where it fits.
  useLayoutEffect(() => {
    if (!menu.current) return
    const box = menu.current.getBoundingClientRect()
    setAt(placeMenu(anchor, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight }))
  }, [anchor])

  // A hidden element can't take focus, so the first item waits until the menu is in place.
  useLayoutEffect(() => {
    if (at) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [at])

  useEffect(() => {
    const outside = (e: Event) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !keep?.current?.contains(t)) onClose()
    }
    const away = (e: Event) => !menu.current?.contains(e.target as Node) && onClose()
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away)
    }
  }, [onClose, keep])

  // The menu's keys are its own: a sheet behind it (the source picker closes on Escape) must not hear them.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      return onClose(true)
    }
    if (e.key === 'Tab') return onClose()
    const buttons = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const to = nextItem(buttons.indexOf(document.activeElement as HTMLElement), e.key, buttons.length)
    if (to === undefined) return
    e.preventDefault()
    e.stopPropagation()
    buttons[to]?.focus()
  }

  return createPortal(
    <div ref={menu} role="menu" aria-label={label} className={s.menu} data-placed={at ? '' : undefined} style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' }} onKeyDown={onKey}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={s.item}
          onClick={() => {
            const host = card?.() ?? null
            onClose(true)
            item.onSelect(host)
          }}
        >
          {item.glyph ?? (item.icon && <Icon name={item.icon} size={18} />)}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}

export default function ContextMenu({ label, items, className }: { label: string; items: MenuItem[]; className?: string }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState<Anchor | null>(null)

  const close = useCallback((giveFocusBack = false) => {
    setOpen(null)
    if (giveFocusBack) trigger.current?.focus()
  }, [])

  // The card is the menu's other trigger: a right-click on it, or a long press with a finger.
  useMenuTriggers(
    () => trigger.current?.closest('li'),
    (anchor) => setOpen(anchor),
    () => trigger.current!.getBoundingClientRect(),
  )

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
      {open && <MenuPanel label={label} items={items} anchor={open} onClose={close} keep={trigger} card={() => trigger.current?.closest('li') ?? null} />}
    </>
  )
}
