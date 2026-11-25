import { describe, expect, it } from 'vitest'
import { formatReleaseDay, homeReleaseStatus, noSourcesNotice } from './homeRelease'

describe('formatReleaseDay', () => {
  it('leaves the year out when it is this year', () => {
    expect(formatReleaseDay('2026-10-16', '2026-11-25', 'en-US')).toBe('October 16')
  })
  it('names the year when it is another one', () => {
    expect(formatReleaseDay('2027-01-20', '2026-11-25', 'en-US')).toBe('January 20, 2027')
  })
  it('follows the locale', () => {
    expect(formatReleaseDay('2026-10-16', '2026-11-25', 'de-DE')).toBe('16. Oktober')
  })
})

describe('noSourcesNotice', () => {
  const now = '2026-11-25'
  it('explains a film that is only in cinemas', () => {
    const status = homeReleaseStatus([{ country: 'US', type: 3, date: '2026-10-16' }], 'US', now)
    expect(noSourcesNotice(status, now, 'en-US')).toEqual({ title: 'In Cinemas', text: "In cinemas since October 16. It has no digital release yet, so your sources don't have it." })
  })
  it('adds the digital date when one is known', () => {
    const status = homeReleaseStatus([{ country: 'US', type: 3, date: '2026-10-16' }, { country: 'US', type: 4, date: '2026-12-18' }], 'US', now)
    expect(noSourcesNotice(status, now, 'en-US')?.text).toBe("In cinemas since October 16. It has no digital release yet, so your sources don't have it. Digital release on December 18.")
  })
  it('says when a film is not out anywhere', () => {
    const status = homeReleaseStatus([{ country: 'US', type: 3, date: '2026-12-03' }], 'US', now)
    expect(noSourcesNotice(status, now, 'en-US')).toEqual({ title: 'Not Out Yet', text: 'Comes to cinemas on December 3.' })
  })
  it('says so when no date is announced', () => {
    expect(noSourcesNotice({ status: 'upcoming', on: null }, now, 'en-US')).toEqual({ title: 'Not Out Yet', text: 'Release date not announced.' })
  })
  it('keeps the ordinary wording otherwise', () => {
    expect(noSourcesNotice({ status: 'available' }, now)).toBeUndefined()
    expect(noSourcesNotice({ status: 'unknown' }, now)).toBeUndefined()
  })
})
