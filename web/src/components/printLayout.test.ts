import { describe, expect, it } from 'vitest'
import { rank, toFacts } from './printLayout'

describe('the facts printed under artwork', () => {
  it('reads callers’ parts: strings are the lowest priority, { key } is the time left, { text, rank } as given', () => {
    const facts = toFacts(['S1 E1', { key: '5m left' }, { text: 'ends 9:00', rank: rank.ends }, ''])
    expect(facts).toEqual([
      { text: 'S1 E1', rank: rank.facts },
      { text: '5m left', rank: rank.left, key: true },
      { text: 'ends 9:00', rank: rank.ends },
    ])
  })

  it('ranks the time left over episodes left, the end time, the format, the episode code, the rating and the rest', () => {
    const order = [rank.left, rank.episodesLeft, rank.ends, rank.format, rank.episode, rank.rating, rank.facts, rank.year]
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})
