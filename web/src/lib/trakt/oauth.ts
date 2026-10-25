/* Trakt sign-in without a client secret, as FlowKit's TraktOAuth does it: the authorization-code flow with
   PKCE (RFC 7636), so the Client ID of the owner's own Trakt app is all it takes. The page makes a verifier,
   sends only its hash to Trakt up front, and spends the code with the verifier, so a code that leaks on the
   way back is worthless on its own. Trakt's API sends CORS headers (access-control-allow-origin: *, and it
   echoes the headers a preflight asks for), so these calls go straight from the page; no proxy is involved.

   Everything here takes `fetch` as a parameter so the tests can stand in for Trakt. */

import type { TraktToken } from '../store/settings'
import { callbackPath } from './arrive'

export const apiBase = 'https://api.trakt.tv'
export const authorizeURLBase = 'https://trakt.tv/oauth/authorize'
export { callbackPath }

/** The exact Redirect URI for this site: what Settings tells the owner to add at trakt.tv/oauth/applications. */
export function redirectURI(origin: string = location.origin, base: string = import.meta.env.BASE_URL): string {
  return `${origin}${base.endsWith('/') ? base : `${base}/`}${callbackPath}`
}

// MARK: PKCE

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Random URL-safe text: 32 bytes make a 43-character verifier, the shortest RFC 7636 allows and plenty of entropy. */
export const randomToken = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)))

/** `BASE64URL(SHA256(verifier))` without padding: the S256 method. */
export async function challengeFor(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

export const isValidVerifier = (v: string) => /^[A-Za-z0-9\-._~]{43,128}$/.test(v)

export interface Pkce {
  verifier: string
  challenge: string
  state: string
}

export async function makePkce(): Promise<Pkce> {
  const verifier = randomToken(32)
  return { verifier, challenge: await challengeFor(verifier), state: randomToken(16) }
}

export function authorizeURL(clientID: string, redirect: string, pkce: Pick<Pkce, 'challenge' | 'state'>): string {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientID, redirect_uri: redirect, code_challenge: pkce.challenge, code_challenge_method: 'S256', state: pkce.state })
  return `${authorizeURLBase}?${q}`
}

// MARK: The way back

/** The code from the address Trakt sent the browser to, once `state` has been checked. A mismatch means the
 *  return didn't come from the request this page made, so the code is not trusted. */
export function authorizationCode(search: string, expectedState: string): { ok: true; code: string } | { ok: false; error: string; cancelled?: boolean } {
  const p = new URLSearchParams(search)
  const error = p.get('error')
  if (error === 'access_denied') return { ok: false, error: 'You didn’t allow Flow in Trakt, so nothing changed. Sign in again whenever you like.', cancelled: true }
  if (error) return { ok: false, error: p.get('error_description') || `Trakt sign-in failed (${error}). Try again.` }
  if (p.get('state') !== expectedState) return { ok: false, error: 'Trakt sign-in didn’t match the request that started it. Try again.' }
  const code = p.get('code')
  return code ? { ok: true, code } : { ok: false, error: 'Trakt didn’t return a sign-in code. Try again.' }
}

// MARK: Tokens

/** What Trakt answers for /oauth/token. */
interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  created_at?: number
}

const toSecond = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** A token as Flow keeps it. Expiry is created_at plus the lifetime, both from Trakt, so a slow clock here doesn't matter. */
export function tokenFromResponse(body: unknown, redirect: string, now = new Date()): TraktToken | undefined {
  const r = (typeof body === 'object' && body !== null ? body : {}) as TokenResponse
  if (typeof r.access_token !== 'string' || !r.access_token) return undefined
  const created = typeof r.created_at === 'number' ? r.created_at * 1000 : now.getTime()
  return {
    accessToken: r.access_token,
    refreshToken: typeof r.refresh_token === 'string' && r.refresh_token ? r.refresh_token : null,
    expiresAt: typeof r.expires_in === 'number' ? toSecond(created + r.expires_in * 1000) : null,
    redirectURI: redirect,
  }
}

