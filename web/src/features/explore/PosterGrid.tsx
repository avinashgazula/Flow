import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { PosterItem } from '../../components/TitleCards'
import type { MediaItem } from '../../lib/tmdb/types'
import { gridLayout, rowCount, shouldLoadMore } from './gridLayout'
import { useMeasuredBox } from './useMeasuredBox'
import s from './PosterGrid.module.css'

/** The grid's posters are 100 to 200 px wide. */
const gridSizes = '(max-width: 720px) 34vw, 200px'

interface Props {
  items: MediaItem[]
  /** Nothing has loaded yet: fill the first screen with placeholders. */
  pending?: boolean
  /** More pages exist: a row of placeholders sits at the end until they land. */
  hasMore?: boolean
  /** Called when the end is about two screens away. The caller guards against duplicate requests. */
  onNearEnd?: () => void
  label?: string
}

/** A poster grid of any length that only ever holds the rows near the viewport. It scrolls with the
 *  page (a window virtualizer), works out its columns from its own width, and gives every row one
 *  fixed height, so thousands of titles cost what a screenful does and nothing jumps as art loads. */
export function PosterGrid({ items, pending = false, hasMore = false, onNearEnd, label }: Props) {
  'use no memo' // The virtualizer mutates itself between renders; memoising around it would freeze the rows.
  const ref = useRef<HTMLDivElement>(null)
  const { width, top } = useMeasuredBox(ref)

  const layout = gridLayout(width)
  const dataRows = rowCount(items.length, layout.columns)
  const screenRows = Math.max(1, Math.ceil((typeof window === 'undefined' ? 900 : window.innerHeight) / layout.rowHeight))
  const rows = pending ? screenRows : dataRows + (hasMore ? 1 : 0)
  const ghosts = pending || hasMore

  const virtualizer = useWindowVirtualizer({
    count: rows,
    estimateSize: () => layout.rowHeight,
    overscan: 3,
    scrollMargin: top,
  })

  // Every row is the same height, so a new width only needs the cached positions thrown away.
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [virtualizer, layout.rowHeight])

  const virtualRows = virtualizer.getVirtualItems()
  const lastRow = virtualRows[virtualRows.length - 1]?.index ?? -1

  useEffect(() => {
    if (!pending && hasMore && onNearEnd && shouldLoadMore({ lastRow, rows: dataRows, rowsPerScreen: screenRows })) onNearEnd()
  }, [pending, hasMore, onNearEnd, lastRow, dataRows, screenRows])

  return (
    <div ref={ref} className={s.grid} style={{ height: virtualizer.getTotalSize() }} role="list" aria-label={label} aria-busy={pending || undefined}>
      {virtualRows.map((row) => {
        const start = row.index * layout.columns
        return (
          <div
            key={row.key}
            className={s.row}
            style={{
              transform: `translateY(${row.start - top}px)`,
              height: layout.rowHeight - layout.rowGap,
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
              columnGap: layout.gap,
            }}
          >
            {Array.from({ length: layout.columns }, (_, column) => {
              const item = pending ? undefined : items[start + column]
              if (item)
                return (
                  <PosterItem key={`${item.type}${item.id}`} item={item} meta={item.year ? String(item.year) : undefined} sizes={gridSizes} />
                )
              return ghosts ? <Ghost key={`ghost${column}`} /> : null
            })}
          </div>
        )
      })}
    </div>
  )
}

function Ghost() {
  return (
    <div className={s.ghost} aria-hidden>
      <div className={s.ghostArt} />
      <div className={s.ghostStrip} />
      <div className={s.ghostLine} />
    </div>
  )
}
