/* External subtitles (SRT, WebVTT, ASS) read into plain timed cues, and cue text split into the
   few styles worth keeping. The player draws subtitles itself, so this is all it needs: no
   positioning, no colours, just words at the right time. */

export interface TimedCue {
  start: number
  end: number
  text: string
}

export type SubtitleFormat = 'srt' | 'vtt' | 'ass'

/** "00:01:02,345", "01:02.345" or ASS's "0:01:02.34", in seconds. NaN when it isn't a time. */
export function parseTimestamp(value: string): number {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(value)
  if (!m) return Number.NaN
  const [, h = '0', min, sec, frac = '0'] = m
  return Number(h) * 3600 + Number(min) * 60 + Number(sec) + Number(frac.padEnd(3, '0')) / 1000
}

export function parseSubtitles(text: string, format: SubtitleFormat): TimedCue[] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const cues = format === 'ass' ? parseASS(clean) : parseBlocks(clean)
  return cues.filter((c) => c.end > c.start && c.text.trim()).sort((a, b) => a.start - b.start)
}

/** SRT and WebVTT share a shape: blocks separated by blank lines, each with one "a --> b" line. */
function parseBlocks(text: string): TimedCue[] {
  const cues: TimedCue[] = []
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n')
    const at = lines.findIndex((l) => l.includes('-->'))
    if (at < 0) continue
    const [from, rest = ''] = lines[at]!.split('-->')
    // WebVTT puts cue settings ("line:85% align:center") after the end time.
    const start = parseTimestamp(from!)
    const end = parseTimestamp(rest.trim().split(/\s+/)[0] ?? '')
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    cues.push({ start, end, text: lines.slice(at + 1).join('\n').trim() })
  }
  return cues
}

function parseASS(text: string): TimedCue[] {
  const cues: TimedCue[] = []
  let fields: string[] = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
  let inEvents = false
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) {
      inEvents = trimmed.toLowerCase() === '[events]'
      continue
    }
    if (!inEvents) continue
    if (/^format:/i.test(trimmed)) {
      fields = trimmed.slice(7).split(',').map((f) => f.trim().toLowerCase())
      continue
    }
    if (!/^dialogue:/i.test(trimmed)) continue
    // The text is the last field and may itself contain commas.
    const parts = trimmed.slice(9).split(',')
    const head = parts.slice(0, fields.length - 1)
    const body = parts.slice(fields.length - 1).join(',')
    const value = (name: string) => head[fields.indexOf(name)]?.trim() ?? ''
    const start = parseTimestamp(value('start'))
    const end = parseTimestamp(value('end'))
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    cues.push({ start, end, text: assText(body) })
  }
  return cues
}

/** ASS markup to the cue markup the overlay reads: italics and bold survive, positioning and
 *  karaoke don't, and drawings (\p1) are dropped whole. */
function assText(body: string): string {
  if (/\{[^}]*\\p[1-9]/.test(body)) return ''
  return body
    .replace(/\{([^}]*)\}/g, (_, tags: string) => {
      let out = ''
      for (const [, tag, on] of tags.matchAll(/\\([ib])(\d)/g)) out += on === '0' ? `</${tag}>` : `<${tag}>`
      return out
    })
    .replace(/\\N|\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .trim()
}

export interface Segment {
  text: string
  italic?: boolean
  bold?: boolean
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '‎', rlm: '‏' }

/** Cue text as lines of styled runs. Keeps <i>, <b> and <u> (shown as bold, as the TV app does);
 *  drops voice, class, colour and timestamp tags; decodes entities. Rendered as text, never HTML. */
export function cueSegments(text: string): Segment[][] {
  const lines: Segment[][] = [[]]
  let italic = 0
  let bold = 0
  const push = (raw: string) => {
    if (!raw) return
    const parts = raw.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return entities[e.toLowerCase()] ?? m
    }).split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1]!.push({ text: part, ...(italic > 0 && { italic: true }), ...(bold > 0 && { bold: true }) })
    })
  }
  let last = 0
  for (const m of text.matchAll(/<\/?([a-z0-9.:]+)[^>]*>/gi)) {
    push(text.slice(last, m.index))
    last = m.index + m[0].length
    const tag = m[1]!.toLowerCase().split('.')[0]
    const closing = m[0][1] === '/'
    if (tag === 'i') italic = Math.max(0, italic + (closing ? -1 : 1))
    else if (tag === 'b' || tag === 'u') bold = Math.max(0, bold + (closing ? -1 : 1))
  }
  push(text.slice(last))
  return lines.filter((l) => l.length > 0)
}
