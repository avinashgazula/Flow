/* What Flow Sync carries and how two copies are merged (docs/SYNC.md, Payload). Pure functions over the
   web's settings, so the rules are tested without a browser or a server.

   The record holds sections. The web understands six of them: keys (the TMDB, MDBList, TVDB, RatingPosterDB, IntroDB,
   PublicMetaDB, Trakt and Simkl keys; the rest travel through), accounts (the Trakt sign-in; Simkl's travels through), add-ons, servers, the stream
   proxy and playback. Everything else in the record (the other keys, Simkl's token, sections a newer app added,
   fields a newer app added inside these) is carried through unchanged. */

import { proxyProblem } from '../sources/proxy'
import { defaultSettings, type AddonConfig, type ServerConfig, type Settings, type TraktToken } from '../store/settings'
import { isSubtitleStyle, normaliseSubtitleStyle } from '../store/subtitleStyle'

export type SectionName = 'keys' | 'accounts' | 'addons' | 'servers' | 'streamProxy' | 'playback'
export const webSections: readonly SectionName[] = ['keys', 'accounts', 'addons', 'servers', 'streamProxy', 'playback']

type Json = Record<string, unknown>

export interface Section {
  updatedAt: string
  device?: string
  data: unknown
  [extra: string]: unknown
}

export interface Payload {
  v: number
  sections: Record<string, Section>
  [extra: string]: unknown
}

/** What this device remembers about a section: when its value last changed (here or on another device),
 *  who changed it, and the value then, so the next change is noticed by comparing. */
export interface Meta {
  updatedAt: string
  device: string
  snapshot: string
}
export type Metas = Partial<Record<SectionName, Meta>>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
/** ISO 8601 to the second, as the document writes it: strict parsers on the Apple side want no fraction. */
export const stamp = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')
const time = (iso: unknown) => (isString(iso) ? Date.parse(iso) : NaN)

// MARK: Reading a record

/** The record's plaintext as a payload, or why it can't be used. A newer format is left alone entirely:
 *  writing over it would drop what this version doesn't know. */
export function parsePayload(text: string): { ok: true; payload: Payload } | { ok: false; newer: boolean } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, newer: false }
  }
  if (!isObject(data) || typeof data.v !== 'number' || !isObject(data.sections)) return { ok: false, newer: false }
  if (data.v > 1) return { ok: false, newer: true }
  return { ok: true, payload: data as Payload }
}

/** A section with a readable time and some data; anything else is ignored as if absent. */
function readable(section: unknown): Section | undefined {
  return isObject(section) && Number.isFinite(time(section.updatedAt)) && 'data' in section ? (section as Section) : undefined
}

// MARK: The web's view of each section

/* One entry in `defs` per section the web takes part in. To carry another field or section:
     - a field of an existing section (a new key in `keys`, say): add it to that entry's `value` (what this
       browser writes) and `patch` (what it does with one that arrives). `overlay` already keeps every other
       field of the section as the record had it, which is how introDBAPIKey, publicMetaDBAPIKey, the
       OpenSubtitles keys and the rest travel through without the web reading them;
     - a new section: add its name to SectionName and webSections, and an entry here. `accounts` is the
       example: its `overlay` replaces only `trakt` and leaves `simkl` as the record has it.
   Everything else (timestamps, merging, unknown sections) is shared. */
interface SectionDef {
  /** What this browser owns of the section, built from its settings. Also what the section's snapshot is made of. */
  value(s: Settings): unknown
  /** The section's data to write: this browser's value laid over what the record already held. `before` is
   *  this browser's value when it last synced the section (undefined if never), so a field it never had
   *  isn't written as a blank over one another device set. */
  overlay(base: unknown, value: unknown, before?: unknown): unknown
  /** The settings a section's data sets here, or null when it can't be applied. */
  patch(data: unknown, current: Settings): Partial<Settings> | null
  /** Joining a sync normally takes the record's section over this browser's. True when the record's data
   *  would throw away something this browser holds and the record has nothing to say about it. */
  keepOnJoin?(data: unknown, current: Settings): boolean
}

const asKnownServer = (v: unknown): v is Json & { id: string; kind: ServerConfig['kind']; url: string } =>
  isObject(v) && isString(v.id) && isString(v.url) && (v.kind === 'jellyfin' || v.kind === 'emby' || v.kind === 'plex')
const asKnownAddon = (v: unknown): v is Json & { url: string; name: string } => isObject(v) && isString(v.url) && v.url.length > 0 && isString(v.name)

