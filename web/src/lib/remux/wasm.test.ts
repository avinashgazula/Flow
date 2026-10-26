import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { initSync, Remuxer } from './pkg/flow_remux.js'
import { rgbaOf } from '../../features/player/pictureLayout'
import { parsePictureCues, PictureTrack } from './pictures'
import type { HeaderInfo } from './protocol'

/* The built WebAssembly module itself, driven the way the worker drives it, against real files: what the crate's
   own tests prove in Rust, proven again through the JavaScript glue and the page's parsers. */

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(path, import.meta.url)))
const sample = () => fixture('../../../public/samples/flow-sample.mkv')
const chaptersFile = () => fixture('./__fixtures__/chapters.mkv')

beforeAll(() => {
  initSync({ module: readFileSync(new URL('./pkg/flow_remux_bg.wasm', import.meta.url)) })
})

/** The header, then the index and the chapters, with every read answered from `bytes`. */
function open(bytes: Uint8Array, cached?: Uint8Array) {
  const rem = new Remuxer(bytes.length)
  const slice = (offset: number, length: number) => bytes.subarray(offset, Math.min(bytes.length, offset + length))
  const imported = cached ? rem.importHeader(cached) : false
  for (let need = rem.headerNeed(); need.length; need = rem.headerNeed()) rem.headerFeed(need[0]!, slice(need[0]!, need[1]!))
  expect(rem.headerError()).toBeUndefined()
  for (let need = rem.cuesNeed(); need.length; ) need = rem.cuesFeed(need[0]!, slice(need[0]!, need[1]!))
  for (let need = rem.chaptersNeed(); need.length; ) need = rem.chaptersFeed(need[0]!, slice(need[0]!, need[1]!))
  return { rem, imported, info: JSON.parse(rem.headerJson()) as HeaderInfo }
}

describe('chapters', () => {
  it('come out of a real file in order, in seconds of file time', () => {
    const { rem } = open(chaptersFile())
    expect(JSON.parse(rem.chaptersJson())).toEqual([
      { title: 'Prologue', start: 0 },
      { title: 'Opening', start: 5 },
      { title: 'Part A', start: 20 },
    ])
  })

  it('come out of the sample too', () => {
    const { rem } = open(sample())
    const chapters = JSON.parse(rem.chaptersJson()) as { title: string; start: number }[]
    expect(chapters.length).toBeGreaterThanOrEqual(2)
    expect(chapters[0]).toEqual({ title: 'Opening Titles', start: 0 })
  })
})

describe('the header cache', () => {
  it('starts a second visit with nothing left to read', () => {
    const bytes = sample()
    const first = open(bytes)
    const blob = first.rem.exportHeader()
    expect(blob.length).toBeGreaterThan(100)
    const second = open(bytes, blob)
    expect(second.imported).toBe(true)
    expect(second.rem.cuesNeed()).toHaveLength(0)
    expect(second.rem.chaptersNeed()).toHaveLength(0)
    expect(second.info).toEqual(first.info)
    expect(second.rem.cueCount()).toBe(first.rem.cueCount())
    expect(second.rem.chaptersJson()).toBe(first.rem.chaptersJson())
    expect(Array.from(second.rem.seekTarget(6))).toEqual(Array.from(first.rem.seekTarget(6)))
  })

  it('says no to anything that is not its own blob', () => {
    const rem = new Remuxer(1000)
    expect(rem.importHeader(new Uint8Array(0))).toBe(false)
    expect(rem.importHeader(new Uint8Array(300).fill(1))).toBe(false)
  })
})

describe('picture subtitles', () => {
  it('decode the sample’s PGS track into cues the page can draw', () => {
    const bytes = sample()
    const { rem, info } = open(bytes)
    const video = info.tracks.find((t) => t.type === 'video')!
    const pgs = info.tracks.find((t) => t.codecId === 'S_HDMV/PGS')!
    expect(pgs.subtitleKind).toBe('image')
    expect(pgs.supported).toBe(true)
    rem.select(video.id, 0, false)
    rem.reset(rem.firstCluster(), true)
    rem.selectPicture(pgs.id)
    const got: Uint8Array[] = []
    for (let at = rem.firstCluster(); at < bytes.length; at += 65536) {
      rem.push(bytes.subarray(at, Math.min(bytes.length, at + 65536)))
      while (rem.nextFragment()) continue
      const cues = rem.takePictureCues()
      if (cues) got.push(cues)
    }
    rem.finish()
    while (rem.nextFragment()) continue
    const last = rem.takePictureCues()
    if (last) got.push(last)

    const track = new PictureTrack()
    const all = got.flatMap((g) => parsePictureCues(g))
    track.add(all)
    expect(all.map((c) => c.objects.length > 0)).toEqual([true, false, true, false])
    const delay = rem.delay()

    // On screen between its start and the clear, off after, on again for the second.
    expect(track.at(0.3 + delay)).toBeNull()
    const first = track.at(0.5 + delay)!
    expect(first).not.toBeNull()
    expect(first.canvasWidth).toBe(1280)
    expect(first.canvasHeight).toBe(720)
    expect(track.at(6.1 + delay)).toBeNull()
    expect(track.at(7 + delay)).not.toBeNull()
    expect(track.at(11.7 + delay)).toBeNull()

    // Real pixels: part of the picture is drawn, and the rest is left clear.
    const object = first.objects[0]!
    expect(object.x + object.width).toBeLessThanOrEqual(1280)
    const rgba = rgbaOf(object, first.palette)
    const opaque = rgba.filter((_, i) => i % 4 === 3 && rgba[i]! > 200).length
    expect(opaque).toBeGreaterThan(50)
    expect(opaque).toBeLessThan(object.width * object.height)
  })
})
