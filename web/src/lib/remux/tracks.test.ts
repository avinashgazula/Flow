import { describe, expect, it } from 'vitest'
import type { HeaderInfo, HeaderTrack } from './protocol'
import { CONVERTED_MIME, mimeCandidates, plan, supportedMime, UnplayableError } from './tracks'

function track(partial: Partial<HeaderTrack> & Pick<HeaderTrack, 'id' | 'type'>): HeaderTrack {
  return { codecId: '', codec: '', supported: true, reason: '', language: 'eng', name: null, default: false, forced: false, commentary: false, hearingImpaired: false, ...partial }
}

const video = track({ id: 1, type: 'video', codecId: 'V_MPEG4/ISO/AVC', codec: 'avc1.640028', width: 1920, height: 1080 })
const aac = track({ id: 3, type: 'audio', codecId: 'A_AAC', codec: 'mp4a.40.2', channels: 2 })
const ac3 = track({ id: 4, type: 'audio', codecId: 'A_AC3', codec: 'ac-3', channels: 6, language: 'spa' })
const dts = track({ id: 2, type: 'audio', codecId: 'A_DTS', codec: '', supported: false, reason: 'DTS audio', default: true, name: 'DTS 5.1', channels: 6 })

const everything = (mime: string) => mime.includes('avc1') || mime.includes('mp4a.40.2') || mime.includes('ac-3')
const header = (...tracks: HeaderTrack[]): HeaderInfo => ({ duration: 60, title: null, tracks })

describe('mime types', () => {
  it('spells MP3-in-MP4 the ways browsers know it', () => {
    expect(mimeCandidates('audio', 'mp4a.6B')).toEqual(['audio/mp4; codecs="mp4a.6B"', 'audio/mp4; codecs="mp4a.69"', 'audio/mp4; codecs="mp3"'])
    expect(supportedMime('audio', 'mp4a.6B', (m) => m.includes('"mp3"'))).toBe('audio/mp4; codecs="mp3"')
    expect(supportedMime('video', '', () => true)).toBeNull()
  })
})

describe('plan', () => {
  it('starts with the first playable audio when the default one is DTS', () => {
    const p = plan(header(video, dts, aac, ac3), everything)
    expect(p.video?.mime).toBe('video/mp4; codecs="avc1.640028"')
    expect(p.defaultAudio).toBe(3)
    expect(p.audio.map((a) => [a.id, a.playable])).toEqual([[2, false], [3, true], [4, true]])
  })

  it('prefers the audio track with the default flag among the playable ones', () => {
    const p = plan(header(video, aac, { ...ac3, default: true }), everything)
    expect(p.defaultAudio).toBe(4)
  })

  it('skips commentary unless nothing else plays', () => {
    const commentary = track({ id: 5, type: 'audio', codecId: 'A_AAC', codec: 'mp4a.40.2', commentary: true, default: true })
    expect(plan(header(video, commentary, aac), everything).defaultAudio).toBe(3)
    expect(plan(header(video, commentary), everything).defaultAudio).toBe(5)
  })

  it('labels tracks with language, codec and layout', () => {
    const p = plan(header(video, aac, ac3, dts), everything)
    expect(p.audio.map((a) => a.label)).toEqual(['English · AAC Stereo', 'Spanish · Dolby Digital 5.1', 'English · DTS 5.1'])
  })

  it('refuses a file whose picture this browser can’t decode', () => {
    const hevc = track({ id: 1, type: 'video', codecId: 'V_MPEGH/ISO/HEVC', codec: 'hvc1.2.4.L153.B0' })
    expect(() => plan(header(hevc, aac), everything)).toThrow(UnplayableError)
    expect(() => plan(header(hevc, aac), everything)).toThrow(/HEVC/)
  })

  it('refuses a file whose only sound is DTS', () => {
    const error = (() => {
      try {
        plan(header(video, dts), everything)
      } catch (e) {
        return e as UnplayableError
      }
    })()
    expect(error?.code).toBe('audio')
    expect(error?.message).toMatch(/DTS/)
  })

  it('plays a file with no audio tracks, and lists subtitles by kind', () => {
    const srt = track({ id: 7, type: 'subtitle', codecId: 'S_TEXT/UTF8', subtitleKind: 'text', language: 'eng', forced: true })
    const pgs = track({ id: 8, type: 'subtitle', codecId: 'S_HDMV/PGS', subtitleKind: 'image', language: 'fra', supported: false })
    const p = plan(header(video, srt, pgs), everything)
    expect(p.defaultAudio).toBeNull()
    expect(p.subtitles).toEqual([
      { id: 7, label: 'English (Forced)', language: 'eng', kind: 'text', default: false, forced: true },
      { id: 8, label: 'French', language: 'fra', kind: 'image', default: false, forced: false },
    ])
  })

  it('says which subtitle formats can’t be shown at all', () => {
    const dvb = track({ id: 9, type: 'subtitle', codecId: 'S_DVBSUB', subtitleKind: 'unsupported', supported: false, reason: 'DVB subtitles' })
    expect(plan(header(video, dvb), everything).subtitles[0]?.kind).toBe('unsupported')
    // A header from before the field existed shows nothing it can't be sure of.
    const old = track({ id: 10, type: 'subtitle', codecId: 'S_TEXT/UTF8' })
    expect(plan(header(video, old), everything).subtitles[0]?.kind).toBe('unsupported')
  })
})

