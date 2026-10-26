import type { SubtitleFormat } from '../../features/player/subtitles'

/** A subtitle file's bytes as text, the way FlowKit's SubtitleParser.decode does: a byte-order mark names
 *  UTF-8 or UTF-16, else UTF-8 if it is valid, else Windows-1252 (what old SRT files from western Europe are). */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3))
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** ASS and SSA scripts have sections no SRT or WebVTT file does; the other two read alike (FlowKit's ASSParser.isASS). */
export function subtitleFormat(text: string): SubtitleFormat {
  return /\[Script Info\]|\[V4\+? Styles\]|\[Events\]/.test(text) ? 'ass' : /^\s*WEBVTT/.test(text) ? 'vtt' : 'srt'
}
