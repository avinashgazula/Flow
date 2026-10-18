import { describe, expect, it } from 'vitest'
import type { HeaderInfo, HeaderTrack } from './protocol'
import { mimeCandidates, plan, supportedMime, UnplayableError } from './tracks'

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
})
