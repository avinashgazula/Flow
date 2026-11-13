/* The universal media engine's WebAssembly module, behind a typed interface. FFmpeg's demuxers, mov muxer, audio
   decoders and FLAC and AAC encoders (pkg/flow-media.wasm, rebuilt with `npm run media-wasm`) read any container
   and write the fragmented MP4 that Media Source Extensions play. The C side is native/flow-media/flow_media.c,
   which documents the calling convention; this file is the only caller.

   A second module (pkg/flow-media-video.wasm, `{ video: true }`) is the same plus the picture decoders. Asked to
   convert the picture (`convertVideo`), it decodes it and hands the frames out as planar 8-bit 4:2:0 (`take`'s
   `onFrame`) for the page to encode with WebCodecs; the encoder's packets go back in through `videoOpen`,
   `videoPacket` and `videoEnd` and come out of `take` as the same fragmented MP4 as a copied picture.

   const engine = await loadMediaEngine()
   const file = engine.open(source)                  // a ByteSource: the whole file, readable at any offset
   file.streams, file.durationMs, file.offsetMs      // what the file holds
   file.start({ video: 0, audio: 1, mode: 'flac', atMs: 90_000 })
   while (!file.step(1 << 20).done) for (const chunk of file.take()) …   // chunk.kind 0 picture, 1 sound; whole boxes
   file.close()

   Runs in a Web Worker (the real use) and in Node (the tests pass the module's bytes). Nothing here knows about
   the network: the source is asked for bytes synchronously, which is why the worker keeps a block cache ahead of
   the read position (blocks.ts) and only falls back to a blocking request on a miss. */

/** The file's bytes, read synchronously. `read` may return fewer than `length` bytes only at the end of the file. */
export interface ByteSource {
  /** The file's length in bytes, or null when the server didn't say (the engine then can't seek from the end). */
  readonly length: number | null
  /** Up to `length` bytes at `position`; an empty array at or past the end. Throws when the bytes can't be had. */
  read(position: number, length: number): Uint8Array
}

export interface MediaStream {
  index: number
  type: 'video' | 'audio' | 'subtitle' | 'other'
  /** FFmpeg's name for the codec: "h264", "hevc", "mpeg2video", "ac3", "mp3", "vorbis"… */
  codec: string
  codecId: number
  profile: number
  profileName: string
  level: number
  width: number
  height: number
  channels: number
  sampleRate: number
  bitRate: number
  /** A copy of the codec's configuration bytes (an avcC record, an AudioSpecificConfig…), empty when the file has none. */
  extradata: Uint8Array
  default: boolean
  forced: boolean
  commentary: boolean
  hearingImpaired: boolean
  attachedPicture: boolean
  /** Frames per second, 0 when unknown. */
  frameRate: number
  /** Bits per colour channel of the picture. */
  bitDepth: number
  /** The pixel format's FFmpeg name ("yuv420p", "yuv420p10le"). */
  pixelFormat: string
  /** ITU-T H.273 transfer characteristics code (16 is PQ, 18 is HLG). */
  transfer: number
  /** Frames the picture is reordered by (B-frames), when the container or a parser said. */
  delay: number
  sarNumerator: number
  sarDenominator: number
  /** The engine has a decoder for this codec (so converting its sound is possible). */
  decodable: boolean
  language: string
  title: string
}

export interface MediaChapter {
  title: string
  /** Milliseconds on the timeline. */
  start: number
  end: number
}

export type ConvertMode = 'copy' | 'flac' | 'aac'

export interface StartOptions {
  /** Stream index of the picture to copy, or -1 for none. */
  video: number
  /** Stream index of the sound, or -1 for none. */
  audio: number
  /** What to do with the sound: pass it through, or decode and encode it as FLAC or AAC. */
  mode: ConvertMode
  /** Keep 5.1 in converted sound (otherwise stereo). */
  surround?: boolean
  /** Decode the picture instead of copying it (the video module only): frames come out of `take` and the encoder's packets go back in. */
  convertVideo?: boolean
  /** Where to begin, in timeline milliseconds: reading starts at the key frame at or before it. */
  atMs?: number
  /** Pictures before this time are already buffered and are skipped (after an audio switch). */
  floorMs?: number
}

