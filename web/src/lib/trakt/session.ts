/* Being signed in to Trakt: where the token lives, when it is refreshed, and the sign-in and sign-out that
   change it. The token is a setting (`traktAccount`) so Flow Sync carries it to every device and a sign-in made
   anywhere arrives here with no prompt. Sync and this file meet in three places:

   - a sign-in, a refreshed token and a sign-out are pushed at once (not after three seconds), because the old
     refresh token stops working the moment Trakt hands out a new one;
   - before spending a refresh token, Sync is pulled first, since another device may already have rotated it;
   - if the refresh is refused anyway, Sync is pulled once more for the same reason before saying "sign in again".

   Sync is only touched when this browser has it on, and it is loaded then, not before. */

import { settingsStore, type TraktToken } from '../store/settings'
import { loadConfig } from '../sync/config'
import { createClient, TraktError, words, type TraktAuth } from './client'
import { authorizationCode, authorizeURL, exchangeCode, isExpired, makePkce, redirectURI, refreshToken, revokeToken, TraktAuthError } from './oauth'
import { emptyState, traktStore } from './store'

const pendingKey = 'flow.trakt.pending'
/** A sign-in that was started this long ago and not finished is forgotten. */
const pendingLife = 15 * 60_000

// MARK: Sync, when it is on

async function pullFromSync(): Promise<void> {
  if (!loadConfig()) return
  const { syncNow } = await import('../sync/engine')
  await syncNow()
}

async function pushToSync(): Promise<void> {
  if (!loadConfig()) return
  const { pushNow } = await import('../sync/engine')
  await pushNow()
}

// MARK: The token

export const clientID = () => settingsStore.get().traktClientID.trim()
export const currentToken = (): TraktToken | null => settingsStore.get().traktAccount

let refreshing: Promise<TraktToken | null> | undefined

/** A token that works now, or null when nobody is signed in or the sign-in has ended. Concurrent callers share
 *  one refresh: the refresh token is single use, so a second attempt would fail and look like a sign-out. */
async function refresh(stale: TraktToken): Promise<TraktToken | null> {
  // Another device may already have rotated it.
  await pullFromSync()
  const held = currentToken()
  if (!held) return null
  if (held.accessToken !== stale.accessToken && !isExpired(held)) return held
  try {
    const fresh = await refreshToken(fetch, { clientID: clientID(), token: held, own: redirectURI() })
    settingsStore.set({ traktAccount: fresh })
    traktStore.set({ signInAgain: false, error: null })
    // Out before anything else uses the new pair: the old refresh token is dead on every other device.
    await pushToSync().catch(() => undefined)
    return fresh
  } catch (error) {
    if (!(error instanceof TraktAuthError) || error.reason !== 'rejected') throw error
    // Refused. A device that refreshed a moment ago and hasn't pushed yet is the usual cause.
    await pullFromSync()
    const after = currentToken()
    if (after && after.accessToken !== held.accessToken) return after
    traktStore.set({ signInAgain: true, error: words.signedOut })
    return null
  }
}

/** An access token for a request. `force` after Trakt refused the last one. */
export async function accessToken(force = false): Promise<string | null> {
  const token = currentToken()
  if (!token) return null
  if (!force && !isExpired(token)) return token.accessToken
  refreshing ??= refresh(token).finally(() => void (refreshing = undefined))
  try {
    return (await refreshing)?.accessToken ?? null
  } catch (error) {
    if (error instanceof TraktAuthError) throw new TraktError(error.message, error.reason === 'network' ? 'network' : 'server', error.status)
    throw error
  }
}

export const traktAuth: TraktAuth = { clientID, accessToken }

/** The Trakt client for this browser's sign-in. */
export const trakt = () => createClient(traktAuth, (...args) => fetch(...args))

// MARK: Signing in

interface Pending {
  verifier: string
  state: string
  redirect: string
  clientID: string
  at: number
}

