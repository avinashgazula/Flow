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
  | { type: 'open'; url: string; headers: Record<string, string> }
  | { type: 'start'; epoch: number; video: number; audio: number; at: number }
  /** Reads from the keyframe before `at`. */
  | { type: 'seek'; epoch: number; at: number }
  /** Rebuilds the audio from `at`; video before `floor` is already buffered and isn't sent again. */
  | { type: 'audio'; epoch: number; track: number; at: number; floor: number }
  | { type: 'playhead'; time: number }
  /** Pauses (true) or resumes reading, for ManagedMediaSource's streaming hints. */
  | { type: 'hold'; hold: boolean }
  /** The browser's buffer filled up with this many seconds ahead of the playhead: read less far ahead than that. */
  | { type: 'pressure'; ahead: number }
  | { type: 'destroy' }

export type FromWorker =
  | { type: 'header'; json: string; length: number; ranges: boolean }
  | { type: 'init'; epoch: number; kind: 0 | 1; codec: string; data: ArrayBuffer }
  /** `key`: the fragment starts on a keyframe, so the buffer before it can be trimmed safely. */
  | { type: 'fragment'; epoch: number; kind: 0 | 1; start: number; end: number; key: boolean; data: ArrayBuffer }
  | { type: 'cues'; cues: RawCue[] }
  /** The file has been read to its end. */
  | { type: 'done'; epoch: number }
  /** `blocked`: the host answers but doesn't let web pages read its files (no CORS headers). */
  | { type: 'error'; message: string; blocked?: boolean }
