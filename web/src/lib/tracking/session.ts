/* Being signed in to Simkl, and the clients for the trackers that aren't Trakt. Simkl signs in with a code: the page
   asks for one, the person types it at simkl.com/pin, and the page polls until Simkl hands over a token. That needs
   no redirect and no secret, so it works from any address. The token has no refresh token and no expiry, so there is
   no rotating to coordinate as there is for Trakt; it is a setting (`simklAccount`) in the shape the apps keep it
   (docs/SYNC.md, accounts), so Flow Sync carries it to every device and one from the apps works here.

   Sync is touched only when this browser has it on, and loaded then, not before. */

import { settingsStore } from '../store/settings'
import { loadConfig } from '../sync/config'
import { TraktError } from '../trakt/client'
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

const simkl = (): SimklClient => createSimklClient({ clientID: simklClientID, accessToken: () => settingsStore.get().simklAccount?.accessToken ?? null }, (...args) => fetch(...args))

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
  while (now() < until) {
    await sleep(pin.interval * 1000, signal)
    if (signal.aborted) return { ok: false, error: '', cancelled: true }
    try {
      const token = await client.pollPin(pin.code)
      if (token) {
        settingsStore.set({ simklAccount: { accessToken: token, refreshToken: null, expiresAt: null, redirectURI: null }, tracker: 'simkl', watchlistDestination: 'simkl' })
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
