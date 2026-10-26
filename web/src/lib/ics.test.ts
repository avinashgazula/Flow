import { describe, expect, it } from 'vitest'
import { buildICS, dateValue, escapeText, fold, icsFileName, nextDay, utcStamp } from './ics'

const now = Date.UTC(2026, 9, 25, 22, 55, 54)

describe('dates in a calendar file', () => {
  it('writes a moment in UTC', () => {
    expect(utcStamp(now)).toBe('20261025T225554Z')
    expect(utcStamp(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('20260102T030405Z')
  })

  it('writes a day without a time zone, and steps to the next one by the calendar', () => {
    expect(dateValue('2026-10-27')).toBe('20261027')
    expect(dateValue('27 Oct 2026')).toBeUndefined()
    expect(nextDay('2026-10-27')).toBe('20261028')
    // Month, year and leap-day ends; and the nights clocks change, which a 24 hour step would get wrong in some zones.
    expect(nextDay('2026-10-31')).toBe('20261101')
    expect(nextDay('2026-12-31')).toBe('20270101')
    expect(nextDay('2028-02-28')).toBe('20280229')
    expect(nextDay('2026-10-25')).toBe('20261026')
    expect(nextDay('2026-03-29')).toBe('20260330')
    expect(nextDay('nope')).toBeUndefined()
  })
})

describe('text in a calendar file', () => {
  it('escapes what the format reserves', () => {
    expect(escapeText('Rick, Morty; and \\ more\nnext line')).toBe('Rick\\, Morty\\; and \\\\ more\\nnext line')
  })

  it('folds a long line at 75 octets without splitting a character', () => {
    const line = `SUMMARY:${'é'.repeat(80)}`
    const folded = fold(line).split('\r\n')
    expect(folded.length).toBeGreaterThan(1)
    const enc = new TextEncoder()
    for (const [i, l] of folded.entries()) {
      expect(enc.encode(l).length).toBeLessThanOrEqual(75)
      if (i > 0) expect(l.startsWith(' ')).toBe(true)
    }
    // Unfolding gives the line back.
    expect(folded.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(line)
    expect(fold('short')).toBe('short')
  })
})

describe('the calendar file', () => {
  const episode = { uid: 'show-1396-s3e7@flow-web', title: 'Breaking Bad — S3E7 · One Minute', day: '2026-10-27', description: 'Hank, back at work.', url: 'https://www.themoviedb.org/tv/1396/season/3/episode/7' }

  it('is a calendar with CRLF line ends and an all-day event on the day itself', () => {
    const text = buildICS([episode], now)
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(text.split('\r\n').filter((l) => l.includes('\n'))).toEqual([])
    expect(text).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Flow//Upcoming//EN')
    expect(text).toContain('UID:show-1396-s3e7@flow-web')
    expect(text).toContain('DTSTAMP:20261025T225554Z')
    expect(text).toContain('DTSTART;VALUE=DATE:20261027\r\nDTEND;VALUE=DATE:20261028')
    expect(text).toContain('SUMMARY:Breaking Bad — S3E7 · One Minute')
    expect(text).toContain('DESCRIPTION:Hank\\, back at work.')
    expect(text).toContain('URL:https://www.themoviedb.org/tv/1396/season/3/episode/7')
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  })

  it('is the same file for the same events, so adding an event twice updates it', () => {
    expect(buildICS([episode], now)).toBe(buildICS([episode], now))
    expect(buildICS([episode], now).match(/UID:.*/)?.[0]).toBe(buildICS([episode], now + 86_400_000).match(/UID:.*/)?.[0])
  })

  it('holds many events, in order, and a moment in UTC with an hour by default', () => {
    const game = { uid: 'game-1@flow-web', title: 'Harbour City v Northgate United', start: Date.UTC(2026, 10, 1, 15, 30) }
    const text = buildICS([episode, game], now)
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(text.indexOf('s3e7')).toBeLessThan(text.indexOf('game-1'))
    expect(text).toContain('DTSTART:20261101T153000Z\r\nDTEND:20261101T163000Z')
    expect(buildICS([{ ...game, end: Date.UTC(2026, 10, 1, 17, 45) }], now)).toContain('DTEND:20261101T174500Z')
  })

  it('leaves out an event it cannot date', () => {
    const text = buildICS([{ uid: 'x', title: 'Nothing', day: 'soon' }, { uid: 'y', title: 'Neither' }], now)
    expect(text).not.toContain('BEGIN:VEVENT')
    expect(text).toContain('END:VCALENDAR')
  })

  it('keeps no line longer than 75 octets', () => {
    const text = buildICS([{ ...episode, description: 'A very long synopsis, '.repeat(20) }], now)
    const enc = new TextEncoder()
    for (const l of text.split('\r\n')) expect(enc.encode(l).length).toBeLessThanOrEqual(75)
  })
})

describe('file names', () => {
  it('keeps letters and digits, drops what a file name cannot hold, and is never empty', () => {
    expect(icsFileName('Breaking Bad S3E7')).toBe('Breaking Bad S3E7.ics')
    expect(icsFileName('Shōgun: Part/Two?')).toBe('Shogun PartTwo.ics')
    expect(icsFileName('???')).toBe('Flow.ics')
  })
})
