import { describe, expect, it } from 'vitest'
import { detectPlatform, externalPlayerTitle, launchURL, playersFor, streamLink } from './externalPlayers'

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

/* The links are FlowKit's ExternalPlayer.launchURL, player for player. */
describe('where the apps exist', () => {
  it('knows iPhone, iPad and Mac, and nothing else', () => {
    expect(detectPlatform(iphone, 5)).toBe('ios')
    expect(detectPlatform(mac, 0)).toBe('macos')
    // iPadOS asks for desktop sites by default and says it is a Mac; only the touch screen gives it away.
    expect(detectPlatform(mac, 5)).toBe('ios')
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0', 0)).toBeUndefined()
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0', 0)).toBeUndefined()
  })

  it('lists the iOS apps on iOS and IINA and mpv on a Mac, the viewer’s own choice first', () => {
    expect(playersFor('ios')).toEqual(['infuse', 'vlc', 'outplayer', 'senPlayer', 'vidHub', 'cineUltra', 'moonPlayer'])
    expect(playersFor('macos')).toEqual(['infuse', 'vidHub', 'iina', 'mpv'])
    expect(playersFor('ios', 'outplayer')[0]).toBe('outplayer')
    // A choice made on another device (it syncs) that doesn't exist here leads nothing.
    expect(playersFor('macos', 'vlc')).toEqual(['infuse', 'vidHub', 'iina', 'mpv'])
    expect(playersFor(undefined)).toEqual([])
  })

  it('names the built-in player as the apps do', () => {
    expect(externalPlayerTitle('none')).toBe('Built-in Player')
    expect(externalPlayerTitle('moonPlayer')).toBe('Moon Player')
    expect(externalPlayerTitle('mpv')).toBe('mpv')
  })
})

describe('which streams an app can open', () => {
  it('takes a plain web address', () => {
    expect(streamLink({ url: 'https://cdn.example.com/Dune.2024.mkv?token=a b' }, 'ios')).toBe('https://cdn.example.com/Dune.2024.mkv?token=a%20b')
    expect(streamLink({ url: 'http://192.168.1.20:8096/Videos/1/stream', headers: {} }, 'ios')).toBe('http://192.168.1.20:8096/Videos/1/stream')
  })

  it('refuses what an app could not fetch by the address alone', () => {
    expect(streamLink({ url: 'https://cdn.example.com/a.mkv', headers: { Authorization: 'Bearer x' } }, 'macos')).toBeUndefined()
    expect(streamLink({ url: 'blob:https://flow.example/1234' }, 'macos')).toBeUndefined()
    expect(streamLink({ url: 'magnet:?xt=urn:btih:abc' }, 'macos')).toBeUndefined()
    expect(streamLink({ url: 'not an address' }, 'macos')).toBeUndefined()
    expect(streamLink({ url: 'https://cdn.example.com/a.mkv' }, undefined)).toBeUndefined()
  })

  it('refuses this computer’s own address on a phone, which is another machine', () => {
    expect(streamLink({ url: 'http://localhost:8096/a.mkv' }, 'ios')).toBeUndefined()
    expect(streamLink({ url: 'http://127.0.0.1:8096/a.mkv' }, 'ios')).toBeUndefined()
    expect(streamLink({ url: 'http://localhost:8096/a.mkv' }, 'macos')).toBe('http://localhost:8096/a.mkv')
  })
})

describe('the links', () => {
  const stream = 'https://cdn.example.com/a b.mkv?x=1&y=2'
  const encoded = encodeURIComponent(stream)

  it('opens Infuse with the resume point and the file’s name', () => {
    expect(launchURL('infuse', stream, { position: 754.9, filename: 'Dune Part Two.mkv' })).toBe(`infuse://x-callback-url/play?url=${encoded}&position=754&filename=Dune%20Part%20Two.mkv`)
    expect(launchURL('infuse', stream)).toBe(`infuse://x-callback-url/play?url=${encoded}`)
    expect(launchURL('infuse', stream, { position: 0 })).toBe(`infuse://x-callback-url/play?url=${encoded}`)
  })

  it('opens the others the way the apps do, without a position they don’t take', () => {
    expect(launchURL('vlc', stream, { position: 90 })).toBe(`vlc-x-callback://x-callback-url/stream?url=${encoded}`)
    expect(launchURL('outplayer', 'https://h.example/a.mkv')).toBe('outplayer://h.example/a.mkv')
    expect(launchURL('senPlayer', stream)).toBe(`SenPlayer://x-callback-url/play?url=${encoded}`)
    expect(launchURL('vidHub', stream)).toBe(`open-vidhub://x-callback-url/open?url=${encoded}`)
    expect(launchURL('cineUltra', stream)).toBe(`cineultra://playback?url=${encoded}`)
    expect(launchURL('moonPlayer', 'https://h.example/a.mkv')).toBe('moonplayer://open?url=https://h.example/a.mkv')
    expect(launchURL('iina', stream)).toBe(`iina://weblink?url=${encoded}`)
    expect(launchURL('mpv', 'https://h.example/a.mkv')).toBe('mpv://https://h.example/a.mkv')
  })

  it('has no link for the built-in player', () => {
    expect(launchURL('none', stream)).toBeUndefined()
  })
})
