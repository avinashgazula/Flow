import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cachedSource, MISS_BYTES, SegmentCache } from './blocks'
import { audioCodecString, headerFor, videoCodecString, videoDecision } from './codecs'
import type { MediaStream } from './engine'
import { av1Codec, boxes, esdsCodec, hevcCodec, soundTracks, splitSegments } from './mp4'
import { engineContainers, mp4SoundCodecs, silentInBrowser, sniffContainer } from './sniff'
import { convertedSoundFormat } from './support'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)))

const stream = (over: Partial<MediaStream>): MediaStream => ({
  index: 0,
  type: 'video',
  codec: 'h264',
  codecId: 27,
  profile: 77,
  profileName: 'Main',
  level: 31,
  width: 1920,
  height: 1080,
  channels: 0,
  sampleRate: 0,
  bitRate: 0,
  extradata: new Uint8Array(0),
  default: false,
  forced: false,
  commentary: false,
  hearingImpaired: false,
  attachedPicture: false,
  frameRate: 24,
  bitDepth: 8,
  pixelFormat: 'yuv420p',
  transfer: 0,
  delay: 0,
  sarNumerator: 1,
  sarDenominator: 1,
  decodable: true,
  language: '',
  title: '',
  ...over,
})

describe('codec strings', () => {
  it('reads H.264 from an avcC record, from an Annex B SPS, and from the parser’s profile and level', () => {
    expect(videoCodecString(stream({ extradata: Uint8Array.of(1, 0x64, 0x00, 0x28, 0xff) }))).toBe('avc1.640028')
    // 00 00 00 01, SPS NAL (0x67), profile 77, constraints 0x40, level 31.
    expect(videoCodecString(stream({ extradata: Uint8Array.of(0, 0, 0, 1, 0x67, 77, 0x40, 31, 0xaa, 0xbb) }))).toBe('avc1.4D401F')
    expect(videoCodecString(stream({ profile: 100, level: 40 }))).toBe('avc1.640028')
    // FFmpeg marks constrained baseline with 0x200 on the profile.
    expect(videoCodecString(stream({ profile: 66 | 0x200, level: 30 }))).toBe('avc1.42401E')
  })

  it('writes HEVC the way ISO 14496-15 does', () => {
    // Main profile, tier 0, compatibility flags 0x60000000, level 93, constraint bytes B0 00 00 00 00 00.
    const hvcc = Uint8Array.of(1, 0x01, 0x60, 0, 0, 0, 0xb0, 0, 0, 0, 0, 0, 93)
    expect(hevcCodec('hvc1', hvcc)).toBe('hvc1.1.6.L93.B0')
    expect(videoCodecString(stream({ codec: 'hevc', extradata: hvcc }))).toBe('hvc1.1.6.L93.B0')
    expect(videoCodecString(stream({ codec: 'hevc', profile: 2, level: 120 }))).toBe('hvc1.2.4.L120.B0')
  })

  it('writes AV1 and VP9', () => {
    expect(av1Codec(Uint8Array.of(0x81, 0x00, 0x4c, 0))).toBe('av01.0.00M.10')
    expect(videoCodecString(stream({ codec: 'av1', extradata: Uint8Array.of(0x81, 0x08, 0x4c, 0) }))).toBe('av01.0.08M.10')
    expect(videoCodecString(stream({ codec: 'vp9', profile: 2, level: 41, bitDepth: 10 }))).toBe('vp09.02.41.10')
  })

  it('names no string for a picture MP4 can’t carry', () => {
    for (const codec of ['mpeg2video', 'mpeg4', 'msmpeg4v3', 'vc1', 'wmv3', 'vp8', 'flv1']) expect(videoCodecString(stream({ codec }))).toBe('')
  })

  it('names the sound that plays in MP4 and none for the rest, which is converted', () => {
    const sound = (codec: string, over: Partial<MediaStream> = {}) => audioCodecString(stream({ type: 'audio', codec, ...over }))
    expect(sound('aac', { extradata: Uint8Array.of(0x12, 0x10) })).toBe('mp4a.40.2')
    expect(sound('aac', { profile: 4 })).toBe('mp4a.40.5')
    expect(sound('aac', { profile: 1 })).toBe('mp4a.40.2')
    expect(sound('mp3')).toBe('mp4a.6B')
    expect(sound('ac3')).toBe('ac-3')
    expect(sound('eac3')).toBe('ec-3')
    expect(sound('flac')).toBe('flac')
    expect(sound('opus')).toBe('opus')
    for (const codec of ['dts', 'truehd', 'vorbis', 'mp2', 'wmav2', 'pcm_s16le']) expect(sound(codec)).toBe('')
  })

  it('reads an AAC object type from an esds box', () => {
    // version/flags, ES_Descriptor (0x03), DecoderConfig (0x04, object type 0x40), DecoderSpecificInfo (0x05) AAC-LC.
    const esds = Uint8Array.of(0, 0, 0, 0, 0x03, 0x19, 0, 1, 0, 0x04, 0x11, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x05, 0x02, 0x12, 0x10)
    expect(esdsCodec(esds)).toBe('mp4a.40.2')
  })
})

