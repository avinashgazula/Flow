import { describe, expect, it } from 'vitest'
import { demoChannels, demoGuide, demoPlaylist, demoProvider, demoStreams, isDemoAddress } from './demo'
import { nowAndNext } from './epg'
import { parseM3U } from './m3u'
import { parseXMLTV } from './xmltv'

/* After FlowKit's DemoTests.testRatingsAndLiveTV: the sample provider reads back through the real parsers. */
describe('the sample IPTV provider', () => {
  const now = Date.parse('2026-03-05T13:41:00Z')

  it('lists every channel with a guide id, a number, a group and a stream that plays', () => {
    const playlist = parseM3U(demoPlaylist(), demoProvider.id)
    expect(playlist.channels).toHaveLength(demoChannels.length)
    expect(playlist.vod).toHaveLength(0)
    expect(playlist.epgURL).toBe(demoProvider.epgURL)
    expect(playlist.channels.map((c) => c.number)).toEqual(demoChannels.map((_, i) => i + 1))
    expect(new Set(playlist.channels.map((c) => c.group))).toEqual(new Set(['News', 'Movies', 'Sports', 'Documentary', 'Kids', 'Music']))
    expect(playlist.channels.every((c) => demoStreams.includes(c.streamURL))).toBe(true)
  })

  it('has something on now, and something next, on every channel', () => {
    const epg = parseXMLTV(demoGuide(now))
    expect(Object.keys(epg.programmes)).toHaveLength(demoChannels.length)
    for (const channel of parseM3U(demoPlaylist(), 'p').channels) {
      const { now: on, next } = nowAndNext(epg, channel.epgID, now)
      expect(on, channel.name).toBeDefined()
      expect(next, channel.name).toBeDefined()
      expect(on!.start).toBeLessThanOrEqual(now)
      expect(on!.end).toBeGreaterThan(now)
    }
    expect(epg.displayNames['flow.news']).toBe('Flow News')
  })

  it('runs for hours ahead, with no gaps between programmes', () => {
    const epg = parseXMLTV(demoGuide(now))
    for (const list of Object.values(epg.programmes)) {
      expect(list.at(-1)!.end - now).toBeGreaterThan(8 * 3_600_000)
      list.slice(1).forEach((p, i) => expect(p.start).toBe(list[i]!.end))
    }
  })

  it('recognises its own address', () => {
    expect(isDemoAddress(demoProvider.url)).toBe(true)
    expect(isDemoAddress(demoProvider.epgURL!)).toBe(true)
    expect(isDemoAddress('https://iptv.example/live.m3u')).toBe(false)
    expect(isDemoAddress('nonsense')).toBe(false)
  })
})
