import { describe, expect, it } from 'vitest'
import { merged } from './reviews'
import type { Review } from './tmdb/types'

const review = (id: string, date?: number): Review => ({ id, source: id.startsWith('t') ? 'tmdb' : 'trakt', author: 'a', text: 'x', spoiler: false, ...(date ? { date } : {}) })

describe('merged reviews', () => {
  it('interleaves both sources newest first and leaves undated ones last', () => {
    expect(merged([review('t1', 10), review('t2')], [review('k1', 30), review('k2', 20)]).map((r) => r.id)).toEqual(['k1', 'k2', 't1', 't2'])
  })
})
