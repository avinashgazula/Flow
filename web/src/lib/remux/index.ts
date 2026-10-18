/* Matroska in the browser: a Rust/WebAssembly demuxer and fragmented-MP4 muxer in a Web Worker,
   fed by HTTP range requests and played through Media Source Extensions.
   (Placeholder: the remux work fills this in. The player codes against this interface.) */

export interface RemuxAudioTrack {
  id: number
  label: string
  language?: string
  codec: string
  channels?: number
  /** False when this browser can't decode it (DTS, TrueHD). */
  playable: boolean
  default: boolean
}

export interface RemuxSubtitleTrack {
  id: number
  label: string
  language?: string
  /** Text tracks (SRT, ASS, WebVTT) arrive as cues; image tracks (PGS, VobSub) aren't supported yet. */
  kind: 'text' | 'image'
  default: boolean
  forced: boolean
}

export interface SubtitleCue {
  start: number
  end: number
  text: string
}

export interface RemuxSession {
  duration: number
  audioTracks: RemuxAudioTrack[]
  subtitleTracks: RemuxSubtitleTrack[]
  /** Switches the audio track, keeping the picture where it is. */
  selectAudio(id: number): Promise<void>
  /** Cues for a text subtitle track, delivered as the file is read (and on seek). */
  onSubtitleCues(trackId: number, listener: (cues: SubtitleCue[]) => void): () => void
  /** Jumps to a time: the worker finds the nearest earlier keyframe through the file's index. */
  seek(seconds: number): Promise<void>
  destroy(): void
}

export interface RemuxOptions {
  headers?: Record<string, string>
  startAt?: number
  signal?: AbortSignal
}

/** True when this browser has Media Source Extensions (iPhone Safari before iOS 17.1 doesn't). */
export function remuxSupported(): boolean {
  return typeof window !== 'undefined' && ('MediaSource' in window || 'ManagedMediaSource' in window)
}

export async function attachMatroska(_video: HTMLVideoElement, _url: string, _options: RemuxOptions = {}): Promise<RemuxSession> {
  throw new Error('Matroska playback isn’t available yet.')
}
