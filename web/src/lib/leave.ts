import { useCallback, useEffect, useRef, useState } from 'react'

/** Lets a sheet play its exit before it unmounts: `close` flags `leaving` (the sheet's CSS answers to `data-leaving`)
 *  and calls `onClose` once the exit has run. Under reduced motion it closes at once. A second call while leaving is
 *  ignored, so Escape then a click can't close twice. */
export function useLeave<A extends unknown[]>(onClose: (...args: A) => void, ms = 160) {
  const [leaving, setLeaving] = useState(false)
  const latest = useRef(onClose)
  const timer = useRef<number | undefined>(undefined)
  const alive = useRef(true)
  useEffect(() => {
    latest.current = onClose
  })
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      window.clearTimeout(timer.current)
    }
  }, [])
  const close = useCallback(
    (...args: A) => {
      if (timer.current !== undefined || !alive.current) return
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return latest.current(...args)
      setLeaving(true)
      timer.current = window.setTimeout(() => latest.current(...args), ms)
    },
    [ms],
  )
  return [close, leaving] as const
}
