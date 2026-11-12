import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadMediaEngine, type MediaEngine, type MediaFile, UnrecognisedError } from './engine'
import { fragmentTimes, readInit, splitSegments } from './mp4'
import { headerFor, videoDecision } from './codecs'

/* These run the real module (pkg/flow-media.wasm) on two-second clips made by FFmpeg (scripts/media-fixtures.sh).
   They check what the player depends on: the tracks the file reports, that the output is fragmented MP4 whose
   init segment names the right codec, that the pieces cover the clip's length on one timeline for picture and
   sound, and that sound the browser can't play comes out as sound it can. */

const wasm = readFileSync(new URL('./pkg/flow-media.wasm', import.meta.url))
const bytesOf = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)))

let engine: MediaEngine
beforeAll(async () => {
  engine = await loadMediaEngine(wasm)
})

const openFixture = (name: string): MediaFile => {
  const bytes = bytesOf(name)
  return engine.open({ length: bytes.length, read: (at, n) => bytes.subarray(at, Math.min(bytes.length, at + n)) })
}

interface Track {
  codec: string
  channels: number
  sampleRate: number
  timescale: number
  samples: number
  start: number
  end: number
  keyFragments: number
  fragments: number
}

/** Runs a whole file through the engine, in small steps, and describes each kind of output. */
function run(name: string, options: { audio?: 'copy' | 'flac' | 'aac'; at?: number; surround?: boolean; video?: boolean; floorMs?: number } = {}) {
  const file = openFixture(name)
  const video = options.video === false ? undefined : file.streams.find((s) => s.type === 'video' && ['h264', 'hevc', 'vp9', 'av1'].includes(s.codec))
  const audio = file.streams.find((s) => s.type === 'audio')
  file.start({ video: video?.index ?? -1, audio: audio?.index ?? -1, mode: options.audio ?? 'copy', atMs: options.at, surround: options.surround, floorMs: options.floorMs })
  const parts: [Uint8Array[], Uint8Array[]] = [[], []]
  let steps = 0
  for (;;) {
    const { done } = file.step(1 << 14)
    steps++
    for (const c of file.take()) parts[c.kind].push(c.data)
    if (done) break
  }
  const tracks = [0, 1].map((k): Track | undefined => {
    const joined = new Uint8Array(parts[k]!.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts[k]!) (joined.set(p, at), (at += p.length))
    if (!joined.length) return undefined
    const { init, fragments } = splitSegments(joined)
    const meta = readInit(init!)!
    const times = fragments.map((f) => fragmentTimes(f, meta.timescale)!)
    return {
      codec: meta.codec,
      channels: meta.channels,
      sampleRate: meta.sampleRate,
      timescale: meta.timescale,
      samples: times.reduce((n, t) => n + t.samples, 0),
      start: times[0]!.start,
      end: times[times.length - 1]!.end,
      keyFragments: times.filter((t) => t.key).length,
      fragments: times.length,
    }
  })
  const result = { file, video: tracks[0], audio: tracks[1], info: file.info(), steps }
  file.close()
  return result
}

