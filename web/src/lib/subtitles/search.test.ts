import { beforeEach, describe, expect, it } from 'vitest'
import opensubtitlesSearch from './__fixtures__/opensubtitles-search.json'
import subdlSearch from './__fixtures__/subdl-search.json'
import wyzieSearch from './__fixtures__/wyzie-search.json'
import { forgetRefused, rankResults, searchSubtitles, usableProviders } from './search'
import type { SubtitleQuery, SubtitleResult } from './types'

const movie: SubtitleQuery = { type: 'movie', tmdbId: 693134, imdbId: 'tt15239678', languages: ['en', 'pt'] }

const result = (id: string, language: string, hearingImpaired: boolean, downloads?: number): SubtitleResult => ({ id, provider: 'subdl', language, languageName: language, release: '', hearingImpaired, downloads, token: id })

beforeEach(forgetRefused)

describe('which services are asked', () => {
  it('takes those with their key, and only those turned on', () => {
    expect(usableProviders({})).toEqual([])
    expect(usableProviders({ openSubtitlesKey: 'a', subdlKey: 'b', wyzieKey: 'c', subSourceKey: 'd' })).toEqual(['opensubtitles', 'subdl', 'wyzie', 'subsource'])
    expect(usableProviders({ openSubtitlesKey: 'a', subdlKey: 'b' }, ['subdl', 'wyzie'])).toEqual(['subdl'])
    expect(usableProviders({ openSubtitlesKey: ' ' })).toEqual([])
  })
})

describe('the order of results', () => {
  it('puts the languages in the order the viewer chose, then the kind they prefer, then the most downloaded', () => {
    const list = [result('pt', 'pt-BR', false, 900), result('en-hi', 'en', true, 5000), result('en-low', 'en', false, 10), result('en-high', 'en', false, 700), result('xx', 'sw', false, 99999)]
    expect(rankResults(list, ['en', 'pt'], false).map((r) => r.id)).toEqual(['en-high', 'en-low', 'en-hi', 'pt', 'xx'])
    // An SDH preference reverses the kinds within a language, and nothing else.
    expect(rankResults(list, ['en', 'pt'], true).map((r) => r.id)).toEqual(['en-hi', 'en-high', 'en-low', 'pt', 'xx'])
    expect(rankResults(list, ['pt', 'en'], false)[0]!.id).toBe('pt')
  })

  it('keeps a service’s own order when nothing else separates two', () => {
    const list = [result('a', 'en', false), result('b', 'en', false), result('c', 'en', false)]
    expect(rankResults(list, ['en'], false).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('treats three-letter and regional codes as the language they are', () => {
    const list = [result('a', 'por', false, 1), result('b', 'en-US', false, 1)]
    expect(rankResults(list, ['en', 'pt'], false).map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('searching', () => {
  const fetch = async (url: string) => {
    if (url.startsWith('https://api.opensubtitles.com/')) return new Response(JSON.stringify(opensubtitlesSearch))
    if (url.startsWith('https://api.subdl.com/')) return new Response(JSON.stringify(subdlSearch))
    if (url.startsWith('https://sub.wyzie.io/')) return new Response(JSON.stringify(wyzieSearch))
    throw new TypeError('Failed to fetch')
  }

  it('merges every service’s answers, ranked, with a count for each', async () => {
    const { results, outcomes } = await searchSubtitles(movie, { openSubtitlesKey: 'a', subdlKey: 'b', wyzieKey: 'c' }, { fetch })
    expect(outcomes).toEqual([
      { provider: 'opensubtitles', count: 3 },
      { provider: 'subdl', count: 3 },
      { provider: 'wyzie', count: 2 },
    ])
    expect(results).toHaveLength(8)
    // English first, most downloaded first.
    expect(results[0]).toMatchObject({ id: 'os-8847112', downloads: 48210 })
    expect(results.slice(0, 5).every((r) => r.language.toLowerCase().startsWith('en') || r.language === 'es')).toBe(true)
    expect(results.at(-1)!.language).toBe('es')
  })

  it('drops the same subtitle listed twice', async () => {
    const twice = async () => new Response(JSON.stringify(subdlSearch))
    const { results } = await searchSubtitles(movie, { subdlKey: 'b', wyzieKey: 'c' }, { fetch: twice })
    expect(new Set(results.map((r) => r.id)).size).toBe(results.length)
  })

  it('reports a service that fails beside the ones that answered', async () => {
    const { results, outcomes } = await searchSubtitles(movie, { openSubtitlesKey: 'a', subdlKey: 'b' }, { fetch: async (url) => (url.includes('subdl') ? new Response('{}', { status: 403 }) : fetch(url)) })
    expect(results).toHaveLength(3)
    expect(outcomes[0]).toEqual({ provider: 'opensubtitles', count: 3 })
    expect(outcomes[1]).toMatchObject({ provider: 'subdl', count: 0, kind: 'key', error: expect.stringContaining('SubDL') })
  })

  it('remembers a service the browser won’t let it read, and doesn’t ask again this visit', async () => {
    let asked = 0
    const blocked = async () => {
      asked++
      throw new TypeError('Failed to fetch')
    }
    const first = await searchSubtitles(movie, { subSourceKey: 'k' }, { fetch: blocked })
    expect(first.outcomes[0]).toMatchObject({ provider: 'subsource', kind: 'blocked' })
    const before = asked
    const second = await searchSubtitles(movie, { subSourceKey: 'k' }, { fetch: blocked })
    expect(asked).toBe(before)
    expect(second.outcomes[0]).toMatchObject({ provider: 'subsource', kind: 'blocked', error: first.outcomes[0]!.error })
  })

  it('gives up on a service that takes too long and carries on', async () => {
    const slow = (url: string) => (url.includes('subdl') ? new Promise<Response>(() => {}) : fetch(url))
    const { results, outcomes } = await searchSubtitles(movie, { openSubtitlesKey: 'a', subdlKey: 'b' }, { fetch: slow, timeoutMs: 20 })
    expect(results).toHaveLength(3)
    expect(outcomes[1]).toMatchObject({ provider: 'subdl', kind: 'network', error: expect.stringMatching(/took too long/) })
  })

  it('asks nobody when no service has a key', async () => {
    const { results, outcomes } = await searchSubtitles(movie, {}, { fetch })
    expect(results).toEqual([])
    expect(outcomes).toEqual([])
  })
})
