/* Flow Sync on the web: when to look at the record, when to write it, and what to say when it fails. The
   rules for merging are in payload.ts and the cryptography in crypto.ts; this file is the clock and the
   network. It loads on its own (a dynamic import from main.tsx, and from Settings), so the first page
   never carries it. */

import { settingsStore } from '../store/settings'
import { clearConfig, loadConfig, saveConfig, type SyncConfig } from './config'
import { decrypt, deriveKeys, encodeKey, encrypt, makeKeyBytes, parseKey, type SyncKeys } from './crypto'
import { detectChanges, merge, parsePayload, stamp, type Payload } from './payload'
import { webLink, type Pairing } from './pairing'

/** About three seconds after the last change, so typing a key is one write and not one per character. */
export const pushDelay = 3000
/** While the page is open, look at the record this often. */
export const pullEvery = 5 * 60_000
/** Writes tried again after another device got in first. */
const maxRetries = 3

export interface SyncStatus {
  phase: 'off' | 'idle' | 'syncing' | 'error'
  /** ISO 8601 time of the last sync that finished. */
  lastSyncAt?: string
  /** What went wrong, in words, with what to do about it. */
  error?: string
}

/** A failure whose message is fit to show as it is. */
class Problem extends Error {}

const words = {
  unreachable: 'Couldn’t reach your sync server. Check its address and token, and that this site is listed in ALLOWED_ORIGINS.',
  token: 'Your sync server didn’t accept the token. Check that it matches the Worker’s TOKEN.',
  mismatch: 'This sync key doesn’t match.',
  noKV: 'Sync needs a KV namespace on your Worker. See web/proxy/README.md.',
  tooBig: 'Your settings are too big to sync. A record can hold 256 KB.',
  erased: 'Nothing is stored for this sync key any more. If you erased it on another device, turn sync off here, then on again.',
  nothingYet: 'Nothing is stored for that sync key yet. On your other device, check that sync is on, then try again.',
  unreadable: 'Couldn’t read the synced data. Check that the sync key here matches your other devices.',
  newer: 'Your other devices use a newer version of Flow Sync. Update Flow here to keep syncing.',
  busy: 'Another device kept changing your settings while Flow was syncing. Try Sync Now again.',
}

// MARK: Status

let status: SyncStatus = loadConfig() ? { phase: 'idle', ...lastOf(loadConfig()) } : { phase: 'off' }
const listeners = new Set<() => void>()

function lastOf(config: SyncConfig | null) {
  return config?.lastSyncAt ? { lastSyncAt: config.lastSyncAt } : {}
}

function setStatus(next: SyncStatus) {
  status = next
  listeners.forEach((l) => l())
}

/** What Settings shows. A store in the shape `useSyncExternalStore` takes. */
export const syncStatus = {
  get: () => status,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}

// MARK: The network

const deviceName = () => {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return `Web (${/Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'})`
}

async function call(config: SyncConfig, keys: SyncKeys, method: 'GET' | 'PUT' | 'DELETE', body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${keys.auth}` }
  if (config.token) headers['X-Flow-Token'] = config.token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    return await fetch(`${config.server}/sync/${keys.id}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
  } catch {
    throw new Problem(words.unreachable)
  }
}

/** The sentence for an answer that isn't one of the expected ones. */
function problemFor(res: Response, during: 'join' | 'sync'): Problem {
  switch (res.status) {
    case 401:
      return new Problem(words.token)
    case 403:
      return new Problem(words.mismatch)
    case 404:
      return new Problem(during === 'join' ? words.nothingYet : words.erased)
    case 413:
      return new Problem(words.tooBig)
    case 501:
      return new Problem(words.noKV)
    default:
      return new Problem(res.status >= 500 ? `Your sync server had a problem (${res.status}). Try again in a moment.` : `Your sync server answered something Flow didn’t expect (${res.status}). Check its address.`)
  }
}

interface Remote {
  /** The revision the next write is based on; 0 when there is no record. */
  rev: number
  payload: Payload | null
  /** The record as JSON text, to tell whether a write would change anything. */
  text: string | null
}