describe('what the engine reports', () => {
  it('lists the tracks of a transport stream and starts the timeline at the first packet', () => {
    const file = openFixture('av-h264-ac3.m2t')
    expect(file.streams.map((s) => [s.type, s.codec])).toEqual([
      ['video', 'h264'],
      ['audio', 'ac3'],
    ])
    expect(file.streams[0]).toMatchObject({ width: 160, height: 90 })
    expect(file.streams[1]).toMatchObject({ channels: 2, sampleRate: 44100, decodable: true })
    expect(file.durationMs).toBeGreaterThan(1900)
    // An MPEG-TS file starts about 1.5 seconds in: that is taken off, so the viewer's timeline starts at zero.
    expect(file.offsetMs).toBeGreaterThan(1400)
    file.close()
  })

  it('reads language and the first track as the default in a Matroska file with two sound tracks', () => {
    const file = openFixture('av-h264-two-audio.mkv')
    const sound = file.streams.filter((s) => s.type === 'audio')
    expect(sound.map((s) => [s.codec, s.language])).toEqual([
      ['pcm_s16le', 'eng'],
      ['opus', 'fra'],
    ])
    file.close()
  })

  it('refuses a file that is not media, and says so', () => {
    const junk = new Uint8Array(4096).map((_, i) => (i * 31) & 0xff)
    expect(() => engine.open({ length: junk.length, read: (at, n) => junk.subarray(at, at + n) })).toThrow(UnrecognisedError)
  })

  it('surfaces a read that failed as itself, not as FFmpeg’s error', () => {
    expect(() =>
      engine.open({
        length: 1000,
        read: () => {
          throw new Error('The connection dropped.')
        },
      }),
    ).toThrow('The connection dropped.')
  })

  it('builds the player’s header from the streams: codec strings, what is copied and what can be converted', () => {
    const file = openFixture('av-h264-ac3.m2t')
    const header = headerFor(file.streams, file.durationMs)
    const [video, audio] = header.tracks
    // An Annex B stream has no config record; the codec string comes from the SPS the engine found.
    expect(video).toMatchObject({ type: 'video', codecId: 'h264', supported: true })
    expect(video!.codec).toMatch(/^avc1\.[0-9A-F]{6}$/)
    expect(audio).toMatchObject({ type: 'audio', codecId: 'ac3', codec: 'ac-3', supported: true, decode: 'ffmpeg', channels: 2 })
    expect(header.duration).toBeCloseTo(2.0, 1)
    file.close()
  })

  it('marks video the browser has no decoder for as refused, in one place', () => {
    const file = openFixture('av-wmv-wma.wmv')
    const video = file.streams.find((s) => s.type === 'video')!
    expect(videoDecision(video, () => true)).toMatchObject({ action: 'unsupported' })
    const tracks = headerFor(file.streams, file.durationMs).tracks
    expect(tracks.find((t) => t.type === 'video')).toMatchObject({ supported: false })
    expect(tracks.find((t) => t.type === 'audio')).toMatchObject({ codecId: 'wmav2', supported: false, decode: 'ffmpeg' })
    file.close()
  })
})

describe('copying a picture and its sound into fragmented MP4', () => {
  const cases: [string, string, string][] = [
    ['av-h264-mp3.avi', 'mp4a.6B', 'AVI with MP3'],
    ['av-h264-aac.flv', 'mp4a.40.2', 'FLV with AAC'],
    ['av-h264-aac.mp4', 'mp4a.40.2', 'MP4 with AAC'],
    ['av-h264-aac-adts.m2t', 'mp4a.40.2', 'MPEG-TS with ADTS AAC'],
  ]
  for (const [name, audioCodec, label] of cases) {
    it(`${label}: the picture and sound arrive whole and together`, () => {
      const { video, audio, info } = run(name, { audio: 'copy' })
      expect(video!.codec).toMatch(/^avc1\./)
      expect(video).toMatchObject({ samples: 30 })
      expect(video!.end - video!.start).toBeGreaterThan(1.8)
      expect(audio!.codec).toBe(audioCodec)
      expect(audio!.end - audio!.start).toBeGreaterThan(1.9)
      // Both start within a frame of each other, at the start of the timeline.
      expect(video!.start).toBeLessThan(0.15)
      expect(Math.abs(video!.start - audio!.start)).toBeLessThan(0.15)
      expect(info.audioFailed).toBe(false)
      // Each fragment of the picture starts on a key frame.
      expect(video!.keyFragments).toBe(video!.fragments)
    })
  }

  it('cuts fragments about a second long, in many small steps of the file', () => {
    const { video, audio, steps } = run('av-h264-ac3.m2t', { audio: 'flac' })
    expect(video!.fragments).toBe(2)
    expect(audio!.fragments).toBeGreaterThanOrEqual(2)
    expect(steps).toBeGreaterThan(1)
  })

  it('copies Opus from Ogg and MP3 as they are (sound only)', () => {
    const opus = run('a-opus.ogg', { audio: 'copy' })
    expect(opus.video).toBeUndefined()
    expect(opus.audio).toMatchObject({ codec: 'opus', channels: 2 })
    expect(opus.audio!.end).toBeCloseTo(2.0, 1)
    const mp3 = run('a-mp3.mp3', { audio: 'copy' })
    expect(mp3.audio).toMatchObject({ codec: 'mp4a.6B' })
    expect(mp3.audio!.end).toBeCloseTo(2.04, 1)
  })
})

