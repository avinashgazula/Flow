import { builtInShelves, builtInTitles, defaultShelves, discoverSorts, newQuery, type BuiltInShelf, type DiscoverQuery, type ShelfConfig, type ShelfSource, type ShelfStyle } from './shelfDefaults'
import { movieGenres, tvGenres } from './genres'
import type { MediaType } from './tmdb/types'

/* Editing Home's shelf list, and moving it between devices as JSON. Pure, so it is tested without a browser.
   The JSON is the apps' own (FlowKit's ShelfConfig, as Swift writes it), so a list copied from the iPhone
   pastes here and the other way round: `{"builtIn":{"_0":"watchlist"}}` for a built-in row, `{"discover":{"_0":{…}}}`
   for a Discover shelf. The website keeps its list in a plainer shape (`source.kind`); only the clipboard is native. */

const builtInSet: ReadonlySet<string> = new Set(builtInShelves)
const styles: readonly ShelfStyle[] = ['poster', 'landscape', 'hero']
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const intList = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 40 && v.every((x) => isInt(x) && x > 0)
const maxShelves = 100

export const isBuiltInShelf = (v: unknown): v is BuiltInShelf => typeof v === 'string' && builtInSet.has(v)
export const isBuiltIn = (shelf: ShelfConfig) => shelf.source.kind === 'builtIn'

// MARK: Validators (the website's own shape: backups and the settings store)

/** A Discover query that TMDB will accept: known type and sort, whole-number ids, sane ranges. */
export function isDiscoverQuery(v: unknown): v is DiscoverQuery {
  if (!isObject(v)) return false
  const opt = (x: unknown, ok: (n: unknown) => boolean) => x === undefined || ok(x)
  return (
    (v.type === 'movie' || v.type === 'show') &&
    intList(v.genres) &&
    intList(v.excludedGenres) &&
    (discoverSorts as readonly unknown[]).includes(v.sort) &&
    intList(v.watchProviders) &&
    opt(v.yearFrom, (x) => isInt(x) && x >= 1870 && x <= 2200) &&
    opt(v.yearTo, (x) => isInt(x) && x >= 1870 && x <= 2200) &&
    opt(v.minRating, (x) => typeof x === 'number' && x >= 0 && x <= 10) &&
    opt(v.minVotes, (x) => isInt(x) && x >= 0) &&
    opt(v.originalLanguage, (x) => typeof x === 'string' && /^[a-z]{2,3}$/i.test(x)) &&
    opt(v.watchRegion, (x) => typeof x === 'string' && /^[A-Z]{2}$/.test(x)) &&
    opt(v.releasedFromDays, (x) => isInt(x) && Math.abs(x as number) <= 36500) &&
    opt(v.releasedToDays, (x) => isInt(x) && Math.abs(x as number) <= 36500)
  )
}

export function isShelfSource(v: unknown): v is ShelfSource {
  if (!isObject(v)) return false
  switch (v.kind) {
    case 'builtIn':
      return isBuiltInShelf(v.id)
    case 'discover':
      return isDiscoverQuery(v.query)
    case 'traktList':
      return typeof v.user === 'string' && v.user.length > 0 && typeof v.slug === 'string' && v.slug.length > 0
    case 'mdblist':
      return isInt(v.id)
    case 'mediaServerLibrary':
      return typeof v.serverID === 'string' && v.serverID.length > 0 && typeof v.libraryID === 'string' && v.libraryID.length > 0
    default:
      return false
  }
}

export const isShelfConfig = (v: unknown): v is ShelfConfig =>
  isObject(v) && typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 80 && typeof v.title === 'string' && v.title.trim().length > 0 && v.title.length <= 120 &&
  typeof v.enabled === 'boolean' && (styles as readonly unknown[]).includes(v.style) && isShelfSource(v.source)

/** What a backup may hold: a list of shelves with distinct ids. An empty list is allowed (Home then says so). */
export const isShelfList = (v: unknown): v is ShelfConfig[] => Array.isArray(v) && v.length <= maxShelves && v.every(isShelfConfig) && new Set(v.map((s: ShelfConfig) => s.id)).size === v.length

// MARK: Editing

/** The list after moving one shelf a place up (-1) or down (1). Past either end changes nothing. */
export function moveShelf(list: readonly ShelfConfig[], id: string, delta: -1 | 1): ShelfConfig[] {
  const next = [...list]
  const from = next.findIndex((s) => s.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= next.length) return next
  ;[next[from], next[to]] = [next[to]!, next[from]!]
  return next
}