/** Expired, or about to be: a minute of margin, as the apps use. A token with no expiry never is. */
export function isExpired(token: TraktToken, now = Date.now()): boolean {
  const at = token.expiresAt ? Date.parse(token.expiresAt) : NaN
  return Number.isFinite(at) && at - now < 60_000
}

/** The redirect URI a refresh quotes. A token remembers the one it was issued against, which may be an app's
 *  (flow://trakt-callback) and not this site's; one that doesn't says nothing, and then it's ours. */
export const refreshRedirect = (token: TraktToken, own: string) => token.redirectURI || own

export class TraktAuthError extends Error {
  constructor(
    message: string,
    /** `rejected`: the code or the refresh token is spent or revoked, and only a new sign-in helps. */
    readonly reason: 'rejected' | 'network' | 'server' = 'rejected',
    readonly status?: number,
  ) {
    super(message)
  }
}

async function post(fetcher: typeof fetch, path: string, body: unknown): Promise<Response> {
  try {
    return await fetcher(`${apiBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2' }, body: JSON.stringify(body), cache: 'no-store' })
  } catch {
    throw new TraktAuthError('Couldn’t reach Trakt. Check your connection, then try again.', 'network')
  }
}

/** Trades the code for tokens. The verifier is the proof, so no client secret goes up. */
export async function exchangeCode(fetcher: typeof fetch, args: { clientID: string; code: string; verifier: string; redirect: string }, now = new Date()): Promise<TraktToken> {
  const res = await post(fetcher, '/oauth/token', { code: args.code, client_id: args.clientID, code_verifier: args.verifier, redirect_uri: args.redirect, grant_type: 'authorization_code' })
  if (res.status >= 500) throw new TraktAuthError(`Trakt had a problem (${res.status}). Try signing in again in a moment.`, 'server', res.status)
  if (!res.ok) {
    // Nearly always a Redirect URI that doesn't match what the Trakt app lists, or a wrong Client ID.
    throw new TraktAuthError(`Trakt didn’t accept the sign-in. Check the Client ID, and that the app’s Redirect URI in Trakt is exactly ${args.redirect}`, 'rejected', res.status)
  }
  const token = tokenFromResponse(await res.json().catch(() => null), args.redirect, now)
  if (!token) throw new TraktAuthError('Trakt answered something Flow didn’t expect. Try signing in again.', 'server', res.status)
  return token
}

/** Trades a refresh token for a new pair. The refresh token is the proof, and it is single use: the old one stops working. */
export async function refreshToken(fetcher: typeof fetch, args: { clientID: string; token: TraktToken; own: string }, now = new Date()): Promise<TraktToken> {
  if (!args.token.refreshToken) throw new TraktAuthError('Trakt ended this sign-in. Sign in again.', 'rejected')
  const redirect = refreshRedirect(args.token, args.own)
  const res = await post(fetcher, '/oauth/token', { refresh_token: args.token.refreshToken, client_id: args.clientID, redirect_uri: redirect, grant_type: 'refresh_token' })
  if (res.status >= 500 || res.status === 429) throw new TraktAuthError(`Trakt had a problem (${res.status}). Flow will try again in a moment.`, 'server', res.status)
  if (!res.ok) throw new TraktAuthError('Trakt ended this sign-in. Sign in again.', 'rejected', res.status)
  const fresh = tokenFromResponse(await res.json().catch(() => null), redirect, now)
  if (!fresh) throw new TraktAuthError('Trakt answered something Flow didn’t expect. Try again in a moment.', 'server', res.status)
  return fresh
}

/** Tells Trakt to forget the token. Best effort: signing out here never waits on it. */
export async function revokeToken(fetcher: typeof fetch, args: { clientID: string; token: TraktToken }): Promise<void> {
  try {
    await post(fetcher, '/oauth/revoke', { token: args.token.accessToken, client_id: args.clientID })
  } catch {
    // Offline: the token will simply expire.
  }
}