describe('the picture decision', () => {
  it('copies what the browser plays and refuses the rest with a reason', () => {
    const h264 = stream({ profile: 100, level: 40 })
    expect(videoDecision(h264, () => true)).toEqual({ action: 'copy', mime: 'video/mp4; codecs="avc1.640028"' })
    expect(videoDecision(h264, () => false)).toMatchObject({ action: 'unsupported', reason: expect.stringContaining('avc1.640028') })
    expect(videoDecision(stream({ codec: 'mpeg2video' }), () => true)).toMatchObject({ action: 'unsupported' })
  })

  it('builds the header: ids are stream indexes, cover art and data are left out', () => {
    const header = headerFor(
      [stream({ index: 0 }), stream({ index: 1, type: 'audio', codec: 'dts', channels: 6, language: 'eng', title: 'Surround', default: true }), stream({ index: 2, attachedPicture: true, codec: 'mjpeg' }), stream({ index: 3, type: 'subtitle', codec: 'subrip' })],
      95_500,
    )
    expect(header.duration).toBe(95.5)
    expect(header.tracks.map((t) => [t.id, t.type])).toEqual([
      [0, 'video'],
      [1, 'audio'],
    ])
    expect(header.tracks[1]).toMatchObject({ language: 'eng', name: 'Surround', default: true, supported: false, decode: 'ffmpeg', channels: 6 })
  })

  it('reports an unknown duration as null', () => {
    expect(headerFor([], 0).duration).toBeNull()
  })
})

describe('the container sniffer', () => {
  const pad = (...bytes: number[]) => Uint8Array.of(...bytes, ...new Array(Math.max(0, 16 - bytes.length)).fill(0))
  it('recognises every container the engine opens from its first bytes', () => {
    expect(sniffContainer(fixture('av-h264-mp3.avi'))).toBe('avi')
    expect(sniffContainer(fixture('av-h264-ac3.m2t'))).toBe('ts')
    expect(sniffContainer(fixture('av-h264-aac.flv'))).toBe('flv')
    expect(sniffContainer(fixture('av-wmv-wma.wmv'))).toBe('asf')
    expect(sniffContainer(fixture('av-mpeg2-ac3.vob'))).toBe('mpegps')
    expect(sniffContainer(fixture('a-opus.ogg'))).toBe('ogg')
    expect(sniffContainer(fixture('av-h264-eac3.mp4'))).toBe('mp4')
    expect(sniffContainer(fixture('av-h264-vorbis.mkv'))).toBe('matroska')
    expect(sniffContainer(fixture('a-mp3.mp3'))).toBe('mp3')
  })

  it('names a web page, and nothing for noise', () => {
    expect(sniffContainer(new TextEncoder().encode('<!DOCTYPE html><html>'))).toBe('html')
    expect(sniffContainer(pad(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12))).toBeUndefined()
    expect(sniffContainer(pad(1, 2, 3))).toBeUndefined()
  })

  it('hands everything but Matroska, MP4 and pages to the engine', () => {
    expect(engineContainers.has('avi')).toBe(true)
    expect(engineContainers.has('ts')).toBe(true)
    expect(engineContainers.has('matroska' as never)).toBe(false)
    expect(engineContainers.has('mp4' as never)).toBe(false)
  })

  it('reads the sound of an MP4 from its moov, and says when the moov is elsewhere', () => {
    expect(mp4SoundCodecs(fixture('av-h264-eac3.mp4'))).toEqual(['ec-3'])
    expect(mp4SoundCodecs(fixture('av-h264-aac.mp4'))).toEqual(['mp4a.40.2'])
    // The first bytes of a file whose moov is at the far end hold no tracks.
    const head = fixture('av-h264-aac.mp4').subarray(0, 40)
    expect(mp4SoundCodecs(head)).toBeNull()
    expect(soundTracks(fixture('av-h264-eac3.mp4'))![0]).toMatchObject({ entry: 'ec-3', channels: 2, sampleRate: 44100 })
  })

  it('knows when an MP4’s sound would play silent here', () => {
    const chrome = (mime: string) => mime.includes('mp4a.40.2') || mime.includes('flac')
    expect(silentInBrowser(['ec-3'], chrome)).toBe(true)
    expect(silentInBrowser(['ec-3', 'mp4a.40.2'], chrome)).toBe(false)
    expect(silentInBrowser([], chrome)).toBe(false)
  })
})

