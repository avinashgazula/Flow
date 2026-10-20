/* What to tell the viewer when the remux worker's requests fail, built from what the server (or the
   stream proxy) answered. Pure, so the wording is tested; worker.ts only collects the facts. */

/** The response header the stream proxy in web/proxy lists the hosts it asked in (hosts and
 *  statuses only), for the viewer to read off the screen. */
export const PROXY_HOPS_HEADER = 'X-Flow-Proxy-Hops'
/** The stream proxy's address for where a play link ended up (see web/proxy/match.js). */
export const PROXY_DIRECT_HEADER = 'X-Flow-Proxy-Direct'

/** How much of an error body is read: the proxy's reasons are a sentence or two. */
export const DETAIL_BYTES = 2048

export interface HttpFailure {
  status: number
  /** What the answer said, when it was short text. */
  detail?: string
  /** The proxy's list of hosts and statuses, such as `media.example.com 302, files.example.com 403`. */
  hops?: string
}

/** True for the bodies worth reading: plain text and JSON, which is where servers and proxies put a
 *  reason. A web page (an error page, a login) would only be markup. */
export function detailWanted(contentType: string | null | undefined): boolean {
  return /^\s*(text\/plain|application\/([\w.-]+\+)?json)\b/i.test(contentType ?? '')
}

/** An error body made fit for the screen: no markup, no links (a link can hold a token, so it keeps
 *  only its host), single spaces and at most `max` characters. Undefined when nothing is left. */
export function cleanDetail(text: string, max = 200): string | undefined {
  const clean = text
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/([^\s/?#"'<>]+)[^\s"'<>]*/gi, '$1')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return undefined
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}

/** Ends a sentence that doesn't already end one. */
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/** The reason for a non-2xx answer. Through the proxy, its own text is already a sentence naming the
 *  host and the status ("The file’s host (files.example.com) answered 403. It said: …"), so it's
 *  shown as it is, with the hosts it asked after it. Anything else a proxy sent (JSON, say) is
 *  quoted with the status. Straight from a server, the status gets its usual advice and what the
 *  server said follows. */
export function httpFailureMessage({ status, detail, hops }: HttpFailure, viaProxy: boolean): string {
  if (viaProxy) {
    const hosts = hops ? ` Hosts asked: ${hops}.` : ''
    if (!detail) return `The stream proxy answered ${status}.${hosts}`
    const sayings = /^[[{]/.test(detail) ? `The stream proxy answered ${status}: ${detail}` : detail
    return `${sentence(sayings)}${hosts}`
  }
  const advice =
    status === 401 || status === 403
      ? 'The server refused the request. Check the sign-in for this source.'
      : status === 404
        ? 'The server doesn’t have this file any more. Try another source.'
        : `The server answered ${status}. Try again, or try another source.`
  return detail ? `${advice} It said: “${detail}”` : advice
}

/** The reason for a request that got no answer fetch() would show. `reachable` is whether a
 *  no-cors request to the same address got through (it did when the host is up but its answer
 *  can't be read), and `origin` is the page's, for the proxy's ALLOWED_ORIGINS. */
export function networkFailureMessage(viaProxy: boolean, reachable: boolean, origin?: string): string {
  if (!viaProxy) return 'Couldn’t reach the server. Check the connection and try again.'
  if (!reachable) return 'The stream proxy didn’t answer. Check its address in Settings → Playback.'
  return `The stream proxy answered, but the browser wouldn’t let this page read it. Add ${origin || 'this page’s address'} to ALLOWED_ORIGINS in the proxy’s settings.`
}