/** A piece of output: whole boxes. The first of each kind is ftyp+moov (the init segment) followed, possibly in the same chunk, by moof+mdat pairs. */
export interface Chunk {
  kind: 0 | 1
  data: Uint8Array
}

/** A decoded picture, as the page encodes it. */
export interface PictureFrame {
  /** Planar 8-bit 4:2:0 (Y, then U, then V, no padding) of `width` x `height`, both even. A view into the module's memory: valid
   *  until the next call into the engine, so a caller that keeps it copies it. (`new VideoFrame(data, …)` copies it.) */
  data: Uint8Array
  width: number
  height: number
  /** Microseconds on the timeline, and how long the picture lasts. */
  timestamp: number
  duration: number
  /** The frame was flagged interlaced and had its combing blended out. */
  interlaced: boolean
  /** The source was full range and has been made limited range. */
  fullRange: boolean
  /** How a pixel is shaped (1:1 is square), from the stream or the first frame. */
  sarNumerator: number
  sarDenominator: number
  /** FFmpeg's AVCOL_SPC_* for the colour matrix (2 when the file doesn't say). */
  matrix: number
}

export interface EncodedPicture {
  /** The AVC decoder configuration record (avcC) of the encoder's output. */
  description: Uint8Array
  width: number
  height: number
  sarNumerator: number
  sarDenominator: number
}

export interface StepResult {
  /** The end of the file was reached and everything has been flushed. */
  done: boolean
}

export interface MediaFile {
  readonly streams: MediaStream[]
  readonly chapters: MediaChapter[]
  /** The container's duration (0 when it doesn't say). */
  readonly durationMs: number
  /** The file's clock at timeline zero: timeline time = file time - offset. */
  readonly offsetMs: number
  /** The container's overall bit rate, bits per second (0 when unknown). */
  readonly bitRate: number
  start(options: StartOptions): void
  /** Reads about `maxBytes` of the file and returns; throws on a failure that ends playback. */
  step(maxBytes: number): StepResult
  /** The output produced since the last call. Decoded frames (only when converting the picture) go to `onFrame`, one at a time and
   *  in order, as views that are valid for the length of the call; without a handler they are discarded. */
  take(onFrame?: (frame: PictureFrame) => void): Chunk[]
  /** Starts the converted picture's muxer from the encoder's configuration: once per run, before the first packet. */
  videoOpen(picture: EncodedPicture): void
  /** One encoded H.264 packet, in AVC form (length-prefixed); `fill` writes its bytes into the buffer it is given. Times are microseconds on the timeline. */
  videoPacket(size: number, fill: (into: Uint8Array) => void, timestamp: number, duration: number, key: boolean): void
  /** The encoder has been flushed: writes the picture's last fragment. */
  videoEnd(): void
  /** Trades picture for speed when conversion can't keep up: 0 none, 1 skip frames nothing refers to, 2 also skip the loop filter. */
  videoTune(level: 0 | 1 | 2, keepInterlaced?: boolean): void
  /** FFmpeg's words for one of its error codes. */
  explain(code: number): string
  /** Counters from the current run (see `RunInfo`). */
  info(): RunInfo
  close(): void
}

export interface RunInfo {
  /** The converted sound gave up (no decoder, or one that failed on every packet). */
  audioFailed: boolean
  /** FFmpeg's error code for the last failure of the sound (0 when none), for the console. */
  audioError: number
  audioErrors: number
  /** The file couldn't be moved to the time asked for, and was read from its start. */
  seekFailed: boolean
  /** The read position, in bytes. */
  bytes: number
  videoPackets: number
  audioPackets: number
  /** Breaks in the stream (a splice, a reset clock) that were closed up. */
  discontinuities: number
  /** Where the first picture of this run is on the timeline, in ms, or -1 when none has come yet. */
  startMs: number
  /** Where the converted sound begins on the timeline, in ms, or -1 before it has. */
  audioStartMs: number
  /** Channels of the converted sound (2 or 6), 0 before it has started. */
  outputChannels: number
  /** Converted picture: frames decoded and handed out in this run. */
  videoFrames: number
  /** Converted picture: the decoder gave up (no decoder for it, or every packet fails), and FFmpeg's error code. */
  videoFailed: boolean
  videoError: number
  videoErrors: number
  /** Frames that were flagged interlaced (and blended). */
  interlacedFrames: number
  /** Frames decoded and dropped for coming before the time this run began at. */
  videoDropped: number
}