export const setShelfEnabled = (list: readonly ShelfConfig[], id: string, enabled: boolean): ShelfConfig[] => list.map((s) => (s.id === id ? { ...s, enabled } : s))

/** Built-in rows the list doesn't have (they can be removed by an imported list), for "Add a Built-in Shelf". */
export const missingBuiltIns = (list: readonly ShelfConfig[]): BuiltInShelf[] => {
  const have = new Set(list.map((s) => (s.source.kind === 'builtIn' ? s.source.id : '')))
  return builtInShelves.filter((id) => !have.has(id))
}

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `shelf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)

export const addBuiltInShelf = (list: readonly ShelfConfig[], id: BuiltInShelf): ShelfConfig[] =>
  list.some((s) => s.source.kind === 'builtIn' && s.source.id === id) ? [...list] : [...list, { id, title: builtInTitles[id], source: { kind: 'builtIn', id }, enabled: true, style: 'poster' }]

export const addDiscoverShelf = (list: readonly ShelfConfig[], title: string, query: DiscoverQuery, id = uid()): ShelfConfig[] => [...list, { id, title: title.trim(), source: { kind: 'discover', query }, enabled: true, style: 'poster' }]

export const updateDiscoverShelf = (list: readonly ShelfConfig[], id: string, title: string, query: DiscoverQuery): ShelfConfig[] =>
  list.map((s) => (s.id === id && s.source.kind === 'discover' ? { ...s, title: title.trim(), source: { kind: 'discover', query } } : s))

/** Only shelves of your own can be removed; the built-in rows are switched off instead, as in the apps. */
export const removeShelf = (list: readonly ShelfConfig[], id: string): ShelfConfig[] => list.filter((s) => s.id !== id || s.source.kind === 'builtIn')

export const restoreDefaultShelves = (): ShelfConfig[] => defaultShelves.map((s) => ({ ...s, source: { ...s.source } as ShelfSource }))

export const isDefaultShelves = (list: readonly ShelfConfig[]) => JSON.stringify(list) === JSON.stringify(defaultShelves)

// MARK: What a row says about itself

const genreTable = (type: MediaType) => (type === 'movie' ? movieGenres : tvGenres)
const sortNames: Record<string, string> = {
  'popularity.desc': 'Popularity', 'vote_average.desc': 'Rating', 'primary_release_date.desc': 'Newest', 'primary_release_date.asc': 'Oldest', 'revenue.desc': 'Box Office', 'vote_count.desc': 'Most Votes',
}
export const sortLabel = (sort: string) => sortNames[sort] ?? sort

/** True when the query looks at titles that aren't out yet. */
export const targetsFuture = (q: DiscoverQuery, year = new Date().getFullYear()) => (q.releasedToDays ?? 0) > 0 || (q.releasedFromDays ?? 0) > 0 || (q.yearFrom ?? 0) > year

/** The line under a shelf's name in Settings: "Built-in", "Discover · Movies · Popularity · Comedy". */
export function shelfSubtitle(source: ShelfSource): string {
  switch (source.kind) {
    case 'builtIn':
      return 'Built-in'
    case 'discover': {
      const q = source.query
      const parts = [q.type === 'movie' ? 'Movies' : 'Shows', sortLabel(q.sort)]
      const genres = q.genres.map((g) => genreTable(q.type)[g]).filter(Boolean)
      if (genres.length) parts.push(genres.join(', '))
      if (targetsFuture(q)) parts.push('Upcoming')
      return `Discover · ${parts.join(' · ')}`
    }
    case 'traktList':
      return `Trakt · ${source.user}/${source.slug}`
    case 'mdblist':
      return `MDBList · #${source.id}`
    case 'mediaServerLibrary':
      return 'Media Server Library'
  }
}

// MARK: The apps' JSON

/** A shelf as Swift's Codable writes it. */
function toNativeSource(source: ShelfSource): unknown {
  switch (source.kind) {
    case 'builtIn':
      return { builtIn: { _0: source.id } }
    case 'discover':
      return { discover: { _0: Object.fromEntries(Object.entries(source.query).filter(([, v]) => v !== undefined)) } }
    case 'traktList':
      return { traktList: { user: source.user, slug: source.slug } }
    case 'mdblist':
      return { mdblist: { id: source.id } }
    case 'mediaServerLibrary':
      return { mediaServerLibrary: { serverID: source.serverID, libraryID: source.libraryID } }
  }
}

/** The list as the text copied to the clipboard: the apps' JSON, indented, keys in order. */
export const shelvesToJSON = (list: readonly ShelfConfig[]): string =>
  JSON.stringify(list.map((s) => ({ enabled: s.enabled, id: s.id, source: toNativeSource(s.source), style: s.style, title: s.title })), null, 2)

