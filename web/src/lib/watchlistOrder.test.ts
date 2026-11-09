import { describe, expect, it } from 'vitest'
import { applying, moving, shifting } from './watchlistOrder'

const k = (id: number) => `movie:${id}`
const ks = (...ids: number[]) => ids.map(k)

// Ported from FlowKit's WatchlistOrderTests.
describe('applying', () => {
  it('puts the saved order first and newer titles after it', () => {
    expect(applying(ks(3, 1), ks(1, 2, 3, 4))).toEqual(ks(3, 1, 2, 4))
  })
  it('drops titles that left the watchlist, and repeats', () => {
    expect(applying(ks(9, 2, 1, 2), ks(1, 2))).toEqual(ks(2, 1))
  })
  it('leaves the list as it is when nothing is saved', () => {
    expect(applying([], ks(5, 6, 7))).toEqual(ks(5, 6, 7))
  })
})

describe('moving', () => {
  it('moves before a target', () => {
    expect(moving(ks(4), k(2), ks(1, 2, 3, 4))).toEqual(ks(1, 4, 2, 3))
    expect(moving(ks(1, 2), k(4), ks(1, 2, 3, 4))).toEqual(ks(3, 1, 2, 4))
  })
  it('moves to the end without a target', () => {
    expect(moving(ks(1), undefined, ks(1, 2, 3))).toEqual(ks(2, 3, 1))
  })
  it('goes to the end when the target is itself moving', () => {
    expect(moving(ks(1, 2), k(2), ks(1, 2, 3))).toEqual(ks(3, 1, 2))
  })
  it('ignores keys that are not on the list', () => {
    expect(moving(ks(9), k(1), ks(1, 2))).toEqual(ks(1, 2))
  })
})

describe('shifting', () => {
  it('moves one place earlier or later', () => {
    expect(shifting(k(3), -1, ks(1, 2, 3, 4))).toEqual(ks(1, 3, 2, 4))
    expect(shifting(k(2), 1, ks(1, 2, 3, 4))).toEqual(ks(1, 3, 2, 4))
    expect(shifting(k(3), 1, ks(1, 2, 3, 4))).toEqual(ks(1, 2, 4, 3))
  })
  it('stays put at either end or off the list', () => {
    expect(shifting(k(1), -1, ks(1, 2, 3))).toEqual(ks(1, 2, 3))
    expect(shifting(k(3), 1, ks(1, 2, 3))).toEqual(ks(1, 2, 3))
    expect(shifting(k(9), 1, ks(1, 2, 3))).toEqual(ks(1, 2, 3))
  })
})