/** The web's fields laid over an object the record already held: fields the web doesn't know stay. */
const overObject = (base: unknown, value: unknown) => ({ ...(isObject(base) ? base : {}), ...(value as Json) })

/** A list laid over the record's: each item keeps the fields the web doesn't know, and items the web can't
 *  represent (a server kind it has no client for) stay at the end. */
function overList(base: unknown, value: unknown, known: (v: unknown) => boolean, key: (item: Json) => unknown): unknown {
  const old = Array.isArray(base) ? base : []
  const kept = new Map(old.filter(known).map((item) => [key(item), item]))
  const items = (value as Json[]).map((item) => ({ ...kept.get(key(item)), ...item }))
  return [...items, ...old.filter((item) => !known(item))]
}

/** A Trakt token as the document writes it: the apps' field names, and a time to the second. */
function tokenOut(t: TraktToken): Json {
  const expires = time(t.expiresAt)
  return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Number.isFinite(expires) ? stamp(new Date(expires)) : null, redirectURI: t.redirectURI }
}

/** A Trakt token from the record, or undefined when it has no access token. */
export function readToken(v: unknown): TraktToken | undefined {
  if (!isObject(v) || !isString(v.accessToken) || !v.accessToken) return undefined
  return {
    accessToken: v.accessToken,
    refreshToken: isString(v.refreshToken) && v.refreshToken ? v.refreshToken : null,
    expiresAt: Number.isFinite(time(v.expiresAt)) ? (v.expiresAt as string) : null,
    redirectURI: isString(v.redirectURI) && v.redirectURI ? v.redirectURI : null,
  }
}