/** A query as the apps write it, with whatever it left out set to its default (Swift omits what is nil). */
function fromNativeQuery(raw: unknown): DiscoverQuery | undefined {
  if (!isObject(raw)) return undefined
  const q: DiscoverQuery = { ...newQuery(raw.type === 'show' ? 'show' : 'movie'), ...(raw as object) } as DiscoverQuery
  q.genres = Array.isArray(raw.genres) ? (raw.genres as number[]) : []
  q.excludedGenres = Array.isArray(raw.excludedGenres) ? (raw.excludedGenres as number[]) : []
  q.watchProviders = Array.isArray(raw.watchProviders) ? (raw.watchProviders as number[]) : []
  q.sort = (raw.sort ?? 'popularity.desc') as DiscoverQuery['sort']
  // Only the fields the model knows, so a newer app's extra keys never reach the settings.
  const clean: DiscoverQuery = { type: q.type, genres: q.genres, excludedGenres: q.excludedGenres, sort: q.sort, watchProviders: q.watchProviders }
  for (const k of ['yearFrom', 'yearTo', 'minRating', 'minVotes', 'originalLanguage', 'watchRegion', 'releasedFromDays', 'releasedToDays'] as const) if (raw[k] !== undefined && raw[k] !== null) (clean as any)[k] = raw[k]
  return isDiscoverQuery(clean) ? clean : undefined
}

function fromNativeSource(raw: unknown): ShelfSource | undefined {
  if (!isObject(raw)) return undefined
  // The website's own shape is accepted too, so a list saved from a backup pastes back.
  if (typeof raw.kind === 'string') return isShelfSource(raw) ? raw : undefined
  const unwrap = (key: string) => (isObject(raw[key]) ? (raw[key] as Record<string, unknown>) : undefined)
  const b = unwrap('builtIn')
  if (b) return isBuiltInShelf(b._0) ? { kind: 'builtIn', id: b._0 } : undefined
  const d = unwrap('discover')
  if (d) {
    const query = fromNativeQuery(d._0)
    return query ? { kind: 'discover', query } : undefined
  }
  const t = unwrap('traktList')
  if (t) return typeof t.user === 'string' && t.user && typeof t.slug === 'string' && t.slug ? { kind: 'traktList', user: t.user, slug: t.slug } : undefined
  const m = unwrap('mdblist')
  if (m) return isInt(m.id) ? { kind: 'mdblist', id: m.id } : undefined
  const s = unwrap('mediaServerLibrary')
  if (s) return typeof s.serverID === 'string' && s.serverID && typeof s.libraryID === 'string' && s.libraryID ? { kind: 'mediaServerLibrary', serverID: s.serverID, libraryID: s.libraryID } : undefined
  return undefined
}

export type ParsedShelves = { ok: true; shelves: ShelfConfig[]; skipped: number } | { ok: false; error: string }

/** Reads shelves pasted from the clipboard. Whatever can't be read is left out and counted, so one odd shelf
 *  never costs the rest; text that holds no shelf at all is an error that says what to do. */
export function parseShelves(text: string): ParsedShelves {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The clipboard doesn’t hold shelves. Copy them from Settings → Shelves in Flow, then try again.' }
  }
  // A whole setup export keeps the list under settings.shelves.
  if (isObject(data) && isObject(data.settings) && Array.isArray(data.settings.shelves)) data = data.settings.shelves
  if (!Array.isArray(data)) return { ok: false, error: 'The clipboard doesn’t hold shelves. Copy them from Settings → Shelves in Flow, then try again.' }
  const shelves: ShelfConfig[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const raw of data.slice(0, maxShelves)) {
    const source = isObject(raw) ? fromNativeSource(raw.source) : undefined
    if (!isObject(raw) || !source) {
      skipped++
      continue
    }
    const id = typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 80 ? raw.id : uid()
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 120) : source.kind === 'builtIn' ? builtInTitles[source.id] : ''
    if (!title || seen.has(id)) {
      skipped++
      continue
    }
    seen.add(id)
    shelves.push({ id, title, source, enabled: raw.enabled !== false, style: (styles as readonly unknown[]).includes(raw.style) ? (raw.style as ShelfStyle) : 'poster' })
  }
  skipped += Math.max(0, data.length - maxShelves)
  if (shelves.length === 0) return { ok: false, error: data.length === 0 ? 'That list is empty, so nothing was replaced.' : 'None of those shelves could be read. Copy them from Settings → Shelves in Flow, then try again.' }
  return { ok: true, shelves, skipped }
}
