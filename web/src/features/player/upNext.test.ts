import { describe, expect, it } from 'vitest'
import { upNextDueAt } from './UpNext'

describe('when Up Next comes up', () => {
  it('is as the credits begin when a segment says where', () => {
    expect(upNextDueAt(2700, 2600)).toBe(2600)
  })

  it('is the last 30 seconds without one', () => {
    expect(upNextDueAt(2700, undefined)).toBe(2670)
  })

  it('waits for the length, and for a stream long enough to have a tail', () => {
    expect(upNextDueAt(Number.NaN, 2600)).toBeUndefined()
    expect(upNextDueAt(45, undefined)).toBeUndefined()
    expect(upNextDueAt(45, 30)).toBe(30)
    expect(upNextDueAt(25, 10)).toBeUndefined()
  })
})
