import { describe, expect, it } from 'vitest'
import { buildCollection } from '../../lib/tmdb/collection'
import { filmCount, yearSpan } from './logic'

describe('collection', () => {
  it('lists the films oldest first and the undated last', () => {
    const c = buildCollection({
      id: 9,
      name: 'Dune Collection',
      overview: 'Arrakis.',
      backdrop_path: '/b.jpg',
      parts: [
        { id: 3, title: 'Later', release_date: '2024-03-01' },
        { id: 4, title: 'Unscheduled', release_date: '' },
        { id: 1, title: 'First', release_date: '2021-10-22' },
      ],
    })
    expect(c.parts.map((p) => p.id)).toEqual([1, 3, 4])
    expect(c).toMatchObject({ id: 9, name: 'Dune Collection', backdrop: '/b.jpg', poster: undefined })
    expect(c.parts.every((p) => p.type === 'movie')).toBe(true)
  })

  it('counts films and gives the years they span', () => {
    expect(filmCount(1)).toBe('1 film')
    expect(filmCount(3)).toBe('3 films')
    expect(yearSpan([{ year: 2024 }, { year: 2021 }, { year: undefined }])).toBe('2021 – 2024')
    expect(yearSpan([{ year: 2021 }, { year: 2021 }])).toBe('2021')
    expect(yearSpan([{ year: undefined }])).toBeUndefined()
  })
})
