/* Subtitle downloads come zipped (SubDL, most of the time) or gzipped. A browser has the inflate half of
   both built in (DecompressionStream), so all that is left to write is the zip directory: find the end
   record, walk the central directory, and read one entry's bytes from where the directory says. That is
   about eighty lines, against a library for a format used here to take a single small file out.

   Not handled, on purpose: ZIP64 (a subtitle is never 4 GB), encryption, and methods other than stored
   and deflate. They are reported as an unreadable archive. */

import { SubtitleError } from './types'

export interface ZipEntry {
  name: string
  /** 0 is stored, 8 is deflate. */
  method: number
  compressedSize: number
  size: number
  /** Where the entry's local header starts. */
  offset: number
}

/** No subtitle is this big; a file that unpacks past it is a bomb or the wrong file. */
export const maxUnpacked = 8 * 1024 * 1024

export const isZip = (b: Uint8Array): boolean => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
export const isGzip = (b: Uint8Array): boolean => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b

const unreadable = () => new SubtitleError('That subtitle download is a zip file Flow can’t open. Choose another.')

/** The entries of a zip archive, folders left out. */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end record is the last 22 bytes plus a comment of up to 64 KB.
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw unreadable()
  const total = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries: ZipEntry[] = []
  for (let n = 0; n < total; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw unreadable()
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    if (!name.endsWith('/')) {
      entries.push({ name, method: view.getUint16(at + 10, true), compressedSize: view.getUint32(at + 20, true), size: view.getUint32(at + 24, true), offset: view.getUint32(at + 42, true) })
    }
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** The bytes of a stream, failing if it runs past `limit`. */
async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > limit) {
      await reader.cancel()
      throw new SubtitleError('That subtitle file is far bigger than a subtitle can be. Choose another.')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(length)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}

async function inflate(data: Uint8Array, format: 'deflate-raw' | 'gzip'): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new SubtitleError('This browser can’t unpack zipped subtitles. Update it, or choose a result from a service that sends plain files.')
  try {
    const source = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format))
    return await readAll(source as ReadableStream<Uint8Array>, maxUnpacked)
  } catch (error) {
    if (error instanceof SubtitleError) throw error
    throw unreadable()
  }
}

export const gunzip = (data: Uint8Array) => inflate(data, 'gzip')

/** One entry's contents. */
export async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const at = entry.offset
  if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) throw unreadable()
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true)
  const data = bytes.subarray(start, start + entry.compressedSize)
  if (data.length < entry.compressedSize) throw unreadable()
  if (entry.method === 0) return data
  if (entry.method === 8) return inflate(data, 'deflate-raw')
  throw unreadable()
}

const subtitleName = /\.(srt|vtt|ass|ssa)$/i

/** The subtitle in a download, unpacked if it is zipped or gzipped. In a zip the first subtitle file wins
 *  (as the apps do), or the one `prefer` likes: a season pack holds an episode apiece. */
export async function unpackSubtitle(bytes: Uint8Array, prefer?: (name: string) => boolean): Promise<{ bytes: Uint8Array; name?: string }> {
  if (isZip(bytes)) {
    const entries = zipEntries(bytes)
    const subtitles = entries.filter((e) => subtitleName.test(e.name))
    const pool = subtitles.length ? subtitles : entries
    const entry = (prefer && pool.find((e) => prefer(e.name))) ?? pool[0]
    if (!entry) throw new SubtitleError('That subtitle download is an empty zip file. Choose another.')
    return { bytes: await readEntry(bytes, entry), name: entry.name }
  }
  if (isGzip(bytes)) return { bytes: await gunzip(bytes) }
  return { bytes }
}
