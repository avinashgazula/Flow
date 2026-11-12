/* What a Marquee Account stores for the library, and how two copies are merged (docs/SYNC.md, Marquee Accounts). Pure
   functions over plain JSON, so the rules are tested without a browser or a server, and the apps can follow the same
   shapes.

   A library is five kinds of document, each stored as its own encrypted value:
     lists      watchlist, favourites, ratings, rewatches, shuffle memory, the watchlist's order
     progress   resume points
     sources    the release each title last played from (a description, never a link)
     history-…  plays, one value per month (a busy month is split by size)
     items-…    the small display card for each title, in 16 shards by TMDB id

   Entries are kept as the objects they arrived as, so a field a newer version adds rides along untouched. */

type Json = Record<string, unknown>
export interface Episode {
  season: number
  episode: number
}
export interface Card {
  title: string
  year?: number
  date?: string
  poster?: string
  backdrop?: string
  rating?: number
  genres?: number[]
  originalLanguage?: string
}
export interface ListEntry extends Json {
  key: string
  addedAt: string
}
export interface RatingEntry extends Json {
  value: number
  ratedAt: string
}
export interface RewatchEntry extends Json {
  key: string
  startedAt: string
  updatedAt?: string
  watched: Episode[]
}
export interface ShuffleEntry extends Json {
  key: string
  played: Episode[]
}
export interface OrderEntry {
  keys: string[]
  updatedAt: string
}
export interface ProgressEntry extends Json {
  key: string
  episode?: Episode
  percent: number
  positionSeconds?: number
  durationSeconds?: number
  updatedAt: string
}
export interface HistoryEntry extends Json {
  key: string
  episode?: Episode
  watchedAt: string
  runtime?: number
}
export interface SourceEntry extends Json {
  providerID: string
  providerName?: string
  filename?: string
  bingeGroup?: string
  releaseGroup?: string
  resolution: number
  quality: string
  hdr: string[]
  date: string
}

/** What a library is, all of it, as the web holds it between syncs. */
export interface WireState {
  watchlist: ListEntry[]
  favourites: ListEntry[]
  ratings: Record<string, RatingEntry>
  rewatches: RewatchEntry[]
  shuffle: ShuffleEntry[]
  order: OrderEntry | null
  progress: ProgressEntry[]
  sources: Record<string, SourceEntry>
  history: HistoryEntry[]
  /** Removals, as "<list>:<id>" to when. Lists: watchlist, favourites, ratings, rewatches, progress, history, sources. */
  removed: Record<string, string>
  items: Record<string, Card>
  /** Fields a newer version added to a document, by document name, carried through. */
  extra: Record<string, Json>
}

export const emptyState = (): WireState => ({ watchlist: [], favourites: [], ratings: {}, rewatches: [], shuffle: [], order: null, progress: [], sources: {}, history: [], removed: {}, items: {}, extra: {} })

/** How long a removal is remembered. */
export const tombstoneDays = 90
/** Plaintext characters a value may hold before a history month is split: base64 and the tag keep it under the Worker's 256 KB. */
export const pageLimit = 160_000
export const maxProgress = 500
export const maxSources = 300

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isEpisode = (v: unknown): v is Episode => isObject(v) && Number.isInteger(v.season) && Number.isInteger(v.episode)
export const at = (stamp: unknown): number => {
  const t = isString(stamp) ? Date.parse(stamp) : NaN
  return Number.isFinite(t) ? t : 0
}
/** ISO 8601 UTC with milliseconds, as the apps' encoder writes it. */
export const iso = (ms: number) => new Date(ms).toISOString()

/** JSON with keys in sorted order, so equal values are equal text on every device. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

// MARK: Identities

/** "S03E07", as the apps' EpisodeRef.code. */
export const episodeCode = (e: Episode) => `S${String(e.season).padStart(2, '0')}E${String(e.episode).padStart(2, '0')}`
export const progressId = (e: { key: string; episode?: Episode }) => (e.episode ? `${e.key}:${episodeCode(e.episode)}` : e.key)
/** The apps' HistoryEntry.id: the title, the episode or "-", and the whole second it was watched. */
export const historyId = (e: HistoryEntry) => `${e.key}:${e.episode ? episodeCode(e.episode) : '-'}:${Math.floor(at(e.watchedAt) / 1000)}`
const historyMonth = (watchedAt: string) => iso(at(watchedAt)).slice(0, 7)
/** The month a history id belongs to, from the second at its end. */
const monthOfId = (id: string) => {
  const seconds = Number(id.slice(id.lastIndexOf(':') + 1))
  return Number.isFinite(seconds) ? iso(seconds * 1000).slice(0, 7) : '1970-01'
}
export const removedKey = (list: string, id: string) => `${list}:${id}`

