import { describe, expect, it } from 'vitest'
import { badges, episodeRef, formatBytes, isCinemaCapture, isUnsafeFileName, normalizeTitle, parseStream, titleAndYear } from './parser'

// Mirrors Packages/FlowKit/Tests/FlowKitTests/ParserTests.swift (StreamParserTests) and SourceSafetyTests.
describe('parseStream', () => {
  it('reads AIOStreams-style text', () => {
    const text = [
      'AIOStreams',
      '🧿 1080p 🎫',
      'TS',
      '🔊 AAC',
      '📦 2.07 GB',
      '🌎 English • Hindi • Tamil',
      'Resident.Evil.2026.1080p.HDTS.x264.AAC.2.0-GROUP.mkv',
    ].join('\n')
    const t = parseStream(text)
    expect(t.resolution).toBe(1080)
    expect(t.quality).toBe('TS')
    expect(t.videoCodec).toBe('H264')
    expect(t.audioCodec).toBe('AAC')
    expect(t.audioChannels).toBe('2.0')
    expect(t.languages).toEqual(['English', 'Hindi', 'Tamil'])
    expect(t.sizeBytes).toBe(Math.trunc(2.07 * 1_073_741_824))
    expect(badges(t)).toEqual(['1080p', 'H264', 'AAC', '2.0'])
    expect(isCinemaCapture(t.quality)).toBe(true)
    expect(t.releaseGroup).toBe('group')
  })

  it('reads a 4K remux with HDR', () => {
    const t = parseStream('Movie.2023.2160p.UHD.BluRay.REMUX.DV.HDR10+.HEVC.TrueHD.Atmos.7.1-FGT [RD+] 💾 58.3 GB')
    expect(t.resolution).toBe(2160)
    expect(t.quality).toBe('REMUX')
    expect(t.videoCodec).toBe('HEVC')
    expect(t.hdr).toEqual(['DV', 'HDR10+'])
    expect(t.audioCodec).toBe('TrueHD Atmos')
    expect(t.audioChannels).toBe('7.1')
    expect(t.isCached).toBe(true)
    expect(t.sizeBytes).toBeDefined()
  })

  it('reads uncached WEB-DL', () => {
    const t = parseStream('[RD download] Show.S01E02.720p.WEB-DL.DDP5.1.H.264')
    expect(t.resolution).toBe(720)
    expect(t.quality).toBe('WEB-DL')
    expect(t.audioCodec).toBe('DD+')
    expect(t.isCached).toBe(false)
  })

  it('doesn’t take HDR for a resolution', () => {
    expect(parseStream('HDR movie').resolution).toBe(0)
    expect(parseStream('Film HD-TS').quality).toBe('TS')
  })

  it('names HDR10 when the release does, and keeps every audio format it lists', () => {
    const t = parseStream('Dune.2160p.WEB-DL.DV.HDR10.DDP5.1.Atmos.HEVC.mkv')
    expect(t.hdr).toEqual(['DV', 'HDR10'])
    expect(t.audioCodec).toBe('Atmos')
    expect(t.audioCodecs).toContain('DD+')
    expect(parseStream('🔊 DTS • AAC • AC-3').audioCodecs).toEqual(['DTS', 'DD', 'AAC'])
  })

  it('reads seeders, 10-bit and the largest size', () => {
    const t = parseStream('Movie 1080p 10bit 👤 154 💾 1.4 GB / 7.9 GB')
    expect(t.seeders).toBe(154)
    expect(t.bitDepth).toBe(10)
    expect(t.sizeBytes).toBe(Math.trunc(7.9 * 1_073_741_824))
  })
})

describe('episodes and titles', () => {
  it('finds episode refs', () => {
    expect(episodeRef('Show.Name.S02E10.1080p.mkv')).toEqual({ season: 2, episode: 10 })
    expect(episodeRef('Show Name 3x07.mp4')).toEqual({ season: 3, episode: 7 })
    expect(episodeRef('Season 1 Episode 4.mkv')).toEqual({ season: 1, episode: 4 })
    expect(episodeRef('Movie.2020.1080p.mkv')).toBeUndefined()
  })

  it('splits title and year', () => {
    expect(titleAndYear('The.Matrix.1999.1080p.BluRay.x264.mkv')).toEqual({ title: 'the matrix', year: 1999 })
    expect(titleAndYear('Amélie (2001).mkv')).toEqual({ title: 'amelie', year: 2001 })
    expect(titleAndYear('Blade Runner 2049 (2017).mp4')).toEqual({ title: 'blade runner 2049', year: 2017 })
  })

  it('normalises titles', () => {
    expect(normalizeTitle('Spider-Man: Brand New Day')).toBe('spider man brand new day')
    expect(normalizeTitle('Fast & Furious')).toBe('fast and furious')
  })

  it('formats sizes as FlowKit does', () => {
    expect(formatBytes(18.2 * 1_073_741_824)).toBe('18.20 GB')
    expect(formatBytes(512 * 1_048_576)).toBe('512.0 MB')
  })
})

