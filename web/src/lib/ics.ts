/* An iCalendar file (RFC 5545), the web's Add to Calendar: the apps hand an event to Apple Calendar, and a page can
   only offer a file that any calendar opens. Pure, so the dates and the escaping are tested. */

export interface IcsEvent {
  /** Stable for the same episode or film, so adding it twice updates the event instead of repeating it. */
  uid: string
  title: string
  /** An all-day event, as the calendar day "2026-10-27". TMDB gives only the day an episode or a film comes out. */
  day?: string
  /** Or a real moment, in milliseconds since the epoch. `end` is an hour later when it is left out. */
  start?: number
  end?: number
  description?: string
  url?: string
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** "20261027T193000Z": a moment in UTC, as a calendar reads it wherever the viewer is. */
export function utcStamp(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** "2026-10-27" as "20261027". Anything else is not a day. */
export function dateValue(day: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return m ? `${m[1]}${m[2]}${m[3]}` : undefined
}

/** The day after, by calendar arithmetic in UTC, so a daylight-saving change can't skip or repeat a day. An all-day
 *  event ends on the day after its last day. */
export function nextDay(day: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return undefined
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1))
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

/** A text value: backslash, semicolon, comma and line breaks are escaped. */
export const escapeText = (text: string) => text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')

/** Lines are folded at 75 octets, the rest on the next line after a space. A character is never split. */
export function fold(line: string): string {
  const encoder = new TextEncoder()
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const size = encoder.encode(ch).length
    // The continuation lines start with a space, which counts toward their 75.
    const limit = out.length === 0 ? 75 : 74
    if (bytes + size > limit) {
      out.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += size
  }
  out.push(current)
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join('\r\n')
}

/** One calendar with these events, as the text of a `.ics` file. Events without a usable date are left out.
 *  `now` stamps when the file was made. */
export function buildICS(events: readonly IcsEvent[], now: number): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Flow//Upcoming//EN', 'CALSCALE:GREGORIAN']
  for (const e of events) {
    const body: string[] = []
    if (e.day) {
      const start = dateValue(e.day)
      const end = nextDay(e.day)
      if (!start || !end) continue
      body.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, 'TRANSP:TRANSPARENT')
    } else if (e.start !== undefined && Number.isFinite(e.start)) {
      const end = e.end !== undefined && e.end > e.start ? e.end : e.start + 3_600_000
      body.push(`DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(end)}`)
    } else continue
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${utcStamp(now)}`, ...body, `SUMMARY:${escapeText(e.title)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    if (e.url) lines.push(`URL:${e.url}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** A file name from a title: letters, digits and spaces, no path or reserved characters, never empty. */
export function icsFileName(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `${base || 'Flow'}.ics`
}

/** Hands the text to the browser as a download. */
export function downloadICS(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  // The browser starts the download synchronously; the address can go a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
