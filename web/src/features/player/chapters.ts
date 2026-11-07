/* What the player does with a film's chapters besides skipping on their names (segments.ts): which one is playing,
   what to call each, and which the progress bar marks (scrubberLayout.ts cuts the track there). Pure, so it is tested without a browser. */

import type { Chapter } from './segments'

/** A film with dozens of chapters would turn the progress bar into a comb, so past this many none are marked. */
export const MAX_TICKS = 40

/** Index of the chapter playing at `time`: the last that has begun (a half second early counts, as in the apps), or -1 before the first. */
export function chapterAt(chapters: readonly Chapter[], time: number): number {
  let found = -1
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.start <= time + 0.5) found = i
    else break
  }
  return found
}

/** What the list calls a chapter: its own name, else its number. */
export const chapterTitle = (chapter: Chapter, index: number): string => chapter.title.trim() || `Chapter ${index + 1}`

/** The chapters the progress bar marks: every one after the opening, unless there are too many to read. */
export function markedChapters(chapters: readonly Chapter[]): Chapter[] {
  return chapters.length > MAX_TICKS ? [] : chapters.filter((c) => c.start > 0)
}
