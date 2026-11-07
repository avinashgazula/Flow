import { describe, expect, it } from 'vitest'
import { chapterAt, chapterTitle, markedChapters, MAX_TICKS } from './chapters'

const chapters = [
  { title: 'Prologue', start: 0 },
  { title: 'Opening', start: 95 },
  { title: '', start: 600 },
  { title: 'Ending', start: 1290 },
]

describe('which chapter is playing', () => {
  it('is the last one that has begun', () => {
    expect(chapterAt(chapters, 0)).toBe(0)
    expect(chapterAt(chapters, 94)).toBe(0)
    expect(chapterAt(chapters, 700)).toBe(2)
    expect(chapterAt(chapters, 5000)).toBe(3)
  })

  it('counts a chapter that begins within half a second, so a seek to its start lands in it', () => {
    expect(chapterAt(chapters, 94.6)).toBe(1)
    expect(chapterAt(chapters, 94.4)).toBe(0)
  })

  it('is none before the first, or when there are none', () => {
    expect(chapterAt([{ title: 'Late', start: 30 }], 10)).toBe(-1)
    expect(chapterAt([], 10)).toBe(-1)
  })
})

describe('naming a chapter', () => {
  it('uses its name, else its number', () => {
    expect(chapterTitle(chapters[1]!, 1)).toBe('Opening')
    expect(chapterTitle(chapters[2]!, 2)).toBe('Chapter 3')
    expect(chapterTitle({ title: '  ', start: 0 }, 0)).toBe('Chapter 1')
  })
})

describe('the chapters the progress bar marks', () => {
  it('are each one after the first', () => {
    expect(markedChapters(chapters).map((c) => c.title)).toEqual(['Opening', '', 'Ending'])
  })

  it('are left off when there are too many to read', () => {
    const many = Array.from({ length: MAX_TICKS + 1 }, (_, i) => ({ title: `${i}`, start: i * 10 }))
    expect(markedChapters(many)).toEqual([])
    expect(markedChapters(many.slice(0, MAX_TICKS))).toHaveLength(MAX_TICKS - 1)
  })
})
