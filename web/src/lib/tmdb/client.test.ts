import { describe, expect, it } from 'vitest'
import { settingsStore } from '../store/settings'
import { api, item } from './client'
import { trailers } from './detail'
import { srcSet, imageURL } from './images'
import { demoTmdb } from './demo'
import { tmdbReviews } from '../reviews'

describe('TMDB normalising', () => {
  it('reads a film from a trending result', () => {
    const m = item({ id: 693134, media_type: 'movie', title: 'Dune: Part Two', release_date: '2024-02-27', vote_average: 8.234, genre_ids: [878, 12], poster_path: '/p.jpg', overview: 'x' })
    expect(m).toMatchObject({ type: 'movie', id: 693134, title: 'Dune: Part Two', year: 2024, rating: 8.2, genres: [878, 12], poster: '/p.jpg' })
  })

  it('reads a show and leaves out people', () => {
    expect(item({ id: 1396, media_type: 'tv', name: 'Breaking Bad', first_air_date: '2008-01-20' })).toMatchObject({ type: 'show', year: 2008, title: 'Breaking Bad' })
    expect(item({ id: 17419, media_type: 'person', name: 'Bryan Cranston' })).toBeUndefined()
  })

  it('takes the list’s type when the result has none', () => {
    expect(item({ id: 1, name: 'A Show' }, 'show')?.type).toBe('show')
    expect(item({ id: 2, title: 'A Film' })?.type).toBe('movie')
  })

  it('treats a missing date as no year', () => {
    expect(item({ id: 3, title: 'Untitled', release_date: '' })?.year).toBeUndefined()
  })
})

describe('Images', () => {
  it('offers every poster width and passes full URLs through', () => {
    expect(srcSet('/a.jpg', 'poster')).toContain('https://image.tmdb.org/t/p/w342/a.jpg 342w')
    expect(srcSet('/a.jpg', 'backdrop')).toContain('original/a.jpg 1920w')
    expect(imageURL('https://example.com/x.png', 300)).toBe('https://example.com/x.png')
    expect(imageURL(undefined, 300)).toBeUndefined()
  })
})

describe('Sample data', () => {
  it('answers the catalogue requests Home and title pages make', async () => {
    const trending: any = await demoTmdb('/trending/all/day', { page: 1 })
    expect(trending.results.length).toBe(20)
    const detail: any = await demoTmdb('/tv/1396', {})
    // Five seasons and the Specials, which TMDB lists as season 0.
    expect(detail.seasons).toHaveLength(6)
    const season: any = await demoTmdb('/tv/1396/season/3', {})
    expect(season.episodes.length).toBeGreaterThan(7)
    const search: any = await demoTmdb('/search/multi', { query: 'dune' })
    expect(search.results.map((r: any) => r.title)).toContain('Dune: Part Two')
  })
})

describe('A title page’s details', () => {
  const asDemo = () => settingsStore.set({ demo: true, region: 'US' })

  it('reads about facts, trailers, services, logo art and reviews from the sample catalogue the way it would from TMDB', async () => {
    asDemo()
    const d = await api.detail('movie', 693134)
    expect(d).toMatchObject({ budget: 190_000_000, revenue: 714_444_358, originCountries: ['US'], productionCompanies: ['Legendary Pictures', 'Warner Bros. Pictures'], logo: '/gOWf4IYBP2m1Q7dhbQJkwxH714x.png' })
    // YouTube only, official trailers first, then teasers and the rest.
    expect(d.trailers.map((v) => v.name)).toEqual(['Official Trailer', 'Final Trailer', 'Official Teaser', 'Behind the Scenes'])
    expect(d.trailer?.name).toBe('Official Trailer')
    // Every way to watch, in the region's own order.
    expect(d.providers.stream.length).toBeGreaterThan(0)
    expect(d.providers.rent.map((p) => p.name)).toEqual(['Apple TV', 'Amazon Video', 'Google Play Movies'])
    expect(d.providers.buy.map((p) => p.name)).toEqual(['Apple TV', 'Amazon Video', 'Google Play Movies', 'YouTube'])
    const reviews = await tmdbReviews('movie', 693134)
    expect(reviews[0]).toMatchObject({ id: 'tmdb:demo-1', source: 'tmdb', author: 'frameperfect', rating: 9, spoiler: false })
    // Markdown, entities and line breaks cleaned, spoiler tags kept for the page to hide.
    expect(reviews[0]!.text).toContain('Stunning from the first frame, and the sound design is half the experience & then some.')
    expect(reviews[0]!.text).toContain('on my blog.')
    expect(reviews[1]!.text).toBe('A confident, patient piece of film-making that trusts its audience.\n\nNot for everyone, but the performances carry it, and it looks gorgeous on a big screen.')
    expect(reviews[2]!.text).toContain('[spoiler]')
  })

  it('shows only the viewer’s own region’s services', async () => {
    settingsStore.set({ demo: true, region: 'DE' })
    const d = await api.detail('movie', 693134)
    expect(d.providers).toMatchObject({ stream: [], free: [], rent: [], buy: [] })
    asDemo()
  })

  it('keeps the Specials season in the list and a show’s countries', async () => {
    asDemo()
    const d = await api.detail('show', 1396)
    expect(d.seasons.map((x) => x.number)).toEqual([0, 1, 2, 3, 4, 5])
    expect(d.originCountries).toEqual(['US'])
    expect(d.budget).toBeUndefined()
  })

  it('ranks videos by kind and officialness and drops other sites', () => {
    const video = (key: string, type: string, official: boolean, site = 'YouTube') => ({ key, name: key, site, type, official })
    expect(trailers({ videos: { results: [video('clip', 'Clip', true), video('teaser', 'Teaser', false), video('t2', 'Trailer', false), video('t1', 'Trailer', true), video('vim', 'Trailer', true, 'Vimeo')] } }).map((v) => v.key)).toEqual(['t1', 't2', 'teaser', 'clip'])
  })
})
