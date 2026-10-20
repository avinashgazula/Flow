// Flow's stream proxy, as a Cloudflare Worker. It fetches a file for Flow on the web and adds the
// CORS headers the file's host leaves out, so Flow can read it (and convert its audio). Setup:
// README.md. The decisions are in match.js.
//
//   GET or HEAD  /?url=<encoded https address>[&token=<TOKEN>]

import { cleanSnippet, corsHeaders, downstreamHeaders, hopsHeader, hopsSummary, originAllowed, parseList, parseTarget, rangeFromStart, redirectStatuses, snippetWanted, streamStatuses, targetAllowed, tokenMatches, upstreamHeaders } from './match.js'

/** Redirect hops followed before giving up: debrid links take one or two. */
const maxRedirects = 5

/** How much of a host's error answer is read to quote from it. */
const snippetBytes = 2048

/** An error answer. `hops` (who answered, and how) goes on it as a header, so Flow can show the reason. */
const text = (status, message, cors, hops = []) =>
  new Response(`${message}\n`, { status, headers: { ...cors, ...(hops.length ? { [hopsHeader]: hopsSummary(hops) } : {}), 'Content-Type': 'text/plain; charset=utf-8' } })

/** A Location header against the address that sent it: it may be relative. */
function resolve(location, base) {
  try {
    return new URL(location, base).href
  } catch {
    return null
  }
}

/** What a host said with its error, when it said it in text or JSON: a few words, cleaned. Hosts
 *  often give the reason there (an address that's banned, a link that expired). Empty otherwise. */
async function quote(upstream) {
  try {
    if (!upstream.body || !snippetWanted(upstream.headers.get('Content-Type'))) return ''
    const reader = upstream.body.getReader()
    const parts = []
    let have = 0
    while (have < snippetBytes) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      have += value.length
    }
    reader.cancel().catch(() => {})
    const bytes = new Uint8Array(have)
    let at = 0
    for (const part of parts) (bytes.set(part, at), (at += part.length))
    return cleanSnippet(new TextDecoder().decode(bytes.subarray(0, snippetBytes)))
  } catch {
    return ''
  }
}

async function answer(request, env, hops) {
  const origin = request.headers.get('Origin')
  const cors = corsHeaders(origin, parseList(env.ALLOWED_ORIGINS))

  if (request.method === 'OPTIONS') {
    // A preflight from a page that isn't listed gets no CORS headers, which is how it's refused.
    return originAllowed(origin, parseList(env.ALLOWED_ORIGINS)) ? new Response(null, { status: 204, headers: cors }) : text(403, 'This page isn’t allowed to use this proxy. Add its address to ALLOWED_ORIGINS.', cors)
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Use GET or HEAD.', { ...cors, Allow: 'GET, HEAD, OPTIONS' })

  const params = new URL(request.url).searchParams
  if (!tokenMatches(params.get('token'), env.TOKEN)) return text(401, 'The token is missing or wrong.', cors)

  const target = parseTarget(params.get('url'))
  if (!target) return text(400, 'Pass an https address as ?url=.', cors)
  const hosts = { allowedHosts: parseList(env.ALLOWED_HOSTS), redirectHosts: parseList(env.ALLOWED_REDIRECT_HOSTS) }
  if (!targetAllowed(target, hosts)) {
    hops.push({ host: target.hostname, status: 'not allowed' })
    return text(403, `${target.hostname} isn’t in ALLOWED_HOSTS.`, cors, hops)
  }

  // Redirects are followed here, one at a time, so each host is checked and not only the first:
  // a play link on an allowed host can't send the proxy somewhere that isn't.
  const headers = upstreamHeaders(request.headers)
  let url = target
  let upstream
  for (let hop = 0; ; hop++) {
    try {
      upstream = await fetchUncached(url, { method: request.method, headers, redirect: 'manual' })
    } catch {
      hops.push({ host: url.hostname, status: 'unreachable' })
      return text(502, `Couldn’t reach ${url.hostname}.`, cors, hops)
    }
    hops.push({ host: url.hostname, status: upstream.status })
    if (!redirectStatuses.has(upstream.status)) break
    const location = upstream.headers.get('Location')
    upstream.body?.cancel()
    if (hop >= maxRedirects) return text(502, `The file redirected more than ${maxRedirects} times, and ${url.hostname} sent it on again.`, cors, hops)
    const next = location ? parseTarget(resolve(location, url)) : null
    if (!next) return text(502, `${url.hostname} redirected somewhere the proxy won’t go (an address that isn’t https on the standard port).`, cors, hops)
    if (!targetAllowed(next, hosts, true)) {
      hops.push({ host: next.hostname, status: 'not allowed' })
      return text(403, `The file redirects to ${next.hostname}, which isn’t in ALLOWED_HOSTS or ALLOWED_REDIRECT_HOSTS.`, cors, hops)
    }
    url = next
  }

  if (!streamStatuses.has(upstream.status)) {
    // The page needs the status (a file that's gone, a host that refused) and the host's own words
    // when it gave some, but not its page.
    const said = await quote(upstream)
    upstream.body?.cancel().catch(() => {})
    // (A 204 or 304 can't carry a body, and nothing here should have produced one.)
    return text(upstream.status >= 400 ? upstream.status : 502, `The file’s host (${url.hostname}) answered ${upstream.status}.${said ? ` It said: “${said}”` : ''}`, cors, hops)
  }
  const passedOn = { ...cors, ...downstreamHeaders(upstream.headers), [hopsHeader]: hopsSummary(hops) }
  // A host (or a cache on the way) that answers a range from the start with the whole file would make
  // Flow think the file can't be read in pieces, so seeking would never work. The piece asked for is
  // the file's beginning, so the answer can be cut down to it here.
  const total = Number(upstream.headers.get('Content-Length'))
  const piece = upstream.status === 200 && request.method === 'GET' && Number.isFinite(total) && total > 0 ? rangeFromStart(headers.Range, total) : null
  if (piece) {
    return new Response(upstream.body?.pipeThrough(firstBytes(piece.length)), {
      status: 206,
      headers: { ...passedOn, 'Content-Length': String(piece.length), 'Content-Range': `bytes 0-${piece.length - 1}/${total}`, 'Accept-Ranges': 'bytes' },
    })
  }
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: passedOn })
}

/** fetch() that skips Cloudflare's own cache. Files with a video extension count as cacheable there,
 *  and a cache in the way may answer a range request with the whole file. Older compatibility dates
 *  don't know the `cache` option and throw, so then the request goes without it. */
async function fetchUncached(url, init) {
  try {
    return await fetch(url, { ...init, cache: 'no-store' })
  } catch (error) {
    if (!/cache/i.test(String(error?.message))) throw error
    return fetch(url, init)
  }
}

/** Passes on the first `limit` bytes of a stream and stops there. */
function firstBytes(limit) {
  let sent = 0
  return new TransformStream({
    transform(chunk, controller) {
      const take = Math.min(chunk.byteLength, limit - sent)
      if (take > 0) controller.enqueue(take === chunk.byteLength ? chunk : chunk.subarray(0, take))
      sent += take
      if (sent >= limit) controller.terminate()
    },
  })
}

export default {
  async fetch(request, env) {
    const hops = []
    const response = await answer(request, env, hops)
    // One line a request for `npx wrangler tail`. Hosts and statuses only: a path or query string
    // holds a token or a file id.
    console.log(`${request.method} ${upstreamHeaders(request.headers).Range ?? 'no range'} -> ${response.status} | ${hopsSummary(hops) || 'no hops'}`)
    return response
  },
}
