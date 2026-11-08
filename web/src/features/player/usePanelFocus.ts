import { useEffect, useRef, type RefObject } from 'react'

const firstStop = 'button:not(:disabled), input:not(:disabled), [tabindex="0"]'

/** Keyboard focus for a panel that opens over the controls. Opened with a key, focus is on the button that opened it:
 *  move it into the panel, and give it back when the panel closes (Escape included), so the next Tab continues from
 *  where the person was. Pointer use leaves focus alone, since a focused button would take Space from play and pause.
 *  `page` is the panel's own page: a row pressed to open a deeper page is gone by then, and focus goes to the new
 *  page's first stop instead of falling to the document. */
export function usePanelFocus(ref: RefObject<HTMLElement | null>, page?: unknown) {
  const keys = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const opener = document.activeElement
    const fromKeyboard = opener instanceof HTMLElement && opener !== document.body && opener.matches(':focus-visible')
    keys.current = fromKeyboard
    if (fromKeyboard) el.querySelector<HTMLElement>(firstStop)?.focus()
    const typed = () => void (keys.current = true)
    const clicked = () => void (keys.current = false)
    el.addEventListener('keydown', typed)
    el.addEventListener('pointerdown', clicked)
    return () => {
      el.removeEventListener('keydown', typed)
      el.removeEventListener('pointerdown', clicked)
      const stranded = document.activeElement === document.body || el.contains(document.activeElement)
      if (fromKeyboard && stranded && opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [ref])

  const shown = useRef(page)
  useEffect(() => {
    if (shown.current === page) return
    shown.current = page
    const el = ref.current
    if (el && keys.current && !el.contains(document.activeElement)) el.querySelector<HTMLElement>(firstStop)?.focus()
  }, [ref, page])
}
