import type { MediaItem, MediaType } from '../tmdb/types'

/** What's being played: a film, or one episode of a show. */
export interface PlaybackRequest {
  item: MediaItem
  type: MediaType
  tmdbId: number
  imdbId?: string
  season?: number
  episode?: number
}

export type SourceOrigin = 'addon' | 'jellyfin' | 'emby' | 'plex' | 'demo'

/** How the player should open a source. */
export type PlaybackEngine =
  /** The browser plays the URL itself (MP4, WebM, or HLS in Safari). */
  | 'native'
  /** HLS through hls.js where the browser has no HLS of its own. */
  | 'hls'
  /** Matroska, remuxed to fragmented MP4 in a worker (src/lib/remux). */
  | 'remux'

export interface ExternalSubtitle {
  url: string
  /** ISO 639 code when known ("en", "eng"). */
  language?: string
  label: string
  format: 'vtt' | 'srt' | 'ass'
}

export interface Source {
  /** Stable for the same file, so "play the source used last time" works. */
  id: string
  origin: SourceOrigin
  /** Add-on or server name, e.g. "Torrentio", "Living Room Jellyfin". */
  provider: string
  /** One-line title shown in the picker, e.g. "Dune.Part.Two.2024.2160p.WEB-DL". */
  title: string
  url: string
  /** Request headers the stream needs (rarely; most hosts take none). */
  headers?: Record<string, string>
  engine: PlaybackEngine
  /** Parsed from the name or reported by the server. */
  resolution?: '2160p' | '1440p' | '1080p' | '720p' | '480p' | 'SD'
  hdr?: ('DV' | 'HDR10+' | 'HDR10' | 'HDR' | 'HLG')[]
  videoCodec?: 'HEVC' | 'H.264' | 'AV1' | 'VP9'
  audio?: string[]
  sizeBytes?: number
  container?: string
  /** True when this browser can't decode something in it (DTS, TrueHD), so it's ranked last. */
  unsupported?: string
  /** Higher is better; set by ranking. */
  score?: number
  subtitles?: ExternalSubtitle[]
  /** Resume position the server remembers, in seconds (Jellyfin/Plex). */
  serverPosition?: number
}
