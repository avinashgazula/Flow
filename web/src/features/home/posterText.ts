/* What is written under a poster and a Continue Watching card, as the apps' Posters switches decide it: Show Titles
   Under Posters (on), Show Release Year (off, and the year stands alone when titles are hidden) and Show Continue
   Watching Release Date (on). */

export interface CaptionOptions {
  showTitles: boolean
  showYear: boolean
}

/** The title and the one line of facts under a poster. `meta` is a caller's own line (a list's year or rating), which
 *  the year never replaces. A title hidden leaves the poster's spoken label to say it. */
export function posterCaption(item: { title: string; year?: number }, { showTitles, showYear }: CaptionOptions, meta?: string): { title?: string; meta?: string } {
  const year = showYear && item.year ? String(item.year) : undefined
  return { ...(showTitles ? { title: item.title } : {}), meta: meta ?? year }
}

/** A Continue Watching card's line of facts, ending in the title's release year when that is on. */
export function continueMeta(line: string, year: number | undefined, showYear: boolean): string {
  return [line, showYear && year ? year : undefined].filter(Boolean).join(' · ')
}
