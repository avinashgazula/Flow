import { hostOf } from '../sources/http'
import { proxied } from '../sources/proxy'
import type { Attempt } from './net'

/* Which requests to make for an IPTV address, given the viewer's stream proxy. */

const localHosts = /^(localhost|127\.0\.0\.1|\[::1\])$/

/** True when a page on `pageProtocol` can't call this address: https can't reach http (except the machine itself). */
export function isMixed(url: string, pageProtocol: string): boolean {
  if (pageProtocol !== 'https:') return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' && !localHosts.test(u.hostname)
  } catch {
    return false
  }
}

export interface PlanInput {
  /** The stream proxy template from Settings; empty for none. */
  proxy: string
  /** This address's origin is known to send no CORS headers. */
  blocked: boolean
  pageProtocol: string
}

/** The requests to try, in order, for an address. With a proxy: straight away through it for a host
 *  known to be blocked or one a page can't call at all, else directly first and through it if that
 *  fails. Without one, only directly, and `problem` says so when that can't work. */
export function planFetch(url: string, { proxy, blocked, pageProtocol }: PlanInput): { attempts: Attempt[]; problem?: string } {
  const mixed = isMixed(url, pageProtocol)
  const direct: Attempt = { url, viaProxy: false }
  if (proxy.trim()) {
    const viaProxy: Attempt = { url: proxied(url, proxy), viaProxy: true }
    return { attempts: mixed || blocked ? [viaProxy] : [direct, viaProxy] }
  }
  if (mixed) {
    return {
      attempts: [],
      problem: `This page is on HTTPS and ${hostOf(url)} is http://, so the browser blocks it. Add a stream proxy in Settings → Playback that can reach it, or use an https:// address if the provider has one.`,
    }
  }
  return { attempts: [direct] }
}

