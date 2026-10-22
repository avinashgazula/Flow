/* The messages between the main thread (MediaSource) and the worker (fetch + WebAssembly). Every
   message about media carries an `epoch`: it goes up on each seek and audio switch, so data from
   a stream that has been replaced is recognised and dropped. */

export interface HeaderTrack {
  id: number
  type: 'video' | 'audio' | 'subtitle' | 'other'
  codecId: string
  /** Codec string for MediaSource.isTypeSupported; empty when the remuxer can't carry it. */
  codec: string
  supported: boolean
  reason: string
  language: string
  name: string | null
  default: boolean
  forced: boolean
  commentary: boolean
  hearingImpaired: boolean
  /** Audio only: which in-browser decoder can play a track browsers can't ('' when none applies). */
  decode?: 'ac3' | 'eac3' | 'dts' | 'truehd' | ''
  width?: number
  height?: number
  frameRate?: number
  range?: string
  channels?: number
  sampleRate?: number
  subtitleKind?: 'text' | 'image'
}

export interface HeaderInfo {
  duration: number | null
  title: string | null
  tracks: HeaderTrack[]
}

export interface RawCue {
  track: number
  start: number
  end: number
  text: string
}

export type ToWorker =
  /** `viaProxy`: the address is the stream proxy's, so a failure is worded as the proxy's. */
  | { type: 'open'; url: string; headers: Record<string, string>; viaProxy: boolean }
  /** `convert`: the audio track is one the browser can't play, to be decoded here and re-encoded as Opus. */
  | { type: 'start'; epoch: number; video: number; audio: number; at: number; convert: boolean }
  /** Reads from the keyframe before `at`. */
  | { type: 'seek'; epoch: number; at: number }
  /** Rebuilds the audio from `at`; video before `floor` is already buffered and isn't sent again. */
  | { type: 'audio'; epoch: number; track: number; at: number; floor: number; convert: boolean }
  | { type: 'playhead'; time: number }
  /** Pauses (true) or resumes reading, for ManagedMediaSource's streaming hints. */
  | { type: 'hold'; hold: boolean }
  /** The browser's buffer filled up with this many seconds ahead of the playhead: read less far ahead than that. */
  | { type: 'pressure'; ahead: number }
  /** The picture at `time`, for the seek preview: the keyframe at or before it, decoded and drawn small. Answered
   *  with `id` once, as a `thumb` or `thumb-none`. Handled outside the stream's queue, one at a time. */
  | { type: 'thumb'; id: number; time: number }
  | { type: 'destroy' }

export type FromWorker =
  | { type: 'header'; json: string; length: number; ranges: boolean }
  /** A converted audio track's init is kind 1 with codec 'opus'. */
  | { type: 'init'; epoch: number; kind: 0 | 1; codec: string; data: ArrayBuffer }
  /** `key`: the fragment starts on a keyframe, so the buffer before it can be trimmed safely. */
  | { type: 'fragment'; epoch: number; kind: 0 | 1; start: number; end: number; key: boolean; data: ArrayBuffer }
  | { type: 'cues'; cues: RawCue[] }
  /** About once a second while a file is being read: how fast it is arriving (`bytesPerSecond`, over
   *  the time requests were open), the file's average rate (`bitrate`, 0 when unknown), how many requests
   *  are in flight, and how many seconds are buffered ahead of the playhead as the worker counts them. */
  | { type: 'stats'; bytesPerSecond: number; bitrate: number; inFlight: number; ahead: number }
  /** The file has been read to its end. */
  | { type: 'done'; epoch: number }
  /** The audio couldn't be converted (the decoder didn't load or crashed, the encoder failed). The
   *  video carries on, so the page drops the audio buffer and plays without sound rather than stall. */
  | { type: 'audio-failed'; epoch: number; message: string }
  /** A preview: `time` is the keyframe's media time, `bitmap` its picture (at most 320 px wide), transferred. */
  | { type: 'thumb'; id: number; time: number; bitmap: ImageBitmap }
  /** No picture for this request: a newer one replaced it (`superseded`), or it couldn't be made (`failed`). */
  | { type: 'thumb-none'; id: number; why: 'superseded' | 'failed' }
  /** This browser or this file can't give previews (no WebCodecs, a codec its decoder won't take, a server
   *  without ranges). Said once; every later request is answered `failed` at once. */
  | { type: 'thumbs-unsupported'; reason: string }
  /** `blocked`: the host answers but doesn't let web pages read its files (no CORS headers).
   *  `notMatroska`: the file is something else (MP4, say), which the browser's own player may take. */
  | { type: 'error'; message: string; blocked?: boolean; notMatroska?: boolean }
