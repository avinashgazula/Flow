/* Being signed in to Simkl, and the clients for the trackers that aren't Trakt. Simkl signs in with a code: the page
   asks for one, the person types it at simkl.com/pin, and the page polls until Simkl hands over a token. That needs
   no redirect and no secret, so it works from any address. Simkl apps registered more recently are OAuth 2.0 apps and
   use the standard device flow for the same thing (simkl.ts picks the one the Client ID needs). The token of an older
   app has no refresh token and no expiry. One from an OAuth 2.0 app may have both, and is refreshed here when it has
   run out. It is a setting (`simklAccount`) in the shape the apps keep it (docs/SYNC.md, accounts), so Marquee Sync
   carries it to every device and one from the apps works here.

   Sync is touched only when this browser has it on, and loaded then, not before. */

import { settingsStore } from '../store/settings'
import { loadConfig } from '../sync/config'
import { TraktError } from '../trakt/client'
import { isExpired } from '../trakt/oauth'
import type { Backend } from './backend'
import { createMDBListClient, mdblistBackend } from './mdblist'
import { activeTracker, type OtherTracker } from './service'
import { createSimklClient, simklBackend, type SimklClient } from './simkl'
import { emptyService, setService } from './store'

async function pushToSync(): Promise<void> {
  if (!loadConfig()) return
  const { pushNow } = await import('../sync/engine')
  await pushNow()
}

const simklClientID = () => settingsStore.get().simklClientID.trim()
const mdblistKey = () => settingsStore.get().mdblistKey?.trim() ?? ''

let refreshing: Promise<string> | undefined

/** The token for a request, renewed first when it has a refresh token and has run out. Concurrent callers share one
 *  refresh. If Simkl refuses it the sign-in has ended, and the request fails with the signed-out sentence. */
async function usableToken(): Promise<string | null> {
  const held = settingsStore.get().simklAccount
  if (!held) return null
  if (!held.refreshToken || !isExpired(held)) return held.accessToken
  refreshing ??= (async () => {
    const fresh = await createSimklClient({ clientID: simklClientID, accessToken: () => null }, (...args) => fetch(...args)).refresh(held.refreshToken!)
    settingsStore.set({ simklAccount: fresh })
    // Out at once so another device doesn't spend the old refresh token.
    await pushToSync().catch(() => undefined)
    return fresh.accessToken
  })().finally(() => void (refreshing = undefined))
  return refreshing
}

const simkl = (): SimklClient => createSimklClient({ clientID: simklClientID, accessToken: usableToken }, (...args) => fetch(...args))

/** The client for one service, as the engine and the scrobbler use it. */
export function backendFor(kind: OtherTracker): Backend {
  if (kind === 'simkl') return simklBackend(simkl(), () => !!settingsStore.get().simklAccount && simklClientID() !== '')
  return mdblistBackend(createMDBListClient(mdblistKey, (...args) => fetch(...args)), () => mdblistKey() !== '')
}

// MARK: Signing in to Simkl

export interface Pin {
  code: string
  url: string
  expiresIn: number
  interval: number
  /** Set when the code came from the OAuth 2.0 device flow, which polls with this and not with the code. */
  deviceCode?: string
}

/** Asks Simkl for a code to type. Fails with a sentence when the Client ID isn't accepted. */
export async function startPin(): Promise<Pin> {
  return simkl().startPin()
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
  })

/** Polls until the code is approved, expires, or `signal` aborts (Cancel). A hiccup on the way (offline for a
 *  moment, Simkl busy) is waited out; the code is good for fifteen minutes. */
export async function finishPin(pin: Pin, signal: AbortSignal, now: () => number = Date.now): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  const client = simkl()
  const until = now() + pin.expiresIn * 1000
  let interval = pin.interval
  while (now() < until) {
    await sleep(interval * 1000, signal)
    if (signal.aborted) return { ok: false, error: '', cancelled: true }
    try {
      const { token, slowDown } = await client.pollPin(pin.code, pin.deviceCode)
      // Simkl asked for more time between looks (RFC 8628: five seconds more).
      if (slowDown) interval += 5
      if (token) {
        settingsStore.set({ simklAccount: token, tracker: 'simkl', watchlistDestination: 'simkl' })
        setService('simkl', { ...emptyService })
        await pushToSync().catch(() => undefined)
        void rememberProfile('simkl')
        return { ok: true }
      }
    } catch (error) {
      if (!(error instanceof TraktError) || (error.kind !== 'network' && error.kind !== 'server' && error.kind !== 'rate')) return { ok: false, error: error instanceof Error ? error.message : 'Simkl didn’t accept the sign-in. Try again.' }
    }
  }
  return { ok: false, error: 'That code expired before it was approved. Start again from Settings → Account.' }
}

/** Who is signed in, for Settings. Failures are not worth showing: the next request says what is wrong. */
export async function rememberProfile(kind: OtherTracker): Promise<void> {
  try {
    const username = await backendFor(kind).username()
    if (username) setService(kind, { username })
  } catch {
    // Leave the name as it was.
  }
}

/** Signs out here and tells the other devices. Simkl has no call to revoke a token, so it simply stops being used. */
export async function signOutOfSimkl(): Promise<void> {
  if (!settingsStore.get().simklAccount) return
  const wasTracking = activeTracker(settingsStore.get()) === 'simkl'
  // Tracking goes back to this device, as the apps do, rather than to whatever happens to be signed in next.
  settingsStore.set((s) => ({ simklAccount: null, ...(wasTracking || s.tracker === 'simkl' ? { tracker: 'local' as const } : {}) }))
  setService('simkl', { ...emptyService })
  await pushToSync().catch(() => undefined)
}

/** The reason the Simkl Client ID can't be used, or nothing when Simkl gives a code for it. */
export async function checkSimklClientID(id: string): Promise<string | undefined> {
  const client = createSimklClient({ clientID: () => id.trim(), accessToken: () => null }, (...args) => fetch(...args))
  try {
    await client.startPin()
    return undefined
  } catch (error) {
    return error instanceof TraktError ? error.message : 'Couldn’t check the Client ID. Try again.'
  }
}
