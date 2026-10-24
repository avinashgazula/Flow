// Flow Sync: one encrypted blob per person, kept in a KV namespace bound as SYNC. The Worker never
// sees what's inside: devices encrypt before they upload. The contract is docs/SYNC.md.
//
//   GET | PUT | DELETE | OPTIONS  /sync/<id>
//
// Every request carries the Worker's TOKEN (X-Flow-Token, or ?token=) and `Authorization: Bearer <auth>`,
// where <auth> is derived from the sync key. The first write stores sha256(auth) with the record, and
// from then on only requests with the same auth may touch it.

import { originAllowed, parseList, syncCorsHeaders, tokenMatches } from './match.js'

/** The biggest blob accepted, in characters. */
export const maxBlob = 256 * 1024

/** The record names are 32 lowercase hex characters (HKDF output, so nothing guessable). */
const idPattern = /^[0-9a-f]{32}$/

/** True for the paths this file answers: /sync and everything under /sync/. */
export const isSyncPath = (pathname) => pathname === '/sync' || pathname.startsWith('/sync/')

const tooBig = 'That is more than a sync record can hold (256 KB).'
const needAuth = 'Send the sync key as an Authorization: Bearer header.'

const headersFor = (cors, type) => ({ ...cors, 'Cache-Control': 'no-store', ...(type ? { 'Content-Type': type } : {}) })
const reply = (status, message, cors) => new Response(message, { status, headers: headersFor(cors, 'text/plain; charset=utf-8') })
const json = (status, body, cors) => new Response(JSON.stringify(body), { status, headers: headersFor(cors, 'application/json; charset=utf-8') })
const noContent = (cors) => new Response(null, { status: 204, headers: headersFor(cors) })

async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The `<auth>` of `Authorization: Bearer <auth>`, or null. */
function bearer(request) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('Authorization') ?? '')
  return m ? m[1] : null
}

/** What a stored record says to a client (the auth hash stays here). */
const shown = (record) => ({ rev: record.rev, blob: record.blob, updatedAt: record.updatedAt })

/** The stored record, or null when there is none (or it can't be read as one). */
async function read(kv, id) {
  const raw = await kv.get(id)
  if (!raw) return null
  try {
    const record = typeof raw === 'string' ? JSON.parse(raw) : raw
    return record && typeof record === 'object' && typeof record.blob === 'string' && Number.isInteger(record.rev) ? record : null
  } catch {
    return null
  }
}

/** Whether `auth` is the one the record was created with. */
async function owns(record, auth) {
  return Boolean(record.authHash) && tokenMatches(await sha256hex(auth), record.authHash)
}

export async function handleSync(request, env) {
  const origin = request.headers.get('Origin')
  const allowed = parseList(env.ALLOWED_ORIGINS)
  const cors = syncCorsHeaders(origin, allowed)

  if (request.method === 'OPTIONS') {
    // A preflight from a page that isn't listed gets no CORS headers, which is how it's refused.
    return originAllowed(origin, allowed) ? noContent(cors) : reply(403, 'This page isn’t allowed to use this proxy. Add its address to ALLOWED_ORIGINS.', cors)
  }
  if (!['GET', 'PUT', 'DELETE'].includes(request.method)) return reply(405, 'Use GET, PUT or DELETE.', { ...cors, Allow: 'GET, PUT, DELETE, OPTIONS' })

  const url = new URL(request.url)
  const id = url.pathname.startsWith('/sync/') ? url.pathname.slice('/sync/'.length) : ''
  if (!idPattern.test(id)) return reply(404, 'Not found.', cors)

  if (!tokenMatches(request.headers.get('X-Flow-Token') ?? url.searchParams.get('token'), env.TOKEN)) return reply(401, 'The token is missing or wrong.', cors)
  const kv = env.SYNC
  if (!kv || typeof kv.get !== 'function') return reply(501, 'Sync needs a KV namespace bound as SYNC. See web/proxy/README.md.', cors)

  const auth = bearer(request)
  const stored = await read(kv, id)

  if (!stored) {
    // Nothing stored yet: a GET is a plain 404 whoever asks, and there is nothing to delete.
    if (request.method === 'GET') return reply(404, 'Nothing is stored for this sync key yet.', cors)
    if (request.method === 'DELETE') return noContent(cors)
  } else if (!auth) {
    return reply(401, needAuth, cors)
  } else if (!(await owns(stored, auth))) {
    return reply(403, "This sync key doesn't match.", cors)
  }

  if (request.method === 'GET') return json(200, shown(stored), cors)
  if (request.method === 'DELETE') {
    await kv.delete(id)
    return noContent(cors)
  }

  // PUT { rev, blob }.
  if (!auth) return reply(401, needAuth, cors)
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

  const currentRev = stored ? stored.rev : 0
  if (body.rev !== currentRev) {
    // Someone else wrote first: hand back what is stored so the client can merge. A record that was
    // erased can't be handed back, and writing it again would undo the erase, so that is a 404.
    return stored ? json(409, shown(stored), cors) : reply(404, 'This sync was erased from another device. Turn sync on again to start a new one.', cors)
  }
  const next = { authHash: stored ? stored.authHash : await sha256hex(auth), rev: currentRev + 1, blob: body.blob, updatedAt: new Date().toISOString() }
  await kv.put(id, JSON.stringify(next))
  return json(200, { rev: next.rev }, cors)
}
