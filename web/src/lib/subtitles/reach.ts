/* How a subtitle file's address is reached from a web page: directly, or through the viewer's stream proxy
   (Settings → Playback) when its host sends no CORS headers. The same plan as the IPTV code makes
   (lib/livetv/plan.ts), written out here on the shared proxy helpers so that the subtitle code and the
   Live TV code don't share a chunk, which would add to the first page's list of files to preload. */

import { hostOf, isMixedContent } from '../sources/http'
import { isKnownBlocked, proxied, rememberBlocked, streamProxy } from '../sources/proxy'
import type { Plan } from './download'

/** The requests to try, in order. With a proxy: straight through it for a host known to be blocked or one a page
 *  can't call at all, else directly first and through it if that fails. Without one, only directly. */
export function planAttempts(url: string, { proxy, blocked, mixed }: { proxy: string; blocked: boolean; mixed: boolean }): Plan {
  const direct = { url, viaProxy: false }
  if (proxy.trim()) {
    const viaProxy = { url: proxied(url, proxy), viaProxy: true }
    return { attempts: mixed || blocked ? [viaProxy] : [direct, viaProxy] }
  }
  if (mixed) {
    return { attempts: [], problem: `This page is on HTTPS and ${hostOf(url)} is http://, so the browser blocks it. Add a stream proxy in Settings → Playback that can reach it.` }
  }
  return { attempts: [direct] }
}

/** The plan for this address with the viewer's settings and what Flow has learned about the host. */
export const planFor = (url: string): Plan => planAttempts(url, { proxy: streamProxy(), blocked: isKnownBlocked(url), mixed: isMixedContent(url) })

/** After a download: a host that had to be reached through the proxy is remembered, so next time the proxy goes first. */
export function learn(url: string, result: { viaProxy: boolean; directBlocked: boolean }) {
  if (result.viaProxy && result.directBlocked) rememberBlocked(url)
}
