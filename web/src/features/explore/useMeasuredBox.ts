import { useLayoutEffect, useState, type RefObject } from 'react'
import { estimateContentWidth } from './gridLayout'

/** An element's width and its distance from the top of the document, kept current. A window
 *  virtualizer needs both: the width decides the layout, the offset is its scroll margin. */
export function useMeasuredBox(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1200 : estimateContentWidth(window.innerWidth)))
  const [top, setTop] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      setWidth(el.clientWidth)
      setTop(Math.round(el.getBoundingClientRect().top + window.scrollY))
    }
    measure()
    // The body too: anything above the element changing height moves where it starts.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [ref])

  return { width, top }
}
