import { describe, expect, it } from 'vitest'
import type { Channel, Programme } from '../../lib/livetv/types'
import { favouritesGroup, groupsOf, guideStart, monogram, neighbour, timingText, visibleChannels } from './logic'

const channel = (id: string, name: string, group: string): Channel => ({ id, providerID: 'p', name, group, streamURL: `https://s.example/${id}.m3u8`, hasCatchup: false })
const channels = [channel('1', 'Flow News', 'News'), channel('2', 'Cinema One', 'Movies'), channel('3', 'World 24', 'News'), channel('4', 'Arena', 'Sports')]

describe('groups and filters', () => {
  it('lists groups in the order channels first use them', () => {
    expect(groupsOf(channels)).toEqual(['News', 'Movies', 'Sports'])
  })

  it('filters by group, by favourites and by search, in any mix', () => {
    const none = new Set<string>()
    expect(visibleChannels(channels, { favourites: none, search: '' })).toHaveLength(4)
    expect(visibleChannels(channels, { group: 'News', favourites: none, search: '' }).map((c) => c.id)).toEqual(['1', '3'])
    expect(visibleChannels(channels, { group: favouritesGroup, favourites: new Set(['2', '4']), search: '' }).map((c) => c.id)).toEqual(['2', '4'])
    expect(visibleChannels(channels, { group: 'News', favourites: none, search: ' WORLD ' }).map((c) => c.id)).toEqual(['3'])
    expect(visibleChannels(channels, { favourites: none, search: 'zzz' })).toEqual([])
  })

  it('falls back to every channel when the last favourite is gone', () => {
    expect(visibleChannels(channels, { group: favouritesGroup, favourites: new Set(), search: '' })).toHaveLength(4)
  })
})

describe('changing channel', () => {
  it('wraps at either end and has nowhere to go with one channel', () => {
    expect(neighbour(channels, '4', 1)?.id).toBe('1')
    expect(neighbour(channels, '1', -1)?.id).toBe('4')
    expect(neighbour(channels, '2', 1)?.id).toBe('3')
    expect(neighbour(channels.slice(0, 1), '1', 1)).toBeUndefined()
    expect(neighbour(channels, 'gone', 1)?.id).toBe('1')
  })
})

describe('what stands in for a logo', () => {
  it('takes the first letters of the first two words', () => {
    expect(monogram('Flow News')).toBe('FN')
    expect(monogram('BBC')).toBe('BB')
    expect(monogram('  sky   sports main event ')).toBe('SS')
    expect(monogram('Ñandú TV')).toBe('ÑT')
    expect(monogram('!!!')).toBe('?')
  })
})

describe('the guide window and a programme’s timing', () => {
  const t = Date.parse('2026-03-05T13:41:00Z')
  const programme = (from: number, to: number): Programme => ({ channelID: 'a', title: 'T', start: t + from * 60_000, end: t + to * 60_000 })

  it('starts on a half hour, an hour or so before now', () => {
    const start = guideStart(t)
    expect(start % (30 * 60_000)).toBe(0)
    expect(t - start).toBeGreaterThanOrEqual(30 * 60_000)
    expect(t - start).toBeLessThan(60 * 60_000)
  })

  it('says how long is left, when it starts, or that it ended', () => {
    expect(timingText(programme(-20, 40), t)).toMatch(/ · 40 min left of 60$/)
    expect(timingText(programme(10, 70), t)).toMatch(/ · Starts in 10 min$/)
    expect(timingText(programme(65, 90), t)).toMatch(/ · Starts in 1 h 5 min$/)
    expect(timingText(programme(-90, -30), t)).toMatch(/ · Ended$/)
  })
})
