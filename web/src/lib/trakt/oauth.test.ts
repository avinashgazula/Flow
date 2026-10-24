import { describe, expect, it } from 'vitest'
import type { TraktToken } from '../store/settings'
import { authorizationCode, authorizeURL, challengeFor, exchangeCode, isExpired, isValidVerifier, makePkce, redirectURI, refreshToken, revokeToken, tokenFromResponse, TraktAuthError } from './oauth'

const site = 'https://flow.example.com/settings/trakt-callback'

interface Call {
  url: string
  body: Record<string, unknown>
}
/** A Trakt that answers each request with the next answer given, and keeps what it was asked. */
function fakeTrakt(...answers: { status: number; json?: unknown }[]) {
  const calls: Call[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]!
    return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status: a.status })
  }) as unknown as typeof fetch
  return { calls, fetcher }
}

describe('PKCE', () => {
  it('derives the S256 challenge the RFC 7636 example gives', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('makes a valid verifier, its challenge, and a separate state', async () => {
    const a = await makePkce()
    const b = await makePkce()
    expect(isValidVerifier(a.verifier)).toBe(true)
    expect(a.verifier).toHaveLength(43)
    expect(a.challenge).toBe(await challengeFor(a.verifier))
    expect(a.state).not.toBe(a.verifier)
    expect(a.verifier).not.toBe(b.verifier)
    expect(isValidVerifier('short')).toBe(false)
    expect(isValidVerifier(`${'a'.repeat(42)}!`)).toBe(false)
  })
})

describe('the sign-in address', () => {
  it('is the site’s origin and the callback route, whatever base the site is served from', () => {
    expect(redirectURI('https://flow.example.com', '/')).toBe(site)
    expect(redirectURI('https://owner.github.io', '/Flow/')).toBe('https://owner.github.io/Flow/settings/trakt-callback')
    expect(redirectURI('https://owner.github.io', '/Flow')).toBe('https://owner.github.io/Flow/settings/trakt-callback')
  })

  it('sends Trakt the client id, the redirect, the challenge and the state, and no secret', () => {
    const url = new URL(authorizeURL('cid', site, { challenge: 'CH', state: 'ST' }))
    expect(`${url.origin}${url.pathname}`).toBe('https://trakt.tv/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: 'code', client_id: 'cid', redirect_uri: site, code_challenge: 'CH', code_challenge_method: 'S256', state: 'ST' })
  })
})

describe('the way back', () => {
  it('takes the code when the state matches', () => {
    expect(authorizationCode('?code=abc&state=ST', 'ST')).toEqual({ ok: true, code: 'abc' })
  })

  it('refuses a code whose state does not match, one that is missing, and an error from Trakt', () => {
    expect(authorizationCode('?code=abc&state=other', 'ST')).toMatchObject({ ok: false, error: expect.stringContaining('didn’t match') })
    expect(authorizationCode('?state=ST', 'ST')).toMatchObject({ ok: false, error: expect.stringContaining('didn’t return a sign-in code') })
    expect(authorizationCode('?error=access_denied&state=ST', 'ST')).toMatchObject({ ok: false, cancelled: true })
    expect(authorizationCode('?error=server_error&error_description=Oops&state=ST', 'ST')).toEqual({ ok: false, error: 'Oops' })
  })
})

describe('tokens', () => {
  it('counts expiry from Trakt’s created_at plus its lifetime, to the second, and remembers the redirect', () => {
    const t = tokenFromResponse({ access_token: 'a', refresh_token: 'r', expires_in: 7_776_000, created_at: 1_760_000_000 }, site)
    expect(t).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: new Date((1_760_000_000 + 7_776_000) * 1000).toISOString().replace('.000Z', 'Z'), redirectURI: site })
    expect(tokenFromResponse({ access_token: 'a' }, site, new Date('2026-01-01T00:00:00Z'))).toEqual({ accessToken: 'a', refreshToken: null, expiresAt: null, redirectURI: site })
    expect(tokenFromResponse({ nope: 1 }, site)).toBeUndefined()
    expect(tokenFromResponse(null, site)).toBeUndefined()
  })

  it('is due a minute early, and never for a token with no expiry', () => {
    const token = (expiresAt: string | null): TraktToken => ({ accessToken: 'a', refreshToken: 'r', expiresAt, redirectURI: site })
    const now = Date.parse('2026-10-24T12:00:00Z')
    expect(isExpired(token('2026-10-24T12:00:59Z'), now)).toBe(true)
    expect(isExpired(token('2026-10-24T12:01:30Z'), now)).toBe(false)
    expect(isExpired(token(null), now)).toBe(false)
  })
})