// MARK: Merging

/** One entry per id, the newest by `when`; a tie keeps the one whose text sorts last, so every device picks the same. */
function newest<T extends Json>(entries: T[], id: (e: T) => string, when: (e: T) => number): T[] {
  const best = new Map<string, T>()
  for (const e of entries) {
    const held = best.get(id(e))
    if (!held || when(e) > when(held) || (when(e) === when(held) && canonical(e) > canonical(held))) best.set(id(e), e)
  }
  return [...best.values()].sort((a, b) => when(b) - when(a) || (id(a) < id(b) ? -1 : 1))
}

/** The later of two removal times for each entry. */
export function mergeRemoved(a: Record<string, string>, b: Record<string, string>): Record<string, string> {
  const out = { ...a }
  for (const [k, t] of Object.entries(b)) if (!(k in out) || at(t) > at(out[k])) out[k] = t
  return out
}

/** Whether `id` on `list` was removed at or after `when`: an entry made after its removal is a new one and stays. */
const gone = (removed: Record<string, string>, list: string, id: string, when: number) => list + ':' + id in removed && at(removed[list + ':' + id]) >= when

/** Removals older than 90 days are forgotten. */
export function pruneRemoved(removed: Record<string, string>, now: number): Record<string, string> {
  return Object.fromEntries(Object.entries(removed).filter(([, t]) => now - at(t) < tombstoneDays * 86_400_000))
}

const mergeEpisodes = (a: Episode[], b: Episode[]): Episode[] => {
  const seen = new Map<string, Episode>()
  for (const e of [...a, ...b]) if (isEpisode(e) && !seen.has(episodeCode(e))) seen.set(episodeCode(e), e)
  return [...seen.values()].sort((x, y) => x.season - y.season || x.episode - y.episode)
}

/** Two rewatches of one show: the same round (same start) unions the episodes ticked; otherwise the later start wins. */
function mergeRewatch(a: RewatchEntry, b: RewatchEntry): RewatchEntry {
  if (at(a.startedAt) !== at(b.startedAt)) return at(a.startedAt) > at(b.startedAt) ? a : b
  const later = at(b.updatedAt ?? b.startedAt) > at(a.updatedAt ?? a.startedAt) ? b : a
  const updatedAt = at(a.updatedAt) >= at(b.updatedAt) ? a.updatedAt : b.updatedAt
  return { ...later, watched: mergeEpisodes(a.watched, b.watched), ...(updatedAt ? { updatedAt } : {}) }
}

