import { isKnownBlocked, rememberBlocked, streamProxy } from '../sources/proxy'
import type { Fetched } from './net'
import { planFetch } from './plan'

/* The settings-aware half of reaching a provider: the viewer's stream proxy and what Flow has learned
   about which hosts send no CORS headers. */

export const pageProtocol = () => (typeof location === 'undefined' ? 'https:' : location.protocol)

/** The requests to make for this address, as the stream proxy setting and what is known of its host say. */
export const planFor = (url: string) => planFetch(url, { proxy: streamProxy(), blocked: isKnownBlocked(url), pageProtocol: pageProtocol() })

/** After a request: a host that had to be reached through the proxy is remembered, so next time the
 *  proxy goes first and no direct request is wasted. */
export function learn(url: string, result: Pick<Fetched, 'viaProxy' | 'directBlocked'>) {
  if (result.viaProxy && result.directBlocked) rememberBlocked(url)
}