describe('exchanging a code', () => {
  it('posts the code with the verifier and no client secret, and keeps the redirect on the token', async () => {
    const trakt = fakeTrakt({ status: 200, json: { access_token: 'acc', refresh_token: 'ref', expires_in: 100, created_at: 1_760_000_000 } })
    const token = await exchangeCode(trakt.fetcher, { clientID: 'cid', code: 'CODE', verifier: 'VER', redirect: site })
    expect(trakt.calls).toEqual([{ url: 'https://api.trakt.tv/oauth/token', body: { code: 'CODE', client_id: 'cid', code_verifier: 'VER', redirect_uri: site, grant_type: 'authorization_code' } }])
    expect(token).toMatchObject({ accessToken: 'acc', refreshToken: 'ref', redirectURI: site })
    expect(trakt.calls[0]!.body).not.toHaveProperty('client_secret')
  })

  it('names the redirect address when Trakt refuses, and tells a Trakt outage apart', async () => {
    const refused = exchangeCode(fakeTrakt({ status: 400, json: { error: 'invalid_grant' } }).fetcher, { clientID: 'cid', code: 'c', verifier: 'v', redirect: site })
    await expect(refused).rejects.toThrow(`exactly ${site}`)
    await expect(exchangeCode(fakeTrakt({ status: 503 }).fetcher, { clientID: 'cid', code: 'c', verifier: 'v', redirect: site })).rejects.toMatchObject({ reason: 'server' })
    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(exchangeCode(offline, { clientID: 'cid', code: 'c', verifier: 'v', redirect: site })).rejects.toMatchObject({ reason: 'network', message: expect.stringContaining('Couldn’t reach Trakt') })
  })
})

describe('refreshing', () => {
  const old: TraktToken = { accessToken: 'old', refreshToken: 'old-r', expiresAt: '2026-10-24T11:00:00Z', redirectURI: 'flow://trakt-callback' }

  it('quotes the redirect the token was issued against, not this site’s', async () => {
    const trakt = fakeTrakt({ status: 200, json: { access_token: 'new', refresh_token: 'new-r', expires_in: 100, created_at: 1_760_000_000 } })
    const fresh = await refreshToken(trakt.fetcher, { clientID: 'cid', token: old, own: site })
    expect(trakt.calls[0]!.body).toEqual({ refresh_token: 'old-r', client_id: 'cid', redirect_uri: 'flow://trakt-callback', grant_type: 'refresh_token' })
    expect(fresh).toMatchObject({ accessToken: 'new', refreshToken: 'new-r', redirectURI: 'flow://trakt-callback' })
  })

  it('uses this site’s redirect for a token that does not say', async () => {
    const trakt = fakeTrakt({ status: 200, json: { access_token: 'n', refresh_token: 'r' } })
    await refreshToken(trakt.fetcher, { clientID: 'cid', token: { ...old, redirectURI: null }, own: site })
    expect(trakt.calls[0]!.body.redirect_uri).toBe(site)
  })

  it('says to sign in again when the refresh token was spent, and not when Trakt is just down', async () => {
    const spent = refreshToken(fakeTrakt({ status: 400, json: { error: 'invalid_grant' } }).fetcher, { clientID: 'cid', token: old, own: site })
    await expect(spent).rejects.toMatchObject({ reason: 'rejected', message: 'Trakt ended this sign-in. Sign in again.' })
    await expect(refreshToken(fakeTrakt({ status: 502 }).fetcher, { clientID: 'cid', token: old, own: site })).rejects.toMatchObject({ reason: 'server' })
    await expect(refreshToken(fakeTrakt().fetcher, { clientID: 'cid', token: { ...old, refreshToken: null }, own: site })).rejects.toBeInstanceOf(TraktAuthError)
  })
})

describe('revoking', () => {
  it('asks Trakt to forget the token, and never fails the sign-out', async () => {
    const trakt = fakeTrakt({ status: 200 })
    await revokeToken(trakt.fetcher, { clientID: 'cid', token: { accessToken: 'a', refreshToken: 'r', expiresAt: null, redirectURI: null } })
    expect(trakt.calls).toEqual([{ url: 'https://api.trakt.tv/oauth/revoke', body: { token: 'a', client_id: 'cid' } }])
    const offline = (async () => {
      throw new TypeError('offline')
    }) as unknown as typeof fetch
    await expect(revokeToken(offline, { clientID: 'cid', token: { accessToken: 'a', refreshToken: null, expiresAt: null, redirectURI: null } })).resolves.toBeUndefined()
  })
})
