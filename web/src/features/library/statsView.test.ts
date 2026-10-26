import { describe, expect, it } from 'vitest'
import { bars, firstWeekday, habitLines, leadSentence, shownLabels } from './statsView'

describe('the lead sentence', () => {
  it('says what the time was spent on, leaving out what there was none of', () => {
    expect(leadSentence({ filmsWatched: 12, episodesWatched: 183, showsWatched: 14 })).toBe('12 films and 183 episodes of 14 shows')
    expect(leadSentence({ filmsWatched: 1, episodesWatched: 1, showsWatched: 1 })).toBe('1 film and 1 episode of 1 show')
    expect(leadSentence({ filmsWatched: 3, episodesWatched: 0, showsWatched: 0 })).toBe('3 films')
    expect(leadSentence({ filmsWatched: 0, episodesWatched: 5, showsWatched: 2 })).toBe('5 episodes of 2 shows')
    expect(leadSentence({ filmsWatched: 0, episodesWatched: 1200, showsWatched: 40 })).toBe(`${(1200).toLocaleString()} episodes of 40 shows`)
  })
})

describe('the bars', () => {
  const b = (minutes: number) => ({ start: 0, minutes, isCurrent: false })
  it('are proportional to the tallest, empty for nothing and never invisible for something', () => {
    expect(bars([b(60), b(30), b(0), b(1)])).toEqual([1, 0.5, 0, 0.03])
    expect(bars([b(0), b(0)])).toEqual([0, 0])
    expect(bars([])).toEqual([])
  })

  it('label every bar up to twelve, then every third', () => {
    expect(shownLabels(12).every(Boolean)).toBe(true)
    expect(shownLabels(5).every(Boolean)).toBe(true)
    expect(shownLabels(13).map((x, i) => (x ? i : -1)).filter((i) => i >= 0)).toEqual([0, 3, 6, 9, 12])
  })
})

describe('the first day of the week', () => {
  it('follows the locale where the browser says, else Monday', () => {
    expect([0, 1]).toContain(firstWeekday('en-US'))
    expect(firstWeekday('en-GB')).toBe(1)
    expect(firstWeekday('not a locale')).toBe(1)
  })
})

describe('habits', () => {
  it('gives the streak’s dates when it ran more than a day, and the favourite weekday', () => {
    const start = new Date(2026, 9, 3).getTime()
    const end = new Date(2026, 9, 7).getTime()
    const lines = habitLines({ period: 'thisYear', longestStreak: 5, longestStreakStart: start, longestStreakEnd: end, busiestWeekday: 5 }, 'en-US')
    expect(lines).toEqual([
      { label: 'Longest Streak', value: '5 days', detail: 'Oct 3 – Oct 7' },
      { label: 'Favourite Day', value: 'Friday', detail: 'Most watch time' },
    ])
  })

  it('includes the year for all time, and says one day plainly with no dates', () => {
    const d = new Date(2024, 11, 30).getTime()
    expect(habitLines({ period: 'allTime', longestStreak: 2, longestStreakStart: d, longestStreakEnd: new Date(2024, 11, 31).getTime(), busiestWeekday: 0 }, 'en-US')[0]!.detail).toBe('Dec 30, 2024 – Dec 31, 2024')
    const one = habitLines({ period: 'thisYear', longestStreak: 1, longestStreakStart: d, longestStreakEnd: d, busiestWeekday: undefined }, 'en-US')
    expect(one[0]).toEqual({ label: 'Longest Streak', value: '1 day', detail: undefined })
    expect(one[1]).toEqual({ label: 'Favourite Day', value: '–', detail: undefined })
  })
})
