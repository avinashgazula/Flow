import { describe, expect, it } from 'vitest'
import { bindsLinksToConnection, isSlateURL, isTooShort, isTooSmall, looksLikeSlate } from './slate'

describe('slate detection', () => {
  it('recognises slate addresses by word', () => {
    expect(isSlateURL('https://slate.elfhosted.com/wrong-ip.mp4')).toBe(true)
    expect(isSlateURL('https://cdn.example.com/slates/v1.5.0/different-connection.mkv')).toBe(true)
    expect(isSlateURL('https://cdn.example.com/Slated.2024.1080p.mkv')).toBe(false)
    expect(isSlateURL('https://rd.example.com/d/ABC123/Dune.2160p.mkv')).toBe(false)
    expect(isSlateURL('not a url')).toBe(false)
  })

  it('calls a few seconds too short for a film, but not a short film or a normal cut', () => {
    expect(isTooShort(9, 166)).toBe(true)
    expect(isTooShort(150, 166)).toBe(true)
    expect(isTooShort(600, 166)).toBe(false)
    expect(isTooShort(1200, 24)).toBe(false)
    expect(isTooShort(9, 12)).toBe(false)
    expect(isTooShort(9, undefined)).toBe(false)
    expect(isTooShort(Number.NaN, 120)).toBe(false)
  })

  it('calls a tiny file for a big listing too small', () => {
    expect(isTooSmall(600_000, 12e9)).toBe(true)
    expect(isTooSmall(9e9, 12e9)).toBe(false)
    expect(isTooSmall(600_000, undefined)).toBe(false)
    expect(isTooSmall(600_000, 50e6)).toBe(false)
  })

  it('uses whatever is known', () => {
    expect(looksLikeSlate({})).toBe(false)
    expect(looksLikeSlate({ finalURL: 'https://x.test/slate/wrong-ip.mp4' })).toBe(true)
    expect(looksLikeSlate({ duration: 12, expectedRuntimeMinutes: 100 })).toBe(true)
    expect(looksLikeSlate({ finalURL: 'https://rd.test/f.mkv', duration: 6000, bytes: 8e9, listedBytes: 8e9, expectedRuntimeMinutes: 100 })).toBe(false)
  })

  it('knows which hosts bind links to the connection', () => {
    expect(bindsLinksToConnection('https://comet.elfhosted.com/playback/abc')).toBe(true)
    expect(bindsLinksToConnection('https://notelfhosted.com/x')).toBe(false)
  })
})
