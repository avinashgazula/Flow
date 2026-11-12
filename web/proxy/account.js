// Marquee Accounts: the encrypted values of each account, kept in the KV namespace bound as SYNC. The Worker
// never sees what's inside: devices encrypt before they upload. The contract is docs/SYNC.md.
//
//   POST    /account/<id>              create the account (authenticates by the auth key it is created with)
//   GET     /account/<id>              the list of values: { createdAt, sections: { <name>: { rev, updatedAt, size } } }
//   DELETE  /account/<id>              delete the account and every value
//   GET | PUT | DELETE  /account/<id>/<section>
//
// There is no TOKEN here: a token would have to ship in the public website. A request proves itself with
// `Authorization: Bearer <auth>`, which only someone who knows the account number can derive, and the
// Worker slows guessing down instead: 20 failed requests (unknown account, wrong key) per address in ten
// minutes answer 429, and so do more than 10 new accounts an hour from one address.

import { accountCorsHeaders, originAllowed, parseList, tokenMatches } from './match.js'

/** The biggest value accepted, in characters of its blob. */
export const maxBlob = 256 * 1024
/** Sections an account may hold, so a stolen key can't fill the namespace. */
export const maxSections = 400
/** Failed requests an address may make in `failWindow` seconds before it is refused. */
export const maxFailures = 20
export const failWindow = 600
/** Accounts an address may create in `createWindow` seconds. */
export const maxCreates = 10
export const createWindow = 3600

const idPattern = /^[0-9a-f]{32}$/
const sectionPattern = /^[a-z0-9][a-z0-9-]{0,39}$/

export const isAccountPath = (pathname) => pathname === '/account' || pathname.startsWith('/account/')

const headersFor = (cors, type, extra) => ({ ...cors, 'Cache-Control': 'no-store', ...(type ? { 'Content-Type': type } : {}), ...extra })
const reply = (status, message, cors, extra) => new Response(message, { status, headers: headersFor(cors, 'text/plain; charset=utf-8', extra) })
const json = (status, body, cors) => new Response(JSON.stringify(body), { status, headers: headersFor(cors, 'application/json; charset=utf-8') })
const noContent = (cors) => new Response(null, { status: 204, headers: headersFor(cors) })

/** Unknown account and wrong key say the same words, so nobody can tell which it was. */
const notFound = (cors) => reply(404, 'No account matches that number.', cors)
const tooMany = (cors, seconds) => reply(429, 'Too many tries from here. Wait ten minutes, then try again.', cors, { 'Retry-After': String(seconds) })

async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function bearer(request) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('Authorization') ?? '')
  return m ? m[1] : null
}

const recordKey = (id) => `acct:${id}`
const sectionKey = (id, section) => `acct:${id}:${section}`

