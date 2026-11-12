/* Marquee Accounts on the web: when to look at the account, when to write it, and what to say when it fails. The rules
   for merging are in wire.ts and bridge.ts (the library) and lib/sync/payload.ts (settings), the cryptography in keys.ts;
   this file is the clock and the network. It loads on its own (a dynamic import from main.tsx, and from Settings and
   Welcome), so the first page never carries it. */

import { defaultSettings, settingsStore, type Settings } from '../store/settings'
import { libraryStore, type Library } from '../store/library'
import { lastSourceStore } from '../sources/lastSource'
import { detectChanges, merge, parsePayload, stamp, type Payload } from '../sync/payload'
import { sha256hex } from '../sync/crypto'
import { applyLocal, patchFor } from './bridge'
import { clearConfig, hasBase, loadBase, loadConfig, loadSettingsCopy, saveBase, saveConfig, saveSettingsCopy, typedServer, type AccountConfig } from './config'
import { deriveAccount, open, seal, type AccountKeys } from './keys'
import { makeNumber, parseNumber, incompleteNumber } from './number'
import { resolveServer } from './server'
import { canonical, emptyState, isLibrarySection, mergeState, readState, settingsSection, writeState, type WireState } from './wire'

/** About three seconds after the last change, so typing a key is one write and not one per character. */
export const pushDelay = 3000
/** Resume points change every few seconds while something plays; they are written about once a minute. */
export const progressDelay = 60_000
/** While the page is open, look at the account this often. */
export const pullEvery = 5 * 60_000
/** Writes tried again after another device got in first. */
const maxRetries = 3
/** Creating retries with a new number when one is taken (it almost never is: 10^16 numbers). */
const maxCreateTries = 5

export interface AccountStatus {
  phase: 'off' | 'idle' | 'syncing' | 'error'
  lastSyncAt?: string
  error?: string
}

class Problem extends Error {}

const words = {
  noServer: 'This site has no account server set. Enter the address of your Worker under Account Server.',
  unreachable: 'Couldn’t reach the account server. Check your connection, and that this site is listed in the Worker’s ALLOWED_ORIGINS.',
  notFound: 'No account matches that number. Check it against the one you wrote down.',
  gone: 'This account no longer exists. If you deleted it on another device, log out here.',
  limited: 'Too many tries from this network. Wait ten minutes, then try again.',
  origin: 'The account server doesn’t allow this site. Add this site’s address to the Worker’s ALLOWED_ORIGINS.',
  noKV: 'The account server needs a KV namespace. See web/proxy/README.md.',
  tooBig: 'Your library is too big to sync. A value can hold 256 KB.',
  unreadable: 'Couldn’t read the synced data. Check that the account number here matches your other devices.',
  newer: 'Your other devices use a newer version of Marquee Accounts. Update Marquee here to keep syncing.',
  busy: 'Another device kept changing your account while Marquee was syncing. Try Sync Now again.',
  taken: 'Couldn’t make a new account number. Try again.',
}

// MARK: Status

const last = (config: AccountConfig | null) => (config?.lastSyncAt ? { lastSyncAt: config.lastSyncAt } : {})
let status: AccountStatus = loadConfig() ? { phase: 'idle', ...last(loadConfig()) } : { phase: 'off' }
const listeners = new Set<() => void>()
function setStatus(next: AccountStatus) {
  status = next
  listeners.forEach((l) => l())
}

