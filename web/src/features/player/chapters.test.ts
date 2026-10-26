import { describe, expect, it } from 'vitest'
import { chapterAt, chapterTicks, chapterTitle, markedChapters, MAX_TICKS } from './chapters'

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

describe('the scrubber’s ticks', () => {
  it('mark where each chapter after the first begins', () => {
    expect(markedChapters(chapters).map((c) => c.title)).toEqual(['Opening', '', 'Ending'])
    expect(chapterTicks(chapters, 1800)).toEqual([95 / 1800, 600 / 1800, 1290 / 1800])
  })

  it('leave out a chapter outside the film, and wait for the length', () => {
    expect(chapterTicks([{ title: 'a', start: 10 }, { title: 'b', start: 2000 }], 1800)).toEqual([10 / 1800, null])
    expect(chapterTicks(chapters, Number.NaN)).toEqual([null, null, null])
    expect(chapterTicks(chapters, 0)).toEqual([null, null, null])
  })

  it('are left off when there are too many to read', () => {
    const many = Array.from({ length: MAX_TICKS + 1 }, (_, i) => ({ title: `${i}`, start: i * 10 }))
    expect(chapterTicks(many, 10_000)).toEqual([])
    expect(chapterTicks(many.slice(0, MAX_TICKS), 10_000)).toHaveLength(MAX_TICKS - 1)
  })
})
