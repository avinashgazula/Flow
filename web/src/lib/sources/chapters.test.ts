import { describe, expect, it } from 'vitest'
import { chaptersOf, mapMediaSource } from './jellyfin'
import type { Capabilities } from './capabilities'
import type { ServerConfig } from '../store/settings'

describe('a Jellyfin item’s chapters', () => {
  it('become seconds in time order, named as the server names them', () => {
    expect(
      chaptersOf([
        { Name: 'Ending', StartPositionTicks: 72_000_000_000 },
        { Name: ' Opening ', StartPositionTicks: 0 },
        { Name: 'Chapter 3', StartPositionTicks: 15_000_000_000 },
      ]),
    ).toEqual([
      { title: 'Opening', start: 0 },
      { title: 'Chapter 3', start: 1500 },
      { title: 'Ending', start: 7200 },
    ])
  })

  it('keep a chapter with no name for the player to number, and drop ones with no time', () => {
    expect(chaptersOf([{ StartPositionTicks: 600_000_000 }, { Name: 'Lost' }, { Name: 'Negative', StartPositionTicks: -5 }])).toEqual([{ title: '', start: 60 }])
  })

  it('are none when the server lists none', () => {
    expect(chaptersOf(undefined)).toBeUndefined()
    expect(chaptersOf([])).toBeUndefined()
  })

  it('ride on the source', () => {
    const config = { id: 'jf', kind: 'jellyfin', name: 'Home', url: 'https://jf.test', token: 'tok', userId: 'u', username: 'me', enabled: true } as ServerConfig
    const caps = { mse: true, video: () => true, audio: () => true } as unknown as Capabilities
    const ms = { Id: 'ms', Name: 'Film', Container: 'mkv', MediaStreams: [] }
    const chapters = chaptersOf([{ Name: 'Opening', StartPositionTicks: 0 }])
    expect(mapMediaSource(config, 'item', ms, 0, 0, caps, undefined, chapters).chapters).toEqual([{ title: 'Opening', start: 0 }])
    expect(mapMediaSource(config, 'item', ms, 0, 0, caps).chapters).toBeUndefined()
  })
})
