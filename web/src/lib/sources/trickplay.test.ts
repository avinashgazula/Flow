import { describe, expect, it } from 'vitest'
import { trickplayCell, trickplayFor } from './trickplay'
import { mapMediaSource } from './jellyfin'
import type { Capabilities } from './capabilities'
import type { ServerConfig } from '../store/settings'

const tile = (Width: number) => ({ Width, Height: Math.round((Width * 9) / 16), TileWidth: 10, TileHeight: 10, ThumbnailCount: 735, Interval: 10000 })

describe('trickplayFor', () => {
  it('picks the smallest picture that is sharp enough, else the biggest there is', () => {
    expect(trickplayFor('https://jf.test', 'item', 'ms', 'tok', { '160': tile(160), '320': tile(320), '640': tile(640) })?.width).toBe(320)
    expect(trickplayFor('https://jf.test', 'item', 'ms', 'tok', { '160': tile(160) })?.width).toBe(160)
    expect(trickplayFor('https://jf.test', 'item', 'ms', 'tok', { '240': tile(240), '480': tile(480) })?.width).toBe(240)
  })

  it('addresses the tiles and carries the grid', () => {
    const t = trickplayFor('https://jf.test', 'abc', 'src1', 'secret', { '320': tile(320) })!
    expect(t.url).toBe('https://jf.test/Videos/abc/Trickplay/320/{n}.jpg?MediaSourceId=src1&api_key=secret')
    expect(t).toMatchObject({ width: 320, height: 180, columns: 10, rows: 10, count: 735, interval: 10000 })
  })

  it('has nothing to offer for a file without them, or with a broken entry', () => {
    expect(trickplayFor('https://jf.test', 'a', 'b', 't', undefined)).toBeUndefined()
    expect(trickplayFor('https://jf.test', 'a', 'b', 't', {})).toBeUndefined()
    expect(trickplayFor('https://jf.test', 'a', 'b', 't', { '320': { ...tile(320), Interval: 0 } })).toBeUndefined()
    expect(trickplayFor('https://jf.test', 'a', 'b', 't', { '320': { ...tile(320), ThumbnailCount: 0 } })).toBeUndefined()
  })
})

describe('trickplayCell', () => {
  const t = trickplayFor('https://jf.test', 'a', 'b', 't', { '320': tile(320) })!
  it('maps a time to a tile and a cell, left to right then down', () => {
    expect(trickplayCell(t, 0)).toEqual({ tile: 0, column: 0, row: 0 })
    expect(trickplayCell(t, 9.9)).toEqual({ tile: 0, column: 0, row: 0 })
    expect(trickplayCell(t, 10)).toEqual({ tile: 0, column: 1, row: 0 })
    expect(trickplayCell(t, 100)).toEqual({ tile: 0, column: 0, row: 1 })
    expect(trickplayCell(t, 995)).toEqual({ tile: 0, column: 9, row: 9 })
    expect(trickplayCell(t, 1000)).toEqual({ tile: 1, column: 0, row: 0 })
    expect(trickplayCell(t, 2345)).toEqual({ tile: 2, column: 4, row: 3 })
  })

  it('stays inside the pictures there are', () => {
    expect(trickplayCell(t, -5)).toEqual({ tile: 0, column: 0, row: 0 })
    // 735 pictures: the last is number 734, the 35th of tile 7: column 4 of row 3.
    expect(trickplayCell(t, 99999)).toEqual({ tile: 7, column: 4, row: 3 })
  })
})

describe('a Jellyfin source', () => {
  const config = { id: 'jf', kind: 'jellyfin', name: 'Home', url: 'https://jf.test', token: 'tok', userId: 'u', username: 'me', enabled: true } as ServerConfig
  const caps = { mse: true, video: () => true, audio: () => true } as unknown as Capabilities
  it('carries its preview tiles when the server made them', () => {
    const source = mapMediaSource(config, 'item', { Id: 'ms', Name: 'Film', Container: 'mp4', MediaStreams: [] }, 0, 0, caps, { '320': tile(320) })
    expect(source.trickplay?.url).toContain('/Videos/item/Trickplay/320/{n}.jpg')
    expect(mapMediaSource(config, 'item', { Id: 'ms', Name: 'Film', Container: 'mp4', MediaStreams: [] }, 0, 0, caps).trickplay).toBeUndefined()
  })
})
