import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { VIDEO_DECODERS } from './codecs'
import { type EncodedChunkLike, type EncoderApi, type EncoderConfig, PictureConverter } from './transcode'
import { loadMediaEngine, type MediaEngine, type MediaFile, type PictureFrame } from './engine'
import { boxes, find, fragmentTimes, readInit, splitSegments } from './mp4'

/* These run the real video module (pkg/flow-media-video.wasm) on tiny clips FFmpeg made (scripts/media-fixtures-video.sh):
   the pictures no browser plays, decoded to the frames the page would encode. Node has no VideoEncoder, so the way back (the
   encoder's packets into the muxer) is run with a stub that answers with H.264 packets made ahead of time. */

const bytesOf = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)))
let video: MediaEngine
let small: MediaEngine
beforeAll(async () => {
  video = await loadMediaEngine(readFileSync(new URL('./pkg/flow-media-video.wasm', import.meta.url)), { video: true })
  small = await loadMediaEngine(readFileSync(new URL('./pkg/flow-media.wasm', import.meta.url)))
})

const open = (engine: MediaEngine, name: string): MediaFile => {
  const bytes = bytesOf(name)
  return engine.open({ length: bytes.length, read: (at, n) => bytes.subarray(at, Math.min(bytes.length, at + n)) })
}

interface Decoded extends Omit<PictureFrame, 'data'> {
  data: Uint8Array
}

/** Every frame of a file's picture, copied out of the module. */
function decode(name: string, options: { at?: number; keepInterlaced?: boolean; tune?: 0 | 1 | 2; floorMs?: number } = {}) {
  const file = open(video, name)
  const picture = file.streams.find((s) => s.type === 'video')!
  if (options.keepInterlaced || options.tune) file.videoTune(options.tune ?? 0, options.keepInterlaced)
  file.start({ video: picture.index, audio: -1, mode: 'copy', convertVideo: true, atMs: options.at, floorMs: options.floorMs })
  const frames: Decoded[] = []
  for (;;) {
    const { done } = file.step(1 << 14)
    file.take((f) => frames.push({ ...f, data: f.data.slice() }))
    if (done) break
  }
  const info = file.info()
  file.close()
  return { frames, info, picture }
}

/** How much a picture's rows disagree with the rows between them: combing from two fields taken at different moments shows up here. */
function combing(f: Decoded): number {
  let sum = 0
  for (let y = 1; y < f.height - 1; y++) {
    for (let x = 0; x < f.width; x++) {
      const above = f.data[(y - 1) * f.width + x]!, here = f.data[y * f.width + x]!, below = f.data[(y + 1) * f.width + x]!
      sum += Math.abs(above + below - 2 * here)
    }
  }
  return sum
}