describe('isUnsafeFileName', () => {
  it('flags executables, archives and shortcuts', () => {
    expect(isUnsafeFileName('Primetime 2026.1080p.HQ Pre.Multi.AAC 2.0.x264.exe')).toBe(true)
    expect(isUnsafeFileName('Movie.2026.2160p.mkv.scr')).toBe(true)
    expect(isUnsafeFileName('Movie.2026.1080p.WEB-DL.rar')).toBe(true)
    expect(isUnsafeFileName('Lanterns.2026.S01E08.1080p.x265-ELiTE.mkv')).toBe(false)
    expect(isUnsafeFileName('The Shawshank Redemption')).toBe(false)
    expect(isUnsafeFileName('Mr. Robot')).toBe(false)
  })
})

// What Trellis (a Jellyfin-compatible server in front of AIOStreams) calls its sources: the only
// thing Flow has, as its MediaStreams are empty.
const trellis = [
  '✨ 4K 🎫  BLURAY REMUX 🔆 DV • HDR10 • IMAX  🔊 Atmos • TrueHD •',
  '✨ 4K 🎫  BLURAY REMUX 🔆 DV • HDR10 • IMAX  🔊 DTS-HD MA • DD+',
  '✨ 4K 🎫  BLURAY REMUX 🔆 DV • HDR10 • IMAX  🔊 DTS-HD MA • DTS',
  '✨ 4K 🎫  BLURAY 🔆 HDR10  🔊 DTS-HD MA • DTS 📦 98.8 GB',
  '✨ 4K 🎫  BLURAY 🔆 HDR10  🔊 DTS-HD MA 📦 53.4 GB  🌎 English📝 En',
]

describe('audio formats in Trellis names', () => {
  it('reads each name’s audio, with Atmos folded into TrueHD', () => {
    expect(parseStream(trellis[0]).audioCodecs).toEqual(['TrueHD'])
    expect(parseStream(trellis[0]).audioCodec).toBe('TrueHD Atmos')
    expect(parseStream(trellis[1]).audioCodecs).toEqual(['DTS-HD MA', 'DD+'])
    expect(parseStream(trellis[2]).audioCodecs).toEqual(['DTS-HD MA'])
    expect(parseStream(trellis[3]).audioCodecs).toEqual(['DTS-HD MA'])
    expect(parseStream(trellis[4]).audioCodecs).toEqual(['DTS-HD MA'])
    expect(parseStream(trellis[3]).sizeBytes).toBeGreaterThan(98 * 1_073_741_824)
  })

  it('reads the file names behind them', () => {
    const remux = parseStream('Oppenheimer.2023.2160p.IMAX.HYBRID.UHD.REMUX.DV.HDR10+.TrueHD.7.1.Atmos-SChIZ0iD.mkv')
    expect(remux.audioCodec).toBe('TrueHD Atmos')
    expect(remux.audioChannels).toBe('7.1')
    // No audio format named: unknown, which is not the same as none.
    const dual = parseStream('Oppenheimer (2023) IMAX 2160p 4K Hybrid UHD HDR10 DV Blu-ray REMUX Dual Audio [Hindi + English] ESub ~ RemuxDoc.mkv')
    expect(dual.audioCodecs).toEqual([])
    expect(dual.audioCodec).toBeUndefined()
  })

  it('tells Dolby Digital from Dolby Digital Plus', () => {
    expect(parseStream('1080p WEB-DL DD+ 5.1').audioCodecs).toEqual(['DD+'])
    expect(parseStream('1080p WEB-DL DDP5.1 Atmos').audioCodecs).toEqual(['DD+'])
    expect(parseStream('1080p WEB-DL E-AC-3').audioCodecs).toEqual(['DD+'])
    expect(parseStream('1080p WEB-DL EAC3 5.1').audioCodecs).toEqual(['DD+'])
    expect(parseStream('1080p WEB-DL Dolby Digital Plus').audioCodecs).toEqual(['DD+'])
    expect(parseStream('1080p BluRay DD5.1').audioCodecs).toEqual(['DD'])
    expect(parseStream('1080p BluRay AC3 5.1').audioCodecs).toEqual(['DD'])
    expect(parseStream('1080p BluRay Dolby Digital 5.1').audioCodecs).toEqual(['DD'])
    expect(parseStream('1080p BluRay DTS • AC-3').audioCodecs).toEqual(['DTS', 'DD'])
  })
})
