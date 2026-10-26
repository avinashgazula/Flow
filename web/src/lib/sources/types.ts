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

export type SourceOrigin = 'addon' | 'jellyfin' | 'emby' | 'plex' | 'demo' | 'iptv'

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

/** Preview pictures the server already made (Jellyfin's trickplay): small frames of the film, `interval` ms
 *  apart, in grids of `columns` x `rows` per image, so a seek preview needs no decoding. */
export interface Trickplay {
  /** Where tile image n is, with `{n}` in place of its number. */
  url: string
  /** One picture's size in pixels. */
  width: number
  height: number
  columns: number
  rows: number
  /** How many pictures there are in all. */
  count: number
  interval: number
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
  /** HLS only: the manifest and every segment it names are fetched through the stream proxy (Live TV, for
   *  providers that send no CORS headers or are on http). */
  viaProxy?: boolean
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
  /** True when the audio is one this browser can't decode and Flow converts it while playing. */
  convertsAudio?: boolean
  /** A short remark for the picker: "TrueHD audio converted for this browser". */
  note?: string
  /** True when this device is known to decode this kind of video too slowly (set by ranking, with a note). */
  mayStutter?: boolean
  /** Higher is better; set by ranking. */
  score?: number
  subtitles?: ExternalSubtitle[]
  /** Resume position the server remembers, in seconds (Jellyfin/Plex). */
  serverPosition?: number
  /** The add-on or server's id (manifest URL or server id), for "play the same source as last time". */
  providerId?: string
  /** Release type parsed from the name: "WEB-DL", "BluRay", "REMUX"… */
  quality?: ReleaseQuality
  /** The file's own name when known; often the best clue to its container. */
  filename?: string
  /** Release group, e.g. "FLUX". */
  releaseGroup?: string
  /** Audio languages named in the release ("English", "Multi"). */
  languages?: string[]
  /** "5.1", "7.1"… */
  audioChannels?: string
  seeders?: number
  /** Debrid cache state when the add-on says (true: instant, false: has to download first). */
  cached?: boolean
  /** Add-ons group a show's releases so the next episode can come from the same one. */
  bingeGroup?: string
  /** The add-on's own multi-line text, kept for the picker's secondary line. */
  detail?: string
  /** Seek preview pictures made by the server, when it has them. */
  trickplay?: Trickplay
  /** The chapters the server lists (Jellyfin), in seconds; they win over what a file holds. */
  chapters?: { title: string; start: number }[]
  /** Stremio's hint that the stream isn't ready for a web player as it is (often an odd container). */
  notWebReady?: boolean
}

export type ReleaseQuality = 'CAM' | 'TS' | 'TC' | 'SCR' | 'HDTV' | 'WEBRip' | 'WEB-DL' | 'BluRay' | 'REMUX'

/** What a Stremio add-on's manifest says about itself; kept with its settings so the list can show it
 *  and so add-ons that don't serve a type or id prefix aren't asked. */
export interface AddonManifest {
  id: string
  name: string
  version?: string
  description?: string
  logo?: string
  types?: string[]
  idPrefixes?: string[]
  resources: (string | { name: string; types?: string[]; idPrefixes?: string[] })[]
}