describe('the segment cache', () => {
  const bytes = (start: number, length: number) => Uint8Array.from({ length }, (_, i) => (start + i) & 0xff)

  it('keeps ranges apart and reads across their joins', () => {
    const cache = new SegmentCache()
    cache.add(0, bytes(0, 100))
    cache.add(200, bytes(200, 50))
    expect(cache.contiguousEnd(0)).toBe(100)
    expect(cache.contiguousEnd(150)).toBe(150)
    cache.add(100, bytes(100, 100))
    expect(cache.contiguousEnd(0)).toBe(250)
    expect(Array.from(cache.read(95, 10))).toEqual(Array.from(bytes(95, 10)))
    expect(Array.from(cache.read(190, 30))).toEqual(Array.from(bytes(190, 30)))
  })

  it('stores overlapping data once', () => {
    const cache = new SegmentCache()
    cache.add(0, bytes(0, 100))
    cache.add(50, bytes(50, 100))
    cache.add(20, bytes(20, 10))
    expect(cache.size).toBe(150)
    expect(Array.from(cache.read(0, 150))).toEqual(Array.from(bytes(0, 150)))
  })

  it('returns what it has, and nothing where it has nothing', () => {
    const cache = new SegmentCache()
    cache.add(10, bytes(10, 10))
    expect(cache.read(0, 5)).toHaveLength(0)
    expect(cache.read(15, 50)).toHaveLength(5)
  })

  it('lets go of what is furthest from the read position when over its size', () => {
    const cache = new SegmentCache(300)
    cache.add(0, bytes(0, 100))
    cache.add(1000, bytes(0, 100))
    cache.add(2000, bytes(0, 100))
    cache.read(2000, 10)
    cache.add(3000, bytes(0, 100))
    expect(cache.size).toBeLessThanOrEqual(300)
    expect(cache.contiguousEnd(2000)).toBe(2100)
    expect(cache.contiguousEnd(0)).toBe(0)
  })
})

describe('the engine’s view of the file', () => {
  const file = Uint8Array.from({ length: 5_000_000 }, (_, i) => i & 0xff)

  it('serves from the cache without asking the network', () => {
    const cache = new SegmentCache()
    cache.add(0, file.subarray(0, 1000))
    const asked: [number, number][] = []
    const source = cachedSource(cache, file.length, (s, e) => (asked.push([s, e]), file.subarray(s, e)))
    expect(source.read(10, 20)).toEqual(file.subarray(10, 30))
    expect(asked).toEqual([])
  })

  it('fetches a miss in one go, at least a few hundred kilobytes, and keeps it', () => {
    const cache = new SegmentCache()
    const asked: [number, number][] = []
    const source = cachedSource(cache, file.length, (s, e) => (asked.push([s, e]), file.subarray(s, e)))
    expect(source.read(4_000_000, 100)).toEqual(file.subarray(4_000_000, 4_000_100))
    expect(asked).toEqual([[4_000_000, 4_000_000 + MISS_BYTES]])
    // The next small read lands in what came back.
    expect(source.read(4_000_100, 100)).toEqual(file.subarray(4_000_100, 4_000_200))
    expect(asked).toHaveLength(1)
  })

  it('stops at the end of the file', () => {
    const cache = new SegmentCache()
    const source = cachedSource(cache, file.length, (s, e) => file.subarray(s, e))
    expect(source.read(file.length - 10, 100)).toHaveLength(10)
    expect(source.read(file.length, 100)).toHaveLength(0)
  })

  it('fails with a message for a server that can’t be read in pieces', () => {
    const source = cachedSource(new SegmentCache(), file.length, null)
    expect(() => source.read(100, 10)).toThrow(/can’t seek/)
  })
})

describe('what converted sound is encoded as', () => {
  it('is FLAC where MP4 carries it, AAC where only that plays, and nothing where neither does', () => {
    expect(convertedSoundFormat(() => true)).toEqual({ out: 'flac', mime: 'audio/mp4; codecs="flac"' })
    expect(convertedSoundFormat((m) => m.includes('mp4a'))).toEqual({ out: 'aac', mime: 'audio/mp4; codecs="mp4a.40.2"' })
    expect(convertedSoundFormat(() => false)).toBeNull()
  })
})

describe('splitting muxer output', () => {
  it('finds the init segment and the fragment pairs, and drops what it doesn’t know', () => {
    const box = (type: string, size: number) => {
      const b = new Uint8Array(size)
      new DataView(b.buffer).setUint32(0, size)
      for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i)
      return b
    }
    const parts = [box('ftyp', 16), box('moov', 40), box('moof', 24), box('mdat', 30), box('styp', 12), box('moof', 24), box('mdat', 20), box('mfra', 16), box('moof', 24)]
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) (data.set(p, at), (at += p.length))
    const { init, fragments } = splitSegments(data)
    expect(init).toHaveLength(56)
    expect(fragments.map((f) => f.length)).toEqual([54, 44])
    expect(boxes(data)).toHaveLength(9)
  })
})
