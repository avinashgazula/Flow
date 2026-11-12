/* Which account server this browser talks to (docs/SYNC.md, Marquee Accounts). The site's own build names one
   (`VITE_ACCOUNT_SERVER`), so Log In needs only the number. A build without one falls back to the Worker of the stream
   proxy setting, and then to an address typed in Settings. Pure, so it is tested without a browser. */

import { normaliseServer, serverFromProxy } from '../sync/pairing'

export type ServerSource = 'build' | 'proxy' | 'typed'

export function resolveServer(build: string | undefined, proxyTemplate: string, typed: string): { server: string; source: ServerSource } | null {
  const fromBuild = build ? normaliseServer(build) : null
  if (fromBuild) return { server: fromBuild, source: 'build' }
  const fromTyped = typed ? normaliseServer(typed) : null
  if (fromTyped) return { server: fromTyped, source: 'typed' }
  const fromProxy = serverFromProxy(proxyTemplate)
  return fromProxy ? { server: fromProxy.server, source: 'proxy' } : null
}