const storage = (): Storage | null => {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

/** Goes to Trakt to approve Flow. The page is left; the way back is `finishSignIn`. */
export async function beginSignIn(): Promise<void> {
  const id = clientID()
  if (!id) throw new TraktError(words.missingID, 'client-id')
  const box = storage()
  if (!box) throw new TraktError('Your browser is blocking site storage, which sign-in needs. Allow it for this site, then try again.', 'rejected')
  const pkce = await makePkce()
  const redirect = redirectURI()
  const pending: Pending = { verifier: pkce.verifier, state: pkce.state, redirect, clientID: id, at: Date.now() }
  box.setItem(pendingKey, JSON.stringify(pending))
  location.assign(authorizeURL(id, redirect, pkce))
}

const expired = 'This sign-in expired before it finished. Start again from Settings → Account.'

/** Trades the code on the address Trakt returned the browser to for a token, signs in and tells the other
 *  devices. `search` is the address's query string. */
export async function finishSignIn(search: string): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  const box = storage()
  let pending: Pending | undefined
  try {
    pending = JSON.parse(box?.getItem(pendingKey) ?? 'null') ?? undefined
  } catch {
    pending = undefined
  }
  box?.removeItem(pendingKey)
  if (!pending || typeof pending.verifier !== 'string' || Date.now() - pending.at > pendingLife) return { ok: false, error: expired }
  const code = authorizationCode(search, pending.state)
  if (!code.ok) return code
  try {
    const token = await exchangeCode(fetch, { clientID: pending.clientID, code: code.code, verifier: pending.verifier, redirect: pending.redirect })
    settingsStore.set({ traktAccount: token })
    traktStore.set({ signInAgain: false, error: null })
    await pushToSync().catch(() => undefined)
    await rememberProfile()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Trakt didn’t accept the sign-in. Try again.' }
  }
}

/** The return from Trakt is being finished, for Settings to say so. In memory only: a closed tab leaves nothing stuck. */
let finishing = false
const watchers = new Set<() => void>()
export const finishingSignIn = {
  get: () => finishing,
  subscribe(listener: () => void) {
    watchers.add(listener)
    return () => void watchers.delete(listener)
  },
}
const setFinishing = (on: boolean) => {
  finishing = on
  watchers.forEach((w) => w())
}

/** What arrive.ts calls with the address Trakt returned the browser to. Settings is already on screen; a failure
 *  is left for its Account section to say, since the address's code works only once. */
export async function finishSignInFromAddress(search: string): Promise<void> {
  setFinishing(true)
  try {
    const result = await finishSignIn(search)
    // A refused approval changes nothing, so it says nothing.
    if (!result.ok && !result.cancelled) traktStore.set({ error: result.error })
  } finally {
    setFinishing(false)
  }
}

/** Who is signed in, for Settings. Failures are not worth showing: the next request says what is wrong. */
export async function rememberProfile(): Promise<void> {
  try {
    const { username } = await trakt().profile()
    traktStore.set({ username })
  } catch {
    // Leave the name as it was.
  }
}

// MARK: Signing out

/** Signs out here, tells Trakt to forget the token, and tells the other devices. */
export async function signOut(): Promise<void> {
  const token = currentToken()
  if (!token) return
  const id = clientID()
  settingsStore.set({ traktAccount: null })
  traktStore.set({ ...emptyState })
  await Promise.all([id ? revokeToken(fetch, { clientID: id, token }) : undefined, pushToSync().catch(() => undefined)])
}

/** The reason the client id in Settings can't be used, or nothing when Trakt accepts it. */
export async function checkClientID(id: string): Promise<string | undefined> {
  const client = createClient({ clientID: () => id.trim(), accessToken: async () => null }, (...args) => fetch(...args))
  try {
    await client.checkClientID()
    return undefined
  } catch (error) {
    return error instanceof TraktError ? error.message : 'Couldn’t check the client ID. Try again.'
  }
}