describe('the pictures the video module decodes', () => {
  const cases: [string, string, number, number, number][] = [
    ['v-xvid-mp3.avi', 'mpeg4', 30, 160, 90],
    ['av-wmv-wma.wmv', 'msmpeg4v3', 30, 160, 90],
    ['v-wmv2-wma.wmv', 'wmv2', 30, 160, 90],
    ['av-mpeg2-ac3.vob', 'mpeg2video', 30, 160, 90],
    ['v-vp8-vorbis.mkv', 'vp8', 30, 160, 90],
    ['v-theora.ogv', 'theora', 30, 160, 90],
    ['v-flv1-mp3.flv', 'flv1', 30, 160, 90],
    ['v-mjpeg.avi', 'mjpeg', 30, 160, 90],
    ['v-h264-hi10p.mkv', 'h264', 30, 160, 90],
    ['v-h264-422.mkv', 'h264', 30, 160, 90],
    ['v-hevc.mkv', 'hevc', 30, 160, 90],
  ]
  for (const [name, codec, count, width, height] of cases) {
    it(`${name} (${codec}) comes out as ${count} frames of ${width}x${height} in order on one timeline`, () => {
      const { frames, info, picture } = decode(name)
      expect(picture.codec).toBe(codec)
      expect(picture.decodable).toBe(true)
      expect(VIDEO_DECODERS.has(codec)).toBe(true)
      expect(info.videoFailed).toBe(false)
      expect(frames.length).toBeGreaterThanOrEqual(count - 2)
      expect(frames.length).toBeLessThanOrEqual(count + 2)
      for (const f of frames) {
        expect([f.width, f.height]).toEqual([width, height])
        expect(f.data.length).toBe((width * height * 3) / 2)
      }
      for (let i = 1; i < frames.length; i++) expect(frames[i]!.timestamp).toBeGreaterThan(frames[i - 1]!.timestamp)
      expect(frames[0]!.timestamp).toBeLessThan(500_000)
      expect(frames[frames.length - 1]!.timestamp).toBeGreaterThan(1_700_000)
      // Spaced like the clip's 15 frames a second, and each lasting about that long.
      expect(frames[1]!.timestamp - frames[0]!.timestamp).toBeGreaterThan(55_000)
      expect(frames[1]!.timestamp - frames[0]!.timestamp).toBeLessThan(80_000)
      // A picture, not a blank: the test pattern has dark and light areas.
      const luma = frames[Math.floor(frames.length / 2)]!.data.subarray(0, width * height)
      expect(Math.max(...luma) - Math.min(...luma)).toBeGreaterThan(100)
    })
  }

  it('names every decoder the page lists, and only those, in the module', () => {
    // A stream per codec the fixtures cover; the list says the rest (VC-1, VP6, RealVideo, DV...) are built, which the build script's own list repeats.
    for (const [name] of cases) {
      const f = open(video, name)
      for (const s of f.streams.filter((x) => x.type === 'video')) expect(s.decodable).toBe(VIDEO_DECODERS.has(s.codec))
      f.close()
      const g = open(small, name)
      for (const s of g.streams.filter((x) => x.type === 'video')) expect(s.decodable).toBe(false)
      g.close()
    }
  })

  it('refuses to convert a picture in the sound-only module, which says so', () => {
    const file = open(small, 'v-xvid-mp3.avi')
    expect(() => file.start({ video: 0, audio: -1, mode: 'copy', convertVideo: true })).toThrow()
    file.close()
  })
})

describe('what the frames are made of', () => {
  it('steps 10-bit down to 8 and keeps a gradient smooth and in order', () => {
    const { frames } = decode('v-gradient-10bit.mkv')
    const f = frames[0]!
    const column = (x: number) => [0, 1, 2, 3].reduce((n, y) => n + f.data[(40 + y) * f.width + x]!, 0) / 4
    expect(column(2)).toBeLessThan(12)
    expect(column(157)).toBeGreaterThan(240)
    let backwards = 0
    for (let x = 4; x < 156; x += 4) if (column(x + 4) < column(x) - 2) backwards++
    expect(backwards).toBe(0)
  })

  it('averages the chroma of 4:2:2 down to 4:2:0 without moving the colours', () => {
    const a = decode('v-h264-422.mkv').frames[10]!
    const b = decode('v-h264-hi10p.mkv').frames[10]!
    const chroma = (f: Decoded) => f.data.subarray(f.width * f.height)
    const mean = (p: Uint8Array) => p.reduce((n, v) => n + v, 0) / p.length
    expect(Math.abs(mean(chroma(a)) - mean(chroma(b)))).toBeLessThan(6)
  })

  it('makes full-range Motion JPEG limited range', () => {
    const { frames } = decode('v-mjpeg.avi')
    expect(frames[0]!.fullRange).toBe(true)
    const luma = frames[5]!.data.subarray(0, 160 * 90)
    expect(Math.min(...luma)).toBeGreaterThanOrEqual(16)
    expect(Math.max(...luma)).toBeLessThanOrEqual(235)
    expect(decode('v-xvid-mp3.avi').frames[0]!.fullRange).toBe(false)
  })

  it('flags interlaced frames and blends their combing, unless asked to leave it', () => {
    const blended = decode('v-mpeg2-interlaced.vob')
    expect(blended.info.interlacedFrames).toBeGreaterThan(5)
    expect(blended.frames.some((f) => f.interlaced)).toBe(true)
    const raw = decode('v-mpeg2-interlaced.vob', { keepInterlaced: true })
    expect(raw.frames.length).toBe(blended.frames.length)
    const energy = (list: Decoded[]) => list.slice(5, 25).reduce((n, f) => n + combing(f), 0)
    expect(energy(blended.frames)).toBeLessThan(energy(raw.frames) * 0.9)
    // A progressive clip is left alone.
    expect(decode('av-mpeg2-ac3.vob').info.interlacedFrames).toBe(0)
  })

  it('carries a stream’s pixel aspect ratio, so 16:9 in a 4:3 frame isn’t squashed', () => {
    const { frames } = decode('v-mpeg2-anamorphic.vob')
    expect([frames[0]!.width, frames[0]!.height]).toEqual([180, 120])
    expect([frames[0]!.sarNumerator, frames[0]!.sarDenominator]).toEqual([32, 27])
    expect([decode('v-xvid-mp3.avi').frames[0]!.sarNumerator, decode('v-xvid-mp3.avi').frames[0]!.sarDenominator]).toEqual([1, 1])
  })

  it('starts a run at a time: frames before it are decoded and dropped, not sent', () => {
    const { frames, info } = decode('v-xvid-mp3.avi', { at: 1500 })
    expect(info.videoDropped).toBeGreaterThan(0)
    expect(frames[0]!.timestamp).toBeGreaterThan(1_400_000)
    expect(frames[0]!.timestamp).toBeLessThan(1_600_000)
    expect(frames.length).toBeLessThan(15)
  })

  it('skips frames nothing refers to when told the device is struggling', () => {
    const all = decode('v-xvid-mp3.avi').frames.length
    const fewer = decode('v-xvid-mp3.avi', { tune: 1 }).frames.length
    expect(fewer).toBeLessThan(all)
    expect(fewer).toBeGreaterThan(all / 4)
  })
})

