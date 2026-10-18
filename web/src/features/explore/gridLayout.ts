/* The arithmetic behind every poster grid (Explore, Library lists, a filmography): how many columns
   fit, how wide a cell is and how tall a row is. Rows have one fixed height, worked out before any
   data or image arrives, so a virtualised grid knows its full height and never shifts. */

export interface GridLayout {
  columns: number
  cellWidth: number
  /** One row plus the space below it: the step between row tops. */
  rowHeight: number
  /** Space between columns. */
  gap: number
  /** Space between rows, included in rowHeight. */
  rowGap: number
}

/** The title and year under a poster, plus the space above them. */
export const captionHeight = 46

/** Below this width the grid is laid out for a phone: three across, tighter gaps. */
const phone = 600

export function gridLayout(width: number, { caption = true }: { caption?: boolean } = {}): GridLayout {
  const w = Math.max(0, width)
  const narrow = w < phone
  const gap = narrow ? 12 : 16
  const rowGap = narrow ? 16 : 24
  // Posters grow until another column fits, so cells stay between about 100 and 200 points wide.
  const minCell = narrow ? 100 : w < 1000 ? 136 : 164
  const columns = Math.max(narrow ? 3 : 2, Math.floor((w + gap) / (minCell + gap)))
  const cellWidth = Math.max(0, (w - gap * (columns - 1)) / columns)
  const rowHeight = Math.round(cellWidth * 1.5 + (caption ? captionHeight : 0) + rowGap)
  return { columns, cellWidth, rowHeight, gap, rowGap }
}

export const rowCount = (items: number, columns: number) => (columns > 0 ? Math.ceil(items / columns) : 0)

/** Whether to ask for the next page: when the last row on screen (or in the overscan) is within
 *  `screens` screenfuls of the end, so the page has landed before anyone scrolls to it. */
export function shouldLoadMore({ lastRow, rows, rowsPerScreen, screens = 2 }: { lastRow: number; rows: number; rowsPerScreen: number; screens?: number }) {
  if (rows === 0) return true
  return lastRow >= rows - 1 - Math.max(1, screens * rowsPerScreen)
}

/** The grid's width before it has been measured: the page's content box at this window size, so
 *  the first render (and a restored scroll position) already has the right number of rows. */
export function estimateContentWidth(viewport: number) {
  const gutter = Math.min(56, Math.max(16, viewport * 0.04))
  return Math.min(1800, viewport) - 2 * gutter
}
