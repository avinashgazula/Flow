import { describe, expect, it } from 'vitest'
import { episodeRef } from '../sources/parser'
import { episodeIn } from './episode'

describe('episodeIn', () => {
  it('reads what the stream parser reads', () => {
    for (const name of ['Show.Name.S02E03.1080p', 'show 2x03 720p', 'Show Season 2 Episode 3', 'Show.S1.E12', 'Dune.Part.Two.2024.1080p', 'Show.Name.Season.2.Complete', '']) {
      expect(episodeIn(name)).toEqual(episodeRef(name))
    }
    expect(episodeIn('Show.Name.S02E03.1080p')).toEqual({ season: 2, episode: 3 })
  })
})
