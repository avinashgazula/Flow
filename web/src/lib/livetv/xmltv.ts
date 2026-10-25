import { emptyEPG, type EPG, type Programme } from './types'

/* XMLTV, read as it arrives. A full guide can be hundreds of megabytes once unpacked, so nothing here
   builds a DOM or holds the document: `XMLTVReader` takes text in pieces, picks each <channel> and
   <programme> out as it completes, and keeps only the programmes inside the window Flow shows, for the channels it has. The
   rest of the file is read and forgotten. */

/** "20240501193000 +0100" to milliseconds since the epoch. Seconds may be left off, the offset may
 *  follow without a space, and no offset means UTC. Undefined when the text isn't a date. */
export function parseXMLTVDate(raw: string): number | undefined {
  const trimmed = raw.trim()
  const digits = /^\d*/.exec(trimmed)![0]
  if (digits.length < 12) return undefined
  const num = (a: number, b: number) => (b <= digits.length ? Number(digits.slice(a, b)) : undefined)
  const [year, month, day, hour, minute] = [num(0, 4), num(4, 6), num(6, 8), num(8, 10), num(10, 12)]
  const second = num(12, 14) ?? 0
  if ([year, month, day, hour, minute].some((x) => x === undefined)) return undefined
  let offsetSeconds = 0
  const zone = trimmed.slice(digits.length).trim()
  const sign = zone[0]
  if (sign === '+' || sign === '-') {
    const d = zone.slice(1).replace(/\D/g, '')
    if (d.length >= 2) {
      const h = Number(d.slice(0, 2))
      const m = d.length >= 4 ? Number(d.slice(2, 4)) : 0
      offsetSeconds = (h * 3600 + m * 60) * (sign === '-' ? -1 : 1)
    }
  }
  const utc = Date.UTC(year!, month! - 1, day!, hour!, minute!, second)
  return Number.isNaN(utc) ? undefined : utc - offsetSeconds * 1000
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Text out of an element's inner XML: CDATA kept as it is, entities and character references decoded. */
export function xmlText(inner: string): string {
  let out = ''
  let rest = inner
  while (rest) {
    const open = rest.indexOf('<![CDATA[')
    const chunk = open < 0 ? rest : rest.slice(0, open)
    out += decodeEntities(chunk)
    if (open < 0) break
    const close = rest.indexOf(']]>', open)
    if (close < 0) {
      out += rest.slice(open + 9)
      break
    }
    out += rest.slice(open + 9, close)
    rest = rest.slice(close + 3)
  }
  return out.trim()
}

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    return entities[name.toLowerCase()] ?? whole
  })
}

function attribute(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag)
  const value = m ? (m[1] ?? m[2]) : undefined
  return value === undefined ? undefined : decodeEntities(value)
}

/** The text of the first <name> element in `body`, or undefined. */
function firstElement(body: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(body)
  if (!m) return undefined
  const text = xmlText(m[1]!)
  return text || undefined
}

/** Longest a single element may grow while waiting for its closing tag. Past this the data isn't XMLTV, and
 *  holding on to it would only use memory. */
const longestElement = 1_000_000

export interface GuideFilter {
  from?: number
  to?: number
  /** Lowercase guide channel ids to keep. */
  channels?: ReadonlySet<string>
}

export class XMLTVReader {
  private buffer = ''
  private programmes: Record<string, Programme[]> = {}
  private displayNames: Record<string, string> = {}

  /** What to keep, when not everything: programmes that end at or after `from` and start at or before `to`,
   *  and of the channels in `channels` (lowercase ids). A playlist rarely uses more than a slice of a big
   *  guide, and the rest would only fill memory. */
  constructor(private readonly keep?: GuideFilter) {}

  /** Feed the next piece of the document, cut anywhere. */
  push(text: string) {
    this.buffer += text
    let at = 0
    for (;;) {
      const open = this.buffer.indexOf('<', at)
      if (open < 0) {
        at = this.buffer.length
        break
      }
      const name = /^<(programme|channel)[\s>/]/.exec(this.buffer.slice(open, open + 12))?.[1]
      if (!name) {
        // Another tag, a comment or the declaration. A tag that is cut short waits for the rest.
        if (this.buffer.length - open < 12 && !this.buffer.includes('>', open)) {
          at = open
          break
        }
        at = open + 1
        continue
      }
      const tagEnd = this.buffer.indexOf('>', open)
      if (tagEnd < 0) {
        at = open
        break
      }
      const tag = this.buffer.slice(open, tagEnd + 1)
      if (tag.endsWith('/>')) {
        this.element(name, tag, '')
        at = tagEnd + 1
        continue
      }
      const closeTag = `</${name}>`
      const close = this.buffer.indexOf(closeTag, tagEnd)
      if (close < 0) {
        at = open
        break
      }
      this.element(name, tag, this.buffer.slice(tagEnd + 1, close))
      at = close + closeTag.length
    }
    this.buffer = this.buffer.slice(at)
    if (this.buffer.length > longestElement) this.buffer = ''
  }

