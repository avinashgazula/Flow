/* The stream proxy: a service the viewer runs (the Cloudflare Worker in web/proxy, or MediaFlow Proxy)
   that fetches a file for Flow and adds the CORS headers its host leaves out. Flow reads files with
   range requests from a Web Worker, so a host that sends no CORS headers (most debrid download
   servers) can't be read directly. Sending the request through the proxy makes it readable, which is
   also what lets Flow convert audio a browser can't decode.

   Flow only uses the proxy where it has to: for hosts known to need it, and for origins it has
   learned are blocked. Everything else is read directly, so the proxy's bandwidth isn't spent on
   files that never needed one. */

import { settingsStore } from '../store/settings'

/** Download hosts of the debrid services, which send no CORS headers. A host matches when it is one
 *  of these or a subdomain of one. */
const debridDomains = ['real-debrid.com', 'alldebrid.com', 'premiumize.me', 'torbox.app', 'debrid-link.com', 'offcloud.com']

/** The viewer's template, trimmed; empty when none is set. */
export const streamProxy = (): string => settingsStore.get().streamProxy.trim()

/** The address the file is read from through the proxy. `{url}` in the template takes the encoded
 *  address; a template without it gets `url=<encoded>` as a query parameter. With no template the
 *  address comes back unchanged. */
export function proxied(url: string, template: string = streamProxy()): string {
  const t = template.trim()
  if (!t) return url
  const encoded = encodeURIComponent(url)
  if (t.includes('{url}')) return t.split('{url}').join(encoded)
  const joiner = t.includes('?') ? (/[?&]$/.test(t) ? '' : '&') : '?'
  return `${t}${joiner}url=${encoded}`
}

/** What is wrong with a template, in words for Settings, or undefined when it can be used. An empty
 *  one is fine: it means no proxy. */
export function proxyProblem(template: string, pageProtocol = typeof location === 'undefined' ? 'https:' : location.protocol): string | undefined {
  const t = template.trim()
  if (!t) return undefined
  let parsed: URL
  try {
    parsed = new URL(proxied('https://example.com/file.mkv', t))
  } catch {
    return 'That doesn’t look like a web address. Start it with https://.'
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'Start the address with https://.'
  // A page on HTTPS can't call an http:// address; localhost is the one exception browsers make.
  if (parsed.protocol === 'http:' && pageProtocol === 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname)) return 'This page is on HTTPS, so the proxy has to be too. Use an https:// address.'
  return undefined
}

// MARK: Learned blocked origins

const storageKey = 'flow.blockedOrigins'
/** Enough for every add-on a person is likely to use, few enough to stay tiny. */
export const blockedOriginsCap = 50

/** Oldest first, so the newest are at the end and survive the cap. */
let blocked: string[] | undefined

const originOf = (url: string): string | undefined => {
  try {
    const { origin, protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? origin : undefined
  } catch {
    return undefined
  }
}

function load(): string[] {
  if (blocked) return blocked
  blocked = []
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey)
    const list: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(list)) blocked = list.filter((x): x is string => typeof x === 'string').slice(-blockedOriginsCap)
  } catch {
    // Storage can be blocked or hold something else: start with nothing learned.
  }
  return blocked
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(blocked ?? []))
  } catch {
    // Not saved: it's learned again next session, at the cost of one failed request.
  }
}

/** Notes that the origin of this address (the one Flow was given, such as an add-on's play link,
 *  not wherever it redirects) sent no CORS headers, so the next file from it goes through the
 *  proxy at once. */
export function rememberBlocked(url: string) {
  const origin = originOf(url)
  if (!origin) return
  const list = load().filter((o) => o !== origin)
  list.push(origin)
  blocked = list.slice(-blockedOriginsCap)
  save()
}

export function isKnownBlocked(url: string): boolean {
  const origin = originOf(url)
  return !!origin && load().includes(origin)
}

/** Forgets every learned origin (tests, and a way back if a host starts allowing web pages). */
export function forgetBlocked() {
  blocked = []
  try {
    localStorage.removeItem(storageKey)
  } catch {
    // Nothing stored to remove.
  }
}

// MARK: Which files need it

/** True for the download hosts of debrid services, and their subdomains. */
export function isDebridHost(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return debridDomains.some((d) => host === d || host.endsWith(`.${d}`))
}

/** True when a proxy is set and this file's host is one that needs it. */
export function needsProxy(url: string, template: string = streamProxy()): boolean {
  return template.trim() !== '' && (isKnownBlocked(url) || isDebridHost(url))
}

/** True when Flow can expect to read this file's bytes: through the proxy, or because nothing says
 *  its host blocks web pages. Audio conversion needs the bytes. */
export function isReadable(url: string, template: string = streamProxy()): boolean {
  return template.trim() !== '' || !(isKnownBlocked(url) || isDebridHost(url))
}
