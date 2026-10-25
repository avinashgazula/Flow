/* Remembers what reading a Matroska file's header and far end cost, so opening it again is quick, as the apps
   do (MatroskaHeaderCache). The remuxer's `exportHeader()` is one small blob: the SeekHead, Info and Tracks as
   read, the chapter list and the Cues. With it a visit skips the reads past the first bytes (an attachment to
   jump over, the index and the chapters at the far end), and a resume part-way in doesn't wait for the index
   before the first byte of film.

   Which file it is: its address (never stored, only a hash of it), its size and its ETag or Last-Modified when
   the server shows them. A debrid link changes on every request, so the same film also answers to a hash of its
   first 64 KB plus its size, as in the apps. A server that has changed the file under the same address shows a
   different ETag or date and finds nothing.

   Kept in IndexedDB in the worker, trimmed by age and size. Any failure (no IndexedDB, a private window, a full
   disk) is a miss: the cache only ever makes opening faster, never different. */

/** A record is forgotten this long after it was last used. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** All records together, and how many there can be. */
export const MAX_BYTES = 24 * 1024 * 1024
export const MAX_ENTRIES = 150
/** A header bigger than this isn't worth keeping (a file with thousands of chapters or index entries). */
export const MAX_ENTRY_BYTES = 2 * 1024 * 1024
/** Bumped whenever the blob's layout or what is read into it changes, so older records are never read. */
const VERSION = 1

export interface FileIdentity {
  url: string
  size: number
  etag?: string | null
  lastModified?: string | null
}