/** `local` and `remote` merged, order of arguments irrelevant except that a card both have is kept as `local` has it. */
export function mergeState(local: WireState, remote: WireState, now: number): WireState {
  const removed = pruneRemoved(mergeRemoved(local.removed, remote.removed), now)
  const keep = <T extends Json>(entries: T[], list: string, id: (e: T) => string, when: (e: T) => number) => newest(entries, id, when).filter((e) => !gone(removed, list, id(e), when(e)))

  const ratings: Record<string, RatingEntry> = {}
  for (const [key, entry] of Object.entries({ ...remote.ratings, ...local.ratings })) {
    const other = (entry === local.ratings[key] ? remote : local).ratings[key]
    const best = other && (at(other.ratedAt) > at(entry.ratedAt) || (at(other.ratedAt) === at(entry.ratedAt) && canonical(other) > canonical(entry))) ? other : entry
    if (!gone(removed, 'ratings', key, at(best.ratedAt))) ratings[key] = best
  }

  const rewatchByKey = new Map<string, RewatchEntry>()
  for (const e of [...local.rewatches, ...remote.rewatches]) {
    const held = rewatchByKey.get(e.key)
    rewatchByKey.set(e.key, held ? mergeRewatch(held, e) : e)
  }
  const rewatches = [...rewatchByKey.values()].filter((e) => !gone(removed, 'rewatches', e.key, Math.max(at(e.startedAt), at(e.updatedAt)))).sort((a, b) => (a.key < b.key ? -1 : 1))

  const shuffleByKey = new Map<string, ShuffleEntry>()
  for (const e of [...local.shuffle, ...remote.shuffle]) {
    const held = shuffleByKey.get(e.key)
    shuffleByKey.set(e.key, held ? { ...held, ...e, played: mergeEpisodes(held.played, e.played) } : e)
  }

  const sources: Record<string, SourceEntry> = {}
  const sourceEntries = newest([...Object.entries(local.sources), ...Object.entries(remote.sources)].map(([key, s]) => ({ ...s, key })), (e) => e.key as string, (e) => at(e.date)).filter((e) => !gone(removed, 'sources', e.key as string, at(e.date)))
  for (const { key, ...entry } of sourceEntries.slice(0, maxSources)) sources[key as string] = entry as SourceEntry

  const order = [local.order, remote.order].filter((o): o is OrderEntry => o !== null).sort((a, b) => at(b.updatedAt) - at(a.updatedAt) || (canonical(b) > canonical(a) ? 1 : -1))[0] ?? null

  const merged: WireState = {
    watchlist: keep(local.watchlist.concat(remote.watchlist), 'watchlist', (e) => e.key, (e) => at(e.addedAt)),
    favourites: keep(local.favourites.concat(remote.favourites), 'favourites', (e) => e.key, (e) => at(e.addedAt)),
    ratings,
    rewatches,
    shuffle: [...shuffleByKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
    order,
    progress: keep(local.progress.concat(remote.progress), 'progress', progressId, (e) => at(e.updatedAt)).slice(0, maxProgress),
    sources,
    history: keep(local.history.concat(remote.history), 'history', historyId, (e) => at(e.watchedAt)),
    removed,
    items: { ...remote.items, ...local.items },
    extra: { ...remote.extra, ...local.extra },
  }
  merged.items = pruneItems(merged)
  return merged
}

/** Every title key anything in the library mentions. */
export function referencedKeys(s: WireState): Set<string> {
  return new Set([...s.watchlist, ...s.favourites, ...s.rewatches, ...s.shuffle, ...s.progress, ...s.history].map((e) => e.key).concat(Object.keys(s.ratings), Object.keys(s.sources)))
}

/** Cards for titles the library no longer mentions are dropped. */
const pruneItems = (s: WireState): Record<string, Card> => {
  const used = referencedKeys(s)
  return Object.fromEntries(Object.entries(s.items).filter(([k]) => used.has(k)))
}

// MARK: Documents

const documents = { lists: 1, progress: 1, sources: 1 } as const
export const listsSection = 'lists'
export const progressSection = 'progress'
export const sourcesSection = 'sources'
export const settingsSection = 'settings'
export const isHistorySection = (name: string) => /^history-\d{4}-\d{2}(-\d+)?$/.test(name)
export const isItemsSection = (name: string) => /^items-[0-9a-f]$/.test(name)
/** The library's sections, as named in the account's list of values (settings is the web's other one). */
export const isLibrarySection = (name: string) => name === listsSection || name === progressSection || name === sourcesSection || isHistorySection(name) || isItemsSection(name)

/** Which items shard holds a title's card: its TMDB id modulo 16, as one hex digit. */
export const itemsShard = (key: string) => `items-${(Number(key.slice(key.indexOf(':') + 1)) % 16 || 0).toString(16)}`

const versionOf = (text: string): Json | 'newer' | null => {
  try {
    const data: unknown = JSON.parse(text)
    if (!isObject(data) || typeof data.v !== 'number') return null
    return data.v > 1 ? 'newer' : data
  } catch {
    return null
  }
}
const list = <T>(v: unknown, ok: (x: unknown) => x is T): T[] => (Array.isArray(v) ? v.filter(ok) : [])
const removedOf = (v: unknown): Record<string, string> => (isObject(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => isString(e[1]))) : {})
const rest = (data: Json, known: string[]): Json => Object.fromEntries(Object.entries(data).filter(([k]) => !known.includes(k) && k !== 'v'))
const extraOf = (name: string, data: Json, known: string[]): Record<string, Json> => {
  const extra = rest(data, known)
  return Object.keys(extra).length ? { [name]: extra } : {}
}
const hasKey = (x: unknown): x is Json & { key: string } => isObject(x) && isString(x.key) && /^(movie|show):\d+$/.test(x.key)

export type Parsed<T> = { ok: true; value: T } | { ok: false; newer: boolean }

