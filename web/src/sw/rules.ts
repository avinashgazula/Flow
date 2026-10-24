/* What the service worker caches, as pure functions so a test can state the rules. sw.ts only wires them
   to fetch events. The principle: Flow caches its own code and nothing it reads from anywhere else. Every
   request to TMDB, an add-on, a media server, the stream proxy or an image host is another origin, and the
   worker doesn't touch it, so the browser answers it as it would without a worker. Media, ranges and
   anything that isn't a GET are left alone too, whatever origin they come from. */

export interface RequestInfo {
  url: string
  method: string
  /** `request.mode`: "navigate" for a page load. */
  mode: string
  /** `request.destination`: "video", "audio", "script", "font" and so on. */
  destination: string
  /** Whether the request carries a Range header, which is how a player reads a stream. */
  ranged: boolean
}

/** How the worker answers a request: not at all, as a page load, or as one of Flow's own static files. */
export type Handling = 'network' | 'navigate' | 'static'

const mediaDestinations = new Set(['video', 'audio', 'track'])
const mediaFile = /\.(?:mkv|mp4|m4v|m4s|m4a|webm|ts|m3u8?|mp3|aac|flac|opus|ogg|wav|vtt|srt|ass)$/i

/** `scope` is the worker's own address, which always ends in a slash ("https://flow.example/Flow/"). Pass the
 *  files the build precached as paths relative to it, so a file outside assets/ and fonts/ (the icon, the
 *  manifest) is answered from the cache too. */
export function handlingFor(req: RequestInfo, scope: string, precached: ReadonlySet<string> = new Set()): Handling {
  if (req.method !== 'GET' || req.ranged || mediaDestinations.has(req.destination)) return 'network'
  let url: URL
  let base: URL
  try {
    url = new URL(req.url)
    base = new URL(scope)
  } catch {
    return 'network'
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return 'network'
  const path = url.pathname.slice(base.pathname.length)
  // The sample stream and any media file are never stored, even when they sit on Flow's own origin.
  if (path.startsWith('samples/') || mediaFile.test(path)) return 'network'
  if (req.mode === 'navigate') return 'navigate'
  if (path.endsWith('.map') || path === 'sw.js') return 'network'
  if (path.startsWith('assets/') || path.startsWith('fonts/') || precached.has(path)) return 'static'
  return 'network'
}

/** A response worth keeping: a whole, successful answer from Flow's own origin. A 206 (part of a file), an
 *  error page and an opaque cross-origin response are not. */
export function isStorable(res: { status: number; type: string }): boolean {
  return res.status === 200 && res.type === 'basic'
}

export const cachePrefix = 'flow-'
export const cacheName = (version: string) => `${cachePrefix}${version}`

/** The caches an update leaves behind: Flow's own, from any other version. Caches that aren't Flow's are
 *  none of the worker's business. */
export function staleCaches(names: readonly string[], version: string): string[] {
  return names.filter((n) => n.startsWith(cachePrefix) && n !== cacheName(version))
}

/** A file the build wrote. */
export interface BuiltFile {
  /** Path relative to the site's base, e.g. "assets/index-abc123.js". */
  path: string
  bytes: number
}

/** What goes in the shell cache on install: everything the first screen needs without a network. That is
 *  the hashed code and styles (the entry, what it imports and the route chunks) plus `extra`, the
 *  unhashed files (the edge-print font, the icon, the manifest). A chunk above `maxChunkBytes` (hls.js,
 *  which only the player loads) is left to be cached the first time it is used, so installing the app
 *  doesn't download a video engine nobody may open. `extra` is never trimmed, so pass the page's own scripts and styles there. */
export function precacheList(files: readonly BuiltFile[], extra: readonly string[], maxChunkBytes = 300_000): string[] {
  const hashed = files.filter((f) => /\.(?:js|css)$/.test(f.path) && f.bytes <= maxChunkBytes).map((f) => f.path)
  return [...new Set([...extra, ...hashed])].sort()
}

/** The files a page names in its own tags (`assets/index-abc.js`): the ones it can't open without, whatever their size. */
export function assetsIn(html: string): string[] {
  return [...new Set([...html.matchAll(/(?:src|href)="[^"]*?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!))]
}