const defs: Record<SectionName, SectionDef> = {
  keys: {
    // The key baked into a build is the site's, not the person's: it isn't theirs to sync.
    // The MDBList, TVDB, RatingPosterDB and skip-segment keys go up only once this browser has one, so a browser
    // that never set them can't clear the apps' copy; clearing one on the website therefore stays local. The client ids are the other
    // way: written as null so a cleared one travels, except that the overlay below drops a null this browser
    // never had a value for.
    value: (s) => ({
      tmdbAPIKey: s.tmdbKey && s.tmdbKey !== defaultSettings.tmdbKey ? s.tmdbKey : null,
      ...(s.mdblistKey?.trim() ? { mdblistAPIKey: s.mdblistKey.trim() } : {}),
      ...(s.tvdbKey?.trim() ? { tvdbAPIKey: s.tvdbKey.trim() } : {}),
      ...(s.rpdbKey?.trim() ? { rpdbAPIKey: s.rpdbKey.trim() } : {}),
      ...(s.introDBKey ? { introDBAPIKey: s.introDBKey } : {}),
      ...(s.publicMetaDBKey ? { publicMetaDBAPIKey: s.publicMetaDBKey } : {}),
      traktClientID: s.traktClientID.trim() || null,
      simklClientID: s.simklClientID.trim() || null,
    }),
    overlay(base, value, before) {
      const mine = { ...(value as Json) }
      const was = isObject(before) ? before : {}
      // Only a client id this browser had and has since cleared is a deliberate blank.
      for (const field of ['traktClientID', 'simklClientID']) if (mine[field] === null && was[field] == null) delete mine[field]
      return overObject(base, mine)
    },
    patch(data, current) {
      if (!isObject(data)) return null
      const key = isString(data.tmdbAPIKey) ? data.tmdbAPIKey.trim() : ''
      const text = (v: unknown) => (isString(v) ? v.trim() : '')
      // A client id the record doesn't mention at all (an older app wrote it) is left as it is here.
      const clientID = (field: 'traktClientID' | 'simklClientID') => (field in data ? { [field]: text(data[field]) } : {})
      // A key from another device is a way in: a browser that hasn't been set up needn't ask again.
      return {
        tmdbKey: key || defaultSettings.tmdbKey,
        ...(text(data.mdblistAPIKey) ? { mdblistKey: text(data.mdblistAPIKey) } : {}),
        ...(text(data.tvdbAPIKey) ? { tvdbKey: text(data.tvdbAPIKey) } : {}),
        ...(text(data.rpdbAPIKey) ? { rpdbKey: text(data.rpdbAPIKey) } : {}),
        ...(text(data.introDBAPIKey) ? { introDBKey: text(data.introDBAPIKey) } : {}),
        ...(text(data.publicMetaDBAPIKey) ? { publicMetaDBKey: text(data.publicMetaDBAPIKey) } : {}),
        ...clientID('traktClientID'),
        ...clientID('simklClientID'),
        ...(key && !current.onboarded ? { onboarded: true } : {}),
      }
    },
  },
  accounts: {
    value: (s) => ({ trakt: s.traktAccount ? tokenOut(s.traktAccount) : null }),
    overlay(base, value) {
      const before = isObject(base) ? base : {}
      const trakt = (value as Json).trakt
      // Simkl, and anything else in the section, stays as the record had it; so do fields on the Trakt token the web doesn't know.
      return { ...before, trakt: trakt === null ? null : { ...(isObject(before.trakt) ? before.trakt : {}), ...(trakt as Json) } }
    },
    patch(data) {
      if (!isObject(data) || !('trakt' in data)) return null
      if (data.trakt === null) return { traktAccount: null }
      const token = readToken(data.trakt)
      return token ? { traktAccount: token } : null
    },
    // A sign-out recorded elsewhere is news; "no Trakt in the record" on joining is not.
    keepOnJoin: (data, current) => current.traktAccount !== null && !(isObject(data) && readToken(data.trakt)),
  },
  addons: {
    value: (s) => s.addons.map((a) => ({ url: a.url, name: a.name, enabled: a.enabled })),
    overlay: (base, value) => overList(base, value, asKnownAddon, (item) => item.url),
    patch(data, current) {
      if (!Array.isArray(data)) return null
      const have = new Map(current.addons.map((a) => [a.url, a]))
      const addons: AddonConfig[] = data.filter(asKnownAddon).map((a) => ({ ...(have.get(a.url)?.manifest ? { manifest: have.get(a.url)!.manifest } : {}), url: a.url, name: a.name, enabled: a.enabled !== false }))
      return { addons }
    },
  },
  servers: {
    value: (s) => s.servers.map((v) => ({ id: v.id, kind: v.kind, name: v.name, url: v.url, token: v.token, ...(v.userId ? { userId: v.userId } : {}), ...(v.username ? { username: v.username } : {}), ...(v.machineId ? { machineId: v.machineId } : {}) })),
    overlay: (base, value) => overList(base, value, asKnownServer, (item) => item.id),
    patch(data, current) {
      if (!Array.isArray(data)) return null
      const have = new Map(current.servers.map((v) => [v.id, v]))
      const servers: ServerConfig[] = data.filter(asKnownServer).map((v) => ({
        id: v.id,
        kind: v.kind,
        name: isString(v.name) ? v.name : v.url,
        url: v.url,
        token: isString(v.token) ? v.token : '',
        enabled: have.get(v.id)?.enabled ?? true,
        ...(isString(v.userId) && v.userId ? { userId: v.userId } : {}),
        ...(isString(v.username) && v.username ? { username: v.username } : {}),
        ...(isString(v.machineId) && v.machineId ? { machineId: v.machineId } : {}),
      }))
      return { servers }
    },
  },
  streamProxy: {
    value: (s) => ({ template: s.streamProxy.trim() }),
    overlay: overObject,
    patch(data, _current) {
      if (!isObject(data) || !isString(data.template)) return null
      // A template this page can't call (plain http from an https page) is left alone.
      return proxyProblem(data.template) === undefined ? { streamProxy: data.template.trim() } : null
    },
  },
  playback: {
    value: (s) => ({ audioLanguages: s.audioLanguages, subtitleLanguages: s.subtitleLanguages, subtitleStyle: s.subtitleStyle }),
    overlay(base, value) {
      const before = isObject(base) ? base : {}
      const v = value as Json
      return { ...before, ...v, subtitleStyle: { ...(isObject(before.subtitleStyle) ? before.subtitleStyle : {}), ...(v.subtitleStyle as Json) } }
    },
    patch(data, current) {
      if (!isObject(data)) return null
      const languages = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => isString(x) && x.length > 0) : undefined)
      const audio = languages(data.audioLanguages)
      const subtitles = languages(data.subtitleLanguages)
      const patch: Partial<Settings> = {
        ...(audio ? { audioLanguages: audio } : {}),
        ...(subtitles ? { subtitleLanguages: subtitles } : {}),
        ...(isSubtitleStyle(data.subtitleStyle) ? { subtitleStyle: normaliseSubtitleStyle({ ...current.subtitleStyle, ...(data.subtitleStyle as Json) }) } : {}),
      }
      return Object.keys(patch).length ? patch : null
    },
  },
}