/** What Settings shows. A store in the shape `useSyncExternalStore` takes. */
export const accountStatus = {
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

/** The account server in use, or null when there isn't one. */
export const accountServer = () => resolveServer(import.meta.env.VITE_ACCOUNT_SERVER as string | undefined, settingsStore.get().streamProxy, typedServer())

let keyCache: { number: string; keys: AccountKeys } | undefined
async function keysFor(number: string): Promise<AccountKeys> {
  if (keyCache?.number === number) return keyCache.keys
  const keys = await deriveAccount(number)
  keyCache = { number, keys }
  return keys
}

async function call(server: string, keys: AccountKeys, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path = '', body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${keys.auth}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    return await fetch(`${server}/account/${keys.id}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
  } catch {
    throw new Problem(words.unreachable)
  }
}

/** The sentence for an answer that isn't one of the expected ones. */
function problemFor(res: Response, during: 'login' | 'sync'): Problem {
  switch (res.status) {
    case 401:
    case 404:
      return new Problem(during === 'login' ? words.notFound : words.gone)
    case 403:
      return new Problem(words.origin)
    case 413:
      return new Problem(words.tooBig)
    case 429:
      return new Problem(words.limited)
    case 501:
      return new Problem(words.noKV)
    default:
      return new Problem(res.status >= 500 ? `The account server had a problem (${res.status}). Try again in a moment.` : `The account server answered something Marquee didn’t expect (${res.status}). Check its address.`)
  }
}

const short = async (text: string) => (await sha256hex(text)).slice(0, 16)
const canonicalText = (text: string) => {
  try {
    return canonical(JSON.parse(text))
  } catch {
    return text
  }
}

// MARK: One sync

interface Options {
  /** Joining an account: what this browser held before is taken from the account where it has an answer, section by section. */
  adopt?: boolean
}

interface Remote {
  settings: Payload | null
  /** The library as the account holds it now. */
  library: WireState
}

/** Reads the values whose revision differs from what this browser last saw, into `plain`, and notes their revisions and hashes. */
async function pull(server: string, keys: AccountKeys, config: AccountConfig, plain: Record<string, string>): Promise<AccountConfig> {
  const res = await call(server, keys, 'GET')
  if (res.status !== 200) throw problemFor(res, 'sync')
  const manifest = (await res.json().catch(() => ({}))) as { sections?: Record<string, { rev?: unknown }> }
  const sections = manifest.sections ?? {}
  const next = { ...config, revs: { ...config.revs }, hashes: { ...config.hashes } }
  const wanted = Object.keys(sections).filter((name) => (name === settingsSection || isLibrarySection(name)) && sections[name]!.rev !== config.revs[name])
  for (let i = 0; i < wanted.length; i += 4) {
    await Promise.all(
      wanted.slice(i, i + 4).map(async (name) => {
        const r = await call(server, keys, 'GET', `/${name}`)
        if (r.status === 204) return
        if (r.status !== 200) throw problemFor(r, 'sync')
        const body = (await r.json().catch(() => ({}))) as { rev?: unknown; blob?: unknown }
        await take(keys, name, body, plain, next)
      }),
    )
  }
  return next
}

async function take(keys: AccountKeys, name: string, body: { rev?: unknown; blob?: unknown }, plain: Record<string, string>, into: AccountConfig) {
  if (typeof body.rev !== 'number' || typeof body.blob !== 'string') throw new Problem(words.unreadable)
  try {
    plain[name] = await open(keys, name, body.blob)
  } catch {
    throw new Problem(words.unreadable)
  }
  into.revs[name] = body.rev
  into.hashes[name] = await short(canonicalText(plain[name]))
}

function remoteOf(plain: Record<string, string>, base: WireState): Remote {
  let settings: Payload | null = null
  if (plain[settingsSection] !== undefined) {
    const parsed = parsePayload(plain[settingsSection])
    if (!parsed.ok) throw new Problem(parsed.newer ? words.newer : words.unreadable)
    settings = parsed.payload
  }
  const read = readState(Object.fromEntries(Object.entries(plain).filter(([name]) => name !== settingsSection)))
  if (read.newer.length) throw new Problem(words.newer)
  if (read.unreadable.length) throw new Problem(words.unreadable)
  // What this browser last saw of the values that haven't changed is what the account still holds.
  return { settings, library: mergeState(base, read.state, Date.now()) }
}

/** Reads the account, merges it with this browser's settings and library, applies what is newer there, and writes what
 *  is newer here, again on top of whatever another device wrote meanwhile (up to three times). */
async function cycle(options: Options): Promise<void> {
  const start = loadConfig()
  if (!start) return
  const keys = await keysFor(start.number)
  const plain: Record<string, string> = {}
  // What this browser last saw has to be there to tell the account's values from ones it lacks. If it was cleared, read everything again.
  const copy = loadSettingsCopy()
  const kept = hasBase() && copy !== null
  let config = await pull(start.server, keys, kept ? start : { ...start, revs: {}, hashes: {} }, plain)
  const copied = copy !== null ? parsePayload(copy) : undefined
  let settingsRemote: Payload | null = copied?.ok ? copied.payload : null

  for (let retry = 0; ; retry++) {
    const now = new Date()
    const base = loadBase()
    const remote = remoteOf(plain, base)
    if (remote.settings !== null) settingsRemote = remote.settings

    // Settings: the same rules as Marquee Sync. The times are saved before the settings change, so the change isn't mistaken
    // for the person's own.
    const adopt = options.adopt && retry === 0
    const mergedSettings = merge(settingsRemote ?? null, settingsStore.get(), config.metas, now, deviceName(), adopt)
    config = { ...config, metas: mergedSettings.metas }

    // The library: this browser's changes laid on what was last synced, merged with the account's, and kept as the new base before
    // the website's stores change so the change isn't mistaken for the person's own.
    const library = libraryStore.get()
    const local = applyLocal(base, library, lastSourceStore.get().byTitle, now.getTime())
    const merged = mergeState(local, remote.library, now.getTime())
    saveBase(merged)
    const live = loadConfig()
    if (!live || live.number !== start.number) return
    saveConfig({ ...live, revs: config.revs, hashes: config.hashes, metas: config.metas })
    applying = true
    try {
      if (Object.keys(mergedSettings.patch).length) settingsStore.set(mergedSettings.patch as Partial<Settings>)
      const change = patchFor(merged, library)
      if (Object.keys(change.library).length) libraryStore.set(change.library as Partial<Library>)
      if (canonical(lastSourceStore.get().byTitle) !== canonical(change.sources)) lastSourceStore.set({ byTitle: change.sources })
    } finally {
      applying = false
      previous = libraryStore.get()
    }

    // What to write: every value whose text differs from what the account last said.
    const out: Record<string, string> = { ...writeState(merged, now.getTime()) }
    if (Object.keys(mergedSettings.payload.sections).length) out[settingsSection] = canonical(mergedSettings.payload)
    let conflict = false
    for (const [name, text] of Object.entries(out)) {
      const hash = await short(text)
      if (config.hashes[name] === hash) continue
      const res = await call(start.server, keys, 'PUT', `/${name}`, { rev: config.revs[name] ?? 0, blob: await seal(keys, name, text) })
      if (res.status === 200) {
        const { rev } = (await res.json().catch(() => ({}))) as { rev?: unknown }
        if (typeof rev !== 'number') throw new Problem(words.unreadable)
        config = { ...config, revs: { ...config.revs, [name]: rev }, hashes: { ...config.hashes, [name]: hash } }
        continue
      }
      if (res.status !== 409) throw problemFor(res, 'sync')
      // Another device wrote this value first: take its version and go round again.
      const body = (await res.json().catch(() => ({}))) as { rev?: unknown; blob?: unknown }
      if (typeof body.blob === 'string') {
        const next = { ...config, revs: { ...config.revs }, hashes: { ...config.hashes } }
        await take(keys, name, body, plain, next)
        config = next
      } else config = { ...config, revs: { ...config.revs, [name]: 0 } }
      conflict = true
      break
    }
    const after = loadConfig()
    if (after && after.number === start.number) saveConfig({ ...after, revs: config.revs, hashes: config.hashes, metas: config.metas, ...(conflict ? last(after) : { lastSyncAt: stamp(new Date()) }) })
    if (!conflict) {
      saveSettingsCopy(canonical(mergedSettings.payload))
      return
    }
    if (retry >= maxRetries) throw new Problem(words.busy)
  }
}

// MARK: When

let running: Promise<void> | undefined
let again: Options | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let slowTimer: ReturnType<typeof setTimeout> | undefined

/** One sync at a time. A request that arrives meanwhile runs once more afterwards. */
function exclusive(options: Options): Promise<void> {
  if (running) {
    again = options
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
  clearTimeout(timer)
  clearTimeout(slowTimer)
  slowTimer = undefined
  setStatus({ phase: 'syncing', ...last(loadConfig()) })
  try {
    await exclusive(options)
    const config = loadConfig()
    setStatus(config ? { phase: 'idle', ...last(config) } : { phase: 'off' })
  } catch (error) {
    setStatus({ phase: 'error', ...last(loadConfig()), error: error instanceof Problem ? error.message : 'Sync stopped unexpectedly. Try Sync Now again.' })
  }
}

/** Sync Now, and the pull at load, on coming back to the tab, and every five minutes. */
export const syncNow = () => run({})

let previous: Library = libraryStore.get()
/** True while a sync is putting the account's changes into the stores, which aren't the person's own. */
let applying = false
function onLibraryChange() {
  const now = libraryStore.get()
  const was = previous
  previous = now
  if (applying || !loadConfig()) return
  // Anything but a resume point goes in about three seconds; resume points tick while a title plays, so they wait up to a minute.
  const onlyProgress = (Object.keys(now) as (keyof Library)[]).every((k) => k === 'progress' || now[k] === was[k])
  if (onlyProgress) {
    slowTimer ??= setTimeout(() => void run({}), progressDelay)
    return
  }
  clearTimeout(timer)
  timer = setTimeout(() => void run({}), pushDelay)
}

function onSettingsChange() {
  const config = loadConfig()
  if (!config) return
  const { metas, changed } = detectChanges(settingsStore.get(), config.metas, new Date(), deviceName())
  if (!changed) return
  saveConfig({ ...config, metas })
  clearTimeout(timer)
  timer = setTimeout(() => void run({}), pushDelay)
}

let listening = false
function listen() {
  if (listening || typeof document === 'undefined') return
  listening = true
  settingsStore.subscribe(onSettingsChange)
  libraryStore.subscribe(onLibraryChange)
  lastSourceStore.subscribe(() => {
    if (applying || !loadConfig()) return
    clearTimeout(timer)
    timer = setTimeout(() => void run({}), pushDelay)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
    // Leaving the tab writes what is waiting, so a resume point isn't lost with it.
    else if (loadConfig() && (timer || slowTimer)) void run({})
  })
  setInterval(() => {
    if (document.visibilityState !== 'hidden') void syncNow()
  }, pullEvery)
}

/** Called once at load when this browser has an account. */
export function startAccount() {
  listen()
  if (loadConfig()) void syncNow()
}

// MARK: Creating, logging in and out

export type Outcome = { ok: true; number?: string } | { ok: false; error: string }

/** Saves a setup, runs the first sync, and puts things back if it fails. */
async function begin(config: AccountConfig, options: Options): Promise<Outcome> {
  const before = loadConfig()
  const baseBefore = loadBase()
  saveConfig(config)
  saveBase(emptyState())
  listen()
  setStatus({ phase: 'syncing' })
  try {
    await exclusive(options)
    setStatus({ phase: 'idle', ...last(loadConfig()) })
    return { ok: true }
  } catch (error) {
    if (before) {
      saveConfig(before)
      saveBase(baseBefore)
    } else clearConfig()
    setStatus(before ? { phase: 'idle', ...last(before) } : { phase: 'off' })
    return { ok: false, error: error instanceof Problem ? error.message : 'Couldn’t start the account. Check your connection, then try again.' }
  }
}

const fresh = (number: string, server: string): AccountConfig => ({ number, server, revs: {}, hashes: {}, metas: {} })

/** Makes an account number and registers it. The number comes back for the "write this down" step. */
export async function createAccount(): Promise<Outcome> {
  const found = accountServer()
  if (!found) return { ok: false, error: words.noServer }
  for (let attempt = 0; attempt < maxCreateTries; attempt++) {
    const number = makeNumber()
    let created: Response
    try {
      created = await call(found.server, await keysFor(number), 'POST')
    } catch (error) {
      return { ok: false, error: error instanceof Problem ? error.message : words.unreachable }
    }
    // 409: that number is taken. Pick another.
    if (created.status === 409) continue
    if (created.status !== 201) return { ok: false, error: problemFor(created, 'sync').message }
    const started = await begin(fresh(number, found.server), {})
    if (!started.ok) {
      // The account exists but the first upload failed: remove it, so a number the person never saw isn't left behind.
      void call(found.server, await keysFor(number), 'DELETE').catch(() => undefined)
      return started
    }
    return { ok: true, number }
  }
  return { ok: false, error: words.taken }
}

/** Logs in with a number. What this browser holds is kept and merged with the account. */
export async function logIn(input: string): Promise<Outcome> {
  const number = parseNumber(input)
  if (!number) return { ok: false, error: incompleteNumber }
  const found = accountServer()
  if (!found) return { ok: false, error: words.noServer }
  const keys = await keysFor(number)
  let check: Response
  try {
    check = await call(found.server, keys, 'GET')
  } catch (error) {
    return { ok: false, error: error instanceof Problem ? error.message : words.unreachable }
  }
  if (check.status !== 200) return { ok: false, error: problemFor(check, 'login').message }
  return begin(fresh(number, found.server), { adopt: true })
}

/** The synced settings and library this browser holds, back to a fresh install (what Log Out and Clear does). */
function clearLocal() {
  const fields = ['tmdbKey', 'mdblistKey', 'tvdbKey', 'rpdbKey', 'introDBKey', 'publicMetaDBKey', 'openSubtitlesKey', 'openSubtitlesUsername', 'openSubtitlesPassword', 'subdlKey', 'subSourceKey', 'wyzieKey', 'traktClientID', 'simklClientID', 'traktAccount', 'simklAccount', 'addons', 'servers', 'streamProxy', 'seerr', 'sports', 'audioLanguages', 'subtitleLanguages', 'subtitleStyle'] as const
  settingsStore.set({ ...Object.fromEntries(fields.map((f) => [f, defaultSettings[f]])), onboarded: false } as Partial<Settings>)
  libraryStore.set({ progress: {}, watchlist: [], favourites: [], history: [], watchedEpisodes: {}, ratings: {}, rewatches: {}, shuffled: {}, watchlistOrder: [] })
  lastSourceStore.set({ byTitle: {} })
}

/** Forgets the account on this device. `keepData` leaves the library and settings as they are; otherwise they are cleared. */
export function logOut(keepData: boolean) {
  clearTimeout(timer)
  clearTimeout(slowTimer)
  slowTimer = undefined
  keyCache = undefined
  // The account is forgotten first, so clearing the library below isn't mistaken for the person removing everything from it.
  clearConfig()
  setStatus({ phase: 'off' })
  if (!keepData) clearLocal()
}

/** Deletes the account and every value in it, then logs out here (data kept). */
export async function deleteAccount(): Promise<Outcome> {
  const config = loadConfig()
  if (!config) return { ok: true }
  try {
    const res = await call(config.server, await keysFor(config.number), 'DELETE')
    if (res.status !== 204 && res.status !== 404) throw problemFor(res, 'sync')
  } catch (error) {
    return { ok: false, error: `Couldn’t delete it. ${error instanceof Problem ? error.message : 'Try again.'}` }
  }
  logOut(true)
  return { ok: true }
}

/** One tap from an older Marquee Sync pairing: make an account from what this browser holds (it is all synced already),
 *  then forget the pairing. The old record stays on the Worker until it is erased there. */
export async function moveToAccount(): Promise<Outcome> {
  const made = await createAccount()
  if (made.ok) (await import('../sync/engine')).turnOff()
  return made
}

/** The number to show, or empty when there is no account. */
export const currentNumber = () => loadConfig()?.number ?? ''