async function open(keys: SyncKeys, body: { rev?: unknown; blob?: unknown }): Promise<Remote> {
  if (typeof body.rev !== 'number' || typeof body.blob !== 'string') throw new Problem(words.unreadable)
  let plain: string
  try {
    plain = await decrypt(keys, body.blob)
  } catch {
    throw new Problem(words.unreadable)
  }
  const parsed = parsePayload(plain)
  if (!parsed.ok) throw new Problem(parsed.newer ? words.newer : words.unreadable)
  return { rev: body.rev, payload: parsed.payload, text: JSON.stringify(parsed.payload) }
}

// MARK: One sync

/** What the last pull or push left: lets a change made a moment later write without reading again. */
let known: Remote | undefined

interface Options {
  /** Read the record again, rather than build on the last one seen. */
  fresh: boolean
  /** Start a record when there is none (turning sync on). Otherwise a missing record is an error. */
  create?: boolean
  /** Joining: what this browser held before is taken from the record, section by section. */
  adopt?: boolean
}

/** Reads the record, merges it with this browser's settings, applies what is newer there, and writes what
 *  is newer here, again on top of whatever another device wrote meanwhile (up to three times). */
async function cycle(options: Options): Promise<void> {
  const start = loadConfig()
  const bytes = start && parseKey(start.key)
  if (!start || !bytes) return
  const keys = await deriveKeys(bytes)

  let remote: Remote
  if (!options.fresh && known) remote = known
  else {
    const res = await call(start, keys, 'GET')
    if (res.status === 404 && options.create) remote = { rev: 0, payload: null, text: null }
    else if (res.status !== 200) throw problemFor(res, options.adopt ? 'join' : 'sync')
    else remote = await open(keys, await res.json().catch(() => ({})))
  }

  for (let retry = 0; ; retry++) {
    const config = loadConfig()
    // Turned off while waiting: nothing more to do.
    if (!config || config.key !== start.key) return
    const merged = merge(remote.payload, settingsStore.get(), config.metas, new Date(), deviceName(), options.adopt && retry === 0)
    // The times are saved before the settings change, so the change isn't mistaken for the person's own.
    saveConfig({ ...config, metas: merged.metas })
    if (Object.keys(merged.patch).length) settingsStore.set(merged.patch)

    const text = JSON.stringify(merged.payload)
    if (remote.payload && text === remote.text) {
      known = remote
      return finish()
    }
    const res = await call(config, keys, 'PUT', { rev: remote.rev, blob: await encrypt(keys, text) })
    if (res.status === 200) {
      const { rev } = (await res.json().catch(() => ({}))) as { rev?: unknown }
      if (typeof rev !== 'number') throw new Problem(words.unreadable)
      known = { rev, payload: merged.payload, text }
      return finish()
    }
    if (res.status !== 409) throw problemFor(res, 'sync')
    if (retry >= maxRetries) throw new Problem(words.busy)
    remote = await open(keys, await res.json().catch(() => ({})))
  }
}

function finish() {
  const config = loadConfig()
  if (!config) return
  const at = stamp(new Date())
  saveConfig({ ...config, lastSyncAt: at })
}

// MARK: When

let running: Promise<void> | undefined
let again: Options | undefined
let timer: ReturnType<typeof setTimeout> | undefined

/** One sync at a time. A request that arrives meanwhile runs once more afterwards. */
function exclusive(options: Options): Promise<void> {
  if (running) {
    again = { ...options, fresh: options.fresh || again?.fresh === true }
    return running
  }
  running = (async () => {
    try {
      await cycle(options)
    } finally {
      running = undefined
      const next = again
      again = undefined
      if (next && loadConfig()) void run(next)
    }
  })()
  return running
}

/** A sync in the background: the outcome goes to the status, never to the caller. */
async function run(options: Options): Promise<void> {
  if (!loadConfig()) return setStatus({ phase: 'off' })
  setStatus({ phase: 'syncing', ...lastOf(loadConfig()) })
  try {
    await exclusive(options)
    const config = loadConfig()
    setStatus(config ? { phase: 'idle', ...lastOf(config) } : { phase: 'off' })
  } catch (error) {
    setStatus({ phase: 'error', ...lastOf(loadConfig()), error: error instanceof Problem ? error.message : 'Sync stopped unexpectedly. Try Sync Now again.' })
  }
}

