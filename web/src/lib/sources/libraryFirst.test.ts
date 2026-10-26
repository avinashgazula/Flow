import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from '../store/settings'
import { fixedCapabilities } from './capabilities'
import { searchSources, type Provider, type SearchUpdate } from './index'
import { libraryOriginFor, rememberLibraryOrigin } from './libraryOrigin'
import type { PlaybackRequest, Source } from './types'

const caps = fixedCapabilities({})
const dune: PlaybackRequest = { type: 'movie', tmdbId: 693134, item: { type: 'movie', id: 693134, title: 'Dune: Part Two', year: 2024, overview: '', genres: [] } }
const src = (id: string, provider: string, origin: Source['origin']): Source => ({ id, origin, provider, providerId: provider, title: id, url: `https://x.test/${id}.mp4`, engine: 'native', resolution: '1080p' })
const provider = (id: string, kind: Provider['kind'], sources: Source[]) => {
  const p = {
    id,
    name: id,
    kind,
    asked: 0,
    search: async () => {
      p.asked++
      return { sources }
    },
  }
  return p
}

/** sessionStorage for the test, since the origin is kept per visit. */
function stubStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) })
}

beforeEach(() => {
  stubStorage()
  settingsStore.set({ sources: undefined })
})
afterEach(() => vi.unstubAllGlobals())

describe('Play From This Library Only', () => {
  it('remembers which server a title was opened from, for the visit', () => {
    expect(libraryOriginFor('movie', 1)).toBeUndefined()
    rememberLibraryOrigin('movie', 1, 'jf')
    rememberLibraryOrigin('show', 1, 'plex')
    expect(libraryOriginFor('movie', 1)).toBe('jf')
    expect(libraryOriginFor('show', 1)).toBe('plex')
    rememberLibraryOrigin('movie', 1, 'plex')
    expect(libraryOriginFor('movie', 1)).toBe('plex')
  })

  it('keeps the most recent forty', () => {
    for (let i = 0; i < 45; i++) rememberLibraryOrigin('movie', i, 'jf')
    expect(libraryOriginFor('movie', 0)).toBeUndefined()
    expect(libraryOriginFor('movie', 44)).toBe('jf')
  })

  it('asks only that server when it has the title, and nobody else', async () => {
    settingsStore.set({ sources: { playFromLibraryOnly: true } as never })
    rememberLibraryOrigin('movie', dune.tmdbId, 'jf')
    const jf = provider('jf', 'jellyfin', [src('a', 'jf', 'jellyfin')])
    const aio = provider('aio', 'addon', [src('b', 'aio', 'addon')])
    const seen: SearchUpdate[] = []
    const result = await searchSources(dune, { capabilities: caps, providers: [jf, aio], onUpdate: (u) => seen.push(u) })
    expect(result.sources.map((s) => s.id)).toEqual(['a'])
    expect(aio.asked).toBe(0)
    expect(result.finished).toBe(true)
    // Nothing said it was finished before the answer was in.
    expect(seen.slice(0, -1).every((u) => !u.finished)).toBe(true)
  })

  it('searches everything as usual when that server has nothing for the title', async () => {
    settingsStore.set({ sources: { playFromLibraryOnly: true } as never })
    rememberLibraryOrigin('movie', dune.tmdbId, 'jf')
    const jf = provider('jf', 'jellyfin', [])
    const aio = provider('aio', 'addon', [src('b', 'aio', 'addon')])
    const result = await searchSources(dune, { capabilities: caps, providers: [jf, aio] })
    expect(result.sources.map((s) => s.id)).toEqual(['b'])
    expect(jf.asked).toBe(2)
    expect(aio.asked).toBe(1)
  })

  it('changes nothing with the setting off, or for a title opened anywhere else', async () => {
    rememberLibraryOrigin('movie', dune.tmdbId, 'jf')
    const jf = provider('jf', 'jellyfin', [src('a', 'jf', 'jellyfin')])
    const aio = provider('aio', 'addon', [src('b', 'aio', 'addon')])
    expect((await searchSources(dune, { capabilities: caps, providers: [jf, aio] })).sources).toHaveLength(2)
    settingsStore.set({ sources: { playFromLibraryOnly: true } as never })
    const other: PlaybackRequest = { ...dune, tmdbId: 5, item: { ...dune.item, id: 5 } }
    expect((await searchSources(other, { capabilities: caps, providers: [jf, aio] })).sources).toHaveLength(2)
  })
})
