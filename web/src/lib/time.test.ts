import { describe, expect, it } from 'vitest'
import { clockParts, endTime, formatClock, formatDuration, formatLeft, formatRuntime, formatShortDay, formatWeekdayDate, greetingTitle, spokenDuration } from './time'

// Local-time dates, so the tests hold in any time zone. 2026-10-22 is a Thursday.
const at = (h: number, m = 0, day = 22) => new Date(2026, 9, day, h, m, 0)
const nbsp = ' '

describe('end time', () => {
  it('is now plus what is left', () => {
    expect(endTime(at(21, 30), 18 * 60).getTime()).toBe(at(21, 48).getTime())
  })

  it('rolls past midnight', () => {
    const end = endTime(at(23, 10), 2 * 3600 + 17 * 60)
    expect(end.getDate()).toBe(23)
    expect(end.getHours()).toBe(1)
    expect(end.getMinutes()).toBe(27)
  })

  it('counts whole minutes from the start of this minute, as the screen says them', () => {
    // 17 min 50 s left reads "18 min left", so it ends 18 minutes after the clock's current minute.
    const now = new Date(2026, 9, 22, 21, 30, 40)
    expect(endTime(now, 17 * 60 + 50).getTime()).toBe(at(21, 48).getTime())
    expect(endTime(at(21, 30), 17 * 60 + 50).getTime()).toBe(endTime(now, 17 * 60 + 50).getTime())
  })

  it('treats nothing left as one minute, like "1 min left"', () => {
    expect(endTime(at(20), -50).getTime()).toBe(at(20, 1).getTime())
  })
})

describe('clock', () => {
  it('follows the locale: 24 hours in Britain and Germany, 12 in the US', () => {
    expect(formatClock(at(21, 48), 'en-GB')).toBe('21:48')
    expect(formatClock(at(9, 5), 'de-DE')).toBe('09:05')
    expect(formatClock(at(21, 48), 'en-US')).toBe(`9:48${nbsp}PM`)
    expect(formatClock(at(0, 7), 'en-US')).toBe(`12:07${nbsp}AM`)
  })

  it('splits a 12 hour time so the period can be small', () => {
    expect(clockParts(at(21, 48), 'en-US')).toEqual({ time: '9:48', period: 'PM' })
    expect(clockParts(at(21, 48), 'en-GB')).toEqual({ time: '21:48' })
  })
})

describe('durations', () => {
  it('says minutes under an hour', () => {
    expect(formatLeft(18 * 60)).toBe('18 min left')
    expect(formatLeft(59 * 60)).toBe('59 min left')
  })

  it('says hours and minutes from an hour up', () => {
    expect(formatLeft(104 * 60)).toBe('1 h 44 min left')
    expect(formatDuration(167 * 60)).toBe('2 h 47 min')
  })

  it('drops zero minutes', () => {
    expect(formatDuration(2 * 3600)).toBe('2 h')
  })

  it('rounds to the nearest minute and never says zero', () => {
    expect(formatLeft(89)).toBe('1 min left')
    expect(formatLeft(20)).toBe('1 min left')
    expect(formatLeft(0)).toBe('1 min left')
    expect(formatLeft(18 * 60 + 40)).toBe('19 min left')
  })

  it('writes a runtime for edge print, with padded minutes after an hour', () => {
    expect(formatRuntime(167 * 60)).toBe('2 h 47')
    expect(formatRuntime(181 * 60)).toBe('3 h 01')
    expect(formatRuntime(2 * 3600)).toBe('2 h 00')
    expect(formatRuntime(47 * 60)).toBe('47 min')
  })

  it('has a spoken form for screen readers', () => {
    expect(spokenDuration(18 * 60)).toBe('18 minutes')
    expect(spokenDuration(60)).toBe('1 minute')
    expect(spokenDuration(104 * 60)).toBe('1 hour 44 minutes')
    expect(spokenDuration(2 * 3600)).toBe('2 hours')
  })
})

describe('dates', () => {
  it('names the weekday and date in the locale order', () => {
    expect(formatWeekdayDate(at(20), 'en-GB')).toBe('Thursday 22 October')
    expect(formatWeekdayDate(at(20), 'en-US')).toBe('Thursday, October 22')
  })

  it('gives a short weekday and day for the air-date column', () => {
    expect(formatShortDay(at(20, 0, 27), 'en-GB')).toBe('Tue 27')
    expect(formatShortDay(at(20, 0, 27), 'en-US')).toBe('Tue 27')
  })
})

describe('greeting', () => {
  it('changes at 5, 12 and 17', () => {
    expect(greetingTitle(at(4, 59))).toBe('Tonight')
    expect(greetingTitle(at(5))).toBe('This Morning')
    expect(greetingTitle(at(11, 59))).toBe('This Morning')
    expect(greetingTitle(at(12))).toBe('This Afternoon')
    expect(greetingTitle(at(16, 59))).toBe('This Afternoon')
    expect(greetingTitle(at(17))).toBe('Tonight')
    expect(greetingTitle(at(0, 30))).toBe('Tonight')
  })
})
