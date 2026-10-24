/* What Flow Sync carries and how two copies are merged (docs/SYNC.md, Payload). Pure functions over the
   web's settings, so the rules are tested without a browser or a server.

   The record holds sections. The web understands five of them: keys (only the TMDB key), add-ons, servers,
   the stream proxy and playback. Everything else in the record (sign-in tokens, the other keys, sections a
   newer app added, fields a newer app added inside these) is carried through unchanged. */

import { proxyProblem } from '../sources/proxy'
import { defaultSettings, type AddonConfig, type ServerConfig, type Settings } from '../store/settings'
import { isSubtitleStyle, normaliseSubtitleStyle } from '../store/subtitleStyle'

export type SectionName = 'keys' | 'addons' | 'servers' | 'streamProxy' | 'playback'
export const webSections: readonly SectionName[] = ['keys', 'addons', 'servers', 'streamProxy', 'playback']

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

/** What the web owns of a section, built from its settings. Also what a section's snapshot is made of. */
export function localValue(name: SectionName, s: Settings): unknown {
  switch (name) {
    case 'keys':
      // The key baked into a build is the site's, not the person's: it isn't theirs to sync.
      return { tmdbAPIKey: s.tmdbKey && s.tmdbKey !== defaultSettings.tmdbKey ? s.tmdbKey : null }
    case 'addons':
      return s.addons.map((a) => ({ url: a.url, name: a.name, enabled: a.enabled }))
    case 'servers':
      return s.servers.map((v) => ({ id: v.id, kind: v.kind, name: v.name, url: v.url, token: v.token, ...(v.userId ? { userId: v.userId } : {}), ...(v.username ? { username: v.username } : {}), ...(v.machineId ? { machineId: v.machineId } : {}) }))
    case 'streamProxy':
      return { template: s.streamProxy.trim() }
    case 'playback':
      return { audioLanguages: s.audioLanguages, subtitleLanguages: s.subtitleLanguages, subtitleStyle: s.subtitleStyle }
  }
}

/** Whether a value is what a fresh install has, so a device that was never set up doesn't write it. */
function isEmpty(name: SectionName, value: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(localValue(name, defaultSettings))
}

const asKnownServer = (v: unknown): v is Json & { id: string; kind: ServerConfig['kind']; url: string } =>
  isObject(v) && isString(v.id) && isString(v.url) && (v.kind === 'jellyfin' || v.kind === 'emby' || v.kind === 'plex')
const asKnownAddon = (v: unknown): v is Json & { url: string; name: string } => isObject(v) && isString(v.url) && v.url.length > 0 && isString(v.name)

/** The section's data to write: the web's values laid over what the record already held, so fields the web
 *  doesn't know stay, on the section and on each add-on and server. Items the web can't represent stay at
 *  the end. */
export function overlay(name: SectionName, base: unknown, value: unknown): unknown {
  const before = isObject(base) ? base : {}
  switch (name) {
    case 'keys':
    case 'streamProxy':
      return { ...before, ...(value as Json) }
    case 'playback': {
      const v = value as Json
      return { ...before, ...v, subtitleStyle: { ...(isObject(before.subtitleStyle) ? before.subtitleStyle : {}), ...(v.subtitleStyle as Json) } }
    }
    case 'addons':
    case 'servers': {
      const old = Array.isArray(base) ? base : []
      const known = name === 'addons' ? asKnownAddon : asKnownServer
      const key = (item: Json) => (name === 'addons' ? item.url : item.id)
      const kept = new Map(old.filter(known).map((item) => [key(item), item]))
      const items = (value as Json[]).map((item) => ({ ...kept.get(key(item)), ...item }))
      return [...items, ...old.filter((item) => !known(item))]
    }
  }
}

/** The settings a section's data sets, or null when it can't be applied here. */
export function settingsPatch(name: SectionName, data: unknown, current: Settings): Partial<Settings> | null {
  switch (name) {
    case 'keys': {
      if (!isObject(data)) return null
      const key = isString(data.tmdbAPIKey) ? data.tmdbAPIKey.trim() : ''
      // A key from another device is a way in: a browser that hasn't been set up needn't ask again.
      return { tmdbKey: key || defaultSettings.tmdbKey, ...(key && !current.onboarded ? { onboarded: true } : {}) }
    }
    case 'addons': {
      if (!Array.isArray(data)) return null
      const have = new Map(current.addons.map((a) => [a.url, a]))
      const addons: AddonConfig[] = data.filter(asKnownAddon).map((a) => ({ ...(have.get(a.url)?.manifest ? { manifest: have.get(a.url)!.manifest } : {}), url: a.url, name: a.name, enabled: a.enabled !== false }))
      return { addons }
    }
    case 'servers': {
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
    }
    case 'streamProxy': {
      if (!isObject(data) || !isString(data.template)) return null
      // A template this page can't call (plain http from an https page) is left alone.
      return proxyProblem(data.template) === undefined ? { streamProxy: data.template.trim() } : null
    }
    case 'playback': {
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
    }
  }
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
    if (meta ? snapshot !== meta.snapshot : !isEmpty(name, value)) {
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
      if (!known[name] && readable(remote?.sections[name])) known[name] = { updatedAt: new Date(0).toISOString(), device: '', snapshot: JSON.stringify(localValue(name, settings)) }
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
      sections[name] = { ...theirs, updatedAt: mine.updatedAt, device: mine.device, data: overlay(name, theirs?.data, localValue(name, working)) }
    }
  }
  return { payload: { ...remote, v: 1, sections }, patch, metas: nextMetas }
}