/** Sync Now, and the pull at load, on coming back to the tab, and every five minutes. */
export const syncNow = () => run({ fresh: true })

/** Writes now instead of three seconds from now. A sign-in or a refreshed Trakt token has to reach the other
 *  devices before they try the refresh token it replaced. Resolves when the write has finished (or failed;
 *  the status says which). Does nothing when sync is off. */
export function pushNow(): Promise<void> {
  clearTimeout(timer)
  return run({ fresh: false })
}

/** Whether this browser has a sync key. */
export const syncIsOn = () => loadConfig() !== null

function onSettingsChange() {
  const config = loadConfig()
  if (!config) return
  const { metas, changed } = detectChanges(settingsStore.get(), config.metas, new Date(), deviceName())
  if (!changed) return
  saveConfig({ ...config, metas })
  clearTimeout(timer)
  timer = setTimeout(() => void run({ fresh: false }), pushDelay)
}

let listening = false
function listen() {
  if (listening || typeof document === 'undefined') return
  listening = true
  settingsStore.subscribe(onSettingsChange)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
  })
  setInterval(() => {
    if (document.visibilityState !== 'hidden') void syncNow()
  }, pullEvery)
}

/** Called once at load when this browser has sync on. */
export function startSync() {
  listen()
  if (loadConfig()) void syncNow()
}

// MARK: Turning it on and off

export type Outcome = { ok: true } | { ok: false; error: string }

/** Saves a setup, runs the first sync, and puts things back if it fails. */
async function begin(config: SyncConfig, options: Options): Promise<Outcome> {
  const before = loadConfig()
  known = undefined
  saveConfig(config)
  listen()
  setStatus({ phase: 'syncing' })
  try {
    await exclusive(options)
    setStatus({ phase: 'idle', ...lastOf(loadConfig()) })
    return { ok: true }
  } catch (error) {
    if (before) saveConfig(before)
    else clearConfig()
    setStatus(before ? { phase: 'idle', ...lastOf(before) } : { phase: 'off' })
    return { ok: false, error: error instanceof Problem ? error.message : 'Couldn’t start sync. Check the address and token, then try again.' }
  }
}

/** Makes a new key and starts a record on the server. */
export function turnOn(server: string, token: string): Promise<Outcome> {
  return begin({ key: encodeKey(makeKeyBytes()), server, token, metas: {} }, { fresh: true, create: true })
}

/** Uses a key from another device. Its settings come here; what this browser has that they lack goes up. */
export function joinSync(pairing: Pairing & { server: string }): Promise<Outcome> {
  return begin({ key: encodeKey(pairing.key), server: pairing.server, token: pairing.token ?? '', metas: {} }, { fresh: true, adopt: true })
}

/** Forgets the key here and keeps the settings as they are. */
export function turnOff() {
  clearTimeout(timer)
  clearConfig()
  known = undefined
  setStatus({ phase: 'off' })
}

/** Also deletes the record, so no device can sync until someone turns it on again. */
export async function turnOffAndErase(): Promise<Outcome> {
  const config = loadConfig()
  const bytes = config && parseKey(config.key)
  if (!config || !bytes) return { ok: true }
  try {
    const res = await call(config, await deriveKeys(bytes), 'DELETE')
    if (res.status !== 204 && res.status !== 404) throw problemFor(res, 'sync')
  } catch (error) {
    return { ok: false, error: error instanceof Problem ? `Couldn’t erase it. ${error.message}` : 'Couldn’t erase it. Try again.' }
  }
  turnOff()
  return { ok: true }
}

/** The link to open on another device. Empty when sync is off. */
export function pairingLink(): string {
  const config = loadConfig()
  const key = config && parseKey(config.key)
  return config && key ? webLink(key, config.server, config.token, `${location.origin}${import.meta.env.BASE_URL}`) : ''
}