// MARK: The way back

/** The H.264 packets of an MP4 (what an encoder would have made), with their sync flags and the avcC. */
function mp4Packets(data: Uint8Array) {
  const u32 = (at: number) => ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0
  const stbl = find(data, 'moov/trak/mdia/minf/stbl')!
  const table = (type: string) => boxes(data, stbl.body, stbl.end).find((b) => b.type === type)!
  const stsz = table('stsz'), stco = table('stco'), stsc = table('stsc'), stss = table('stss')
  const count = u32(stsz.body + 8)
  const sizes = Array.from({ length: count }, (_, i) => u32(stsz.body + 12 + i * 4))
  const chunks = Array.from({ length: u32(stco.body + 4) }, (_, i) => u32(stco.body + 8 + i * 4))
  const runs = Array.from({ length: u32(stsc.body + 4) }, (_, i) => ({ first: u32(stsc.body + 8 + i * 12), per: u32(stsc.body + 12 + i * 12) }))
  const keys = new Set(Array.from({ length: u32(stss.body + 4) }, (_, i) => u32(stss.body + 8 + i * 4) - 1))
  const packets: { bytes: Uint8Array; key: boolean }[] = []
  let sample = 0
  chunks.forEach((offset, i) => {
    const per = [...runs].reverse().find((r) => r.first <= i + 1)!.per
    let at = offset
    for (let k = 0; k < per && sample < count; k++, sample++) {
      packets.push({ bytes: data.slice(at, at + sizes[sample]!), key: keys.has(sample) })
      at += sizes[sample]!
    }
  })
  const avcc = find(data, 'moov/trak/mdia/minf/stbl/stsd')!
  const avcC = (() => {
    for (let i = avcc.body; i + 8 < avcc.end; i++) if (data[i + 4] === 0x61 && data[i + 5] === 0x76 && data[i + 6] === 0x63 && data[i + 7] === 0x43) return data.slice(i + 8, i + u32(i))
    throw new Error('no avcC')
  })()
  return { packets, avcC }
}

