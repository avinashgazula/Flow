import { describe, expect, it } from 'vitest'
import { parseM3U } from './m3u'

/* Ported from FlowKit's LiveTVParserTests and LiveTVEdgeCaseTests. */
describe('M3U parsing', () => {
  it('reads channels, groups, logos, numbers, the guide address and per-channel user agents', () => {
    const m3u = `#EXTM3U x-tvg-url="https://epg.example.com/guide.xml.gz"
#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="https://logo/bbc1.png" group-title="UK",BBC One HD
#EXTVLCOPT:http-user-agent=Flow/1.0
https://stream.example.com/live/bbc1.m3u8
#EXTINF:-1 tvg-id="" group-title="Movies VOD",The Matrix (1999)
https://stream.example.com/movie/u/p/123.mkv
#EXTINF:-1 tvg-chno="7" group-title='News',Sky News
https://stream.example.com/live/sky.ts`
    const playlist = parseM3U(m3u, 'p1')
    expect(playlist.epgURL).toBe('https://epg.example.com/guide.xml.gz')
    expect(playlist.channels).toHaveLength(2)
    expect(playlist.vod).toHaveLength(1)
    const bbc = playlist.channels[0]!
    expect(bbc.name).toBe('BBC One HD')
    expect(bbc.group).toBe('UK')
    expect(bbc.epgID).toBe('bbc1.uk')
    expect(bbc.userAgent).toBe('Flow/1.0')
    expect(bbc.logoURL).toBe('https://logo/bbc1.png')
    expect(playlist.channels[1]!.number).toBe(7)
    expect(playlist.channels[1]!.group).toBe('News')
    expect(playlist.channels[1]!.userAgent).toBeUndefined()
  })

  it('keeps commas in names and groups, ignores a byte-order mark, and falls back to tvg-name and Uncategorised', () => {
    const m3u = `﻿#EXTM3U x-tvg-url="https://a.example/g.xml,https://b.example/g.xml"\r
#EXTINF:-1 tvg-id="x.uk" group-title="News, Sport",Sky Sports, Main Event
https://stream.example.com/live/1.m3u8
#EXTINF:-1 tvg-name="Quiet One" group-title="",
https://stream.example.com/live/2.m3u8`
    const playlist = parseM3U(m3u, 'p')
    expect(playlist.epgURL).toBe('https://a.example/g.xml')
    expect(playlist.channels, 'A byte-order mark must not turn the header into a channel').toHaveLength(2)
    expect(playlist.channels[0]!.name).toBe('Sky Sports, Main Event')
    expect(playlist.channels[0]!.group).toBe('News, Sport')
    expect(playlist.channels[1]!.name).toBe('Quiet One')
    expect(playlist.channels[1]!.group).toBe('Uncategorised')
  })

  it('takes a group from an #EXTGRP line and flags catch-up', () => {
    const m3u = `#EXTM3U
#EXTGRP:Sport
#EXTINF:-1 tvg-id="a" catchup="default",Arena
https://stream.example.com/live/a.m3u8
#EXTINF:-1 tvg-rec="3",Arena 2
https://stream.example.com/live/b.m3u8
#EXTINF:-1,Plain
https://stream.example.com/live/c.m3u8`
    const { channels } = parseM3U(m3u, 'p')
    expect(channels.map((c) => c.group)).toEqual(['Sport', 'Uncategorised', 'Uncategorised'])
    expect(channels.map((c) => c.hasCatchup)).toEqual([true, true, false])
    // The group line applies to the next channel only.
    expect(channels[0]!.epgID).toBe('a')
  })

  it('gives ids that stay unique when two channels share a name, and tells VOD apart from live', () => {
    const m3u = `#EXTM3U
#EXTINF:-1,News
https://s.example/live/1.m3u8
#EXTINF:-1,News
https://s.example/live/2.m3u8
#EXTINF:-1 group-title="Movies",Heat
https://s.example/live/heat.m3u8
#EXTINF:-1,Film
https://s.example/series/u/p/9.m3u8
#EXTINF:-1,Clip
https://s.example/media/clip.mp4`
    const playlist = parseM3U(m3u, 'p')
    expect(new Set(playlist.channels.map((c) => c.id)).size).toBe(playlist.channels.length)
    // A group called "Movies" is often live; only the path or a VOD tag says otherwise.
    expect(playlist.channels.map((c) => c.name)).toEqual(['News', 'News', 'Heat'])
    expect(playlist.vod.map((c) => c.name)).toEqual(['Film', 'Clip'])
  })

  it('reads a relative stream address against the playlist address, and skips lines it cannot read', () => {
    const m3u = `#EXTM3U
#EXTINF:-1,Local
streams/local.m3u8
#EXTINF:-1,Nowhere
http://`
    const { channels } = parseM3U(m3u, 'p', { baseURL: 'https://iptv.example/lists/all.m3u' })
    expect(channels.map((c) => c.streamURL)).toEqual(['https://iptv.example/lists/streams/local.m3u8'])
  })

  it('uses the default user agent when a channel names none', () => {
    const { channels } = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://s.example/a.m3u8', 'p', { defaultUserAgent: 'Flow/2' })
    expect(channels[0]!.userAgent).toBe('Flow/2')
  })
})
