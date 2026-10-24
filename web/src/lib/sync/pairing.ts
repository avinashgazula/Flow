/* The pairing link and the server it names (docs/SYNC.md, Pairing). Pure text handling. */

import { encodeKey, incompleteKey, parseKey } from './crypto'

export interface Pairing {
  /** The 16 key bytes. */
  key: Uint8Array<ArrayBuffer>
  /** The Worker's origin, when the link carried one. */
  server?: string
  token?: string
}

/** The Worker's origin and token from the stream proxy setting: the origin of its template address and
 *  the value of its `token=`. Null when the setting is empty or not an address. */
export function serverFromProxy(template: string): { server: string; token: string } | null {
  const t = template.trim()
  if (!t) return null
  try {
    const url = new URL(t.split('{url}').join('x'))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return { server: url.origin, token: url.searchParams.get('token') ?? '' }
  } catch {
    return null
  }
}

/** A Worker address as typed: https:// added when missing, the path dropped. Null when it isn't one. */
export function normaliseServer(input: string): string | null {
  const t = input.trim()
  if (!t) return null
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(t) ? t : `https://${t}`)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/** The link another device opens: `<site>/settings#sync=k=…&s=…&t=…`. The fragment never reaches a
 *  server log. `siteBase` is the site's address up to and including the trailing slash. */
export function webLink(keyBytes: Uint8Array, server: string, token: string, siteBase: string): string {
  return `${siteBase.replace(/\/?$/, '/')}settings#sync=${query(keyBytes, server, token)}`
}

/** The link the apps open: `flow://sync?k=…&s=…&t=…`. */
export function appLink(keyBytes: Uint8Array, server: string, token: string): string {
  return `flow://sync?${query(keyBytes, server, token)}`
}

const query = (keyBytes: Uint8Array, server: string, token: string) => `k=${encodeKey(keyBytes)}&s=${encodeURIComponent(server)}&t=${encodeURIComponent(token)}`

/** What a person pastes into Join a Sync: a pairing link of either form, a fragment (`#sync=…`), or just
 *  the key. Returns the pairing, or the sentence to show when it can't be read. */
export function parsePairing(input: string): { ok: true; pairing: Pairing } | { ok: false; error: string } {
  const text = input.trim()
  let params: URLSearchParams | undefined
  const fragment = /#sync=(.*)$/s.exec(text) ?? /^sync=(.*)$/s.exec(text)
  if (fragment) params = new URLSearchParams(fragment[1])
  else if (/^flow:\/\/sync\b/i.test(text)) params = new URLSearchParams(text.slice(text.indexOf('?') + 1 || text.length))
  if (!params) {
    const key = parseKey(text)
    return key ? { ok: true, pairing: { key } } : { ok: false, error: incompleteKey }
  }
  const key = parseKey(params.get('k') ?? '')
  if (!key) return { ok: false, error: incompleteKey }
  const rawServer = params.get('s')
  const server = rawServer ? normaliseServer(rawServer) : null
  if (rawServer && !server) return { ok: false, error: 'That link has a server address Flow can’t read. Copy the link again from your other device.' }
  return { ok: true, pairing: { key, ...(server ? { server } : {}), ...(params.get('t') ? { token: params.get('t')! } : {}) } }
}