/** An encoder that never encodes: each frame it is given is answered with the next packet made ahead of time. */
function stubApi(packets: { bytes: Uint8Array; key: boolean }[], avcC: Uint8Array) {
  const log = { configs: [] as EncoderConfig[], keyRequests: 0, frames: 0, closed: 0 }
  const api: EncoderApi = {
    isConfigSupported: async () => ({ supported: true }),
    frame: () => ({ close: () => void log.frames++ }),
    create: ({ output }) => {
      let n = 0
      return {
        encodeQueueSize: 0,
        configure: (c) => log.configs.push(c),
        encode: (_frame, options) => {
          if (options?.keyFrame) log.keyRequests++
          const packet = packets[n % packets.length]!
          const frameTime = pending.shift()!
          const chunk: EncodedChunkLike = { type: packet.key ? 'key' : 'delta', timestamp: frameTime, byteLength: packet.bytes.length, copyTo: (into) => into.set(packet.bytes) }
          output(chunk, n === 0 ? { decoderConfig: { description: avcC } } : undefined)
          n++
        },
        flush: async () => {},
        close: () => void log.closed++,
      }
    },
  }
  // The stub reads the times from the frames the converter hands to `frame`.
  const pending: number[] = []
  const frame = api.frame
  api.frame = (data, init) => {
    pending.push(init.timestamp)
    return frame(data, init)
  }
  return { api, log }
}

describe('putting the encoder’s packets back into the muxer', () => {
  const encoded = mp4Packets(bytesOf('enc-h264-160x90.mp4'))

  function convertThrough(name: string) {
    const file = open(video, name)
    const picture = file.streams.find((s) => s.type === 'video')!
    file.start({ video: picture.index, audio: -1, mode: 'copy', convertVideo: true })
    const { api, log } = stubApi(encoded.packets, encoded.avcC)
    const config: EncoderConfig = { codec: 'avc1.64001E', width: 160, height: 90, bitrate: 1e6, framerate: 15, latencyMode: 'realtime', avc: { format: 'avc' } }
    const converter = new PictureConverter(api, config, file)
    const parts: Uint8Array[] = []
    for (;;) {
      const { done } = file.step(1 << 14)
      for (const c of file.take((f) => converter.submit(f))) parts.push(c.data)
      if (done) break
    }
    file.videoEnd()
    for (const c of file.take()) parts.push(c.data)
    const total = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) (total.set(p, at), (at += p.length))
    file.close()
    return { ...splitSegments(total), log, converter, bytes: total }
  }

  it('makes the same fragmented MP4 a copied picture would be', () => {
    const { init, fragments, log, converter } = convertThrough('v-xvid-mp3.avi')
    expect(converter.failure).toBeNull()
    const track = readInit(init!)!
    expect(track.entry).toBe('avc1')
    expect(track.codec).toMatch(/^avc1\.6400/)
    expect([track.width, track.height]).toEqual([160, 90])
    const times = fragments.map((f) => fragmentTimes(f, track.timescale)!)
    expect(times[0]!.key).toBe(true)
    expect(times.length).toBeGreaterThanOrEqual(2)
    expect(times.every((t) => t.key)).toBe(true)
    expect(times.reduce((n, t) => n + t.samples, 0)).toBe(converter.packets)
    expect(times[0]!.start).toBeLessThan(0.5)
    expect(times[times.length - 1]!.end).toBeGreaterThan(1.9)
    for (let i = 1; i < times.length; i++) expect(Math.abs(times[i]!.start - times[i - 1]!.end)).toBeLessThan(0.01)
    // The encoder was configured at the size of the frames, asked for a key frame at the start and about each second, and every frame was closed.
    expect(log.configs[0]).toMatchObject({ width: 160, height: 90 })
    expect(log.keyRequests).toBeGreaterThanOrEqual(2)
    expect(log.frames).toBe(converter.frames)
  })

  it('writes the pixel aspect ratio into the init segment, for a picture that is shown wider than it is coded', () => {
    const { init } = convertThrough('v-mpeg2-anamorphic.vob')
    const at = [...init!].findIndex((_, i) => init![i] === 0x70 && init![i + 1] === 0x61 && init![i + 2] === 0x73 && init![i + 3] === 0x70)
    expect(at).toBeGreaterThan(0)
    const u32 = (i: number) => ((init![i]! << 24) | (init![i + 1]! << 16) | (init![i + 2]! << 8) | init![i + 3]!) >>> 0
    expect([u32(at + 4), u32(at + 8)]).toEqual([32, 27])
  })
})