/** What the web owns of a section, built from its settings. */
export const localValue = (name: SectionName, s: Settings): unknown => defs[name].value(s)
export const overlay = (name: SectionName, base: unknown, value: unknown, before?: unknown): unknown => defs[name].overlay(base, value, before)
export const settingsPatch = (name: SectionName, data: unknown, current: Settings): Partial<Settings> | null => defs[name].patch(data, current)

/** A snapshot without its null fields. A field added to a section later (the Trakt client id) reads as null
 *  on a device that never set it, which isn't a change from a snapshot made before the field existed. */
function withoutNulls(snapshot: string): string {
  try {
    const v: unknown = JSON.parse(snapshot)
    return isObject(v) ? JSON.stringify(Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null))) : snapshot
  } catch {
    return snapshot
  }
}

const parsed = (snapshot: string | undefined): unknown => {
  try {
    return snapshot === undefined ? undefined : JSON.parse(snapshot)
  } catch {
    return undefined
  }
}

/** Whether a value is what a fresh install has, so a device that was never set up doesn't write it. */
function isEmpty(name: SectionName, value: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(localValue(name, defaultSettings))
}


// MARK: Merging

/** Stamps every section whose value changed on this device since it was last seen. Called as soon as a
 *  setting changes, so the time is the time of the change, not of the upload three seconds later. */
export function detectChanges(settings: Settings, metas: Metas, now: Date, device: string): { metas: Metas; changed: boolean } {
  const next: Metas = { ...metas }
  let changed = false
  for (const name of webSections) {
    const value = localValue(name, settings)
    const snapshot = JSON.stringify(value)
    const meta = next[name]
    if (meta ? withoutNulls(snapshot) !== withoutNulls(meta.snapshot) : !isEmpty(name, value)) {
      // Times are to the second, so a change made right after the last one would tie with it and lose.
      // Mine is always at least a second after what it replaces.
      const after = meta ? time(meta.updatedAt) + 1000 : 0
      next[name] = { updatedAt: stamp(new Date(Math.max(now.getTime(), after))), device, snapshot }
      changed = true
    }
  }
  return { metas: next, changed }
}

export interface Merged {
  /** The record to write: the remote one with this device's newer sections laid in. */
  payload: Payload
  /** Settings to change here, from the remote sections that are newer. */
  patch: Partial<Settings>
  metas: Metas
}

/** Section by section, the newer `updatedAt` wins. A remote section newer than what this device has is
 *  applied (without bumping its time); a local one newer than the record's goes into the payload; equal
 *  times leave both alone. A device with no time for a section has never set it, so the record's wins
 *  when joining (`adopt`); otherwise a value it holds there is a change like any other. */
export function merge(remote: Payload | null, settings: Settings, metas: Metas, now: Date, device: string, adopt = false): Merged {
  // Joining a sync: what this browser had before is not a change to the shared copy, so a section the
  // record has is taken as it is. (Sections the record lacks still go up.)
  const known: Metas = { ...metas }
  if (adopt) {
    for (const name of webSections) {
      const theirs = readable(remote?.sections[name])
      if (!known[name] && theirs && !defs[name].keepOnJoin?.(theirs.data, settings)) known[name] = { updatedAt: new Date(0).toISOString(), device: '', snapshot: JSON.stringify(localValue(name, settings)) }
    }
  }
  const detected = detectChanges(settings, known, now, device)
  const nextMetas = detected.metas
  const sections: Record<string, Section> = { ...(remote?.sections ?? {}) }
  let working = settings
  let patch: Partial<Settings> = {}

  for (const name of webSections) {
    const mine = nextMetas[name]
    const theirs = readable(remote?.sections[name])
    if (theirs && (!mine || time(theirs.updatedAt) > time(mine.updatedAt))) {
      const change = settingsPatch(name, theirs.data, working)
      if (!change) continue
      working = { ...working, ...change }
      patch = { ...patch, ...change }
      nextMetas[name] = { updatedAt: theirs.updatedAt, device: isString(theirs.device) ? theirs.device : '', snapshot: JSON.stringify(localValue(name, working)) }
    } else if (mine && (!theirs || time(mine.updatedAt) > time(theirs.updatedAt))) {
      sections[name] = { ...theirs, updatedAt: mine.updatedAt, device: mine.device, data: overlay(name, theirs?.data, localValue(name, working), parsed(known[name]?.snapshot)) }
    }
  }
  return { payload: { ...remote, v: 1, sections }, patch, metas: nextMetas }
}
