/* Telling what a file is from its first bytes, for links that don't say (a debrid or add-on play link ends in an
   opaque id). The Matroska remuxer already looks at the start of such a link; when it isn't Matroska, this names
   what it is, so the player can send it to the browser's own player (an MP4 whose sound plays) or to the universal
   engine (AVI, MPEG-TS and the rest, or an MP4 whose sound the browser can't decode). Pure functions over bytes. */

import { boxes, find, soundTracks } from './mp4'

export type Container = 'matroska' | 'mp4' | 'avi' | 'ts' | 'mpegps' | 'asf' | 'flv' | 'ogg' | 'rm' | 'wav' | 'mp3' | 'flac' | 'html'

const ascii = (b: Uint8Array, at: number, text: string): boolean => {
  if (b.length < at + text.length) return false
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false
  return true
}

/** MPEG transport stream packets are 188 bytes (192 with a time code in front, as Blu-ray's M2TS has): a sync byte at the start of each. */
function isTransportStream(b: Uint8Array): boolean {
  for (const [size, lead] of [
    [188, 0],
    [192, 4],
  ] as const) {
    if (b.length >= lead + size * 3 + 1 && [0, 1, 2, 3].every((n) => b[lead + size * n] === 0x47)) return true
  }
  return false
}

/** The kind of file whose first bytes these are, or undefined when they say nothing the engine knows. */
export function sniffContainer(b: Uint8Array): Container | undefined {
  if (b.length < 12) return undefined
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'matroska'
  if (['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip', 'pnot'].some((t) => ascii(b, 4, t))) return 'mp4'
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'AVI ')) return 'avi'
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return 'wav'
  if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75 && b[4] === 0x8e && b[5] === 0x66 && b[6] === 0xcf && b[7] === 0x11) return 'asf'
  if (ascii(b, 0, 'FLV') && b[3] === 1) return 'flv'
  if (ascii(b, 0, 'OggS')) return 'ogg'
  if (ascii(b, 0, '.RMF')) return 'rm'
  if (ascii(b, 0, 'fLaC')) return 'flac'
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && (b[3] === 0xba || b[3] === 0xb3)) return 'mpegps'
  if (isTransportStream(b)) return 'ts'
  if (ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return 'mp3'
  // A page the server sent instead of the file.
  const text = String.fromCharCode(...b.subarray(0, 15)).toLowerCase()
  if (text.startsWith('<!doctype') || text.startsWith('<html')) return 'html'
  return undefined
}

/** Kinds the universal engine opens: everything but Matroska (the fast remuxer's), MP4 (the browser's, unless its sound needs converting) and a web page. */
export const engineContainers: ReadonlySet<Container> = new Set(['avi', 'ts', 'mpegps', 'asf', 'flv', 'ogg', 'rm', 'wav', 'mp3', 'flac'])

/** The codec strings of an MP4's sound tracks, when its moov is in `data` (the start of the file for "fast start" files, the end otherwise); null when it isn't. */
export function mp4SoundCodecs(data: Uint8Array): string[] | null {
  const tracks = soundTracks(data)
  return tracks ? tracks.map((t) => t.codec || t.entry) : null
}

/** Whether the top-level boxes of `data` include a moov: it has the file's tracks in it. */
export const hasMoov = (data: Uint8Array): boolean => boxes(data).some((b) => b.type === 'moov') || !!find(data, 'moov')

/** True when none of these sound codecs plays in this browser: the picture would play, and the sound would be silent. The list is empty for a file with no sound. */
export function silentInBrowser(codecs: string[], isSupported: (mime: string) => boolean): boolean {
  return codecs.length > 0 && codecs.every((codec) => !isSupported(`audio/mp4; codecs="${codec}"`) && !(codec === 'mp4a.6B' && isSupported('audio/mpeg')))
}