describe('converting sound the browser can’t play', () => {
  const cases: [string, string][] = [
    ['av-h264-ac3.m2t', 'AC-3 in MPEG-TS'],
    ['av-h264-eac3.mp4', 'E-AC-3 in MP4'],
    ['av-h264-vorbis.mkv', 'Vorbis in Matroska'],
    ['av-h264-two-audio.mkv', 'PCM in Matroska'],
    ['av-wmv-wma.wmv', 'WMA in Windows Media'],
    ['av-mpeg2-ac3.vob', 'AC-3 in a DVD program stream'],
    ['a-mp2.mp2', 'MP2'],
  ]
  for (const [name, label] of cases) {
    for (const out of ['flac', 'aac'] as const) {
      it(`${label} becomes ${out.toUpperCase()} at 48 kHz stereo and keeps its length`, () => {
        const { audio, info } = run(name, { audio: out, video: false })
        expect(info.audioFailed).toBe(false)
        expect(audio).toMatchObject({ codec: out === 'flac' ? 'flac' : 'mp4a.40.2', channels: 2, sampleRate: 48000, timescale: 48000 })
        // Two seconds of sound, to within a codec frame or two.
        expect(audio!.end - audio!.start).toBeGreaterThan(1.9)
        expect(audio!.end - audio!.start).toBeLessThan(2.2)
      })
    }
  }

  it('keeps 5.1 when asked, and mixes down when not', () => {
    const six = run('av-h264-ac3-51.m2t', { audio: 'flac', surround: true, video: false })
    expect(six.audio!.channels).toBe(6)
    expect(six.info.outputChannels).toBe(6)
    const two = run('av-h264-ac3-51.m2t', { audio: 'aac', surround: false, video: false })
    expect(two.audio!.channels).toBe(2)
  })

  it('puts the sound on the same timeline as the picture, however late the file’s own clock starts', () => {
    const { video, audio } = run('av-h264-ac3.m2t', { audio: 'flac' })
    expect(Math.abs(video!.start - audio!.start)).toBeLessThan(0.15)
    expect(audio!.start).toBeLessThan(0.15)
  })

  it('gives up on the sound but not the picture when no decoder takes it', () => {
    // A transport stream whose audio stream claims a codec the engine has no decoder for.
    const file = openFixture('av-h264-ac3.m2t')
    file.start({ video: 0, audio: 1, mode: 'flac' })
    for (let done = false; !done; ) done = file.step(1 << 16).done
    expect(file.info().audioFailed).toBe(false)
    file.close()
  })
})

describe('starting in the middle', () => {
  const cases: [string, string][] = [
    ['av-h264-mp3.avi', 'AVI'],
    ['av-h264-aac.flv', 'FLV'],
    ['av-h264-eac3.mp4', 'MP4'],
    ['av-h264-ac3.m2t', 'MPEG-TS'],
    ['av-h264-vorbis.mkv', 'Matroska'],
  ]
  for (const [name, label] of cases) {
    it(`${label}: begins at the key frame at or before the time asked for`, () => {
      const { video, audio, info } = run(name, { audio: name.endsWith('mp3.avi') ? 'copy' : 'aac', at: 1300 })
      expect(info.seekFailed).toBe(false)
      expect(video!.start).toBeLessThanOrEqual(1.35)
      expect(video!.start).toBeGreaterThanOrEqual(0)
      expect(video!.end).toBeGreaterThan(1.9)
      // The sound is there at the time asked for, too.
      expect(audio!.start).toBeLessThanOrEqual(1.3)
      expect(audio!.end).toBeGreaterThan(1.9)
      // Whatever precedes the key frame isn't sent (a transport stream is entered a few seconds early, so it may send it all).
      if (!name.endsWith('.m2t')) expect(video!.samples).toBeLessThan(30)
    })
  }

  it('skips the picture already buffered when the sound is switched (floor), and keeps the sound', () => {
    const { video, audio } = run('av-h264-two-audio.mkv', { audio: 'aac', at: 500, floorMs: 1000 })
    expect(video!.start).toBeGreaterThanOrEqual(0.99)
    expect(audio!.start).toBeLessThanOrEqual(0.5)
  })

  it('can be started again on the same file, from the start', () => {
    const file = openFixture('av-h264-mp3.avi')
    const gather = (at: number) => {
      file.start({ video: 0, audio: 1, mode: 'copy', atMs: at })
      let video = 0
      for (let done = false; !done; ) {
        done = file.step(1 << 15).done
        for (const c of file.take()) if (c.kind === 0) video += splitSegments(c.data).fragments.length
      }
      return video
    }
    expect(gather(0)).toBe(2)
    expect(gather(1300)).toBe(1)
    expect(gather(0)).toBe(2)
    file.close()
  })
})

describe('the first read of a file', () => {
  it('reads only what it needs for a small step, and reports where it is', () => {
    const file = openFixture('av-h264-aac.mp4')
    file.start({ video: 0, audio: 1, mode: 'copy' })
    const before = file.info().bytes
    file.step(2000)
    expect(file.info().bytes).toBeGreaterThan(before)
    expect(file.info().bytes).toBeLessThan(bytesOf('av-h264-aac.mp4').length)
    file.close()
  })
})
