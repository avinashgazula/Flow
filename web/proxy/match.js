// The pure parts of Flow's stream proxy: which hosts and origins are allowed, what is sent upstream
// and which headers come back. worker.js is the thin Cloudflare wrapper around them, and these are
// tested on their own (match.test.js).

/** Splits a comma-separated setting into trimmed, lower-case, non-empty entries. */
export function parseList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

/** True when `host` is one of `patterns`. A pattern is a host name (`files.example.com`) or a
 *  wildcard (`*.example.com`) that matches any subdomain of it, at any depth, but not the bare
 *  domain: list that too if it's wanted. A lone `*` matches nothing, on purpose: it would turn the
 *  proxy into an open one. */
export function hostMatches(host, patterns) {
  const name = String(host ?? '').toLowerCase().replace(/\.$/, '')
  if (!name) return false
  return patterns.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1)
      return suffix.length > 1 && name.length > suffix.length && name.endsWith(suffix)
    }
    return pattern !== '*' && name === pattern
  })
}

/** The address to fetch, or null when it isn't one the proxy will touch: https only, no embedded
 *  sign-in, and the standard port. */
export function parseTarget(raw) {
  if (!raw) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (url.port && url.port !== '443') return null
  return url
}

/** True when the origin a page sends is one the owner listed. Compared without a trailing slash. */
export function originAllowed(origin, allowedOrigins) {
  if (!origin) return false
  const normal = origin.trim().toLowerCase().replace(/\/$/, '')
  return allowedOrigins.includes(normal)
}

/** Whether the address is allowed as the first request (`ALLOWED_HOSTS`) or as a redirect target
 *  (`ALLOWED_HOSTS` or `ALLOWED_REDIRECT_HOSTS`). */
export function targetAllowed(url, { allowedHosts, redirectHosts = [] }, redirected = false) {
  return hostMatches(url.hostname, allowedHosts) || (redirected && hostMatches(url.hostname, redirectHosts))
}

/** Names the hosts that answered and how, so a failure can be read off Flow's screen and in
 *  `wrangler tail`: only host names and statuses, never a path or query string (those hold tokens
 *  and file ids). */
export const hopsHeader = 'X-Flow-Proxy-Hops'

/** `media.example.com 302, files.example.com 403`: one entry per host asked, in order. A status is
 *  a number, or a word when there was no answer (`unreachable`, `not allowed`). */
export function hopsSummary(hops) {
  return hops.map((hop) => `${hop.host} ${hop.status}`).join(', ')
}

/** True for the kinds of error body worth quoting: plain text and JSON. A host's HTML error page is
 *  skipped, since a snippet of it would only be markup. */
export function snippetWanted(contentType) {
  return /^\s*(text\/plain|application\/([\w.-]+\+)?json)\b/i.test(String(contentType ?? ''))
}

/** A host's error text made fit to show: no markup, no links (they may carry a token, so each
 *  becomes its host name), single spaces, and at most `max` characters. Empty when nothing is left. */
export function cleanSnippet(text, max = 160) {
  const clean = String(text ?? '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/([^\s/?#"'<>]+)[^\s"'<>]*/gi, '$1')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}

/** The headers that let a page read the answer, only for an allowed origin: nothing is added for
 *  any other, so the browser keeps blocking it. `Vary: Origin` always goes, since the answer
 *  depends on it. */
export function corsHeaders(origin, allowedOrigins) {
  const headers = { Vary: 'Origin' }
  if (!originAllowed(origin, allowedOrigins)) return headers
  return {
    ...headers,
    'Access-Control-Allow-Origin': origin.trim().replace(/\/$/, ''),
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Expose-Headers': `Content-Range, Content-Length, Accept-Ranges, Content-Type, ${hopsHeader}`,
    'Access-Control-Max-Age': '86400',
  }
}

const userAgent = 'Mozilla/5.0 (compatible; FlowStreamProxy)'

/** What goes to the file's host: the Range the page asked for and a plain User-Agent. Never the
 *  page's cookies, authorisation or anything else it sent. */
export function upstreamHeaders(requestHeaders) {
  const headers = { 'User-Agent': userAgent, 'Accept-Encoding': 'identity' }
  const range = requestHeaders.get('Range')
  // A Range is a unit and a list of spans; anything longer than a sane request is dropped.
  if (range && range.length < 200 && /^bytes=[\d,\s-]+$/i.test(range)) headers.Range = range
  return headers
}

const passed = ['Content-Range', 'Content-Length', 'Accept-Ranges', 'Content-Type']

/** The headers of the file's answer worth keeping. */
export function downstreamHeaders(upstream) {
  const headers = {}
  for (const name of passed) {
    const value = upstream.get(name)
    if (value) headers[name] = value
  }
  // A page under cross-origin isolation (needed by some decoders) may only embed what opts in.
  headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
  return headers
}

/** Statuses passed through with the file's own body: the file, a range of it, or a range past its end. */
export const streamStatuses = new Set([200, 206, 416])

/** Redirects the proxy follows itself, so every hop can be checked. */
export const redirectStatuses = new Set([301, 302, 303, 307, 308])

/** Compares the token in the address with the secret, taking the same time whatever matches. With no
 *  secret set there's nothing to check. */
export function tokenMatches(provided, secret) {
  if (!secret) return true
  const a = String(provided ?? '')
  const b = String(secret)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i)
  return diff === 0
}

/** For a single range that starts at the beginning (`bytes=0-1023`, or `bytes=0-`), how many bytes
 *  it covers of a file of `total` bytes. Null for anything else: a range further in can't be cut from
 *  an answer that starts at byte 0 without reading everything before it. */
export function rangeFromStart(range, total) {
  const m = /^bytes=0-(\d*)$/i.exec(String(range ?? '').trim())
  if (!m || !(total > 0)) return null
  const end = m[1] === '' ? total - 1 : Math.min(Number(m[1]), total - 1)
  return { length: end + 1 }
}