describe('plan with audio conversion', () => {
  // A browser like Chromium on Linux: AAC plays, Dolby Digital doesn't.
  const noDolby = (mime: string) => mime.includes('avc1') || mime.includes('mp4a.40.2')
  const truehd = track({ id: 2, type: 'audio', codecId: 'A_TRUEHD', codec: '', supported: false, reason: 'TrueHD audio', default: true, channels: 8, decode: 'truehd' })
  const dolby = track({ id: 4, type: 'audio', codecId: 'A_AC3', codec: 'ac-3', channels: 6, decode: 'ac3' })
  const dtsDecodable = { ...dts, decode: 'dts' as const }

  it('converts what the browser can’t play when conversion is available', () => {
    const p = plan(header(video, truehd), noDolby, true)
    expect(p.defaultAudio).toBe(2)
    expect(p.audio).toEqual([expect.objectContaining({ id: 2, playable: true, converted: true, mime: CONVERTED_MIME })])
  })

  it('still refuses a file with only sound nobody can decode, or when conversion is off', () => {
    expect(() => plan(header(video, truehd), noDolby, false)).toThrow(UnplayableError)
    expect(() => plan(header(video, truehd), noDolby)).toThrow(/TrueHD/)
    const unknown = track({ id: 2, type: 'audio', codecId: 'A_WMA', supported: false, default: true })
    expect(() => plan(header(video, unknown), noDolby, true)).toThrow(UnplayableError)
  })

  it('treats Dolby Digital as convertible only where the browser lacks a decoder', () => {
    const chromium = plan(header(video, dolby), noDolby, true)
    expect(chromium.audio[0]).toMatchObject({ playable: true, converted: true })
    const safari = plan(header(video, dolby), everything, true)
    expect(safari.audio[0]).toMatchObject({ playable: true, converted: false })
    expect(safari.audio[0]!.mime).toBe('audio/mp4; codecs="ac-3"')
  })

  it('starts with a track that plays as it is, even when a converted one is the default', () => {
    const p = plan(header(video, truehd, aac), noDolby, true)
    expect(p.defaultAudio).toBe(3)
    expect(p.audio.map((a) => [a.id, a.converted])).toEqual([[2, true], [3, false]])
  })

  it('picks the best converted track by the usual rules when none plays as it is', () => {
    const commentary = { ...dtsDecodable, id: 6, commentary: true, default: true, language: 'eng' }
    const p = plan(header(video, commentary, dolby, dtsDecodable), noDolby, true)
    // Not commentary; the default flag wins among the rest.
    expect(p.defaultAudio).toBe(2)
    expect(plan(header(video, commentary), noDolby, true).defaultAudio).toBe(6)
  })

  it('never converts a track the remuxer can’t hand to the decoder', () => {
    const p = plan(header(video, dts, aac), noDolby, true)
    expect(p.audio.map((a) => [a.id, a.playable, a.converted])).toEqual([[2, false, false], [3, true, false]])
    expect(p.defaultAudio).toBe(3)
  })
})