export interface MediaEngine {
  open(source: ByteSource): MediaFile
  /** True for the module that has the picture decoders. */
  readonly video: boolean
}

export interface EngineOptions {
  /** Load the module with the picture decoders (a few MB more: only for a file whose picture is to be converted). */
  video?: boolean
}

/** A file that isn't a media file (or whose format the engine doesn't carry). */
export class UnrecognisedError extends Error {
  constructor(message = 'Marquee doesn’t recognise this file as video or audio.') {
    super(message)
    this.name = 'UnrecognisedError'
  }
}

interface Exports {
  memory: WebAssembly.Memory
  fm_open(): number
  fm_strerror(code: number): number
  fm_streams(): number
  fm_duration_ms(): number
  fm_offset_ms(): number
  fm_stream_info(index: number, key: number): number
  fm_stream_str(index: number, key: number): number
  fm_stream_extradata(index: number): number
  fm_container_bitrate(): number
  fm_chapters(): number
  fm_chapter(index: number, key: number): number
  fm_chapter_title(index: number): number
  fm_start(video: number, audio: number, mode: number, atMs: number, floorMs: number, flags: number): number
  fm_step(maxBytes: number): number
  fm_out_next(): number
  fm_out_ptr(): number
  fm_out_kind(): number
  fm_out_info(key: number): number
  fm_scratch(size: number): number
  fm_video_open(width: number, height: number, sarNum: number, sarDen: number, extradataLength: number): number
  fm_video_packet(length: number, ptsUs: number, durUs: number, key: number): number
  fm_video_end(): number
  fm_video_tune(bits: number): void
  fm_info(key: number): number
  fm_close(): void
}

// The keys of fm_stream_info and fm_info (flow_media.c).
const S = { type: 1, codecId: 2, profile: 3, level: 4, width: 5, height: 6, channels: 7, rate: 8, bitrate: 9, extradata: 10, default: 11, forced: 12, comment: 13, hearing: 14, fps: 15, depth: 16, transfer: 17, delay: 18, sarNum: 19, sarDen: 20, decodable: 21, attachedPic: 23 } as const
const I = { audioFailed: 1, audioErrors: 2, seekFailed: 3, bytes: 4, videoPackets: 5, audioPackets: 6, discontinuities: 7, startMs: 8, outChannels: 9, audioError: 11, audioStartMs: 12, videoFrames: 13, videoFailed: 14, videoErrors: 15, interlaced: 16, videoError: 17, videoDropped: 18 } as const
const FRAME = { pts: 1, duration: 2, width: 3, height: 4, flags: 5, sarNum: 6, sarDen: 7, matrix: 8 } as const
const TYPES = ['video', 'audio', 'subtitle', 'other'] as const
const MODES: Record<ConvertMode, number> = { copy: 0, flac: 1, aac: 2 }

/* One compiled module per source, shared by every instance. A failed load isn't kept, so the next try fetches again. */
let defaultModule: Promise<WebAssembly.Module> | undefined
let defaultVideoModule: Promise<WebAssembly.Module> | undefined
const modules = new WeakMap<object, Promise<WebAssembly.Module>>()

