import { describe, expect, it } from 'vitest'
import { cacheKeys, type CacheStore, HeaderCache, hash, MAX_AGE_MS, MAX_BYTES, MAX_ENTRIES, MAX_ENTRY_BYTES, planEviction } from './headerCache'

type Meta = Awaited<ReturnType<CacheStore['meta']>>[number]

/** The store in memory, with what a test needs to look inside it. */
function memory() {
  const metas = new Map<string, Meta>()
  const blobs = new Map<string, Uint8Array>()
  const store: CacheStore = {
    meta: async () => [...metas.values()],
    getMeta: async (key) => metas.get(key),
    getBlob: async (key) => blobs.get(key),
    put: async (meta, blob) => {
      metas.set(meta.key, meta)
      if (blob) blobs.set(meta.key, blob)
    },
    remove: async (keys) => keys.forEach((k) => (metas.delete(k), blobs.delete(k))),
  }
  return { store, metas, blobs }
}

const head = (fill: number, length = 100_000) => new Uint8Array(length).fill(fill)
const file = { url: 'https://cdn.example/film.mkv?token=abc', size: 4_000_000_000, etag: '"v1"', lastModified: 'Tue, 01 Oct 2024 10:00:00 GMT' }
const blob = (n = 1000) => new Uint8Array(n).fill(7)

describe('hash', () => {
  it('is stable, short and sensitive', () => {
    expect(hash('a')).toBe(hash('a'))
    expect(hash('a')).not.toBe(hash('b'))
    expect(hash('a')).toHaveLength(14)
    expect(hash(new Uint8Array([1, 2, 3]))).not.toBe(hash(new Uint8Array([1, 2, 4])))
  })
})

describe('naming a file', () => {
  it('never contains the address', () => {
    const keys = cacheKeys(file, head(1))
    for (const key of Object.values(keys)) expect(key).not.toMatch(/cdn|token|film/)
  })

  it('tells files apart by address, size, ETag and date', () => {
    const base = cacheKeys(file, head(1)).identity
    expect(cacheKeys({ ...file }, head(1)).identity).toBe(base)
    expect(cacheKeys({ ...file, url: file.url + '2' }, head(1)).identity).not.toBe(base)
    expect(cacheKeys({ ...file, size: file.size + 1 }, head(1)).identity).not.toBe(base)
    expect(cacheKeys({ ...file, etag: '"v2"' }, head(1)).identity).not.toBe(base)
    expect(cacheKeys({ ...file, lastModified: null }, head(1)).identity).not.toBe(base)
    // The page's own #fragment isn't part of the address.
    expect(cacheKeys({ ...file, url: file.url + '#t=5' }, head(1)).identity).toBe(base)
  })

  it('names a film by its first 64 KB and size when its link changes', () => {
    const a = cacheKeys(file, head(1))
    const b = cacheKeys({ ...file, url: 'https://other.example/new-link' }, head(1))
    expect(b.identity).not.toBe(a.identity)
    expect(b.content).toBe(a.content)
    // Bytes past 64 KB (the first 512 KB are read, but only the start identifies) don't count.
    const later = head(1, 200_000)
    later.fill(9, 70_000)
    expect(cacheKeys(file, later).content).toBe(a.content)
    expect(cacheKeys(file, head(2)).content).not.toBe(a.content)
  })
})

describe('what to forget', () => {
  const now = 1_000_000_000_000
  const entry = (key: string, daysAgo: number, bytes = 1000) => ({ key, bytes, usedAt: now - daysAgo * 86_400_000 })

  it('forgets what was last used too long ago', () => {
    expect(planEviction([entry('old', 31), entry('new', 29)], now)).toEqual(['old'])
  })

  it('forgets the least recently used when there is too much', () => {
    const limits = { age: MAX_AGE_MS, bytes: 2500, entries: MAX_ENTRIES }
    expect(planEviction([entry('a', 3), entry('b', 1), entry('c', 2), entry('d', 4)], now, limits).sort()).toEqual(['a', 'd'])
    // A single entry bigger than the whole budget goes, and takes only itself.
    expect(planEviction([entry('huge', 1, 9000), entry('small', 2)], now, limits)).toEqual(['huge'])
  })

  it('keeps no more than the most it allows', () => {
    const many = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => entry(`k${i}`, i / 10 + 0.1, 10))
    const gone = planEviction(many, now)
    expect(gone).toHaveLength(5)
    expect(gone).toContain(`k${MAX_ENTRIES + 4}`)
  })

  it('has limits that make sense for a header', () => {
    expect(MAX_BYTES).toBeGreaterThan(MAX_ENTRY_BYTES * 8)
    expect(MAX_ENTRY_BYTES).toBeGreaterThan(100_000)
  })
})

