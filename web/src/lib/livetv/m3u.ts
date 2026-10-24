import type { Channel } from './types'

/* An M3U/M3U8 playlist into channels, after FlowKit's M3UParser: tvg-id, tvg-name, tvg-chno, tvg-logo,
   group-title (or an #EXTGRP line), a per-channel #EXTVLCOPT user agent, and catch-up flags. Entries that
   look like films and series (VOD) are kept apart from the live channels. */

export interface M3UPlaylist {
  channels: Channel[]
  /** Entries that look like movies and series rather than live channels. */
  vod: Channel[]
  epgURL?: string
}

const nonEmpty = (value: string | undefined) => (value ? value : undefined)

export function parseM3U(text: string, providerID: string, options: { defaultUserAgent?: string; baseURL?: string } = {}): M3UPlaylist {
  const channels: Channel[] = []
  const vod: Channel[] = []
  let epgURL: string | undefined
  let pending: { attrs: Record<string, string>; name: string } | undefined
  let userAgent: string | undefined
  let groupOverride: string | undefined

  for (const raw of text.split(/\r\n|\n|\r|\u2028|\u2029|\u0085/)) {
    // A byte-order mark in front of "#EXTM3U" would make the first line look like a stream address; trim() drops it.
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXTM3U')) {
      const attrs = attributes(line)
      epgURL = nonEmpty((attrs['x-tvg-url'] ?? attrs['url-tvg'])?.split(',')[0]?.trim())
    } else if (line.startsWith('#EXTINF')) {
      const attrs = attributes(line)
      const title = splitInfo(line).title.trim()
      pending = { attrs, name: title || nonEmpty(attrs['tvg-name']) || 'Channel' }
    } else if (line.startsWith('#EXTVLCOPT:http-user-agent=')) {
      userAgent = line.slice('#EXTVLCOPT:http-user-agent='.length)
    } else if (line.startsWith('#EXTGRP:')) {
      groupOverride = line.slice('#EXTGRP:'.length)
    } else if (!line.startsWith('#')) {
      const url = resolveURL(line, options.baseURL)
      if (!url) continue
      const attrs = pending?.attrs ?? {}
      const name = pending?.name ?? (new URL(url).pathname.split('/').filter(Boolean).pop() || 'Channel')
      const group = nonEmpty(attrs['group-title']) ?? groupOverride ?? 'Uncategorised'
      const tvgID = nonEmpty(attrs['tvg-id'])
      const number = Number.parseInt(attrs['tvg-chno'] ?? '', 10)
      const channel: Channel = {
        id: `${providerID}:${tvgID ?? name}:${channels.length + vod.length}`,
        providerID,
        name,
        number: Number.isFinite(number) ? number : undefined,
        group,
        logoURL: nonEmpty(attrs['tvg-logo']),
        streamURL: url,
        epgID: tvgID,
        userAgent: userAgent ?? options.defaultUserAgent,
        hasCatchup: attrs['catchup'] !== undefined || attrs['tvg-rec'] !== undefined,
      }
      if (isVOD(url, group)) vod.push(channel)
      else channels.push(channel)
      pending = undefined
      userAgent = undefined
      groupOverride = undefined
    }
  }
  return { channels, vod, epgURL }
}

/** The address a line names; a relative one is read against the playlist's own address. */
function resolveURL(line: string, base: string | undefined): string | undefined {
  try {
    return new URL(line, base).toString()
  } catch {
    return undefined
  }
}

export function isVOD(url: string, group: string): boolean {
  let path: string
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    return false
  }
  if (path.includes('/movie/') || path.includes('/series/')) return true
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : ''
  if (['mkv', 'mp4', 'avi', 'm4v'].includes(ext)) return true
  // Group names alone are unreliable ("Movies" is often a live channel group); only an explicit VOD tag counts.
  return group.toLowerCase().includes('vod')
}

/** Splits `#EXTINF:-1 tvg-name="A, B",A, B` at the first comma outside a quoted attribute value:
 *  names can hold commas, and so can values like group-title="News, Sport". */
export function splitInfo(line: string): { header: string; title: string } {
  let quote: string | undefined
  let previous: string | undefined
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quote) {
      if (c === quote) quote = undefined
    } else if ((c === '"' || c === "'") && previous === '=') {
      quote = c
    } else if (c === ',') {
      return { header: line.slice(0, i), title: line.slice(i + 1) }
    }
    previous = c
  }
  return { header: line, title: '' }
}

/** Parses key="value" pairs; tolerates single quotes and unquoted values. Keys are lowercased. */
export function attributes(line: string): Record<string, string> {
  const result: Record<string, string> = {}
  const { header } = splitInfo(line)
  for (const m of header.matchAll(/([a-zA-Z0-9\-_]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g)) {
    result[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return result
}