/** A 53-bit hash (cyrb53) of text or bytes, in hex: short keys, nothing to read the address back from. */
export function hash(input: string | Uint8Array, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < input.length; i++) {
    const c = typeof input === 'string' ? input.charCodeAt(i) : input[i]!
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

export interface CacheKeys {
  /** The file as the server describes it (address, size, ETag or date). */
  identity: string
  /** The file as its first bytes show it, for links that change. */
  content: string
}

/** The two names a file goes by. `head` is the file's first bytes, of which the first 64 KB count. */
export function cacheKeys(file: FileIdentity, head: Uint8Array): CacheKeys {
  const stamp = [file.url.split('#')[0], file.size, file.etag ?? '', file.lastModified ?? ''].join('\n')
  return {
    identity: `v${VERSION}-id-${hash(stamp)}-${file.size}`,
    content: `v${VERSION}-ct-${hash(head.subarray(0, 64 * 1024))}-${file.size}`,
  }
}

interface Meta {
  key: string
  bytes: number
  savedAt: number
  usedAt: number
  /** For an alias: the record it names. */
  alias?: string
  /** What the server said about the file when this was saved, to refuse a changed one. */
  etag?: string
  lastModified?: string
}

/** What to forget: the old, then the least recently used until the rest fits. Pure. */
export function planEviction(entries: readonly Pick<Meta, 'key' | 'bytes' | 'usedAt'>[], now: number, limits = { age: MAX_AGE_MS, bytes: MAX_BYTES, entries: MAX_ENTRIES }): string[] {
  type Entry = Pick<Meta, 'key' | 'bytes' | 'usedAt'>
  const gone: string[] = []
  const kept: Entry[] = []
  for (const entry of entries) {
    if (now - entry.usedAt > limits.age) gone.push(entry.key)
    else kept.push(entry)
  }
  kept.sort((a, b) => b.usedAt - a.usedAt)
  let bytes = 0
  kept.forEach((entry, index) => {
    bytes += entry.bytes
    if (index >= limits.entries || bytes > limits.bytes) {
      bytes -= entry.bytes
      gone.push(entry.key)
    }
  })
  return gone
}

/** Where records live. IndexedDB in the browser; a Map in the tests. */
export interface CacheStore {
  meta(): Promise<Meta[]>
  getMeta(key: string): Promise<Meta | undefined>
  getBlob(key: string): Promise<Uint8Array | undefined>
  put(meta: Meta, blob?: Uint8Array): Promise<void>
  remove(keys: string[]): Promise<void>
}

export class HeaderCache {
  constructor(
    private readonly store: CacheStore | null = idbStore(),
    private readonly now: () => number = Date.now,
  ) {}

  /** The blob saved for this file, or undefined. A hit counts as a use. */
  async lookup(keys: CacheKeys, file: FileIdentity): Promise<Uint8Array | undefined> {
    const store = this.store
    if (!store) return undefined
    try {
      const alias = await store.getMeta(keys.identity)
      const contentKey = alias?.alias ?? keys.content
      const meta = await store.getMeta(contentKey)
      if (!meta || meta.alias) return undefined
      // The same first bytes and size, but the server now shows a different version: not the file that was saved.
      if ((meta.etag && file.etag && meta.etag !== file.etag) || (meta.lastModified && file.lastModified && meta.lastModified !== file.lastModified)) return undefined
      const blob = await store.getBlob(contentKey)
      if (!blob) return undefined
      const now = this.now()
      await store.put({ ...meta, usedAt: now })
      if (!alias) await store.put({ key: keys.identity, bytes: 0, savedAt: now, usedAt: now, alias: contentKey })
      return blob
    } catch {
      return undefined
    }
  }

  /** Saves a blob under both names, then forgets what is too old or too much. */
  async save(keys: CacheKeys, file: FileIdentity, blob: Uint8Array): Promise<void> {
    const store = this.store
    if (!store || blob.length === 0 || blob.length > MAX_ENTRY_BYTES) return
    try {
      const now = this.now()
      await store.put({ key: keys.content, bytes: blob.length, savedAt: now, usedAt: now, etag: file.etag ?? undefined, lastModified: file.lastModified ?? undefined }, blob)
      await store.put({ key: keys.identity, bytes: 0, savedAt: now, usedAt: now, alias: keys.content })
      const all = await store.meta()
      const records = all.filter((m) => !m.alias)
      const gone = new Set(planEviction(records, now))
      const alive = new Set(records.filter((m) => !gone.has(m.key)).map((m) => m.key))
      // A name outlives neither the record it points at nor the age limit.
      const stale = all.filter((m) => m.alias && (!alive.has(m.alias) || now - m.usedAt > MAX_AGE_MS)).map((m) => m.key)
      if (gone.size || stale.length) await store.remove([...gone, ...stale])
    } catch {
      // A full disk or a closed database: the next visit reads the file's header again.
    }
  }
}

// MARK: IndexedDB

const DB = 'flow-mkv'

function idbStore(): CacheStore | null {
  if (typeof indexedDB === 'undefined') return null
  let opened: Promise<IDBDatabase> | null = null
  const open = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('meta', { keyPath: 'key' })
        request.result.createObjectStore('blobs')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }).catch((error) => {
      opened = null
      throw error
    }))
  const run = async <T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> => {
    const db = await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      const request = work(tx)
      tx.oncomplete = () => resolve(request ? request.result : undefined)
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  }
  return {
    meta: async () => (await run<Meta[]>(['meta'], 'readonly', (tx) => tx.objectStore('meta').getAll())) ?? [],
    getMeta: (key) => run<Meta | undefined>(['meta'], 'readonly', (tx) => tx.objectStore('meta').get(key)),
    getBlob: async (key) => {
      const value = await run<Uint8Array | undefined>(['blobs'], 'readonly', (tx) => tx.objectStore('blobs').get(key))
      return value ? new Uint8Array(value) : undefined
    },
    put: async (meta, blob) => {
      await run(['meta', 'blobs'], 'readwrite', (tx) => {
        if (blob) tx.objectStore('blobs').put(blob, meta.key)
        tx.objectStore('meta').put(meta)
      })
    },
    remove: async (keys) => {
      await run(['meta', 'blobs'], 'readwrite', (tx) => {
        for (const key of keys) {
          tx.objectStore('meta').delete(key)
          tx.objectStore('blobs').delete(key)
        }
      })
    },
  }
}
