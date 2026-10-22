import { useCallback, useState } from 'react'

/** True once the element has come within a screen of the viewport, and stays true. Use it to fetch
 *  something per item only for the items about to be seen: `const [near, ref] = useNearScreen()`, put
 *  `ref` on the item, and enable a query on `near`. Items that never scroll into view cost nothing. */
export function useNearScreen<T extends Element>() {
  const [near, setNear] = useState(false)
  const ref = useCallback(
    (el: T | null) => {
      if (!el || near) return
      const watch = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setNear(true)
            watch.disconnect()
          }
        },
        { rootMargin: '400px 200px' },
      )
      watch.observe(el)
      return () => watch.disconnect()
    },
    [near],
  )
  return [near, ref] as const
}