export function parseLists(text: string): Parsed<Partial<WireState>> {
  const data = versionOf(text)
  if (!data || data === 'newer') return { ok: false, newer: data === 'newer' }
  const dated = (x: unknown, field: string): x is Json & { key: string } => hasKey(x) && at(x[field]) > 0
  const ratings = isObject(data.ratings) ? Object.fromEntries(Object.entries(data.ratings).filter(([k, r]) => /^(movie|show):\d+$/.test(k) && isObject(r) && typeof r.value === 'number' && at(r.ratedAt) > 0)) : {}
  const order = isObject(data.order) && Array.isArray(data.order.keys) && at(data.order.updatedAt) > 0 ? { keys: data.order.keys.filter(isString), updatedAt: data.order.updatedAt as string } : null
  const fixEpisodes = <T extends Json>(e: T, field: string): T => ({ ...e, [field]: Array.isArray(e[field]) ? (e[field] as unknown[]).filter(isEpisode) : [] })
  return {
    ok: true,
    value: {
      watchlist: list(data.watchlist, (x): x is ListEntry => dated(x, 'addedAt')),
      favourites: list(data.favourites, (x): x is ListEntry => dated(x, 'addedAt')),
      ratings: ratings as Record<string, RatingEntry>,
      rewatches: list(data.rewatches, (x): x is RewatchEntry => dated(x, 'startedAt')).map((e) => fixEpisodes(e, 'watched')),
      shuffle: list(data.shuffle, (x): x is ShuffleEntry => hasKey(x)).map((e) => fixEpisodes(e, 'played')),
      order,
      removed: removedOf(data.removed),
      extra: extraOf(listsSection, data, ['watchlist', 'favourites', 'ratings', 'rewatches', 'shuffle', 'order', 'removed']),
    },
  }
}

export function parseProgress(text: string): Parsed<Partial<WireState>> {
  const data = versionOf(text)
  if (!data || data === 'newer') return { ok: false, newer: data === 'newer' }
  const entries = list(data.entries, (x): x is ProgressEntry => hasKey(x) && at(x.updatedAt) > 0 && typeof x.percent === 'number' && (x.episode === undefined || isEpisode(x.episode)))
  return { ok: true, value: { progress: entries, removed: removedOf(data.removed), extra: extraOf(progressSection, data, ['entries', 'removed']) } }
}

export function parseSources(text: string): Parsed<Partial<WireState>> {
  const data = versionOf(text)
  if (!data || data === 'newer') return { ok: false, newer: data === 'newer' }
  const entries = isObject(data.entries) ? Object.fromEntries(Object.entries(data.entries).filter(([k, s]) => /^(movie|show):\d+$/.test(k) && isObject(s) && isString(s.providerID) && at(s.date) > 0)) : {}
  return { ok: true, value: { sources: entries as Record<string, SourceEntry>, removed: removedOf(data.removed), extra: extraOf(sourcesSection, data, ['entries', 'removed']) } }
}

export function parseHistory(text: string): Parsed<Partial<WireState>> {
  const data = versionOf(text)
  if (!data || data === 'newer') return { ok: false, newer: data === 'newer' }
  const entries = list(data.entries, (x): x is HistoryEntry => hasKey(x) && at(x.watchedAt) > 0 && (x.episode === undefined || isEpisode(x.episode)))
  return { ok: true, value: { history: entries, removed: removedOf(data.removed) } }
}

export function parseItems(text: string): Parsed<Record<string, Card>> {
  const data = versionOf(text)
  if (!data || data === 'newer') return { ok: false, newer: data === 'newer' }
  const cards = isObject(data.items) ? Object.fromEntries(Object.entries(data.items).filter(([k, c]) => /^(movie|show):\d+$/.test(k) && isObject(c) && isString(c.title))) : {}
  return { ok: true, value: cards as unknown as Record<string, Card> }
}

/** Builds a state from the plaintexts of the library's values, by section name. A value that can't be read is
 *  reported by name and left out. */
export function readState(plain: Record<string, string>): { state: WireState; unreadable: string[]; newer: string[] } {
  const state = emptyState()
  const unreadable: string[] = []
  const newer: string[] = []
  for (const [name, text] of Object.entries(plain)) {
    const parsed = name === listsSection ? parseLists(text) : name === progressSection ? parseProgress(text) : name === sourcesSection ? parseSources(text) : isHistorySection(name) ? parseHistory(text) : isItemsSection(name) ? parseItems(text) : null
    if (!parsed) continue
    if (!parsed.ok) {
      ;(parsed.newer ? newer : unreadable).push(name)
      continue
    }
    if (isItemsSection(name)) {
      Object.assign(state.items, parsed.value)
      continue
    }
    const v = parsed.value as Partial<WireState>
    Object.assign(state, { ...Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'removed' && k !== 'extra' && k !== 'history')) })
    if (v.history) state.history.push(...v.history)
    state.removed = mergeRemoved(state.removed, v.removed ?? {})
    Object.assign(state.extra, v.extra ?? {})
  }
  return { state, unreadable, newer }
}