describe('the cache', () => {
  it('gives back what was saved, under either name', async () => {
    const { store } = memory()
    const cache = new HeaderCache(store, () => 1000)
    const keys = cacheKeys(file, head(1))
    expect(await cache.lookup(keys, file)).toBeUndefined()
    await cache.save(keys, file, blob())
    expect(await cache.lookup(keys, file)).toEqual(blob())
    // A new link to the same film.
    const relinked = { ...file, url: 'https://elsewhere.example/x' }
    expect(await cache.lookup(cacheKeys(relinked, head(1)), relinked)).toEqual(blob())
    // A different film (another address, other first bytes) is not it.
    const other = { ...file, url: 'https://elsewhere.example/other' }
    expect(await cache.lookup(cacheKeys(other, head(2)), other)).toBeUndefined()
  })

  it('refuses a file the server now shows as changed', async () => {
    const { store } = memory()
    const cache = new HeaderCache(store, () => 1000)
    await cache.save(cacheKeys(file, head(1)), file, blob())
    const changed = { ...file, etag: '"v2"' }
    expect(await cache.lookup(cacheKeys(changed, head(1)), changed)).toBeUndefined()
    // A server that shows nothing can't contradict it.
    const silent = { ...file, etag: null, lastModified: null }
    expect(await cache.lookup(cacheKeys(silent, head(1)), silent)).toEqual(blob())
  })

  it('counts a hit as a use, so what is watched stays', async () => {
    const { store, metas } = memory()
    let now = 1000
    const cache = new HeaderCache(store, () => now)
    const keys = cacheKeys(file, head(1))
    await cache.save(keys, file, blob())
    now = 5000
    await cache.lookup(keys, file)
    expect(metas.get(keys.content)!.usedAt).toBe(5000)
  })

  it('forgets old records when saving, with the names that pointed at them', async () => {
    const { store, metas, blobs } = memory()
    let now = 1000
    const cache = new HeaderCache(store, () => now)
    const old = cacheKeys({ ...file, url: 'https://a.example/old' }, head(1))
    await cache.save(old, file, blob())
    now += MAX_AGE_MS + 1
    const fresh = cacheKeys({ ...file, url: 'https://a.example/new' }, head(2))
    await cache.save(fresh, file, blob())
    expect([...metas.keys()].sort()).toEqual([fresh.content, fresh.identity].sort())
    expect([...blobs.keys()]).toEqual([fresh.content])
  })

  it('keeps under its budget by letting the least recently used go', async () => {
    const { store, blobs } = memory()
    let now = 1000
    const cache = new HeaderCache(store, () => now)
    const size = Math.floor(MAX_ENTRY_BYTES * 0.9)
    const saved: string[] = []
    for (let i = 0; i < 20; i++) {
      now += 1000
      const keys = cacheKeys({ ...file, url: `https://a.example/${i}` }, head(i + 1))
      saved.push(keys.content)
      await cache.save(keys, file, blob(size))
    }
    const total = [...blobs.values()].reduce((n, b) => n + b.length, 0)
    expect(total).toBeLessThanOrEqual(MAX_BYTES)
    expect(blobs.has(saved[19]!)).toBe(true)
    expect(blobs.has(saved[0]!)).toBe(false)
  })

  it('does not keep a header too big to be worth it, or an empty one', async () => {
    const { store, metas } = memory()
    const cache = new HeaderCache(store, () => 1)
    await cache.save(cacheKeys(file, head(1)), file, blob(MAX_ENTRY_BYTES + 1))
    await cache.save(cacheKeys(file, head(1)), file, new Uint8Array(0))
    expect(metas.size).toBe(0)
  })

  it('treats a broken store, or none, as a miss', async () => {
    const broken: CacheStore = {
      meta: () => Promise.reject(new Error('closed')),
      getMeta: () => Promise.reject(new Error('closed')),
      getBlob: () => Promise.reject(new Error('closed')),
      put: () => Promise.reject(new Error('full')),
      remove: () => Promise.reject(new Error('closed')),
    }
    for (const cache of [new HeaderCache(broken), new HeaderCache(null)]) {
      const keys = cacheKeys(file, head(1))
      await expect(cache.save(keys, file, blob())).resolves.toBeUndefined()
      await expect(cache.lookup(keys, file)).resolves.toBeUndefined()
    }
  })
})
