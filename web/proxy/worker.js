// Flow's stream proxy, as a Cloudflare Worker. It fetches a file for Flow on the web and adds the
// CORS headers the file's host leaves out, so Flow can read it (and convert its audio). Setup:
// README.md. The decisions are in match.js.
//
//   GET or HEAD  /?url=<encoded https address>[&token=<TOKEN>]

import { corsHeaders, downstreamHeaders, originAllowed, parseList, parseTarget, redirectStatuses, streamStatuses, targetAllowed, tokenMatches, upstreamHeaders } from './match.js'

/** Redirect hops followed before giving up: debrid links take one or two. */
const maxRedirects = 5

const text = (status, message, cors) => new Response(`${message}\n`, { status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } })

/** A Location header against the address that sent it: it may be relative. */
function resolve(location, base) {
  try {
    return new URL(location, base).href
  } catch {
    return null
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin, parseList(env.ALLOWED_ORIGINS))

    if (request.method === 'OPTIONS') {
      // A preflight from a page that isn't listed gets no CORS headers, which is how it's refused.
      return originAllowed(origin, parseList(env.ALLOWED_ORIGINS)) ? new Response(null, { status: 204, headers: cors }) : text(403, 'This page isn’t allowed to use this proxy.', cors)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Use GET or HEAD.', { ...cors, Allow: 'GET, HEAD, OPTIONS' })

    const params = new URL(request.url).searchParams
    if (!tokenMatches(params.get('token'), env.TOKEN)) return text(401, 'The token is missing or wrong.', cors)

    const target = parseTarget(params.get('url'))
    if (!target) return text(400, 'Pass an https address as ?url=.', cors)
    const hosts = { allowedHosts: parseList(env.ALLOWED_HOSTS), redirectHosts: parseList(env.ALLOWED_REDIRECT_HOSTS) }
    if (!targetAllowed(target, hosts)) return text(403, 'This host isn’t in ALLOWED_HOSTS.', cors)

    // Redirects are followed here, one at a time, so each host is checked and not only the first:
    // a play link on an allowed host can't send the proxy somewhere that isn't.
    const headers = upstreamHeaders(request.headers)
    let url = target
    let upstream
    for (let hop = 0; ; hop++) {
      try {
        upstream = await fetch(url, { method: request.method, headers, redirect: 'manual' })
      } catch {
        return text(502, 'Couldn’t reach the file’s host.', cors)
      }
      if (!redirectStatuses.has(upstream.status)) break
      const location = upstream.headers.get('Location')
      upstream.body?.cancel()
      if (hop >= maxRedirects) return text(502, 'Too many redirects.', cors)
      const next = location ? parseTarget(resolve(location, url)) : null
      if (!next) return text(502, 'The file’s host redirected somewhere the proxy won’t go.', cors)
      if (!targetAllowed(next, hosts, true)) return text(403, `The file redirects to ${next.hostname}, which isn’t in ALLOWED_HOSTS or ALLOWED_REDIRECT_HOSTS.`, cors)
      url = next
    }

    if (!streamStatuses.has(upstream.status)) {
      // The page needs the status (a file that's gone, a host that refused) but not the host's page.
      upstream.body?.cancel()
      // (A 204 or 304 can't carry a body, and nothing here should have produced one.)
      return text(upstream.status >= 400 ? upstream.status : 502, `The file’s host answered ${upstream.status}.`, cors)
    }
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: { ...cors, ...downstreamHeaders(upstream.headers) },
    })
  },
}