  private element(name: string, tag: string, body: string) {
    if (name === 'channel') {
      const id = attribute(tag, 'id')
      const display = firstElement(body, 'display-name')
      if (id && display && this.displayNames[id] === undefined) this.displayNames[id] = display
      return
    }
    const channel = attribute(tag, 'channel')
    const start = parseXMLTVDate(attribute(tag, 'start') ?? '')
    const end = parseXMLTVDate(attribute(tag, 'stop') ?? '')
    if (!channel || start === undefined || end === undefined) return
    const keep = this.keep
    if (keep && !(end >= (keep.from ?? -Infinity) && start <= (keep.to ?? Infinity))) return
    if (keep?.channels && !keep.channels.has(channel.toLowerCase())) return
    const icon = /<icon\s[^>]*src\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(body)
    const programme: Programme = {
      channelID: channel,
      title: firstElement(body, 'title') ?? 'Untitled',
      subtitle: firstElement(body, 'sub-title'),
      description: firstElement(body, 'desc'),
      start,
      end,
      category: firstElement(body, 'category'),
      iconURL: icon ? decodeEntities(icon[1] ?? icon[2] ?? '') || undefined : undefined,
    }
    ;(this.programmes[channel] ??= []).push(programme)
  }

  /** Everything read so far, each channel's programmes sorted by start. */
  finish(): EPG {
    this.push('')
    const epg = emptyEPG()
    for (const [id, list] of Object.entries(this.programmes)) epg.programmes[id] = list.sort((a, b) => a.start - b.start)
    epg.displayNames = this.displayNames
    return epg
  }
}

/** XMLTV text in one go (a small guide, or a test). */
export function parseXMLTV(text: string, keep?: GuideFilter): EPG {
  const reader = new XMLTVReader(keep)
  reader.push(text)
  return reader.finish()
}

// MARK: Streams

const gzipMagic = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b

/** The text encoding an XML document declares, when the browser can read it. */
function declaredEncoding(head: Uint8Array): string {
  const m = /^<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(new TextDecoder('latin1').decode(head.subarray(0, 200)))
  if (!m) return 'utf-8'
  try {
    new TextDecoder(m[1]!)
    return m[1]!
  } catch {
    return 'utf-8'
  }
}

async function* chunksOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}

/** A response body as text pieces. A gzip file (a ".xml.gz" guide, which the browser hands over still
 *  packed) is unpacked on the way through, and the document's declared encoding is honoured. */
export async function* textPieces(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const source = chunksOf(body)
  const first = await source.next()
  if (first.done) return
  async function* all(): AsyncGenerator<Uint8Array> {
    yield first.value as Uint8Array
    for await (const chunk of source) yield chunk
  }
  let bytes: AsyncIterable<Uint8Array> = all()
  if (gzipMagic(first.value)) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t unpack a gzip guide. Use a guide address that isn’t compressed, or update the browser.')
    const unpack = new DecompressionStream('gzip')
    const writer = unpack.writable.getWriter()
    void (async () => {
      try {
        for await (const chunk of all()) await writer.write(chunk as Uint8Array<ArrayBuffer>)
        await writer.close()
      } catch (error) {
        await writer.abort(error).catch(() => {})
      }
    })()
    bytes = chunksOf(unpack.readable)
  }
  let decoder: TextDecoder | undefined
  for await (const chunk of bytes) {
    decoder ??= new TextDecoder(declaredEncoding(chunk))
    const text = decoder.decode(chunk, { stream: true })
    if (text) yield text
  }
  const rest = decoder?.decode()
  if (rest) yield rest
}

/** Reads a whole XMLTV response body into a guide without holding the document. */
export async function readXMLTV(body: ReadableStream<Uint8Array>, keep?: GuideFilter, signal?: AbortSignal): Promise<EPG> {
  const reader = new XMLTVReader(keep)
  for await (const piece of textPieces(body)) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    reader.push(piece)
  }
  return reader.finish()
}