async function compileFromURL(url: URL): Promise<WebAssembly.Module> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Marquee’s media engine didn’t download (${response.status}). Reload the page and try again.`)
  try {
    // Compiles while it downloads, but only when the server says application/wasm.
    return await WebAssembly.compileStreaming(response.clone())
  } catch {
    return WebAssembly.compile(await response.arrayBuffer())
  }
}

function loadModule(source: BufferSource | URL | undefined, video: boolean): Promise<WebAssembly.Module> {
  if (source === undefined) {
    // The literal forms below are what lets the bundler find each file and give it a hashed name.
    if (video) {
      return (defaultVideoModule ??= compileFromURL(new URL('./pkg/flow-media-video.wasm', import.meta.url)).catch((error) => {
        defaultVideoModule = undefined
        throw error
      }))
    }
    return (defaultModule ??= compileFromURL(new URL('./pkg/flow-media.wasm', import.meta.url)).catch((error) => {
      defaultModule = undefined
      throw error
    }))
  }
  let loading = modules.get(source)
  if (!loading) {
    loading = source instanceof URL ? compileFromURL(source) : WebAssembly.compile(source)
    loading.catch(() => modules.delete(source))
    modules.set(source, loading)
  }
  return loading
}

/** Loads the engine: `source` is the module's bytes (tests) or address; by default the file next to this one (the one with the picture decoders when `video`). */
export async function loadMediaEngine(source?: BufferSource | URL, options: EngineOptions = {}): Promise<MediaEngine> {
  const video = options.video === true
  const module = await loadModule(source, video)
  return {
    video,
    open(bytes) {
      return openFile(module, bytes)
    },
  }
}

// FFmpeg's AVERROR codes for the few the page distinguishes.
const AVERROR_INVALIDDATA = -1094995529
const AVERROR_DEMUXER_NOT_FOUND = -1330794744

function openFile(module: WebAssembly.Module, source: ByteSource): MediaFile {
  let position = 0
  let failure: unknown = null
  let memory: WebAssembly.Memory | undefined
  const instance = new WebAssembly.Instance(module, {
    env: {
      // The two calls the module makes into the page. A failed read is reported to the module as an I/O error
      // and kept, so the real reason (a dropped connection, a 403) reaches the caller instead of FFmpeg's.
      fm_js_read(pointer: number, size: number): number {
        try {
          const bytes = source.read(position, size)
          if (bytes.length === 0) return 0
          new Uint8Array(memory!.buffer, pointer, bytes.length).set(bytes)
          position += bytes.length
          return bytes.length
        } catch (error) {
          failure = error
          return -1
        }
      },
      fm_js_seek(offset: number, whence: number): number {
        const length = source.length
        if (whence === 0x10000) return length ?? -1
        const next = whence === 0 ? offset : whence === 1 ? position + offset : length === null ? -1 : length + offset
        if (next < 0) return -1
        position = next
        return next
      },
    },
  })
  const x = instance.exports as unknown as Exports
  memory = x.memory

  const text = (pointer: number): string => {
    const bytes = new Uint8Array(x.memory.buffer, pointer)
    let end = 0
    while (bytes[end] !== 0) end++
    return new TextDecoder().decode(bytes.subarray(0, end))
  }
  const fail = (code: number, fallback: string): never => {
    if (failure) {
      const error = failure
      failure = null
      throw error
    }
    if (code === AVERROR_INVALIDDATA || code === AVERROR_DEMUXER_NOT_FOUND) throw new UnrecognisedError()
    throw new Error(`${fallback} (${text(x.fm_strerror(code)) || code}).`)
  }

  const opened = x.fm_open()
  if (opened < 0) {
    try {
      fail(opened, 'Marquee couldn’t read this file')
    } finally {
      x.fm_close()
    }
  }

  const streams: MediaStream[] = []
  for (let i = 0; i < x.fm_streams(); i++) {
    const n = (key: number) => x.fm_stream_info(i, key)
    const size = n(S.extradata)
    const pointer = size > 0 ? x.fm_stream_extradata(i) : 0
    streams.push({
      index: i,
      type: TYPES[n(S.type)] ?? 'other',
      codec: text(x.fm_stream_str(i, 1)),
      codecId: n(S.codecId),
      profile: n(S.profile),
      profileName: text(x.fm_stream_str(i, 5)),
      level: n(S.level),
      width: n(S.width),
      height: n(S.height),
      channels: n(S.channels),
      sampleRate: n(S.rate),
      bitRate: n(S.bitrate),
      extradata: pointer ? new Uint8Array(x.memory.buffer, pointer, size).slice() : new Uint8Array(0),
      default: n(S.default) === 1,
      forced: n(S.forced) === 1,
      commentary: n(S.comment) === 1,
      hearingImpaired: n(S.hearing) === 1,
      attachedPicture: n(S.attachedPic) === 1,
      frameRate: n(S.fps) / 1000,
      bitDepth: n(S.depth),
      pixelFormat: text(x.fm_stream_str(i, 4)),
      transfer: n(S.transfer),
      delay: n(S.delay),
      sarNumerator: n(S.sarNum),
      sarDenominator: n(S.sarDen),
      decodable: n(S.decodable) === 1,
      language: text(x.fm_stream_str(i, 2)),
      title: text(x.fm_stream_str(i, 3)),
    })
  }
  const chapters: MediaChapter[] = []
  for (let i = 0; i < x.fm_chapters(); i++) chapters.push({ title: text(x.fm_chapter_title(i)), start: x.fm_chapter(i, 1), end: x.fm_chapter(i, 2) })
  const durationMs = x.fm_duration_ms()
  const offsetMs = x.fm_offset_ms()
  const bitRate = x.fm_container_bitrate()
  let closed = false

  return {
    streams,
    chapters,
    durationMs,
    offsetMs,
    bitRate,
    start(o) {
      const code = x.fm_start(o.video, o.audio, MODES[o.mode], o.atMs ?? 0, o.floorMs ?? 0, (o.surround ? 1 : 0) | (o.convertVideo ? 2 : 0))
      if (code < 0) fail(code, 'Marquee couldn’t start reading this file')
    },
    step(maxBytes) {
      const code = x.fm_step(maxBytes)
      if (code < 0) fail(code, 'Marquee couldn’t read this file')
      return { done: code === 1 }
    },
    take(onFrame) {
      const chunks: Chunk[] = []
      for (let length = x.fm_out_next(); length > 0; length = x.fm_out_next()) {
        const kind = x.fm_out_kind()
        if (kind === 2) {
          if (!onFrame) continue
          const flags = x.fm_out_info(FRAME.flags)
          onFrame({
            data: new Uint8Array(x.memory.buffer, x.fm_out_ptr(), length),
            width: x.fm_out_info(FRAME.width),
            height: x.fm_out_info(FRAME.height),
            timestamp: x.fm_out_info(FRAME.pts),
            duration: x.fm_out_info(FRAME.duration),
            interlaced: (flags & 1) !== 0,
            fullRange: (flags & 2) !== 0,
            sarNumerator: x.fm_out_info(FRAME.sarNum),
            sarDenominator: x.fm_out_info(FRAME.sarDen),
            matrix: x.fm_out_info(FRAME.matrix),
          })
          continue
        }
        chunks.push({ kind: kind === 1 ? 1 : 0, data: new Uint8Array(x.memory.buffer, x.fm_out_ptr(), length).slice() })
      }
      return chunks
    },
    videoOpen(picture) {
      const pointer = x.fm_scratch(picture.description.length)
      if (!pointer) throw new Error('Marquee ran out of memory converting this picture. Reload the page and try again.')
      new Uint8Array(x.memory.buffer, pointer, picture.description.length).set(picture.description)
      const code = x.fm_video_open(picture.width, picture.height, picture.sarNumerator, picture.sarDenominator, picture.description.length)
      if (code < 0) fail(code, 'Marquee couldn’t start the converted picture')
    },
    videoPacket(size, fill, timestamp, duration, key) {
      const pointer = x.fm_scratch(size)
      if (!pointer) throw new Error('Marquee ran out of memory converting this picture. Reload the page and try again.')
      fill(new Uint8Array(x.memory.buffer, pointer, size))
      const code = x.fm_video_packet(size, timestamp, duration, key ? 1 : 0)
      if (code < 0) fail(code, 'Marquee couldn’t write the converted picture')
    },
    videoEnd() {
      x.fm_video_end()
    },
    videoTune(level, keepInterlaced = false) {
      x.fm_video_tune((level === 2 ? 3 : level === 1 ? 1 : 0) | (keepInterlaced ? 4 : 0))
    },
    explain: (code) => text(x.fm_strerror(code)),
    info() {
      return {
        audioFailed: x.fm_info(I.audioFailed) === 1,
        audioError: x.fm_info(I.audioError),
        audioErrors: x.fm_info(I.audioErrors),
        seekFailed: x.fm_info(I.seekFailed) === 1,
        bytes: x.fm_info(I.bytes),
        videoPackets: x.fm_info(I.videoPackets),
        audioPackets: x.fm_info(I.audioPackets),
        discontinuities: x.fm_info(I.discontinuities),
        startMs: x.fm_info(I.startMs),
        audioStartMs: x.fm_info(I.audioStartMs),
        outputChannels: x.fm_info(I.outChannels),
        videoFrames: x.fm_info(I.videoFrames),
        videoFailed: x.fm_info(I.videoFailed) === 1,
        videoError: x.fm_info(I.videoError),
        videoErrors: x.fm_info(I.videoErrors),
        interlacedFrames: x.fm_info(I.interlaced),
        videoDropped: x.fm_info(I.videoDropped),
      }
    },
    close() {
      if (closed) return
      closed = true
      x.fm_close()
    },
  }
}
