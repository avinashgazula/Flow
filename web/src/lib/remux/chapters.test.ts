import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseChapters } from './chapters'

/* A small Matroska writer: enough EBML to lay out a header the way mkvmerge does. */
const bytesOf = (n: number, length: number) => Array.from({ length }, (_, i) => Math.floor(n / 256 ** (length - 1 - i)) % 256)
const idBytes = (id: number) => bytesOf(id, id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1)
const sizeBytes = (n: number, length = 4) => {
  const out = bytesOf(n, length)
  out[0]! |= 0x80 >> (length - 1)
  return out
}
const el = (id: number, ...body: number[][]) => {
  const data = body.flat()
  return [...idBytes(id), ...sizeBytes(data.length), ...data]
}
const uintEl = (id: number, n: number) => el(id, bytesOf(n, n > 0xffffffff ? 8 : 4))
const text = (s: string) => Array.from(new TextEncoder().encode(s))

const atom = (title: string, seconds: number, ...extra: number[][]) =>
  el(0xb6, uintEl(0x73c4, 1), uintEl(0x91, seconds * 1e9), el(0x80, el(0x85, text(title)), el(0x437c, text('eng'))), ...extra)
const edition = (...atoms: number[][]) => el(0x45b9, uintEl(0x45bc, 1), ...atoms)
const chapters = (...editions: number[][]) => el(0x1043a770, ...editions)

const ebmlHeader = el(0x1a45dfa3, el(0x4282, text('matroska')))
const tracks = el(0x1654ae6b, el(0xae, uintEl(0xd7, 1)))
const cluster = el(0x1f43b675, uintEl(0xe7, 0))
/** The Segment declares more than the bytes read, as when only the first part of a file is fetched. */
const segment = (...children: number[][]) => [...idBytes(0x18538067), ...sizeBytes(900_000_000, 8), ...children.flat()]
const file = (...children: number[][]) => new Uint8Array([...ebmlHeader, ...segment(...children)])

describe('chapters from a Matroska header', () => {
  it('reads the names and start times in order', () => {
    const bytes = file(tracks, chapters(edition(atom('Prologue', 0), atom('Opening', 95.5), atom('Part A', 185))), cluster)
    expect(parseChapters(bytes)).toEqual([
      { title: 'Prologue', start: 0 },
      { title: 'Opening', start: 95.5 },
      { title: 'Part A', start: 185 },
    ])
  })

  it('sorts chapters that are stored out of order', () => {
    const bytes = file(chapters(edition(atom('Ending', 1290), atom('Opening', 95))))
    expect(parseChapters(bytes).map((c) => c.title)).toEqual(['Opening', 'Ending'])
  })

  it('reads sub-chapters, and takes only the first edition', () => {
    const bytes = file(chapters(edition(atom('Act One', 0, atom('Opening', 30))), edition(atom('Other cut', 5))))
    expect(parseChapters(bytes)).toEqual([
      { title: 'Act One', start: 0 },
      { title: 'Opening', start: 30 },
    ])
  })

  it('skips a disabled chapter, and one with no name', () => {
    const disabled = el(0xb6, uintEl(0x91, 10e9), uintEl(0x4598, 0), el(0x80, el(0x85, text('Hidden'))))
    const unnamed = el(0xb6, uintEl(0x91, 20e9))
    expect(parseChapters(file(chapters(edition(disabled, unnamed, atom('Kept', 30)))))).toEqual([{ title: 'Kept', start: 30 }])
  })

  it('has none when the file has no chapters, or they come after the first cluster', () => {
    expect(parseChapters(file(tracks, cluster))).toEqual([])
    expect(parseChapters(file(tracks, cluster, chapters(edition(atom('Late', 1)))))).toEqual([])
  })

  it('has none when the chapter list is cut off by the end of the bytes', () => {
    const whole = file(tracks, chapters(edition(atom('Opening', 95), atom('Ending', 1290))))
    expect(parseChapters(whole.subarray(0, whole.length - 6))).toEqual([])
  })

  it('has none, and does not throw, for bytes that are not Matroska', () => {
    expect(parseChapters(new Uint8Array())).toEqual([])
    expect(parseChapters(new Uint8Array([0, 0, 0, 0, 0, 0]))).toEqual([])
    expect(parseChapters(new TextEncoder().encode('<!doctype html><title>nope</title>'))).toEqual([])
    expect(parseChapters(new Uint8Array(Array.from({ length: 200 }, (_, i) => (i * 37) % 256)))).toEqual([])
  })

  it('reads a real file: ffmpeg’s output with three chapters', () => {
    // 11 KB, made with `ffmpeg -map_metadata` from a chapter list: Prologue 0:00, Opening 0:05, Part A 0:20.
    const bytes = new Uint8Array(readFileSync(new URL('./__fixtures__/chapters.mkv', import.meta.url)))
    expect(parseChapters(bytes)).toEqual([
      { title: 'Prologue', start: 0 },
      { title: 'Opening', start: 5 },
      { title: 'Part A', start: 20 },
    ])
  })
})