async function readJSON(kv, key) {
  const raw = await kv.get(key)
  if (!raw) return null
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

// MARK: Rate limiting

/** A counter in KV that expires `window` seconds after its first count. Best effort: KV has no atomic
 *  increment, so two requests at the same instant may count once. That is fine for a brake. */
async function count(kv, key, window, now) {
  const stored = await readJSON(kv, key)
  return stored && Number.isInteger(stored.n) && Number.isFinite(stored.start) && now - stored.start < window * 1000 ? stored : { n: 0, start: now }
}

async function bump(kv, key, window, now) {
  const current = await count(kv, key, window, now)
  const left = Math.max(60, Math.ceil(window - (now - current.start) / 1000))
  await kv.put(key, JSON.stringify({ n: current.n + 1, start: current.start }), { expirationTtl: left })
}

/** The address, hashed: the counters hold no addresses. */
const who = async (request) => (await sha256hex(`marquee-account:${request.headers.get('CF-Connecting-IP') ?? 'local'}`)).slice(0, 24)

// MARK: Routes

export async function handleAccount(request, env, now = Date.now()) {
  const origin = request.headers.get('Origin')
  const allowed = parseList(env.ALLOWED_ORIGINS)
  const cors = accountCorsHeaders(origin, allowed)

  // A browser page that isn't listed is refused outright (the apps send no Origin).
  if (origin && !originAllowed(origin, allowed)) return reply(403, 'This page isn’t allowed to use this server. Add its address to ALLOWED_ORIGINS.', cors)
  if (request.method === 'OPTIONS') return noContent(cors)
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) return reply(405, 'Use GET, POST, PUT or DELETE.', { ...cors, Allow: 'GET, POST, PUT, DELETE, OPTIONS' })

  const url = new URL(request.url)
  const [, , id = '', section, extra] = url.pathname.split('/')
  if (!idPattern.test(id) || extra !== undefined || (section !== undefined && !sectionPattern.test(section))) return reply(404, 'Not found.', cors)
  if (request.method === 'POST' && section !== undefined) return reply(405, 'Create an account with POST /account/<id>.', cors)

  const kv = env.SYNC
  if (!kv || typeof kv.get !== 'function') return reply(501, 'Accounts need a KV namespace bound as SYNC. See web/proxy/README.md.', cors)

  // The optional Cloudflare Rate Limiting binding is a coarse brake on any traffic from one address; the KV counters
  // below are the ones that count failures over ten minutes.
  const ip = await who(request)
  if (env.ACCOUNT_LIMITER && typeof env.ACCOUNT_LIMITER.limit === 'function' && !(await env.ACCOUNT_LIMITER.limit({ key: ip })).success) return tooMany(cors, 60)
  const failKey = `rl:fail:${ip}`
  const failed = await count(kv, failKey, failWindow, now)
  if (failed.n >= maxFailures) return tooMany(cors, Math.ceil(failWindow - (now - failed.start) / 1000))
  const strike = () => bump(kv, failKey, failWindow, now)

  const auth = bearer(request)
  if (!auth) {
    await strike()
    return reply(401, 'Send the account key as an Authorization: Bearer header.', cors)
  }

  const record = await readJSON(kv, recordKey(id))

  if (request.method === 'POST') {
    if (record) {
      // Someone who sent the right key already has this account: say so, so Create Account picks another number.
      if (await owns(record, auth)) return reply(409, 'That account already exists.', cors)
      await strike()
      return notFound(cors)
    }
    const createKey = `rl:new:${ip}`
    const made = await count(kv, createKey, createWindow, now)
    if (made.n >= maxCreates) return tooMany(cors, Math.ceil(createWindow - (now - made.start) / 1000))
    const createdAt = new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z')
    await kv.put(recordKey(id), JSON.stringify({ authHash: await sha256hex(auth), createdAt }))
    await bump(kv, createKey, createWindow, now)
    return json(201, { createdAt }, cors)
  }

  if (!record || !(await owns(record, auth))) {
    await strike()
    return notFound(cors)
  }

  if (section === undefined) {
    if (request.method === 'DELETE') {
      await deleteAll(kv, id)
      return noContent(cors)
    }
    if (request.method !== 'GET') return reply(405, 'Use GET or DELETE on an account.', cors)
    const sections = {}
    for (const key of await listKeys(kv, id)) sections[key.name.slice(recordKey(id).length + 1)] = { rev: key.metadata?.rev ?? 0, updatedAt: key.metadata?.updatedAt ?? null, size: key.metadata?.size ?? 0 }
    return json(200, { createdAt: record.createdAt, sections }, cors)
  }

  const key = sectionKey(id, section)
  const stored = await readJSON(kv, key)
  if (request.method === 'GET') return stored && typeof stored.blob === 'string' && Number.isInteger(stored.rev) ? json(200, { rev: stored.rev, blob: stored.blob, updatedAt: stored.updatedAt }, cors) : noContent(cors)
  if (request.method === 'DELETE') {
    await kv.delete(key)
    return noContent(cors)
  }

  // PUT { rev, blob }: the same compare-then-write as Marquee Sync, per section.
  const tooBig = 'That is more than a section can hold (256 KB).'
  if (Number(request.headers.get('Content-Length')) > maxBlob + 1024) return reply(413, tooBig, cors)
  const text = await request.text()
  if (text.length > maxBlob + 1024) return reply(413, tooBig, cors)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  if (!body || typeof body !== 'object' || !Number.isInteger(body.rev) || body.rev < 0 || typeof body.blob !== 'string' || !body.blob) return reply(400, 'Send JSON like {"rev": 0, "blob": "…"}.', cors)
  if (body.blob.length > maxBlob) return reply(413, tooBig, cors)

  const currentRev = stored && Number.isInteger(stored.rev) ? stored.rev : 0
  if (body.rev !== currentRev) return json(409, stored ? { rev: stored.rev, blob: stored.blob, updatedAt: stored.updatedAt } : { rev: 0, blob: null, updatedAt: null }, cors)
  if (!stored && (await listKeys(kv, id)).length >= maxSections) return reply(413, 'This account holds as many sections as it can.', cors)
  const next = { rev: currentRev + 1, blob: body.blob, updatedAt: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z') }
  await kv.put(key, JSON.stringify(next), { metadata: { rev: next.rev, updatedAt: next.updatedAt, size: next.blob.length } })
  return json(200, { rev: next.rev }, cors)
}

async function owns(record, auth) {
  return typeof record.authHash === 'string' && tokenMatches(await sha256hex(auth), record.authHash)
}

/** Every section key of an account, with the metadata each was written with. */
async function listKeys(kv, id) {
  const prefix = `${recordKey(id)}:`
  const keys = []
  let cursor
  for (let page = 0; page < 20; page++) {
    const result = await kv.list({ prefix, cursor })
    keys.push(...result.keys)
    if (result.list_complete) break
    cursor = result.cursor
  }
  return keys
}

async function deleteAll(kv, id) {
  for (const key of await listKeys(kv, id)) await kv.delete(key.name)
  await kv.delete(recordKey(id))
}
