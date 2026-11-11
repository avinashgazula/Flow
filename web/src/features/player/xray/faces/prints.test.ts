import { describe, expect, it } from 'vitest'
import { collectPrints, keyOf, photoURL, type PrintStore } from './prints'

const memory = (initial: Record<string, Float32Array | null> = {}): PrintStore & { data: Map<string, Float32Array | null>; writes: number } => {
  const data = new Map(Object.entries(initial))
  return {
    data,
    writes: 0,
    async read(keys) {
      return keys.map((k) => (data.has(k) ? data.get(k) : undefined))
    },
    async write(entries) {
      this.writes++
      for (const [k, v] of entries) data.set(k, v)
    },
  }
}
const print = (...n: number[]) => Float32Array.from(n)

describe('the cast’s prints', () => {
  const cast = [
    { id: 1, profile: '/a.jpg' },
    { id: 2, profile: '/b.jpg' },
    { id: 3 },
    { id: 4, profile: '/d.jpg' },
  ]

  it('asks for the tall TMDB photo, and leaves a full address alone', () => {
    expect(photoURL('/a.jpg')).toBe('https://image.tmdb.org/t/p/h632/a.jpg')
    expect(photoURL('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
  })

  it('works out each photo once, skips people without one, and keeps the results', async () => {
    const store = memory()
    const asked: string[] = []
    const got = await collectPrints(cast, async (url) => (asked.push(url), print(asked.length)), { store })
    expect(asked.sort()).toEqual(['https://image.tmdb.org/t/p/h632/a.jpg', 'https://image.tmdb.org/t/p/h632/b.jpg', 'https://image.tmdb.org/t/p/h632/d.jpg'])
    expect(got.prints.map((p) => p.id)).toEqual([1, 2, 4])
    expect(store.data.size).toBe(3)

    // The next title (or visit) with the same actors asks for nothing.
    const again = await collectPrints(cast, async () => Promise.reject(new Error('should not be asked')), { store })
    expect(again.prints.map((p) => p.id)).toEqual([1, 2, 4])
    expect(again.failed).toBe(0)
  })

  it('remembers a photo with no face, so it is not tried again', async () => {
    const store = memory()
    let asked = 0
    await collectPrints([{ id: 1, profile: '/a.jpg' }], async () => (asked++, null), { store })
    const got = await collectPrints([{ id: 1, profile: '/a.jpg' }], async () => (asked++, null), { store })
    expect(asked).toBe(1)
    expect(got.prints).toEqual([])
    expect(store.data.get(keyOf({ id: 1, profile: '/a.jpg' }))).toBeNull()
  })

  it('counts a photo that failed to load, keeps nothing for it, and goes on', async () => {
    const store = memory()
    const got = await collectPrints(cast, async (url) => (url.endsWith('/b.jpg') ? Promise.reject(new Error('offline')) : print(1)), { store })
    expect(got.failed).toBe(1)
    expect(got.prints.map((p) => p.id)).toEqual([1, 4])
    expect(store.data.has(keyOf({ id: 2, profile: '/b.jpg' }))).toBe(false)
  })

  it('makes a new print when an actor’s photo changes', async () => {
    const store = memory()
    await collectPrints([{ id: 1, profile: '/old.jpg' }], async () => print(1), { store })
    let asked = 0
    await collectPrints([{ id: 1, profile: '/new.jpg' }], async () => (asked++, print(2)), { store })
    expect(asked).toBe(1)
  })

  it('looks up the billed actors only', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, profile: `/${i}.jpg` }))
    const got = await collectPrints(many, async () => print(1), { store: memory(), limit: 10 })
    expect(got.prints.map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('stops asking when told to', async () => {
    const abort = new AbortController()
    let asked = 0
    await collectPrints(
      Array.from({ length: 10 }, (_, i) => ({ id: i + 1, profile: `/${i}.jpg` })),
      async () => {
        asked++
        abort.abort()
        return print(1)
      },
      { store: memory(), parallel: 1, signal: abort.signal },
    )
    expect(asked).toBe(1)
  })

  it('still works when nothing can be stored', async () => {
    const broken: PrintStore = { read: async (keys) => keys.map(() => undefined), write: async () => {} }
    const got = await collectPrints(cast, async () => print(1), { store: broken })
    expect(got.prints).toHaveLength(3)
  })
})