// MARK: Writing

const sortedRemoved = (removed: Record<string, string>, lists: string[]) => Object.fromEntries(Object.entries(removed).filter(([k]) => lists.some((l) => k.startsWith(`${l}:`))))
const withExtra = (s: WireState, name: keyof typeof documents, body: Json) => ({ ...(s.extra[name] ?? {}), v: documents[name], ...body })

/** The library's values as text, by section name. Empty sections are left out, so a new account writes only what it has. */
export function writeState(s: WireState, now: number): Record<string, string> {
  const out: Record<string, string> = {}
  const removed = pruneRemoved(s.removed, now)
  const listsRemoved = sortedRemoved(removed, ['watchlist', 'favourites', 'ratings', 'rewatches'])
  const lists = withExtra(s, 'lists', { watchlist: s.watchlist, favourites: s.favourites, ratings: s.ratings, rewatches: s.rewatches, shuffle: s.shuffle, order: s.order, removed: listsRemoved })
  const listsEmpty = !s.watchlist.length && !s.favourites.length && !Object.keys(s.ratings).length && !s.rewatches.length && !s.shuffle.length && !s.order && !Object.keys(listsRemoved).length
  if (!listsEmpty) out[listsSection] = canonical(lists)
  const progressRemoved = sortedRemoved(removed, ['progress'])
  if (s.progress.length || Object.keys(progressRemoved).length) out[progressSection] = canonical(withExtra(s, 'progress', { entries: s.progress.slice(0, maxProgress), removed: progressRemoved }))
  const sourcesRemoved = sortedRemoved(removed, ['sources'])
  if (Object.keys(s.sources).length || Object.keys(sourcesRemoved).length) out[sourcesSection] = canonical(withExtra(s, 'sources', { entries: s.sources, removed: sourcesRemoved }))
  Object.assign(out, splitHistory(s.history, sortedRemoved(removed, ['history'])))
  const shards: Record<string, Record<string, Card>> = {}
  for (const [key, card] of Object.entries(pruneItems(s))) (shards[itemsShard(key)] ??= {})[key] = card
  for (const [name, items] of Object.entries(shards)) out[name] = canonical({ v: 1, items })
  return out
}

/** History by month, a month split into numbered pages when it would pass the size limit. Entries are ordered by id, so
 *  the same history is the same text everywhere. Removals go with their month. */
export function splitHistory(entries: HistoryEntry[], removed: Record<string, string>, limit = pageLimit): Record<string, string> {
  const months = new Map<string, { entries: HistoryEntry[]; removed: Record<string, string> }>()
  const month = (m: string) => months.get(m) ?? months.set(m, { entries: [], removed: {} }).get(m)!
  for (const e of entries) month(historyMonth(e.watchedAt)).entries.push(e)
  for (const [k, t] of Object.entries(removed)) month(monthOfId(k.slice('history:'.length))).removed[k] = t
  const out: Record<string, string> = {}
  for (const [m, { entries: list, removed: gone }] of months) {
    const sorted = [...list].sort((a, b) => (historyId(a) < historyId(b) ? -1 : 1))
    const pages: HistoryEntry[][] = [[]]
    let size = canonical(gone).length + 40
    for (const e of sorted) {
      const length = canonical(e).length + 1
      if (size + length > limit && pages[pages.length - 1]!.length) {
        pages.push([])
        size = 40
      }
      pages[pages.length - 1]!.push(e)
      size += length
    }
    pages.forEach((page, i) => (out[`history-${m}${i ? `-${i + 1}` : ''}`] = canonical({ v: 1, month: m, entries: page, ...(i === 0 ? { removed: gone } : {}) })))
  }
  return out
}

/** Whether two sets of values say the same thing, whatever order their keys came in. */
export const sameValues = (a: Record<string, string>, b: Record<string, string>) => {
  const names = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const n of names) {
    if (!(n in a) || !(n in b)) return false
    try {
      if (canonical(JSON.parse(a[n]!)) !== canonical(JSON.parse(b[n]!))) return false
    } catch {
      return false
    }
  }
  return true
}
