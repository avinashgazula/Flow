/* WebDAV shares as a source provider, after FlowKit's WebDAVClient: list a share's Movies and TV Shows folders with
   PROPFIND, find the file named like the title, and offer it in the picker. A browser can only do this when the
   server lets web pages: the folder listing is a PROPFIND with an Authorization header, which the browser
   asks the server about first (CORS preflight), and most WebDAV servers answer that with nothing. The errors here
   say so, and what to allow. */

import type { WebDAVConfig } from '../store/settings'
import type { Capabilities } from './capabilities'
import { hostOf, isMixedContent, SourceError, withTimeout } from './http'
import { episodeRef, isUnsafeFileName, normalizeTitle, parseStream, titleAndYear } from './parser'
import { buildSource } from './rank'
import type { PlaybackRequest, Source } from './types'

export interface WebDAVEntry {
  /** As the server wrote it: an absolute path on its host, or a full address; percent-encoded. */
  href: string
  name: string
  isDirectory: boolean
  size?: number
  contentType?: string
}

export const videoExtensions: ReadonlySet<string> = new Set(['mkv', 'mp4', 'm4v', 'avi', 'mov', 'ts', 'm2ts', 'webm', 'wmv', 'mpg'])

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}
export const isVideo = (entry: WebDAVEntry) => !entry.isDirectory && videoExtensions.has(extensionOf(entry.name)) && !isUnsafeFileName(entry.name)

// MARK: Addresses

/** A configured folder ("/Movies") under the share's address, each part escaped. */
export function urlForPath(config: Pick<WebDAVConfig, 'url'>, path: string): string {
  const parts = path.split('/').filter(Boolean).map(encodeURIComponent)
  return [config.url.replace(/\/+$/, ''), ...parts].join('/')
}

/** An href from a PROPFIND answer: an absolute path on the host, or a full address. */
export function urlForHref(config: Pick<WebDAVConfig, 'url'>, href: string): string {
  try {
    return new URL(href, config.url).href
  } catch {
    return config.url
  }
}

const trimSlashes = (path: string) => path.replace(/^\/+|\/+$/g, '')

// MARK: Reading the answer

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeXML = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const point = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole
      }
      return entities[code.toLowerCase()] ?? whole
    })

/** The text of the first `<…:name>…</…:name>` in a block, whatever namespace prefix the server chose. A
 *  self-closing `<d:name/>` is no value. */
function field(block: string, name: string): string | undefined {
  const m = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*[^/>])?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, 'i').exec(block)
  const value = m ? unescapeXML(m[1]!).trim() : ''
  return value || undefined
}

/** The entries of a `DAV:multistatus` answer, tolerant of namespace prefixes. */
export function parseMultistatus(xml: string): WebDAVEntry[] {
  const entries: WebDAVEntry[] = []
  for (const m of xml.matchAll(/<(?:[\w.-]+:)?response(?:\s[^>]*[^/>])?>([\s\S]*?)<\/(?:[\w.-]+:)?response\s*>/gi)) {
    const block = m[1]!
    const href = field(block, 'href')
    if (!href) continue
    const isDirectory = /<(?:[\w.-]+:)?collection\b/i.test(block) || href.endsWith('/')
    let decoded = href
    try {
      decoded = decodeURIComponent(href)
    } catch {
      // Keep it as the server wrote it.
    }
    const size = Number(field(block, 'getcontentlength'))
    entries.push({
      href,
      name: field(block, 'displayname') ?? decoded.replace(/\/+$/, '').split('/').pop() ?? decoded,
      isDirectory,
      ...(Number.isFinite(size) && size > 0 && !isDirectory ? { size } : {}),
      ...(field(block, 'getcontenttype') ? { contentType: field(block, 'getcontenttype') } : {}),
    })
  }
  return entries
}

// MARK: Requests

const propfindBody =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/><d:displayname/></d:prop></d:propfind>'

/** `Authorization: Basic …` for a share with a login, UTF-8 safe. */
export function authHeaders(config: Pick<WebDAVConfig, 'username' | 'password'>): Record<string, string> {
  if (!config.username && !config.password) return {}
  const bytes = new TextEncoder().encode(`${config.username ?? ''}:${config.password ?? ''}`)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return { Authorization: `Basic ${btoa(binary)}` }
}

/** What to tell the viewer when the browser couldn't get an answer at all: a web page can't tell a server that is
 *  off from one that doesn't allow web pages, so the message covers both and says what to allow. */
export const corsMessage = (host: string) =>
  `Couldn’t read ${host}. Check the address, and that the server allows web pages to use it: turn on CORS for this site with the PROPFIND and OPTIONS methods and the Authorization, Depth and Content-Type headers. A stream proxy can carry the files but not the folder list.`

function statusError(host: string, status: number, path: string): SourceError {
  if (status === 401) return new SourceError(`${host} didn’t accept the username and password. Check them and try again.`, status)
  if (status === 403) return new SourceError(`${host} wouldn’t let this account read ${path || 'the share'}. Check its permissions.`, status)
  if (status === 404) {
    return new SourceError(path && path !== '/' ? `${host} has no folder called ${path}. Check the folder names for this share.` : `${host} didn’t find a share at that address. Check the address.`, status)
  }
  if (status === 405 || status === 501) return new SourceError(`${host} didn’t answer like a WebDAV server. Check the address; it usually ends in /dav or /webdav.`, status)
  if (status >= 500) return new SourceError(`${host} had a problem (${status}). Try again in a moment.`, status)
  return new SourceError(`${host} answered ${status}.`, status)
}

/** One folder's contents, one level deep (the folder itself left out). */
export async function propfind(config: WebDAVConfig, target: string, signal?: AbortSignal): Promise<WebDAVEntry[]> {
  const host = hostOf(target)
  if (isMixedContent(target)) throw new SourceError('This page is served over HTTPS, so your browser blocks an http:// share. Use the share’s https:// address, or run Flow locally to reach it.')
  const timer = withTimeout(signal, 20_000)
  try {
    const response = await fetch(target, {
      method: 'PROPFIND',
      headers: { ...authHeaders(config), Depth: '1', 'Content-Type': 'application/xml', Accept: 'application/xml' },
      body: propfindBody,
      signal: timer.signal,
    })
    if (response.status !== 207 && !response.ok) throw statusError(host, response.status, decodePath(target, config))
    const entries = parseMultistatus(await response.text())
    const here = trimSlashes(safePath(target))
    return entries.filter((e) => trimSlashes(safePath(urlForHref(config, e.href))) !== here)
  } catch (error) {
    if (error instanceof SourceError) throw error
    if (timer.timedOut()) throw new SourceError(`${host} took too long to answer.`)
    if ((error as Error)?.name === 'AbortError') throw error
    throw new SourceError(corsMessage(host))
  } finally {
    timer.done()
  }
}

/** The path of an address or an href, percent-decoded. */
const safePath = (url: string) => {
  let path = url
  try {
    path = new URL(url, 'http://dav.invalid').pathname
  } catch {
    // Not an address: use it as it is.
  }
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}
const decodePath = (target: string, config: Pick<WebDAVConfig, 'url'>) => {
  const base = trimSlashes(safePath(config.url))
  const path = trimSlashes(safePath(target))
  return `/${base && path.startsWith(base) ? trimSlashes(path.slice(base.length)) : path}`
}

/** The share's root, to test the address and the login. Answers how many things are in it. */
export async function testShare(config: WebDAVConfig, signal?: AbortSignal): Promise<number> {
  return (await propfind(config, urlForPath(config, '/'), signal)).length
}

// MARK: Scanning for video

/** Listings kept for a few minutes, so asking for a title's sources doesn't walk the share each time. */
const kept = new Map<string, { at: number; entries: Promise<WebDAVEntry[]> }>()
const keepMs = 5 * 60_000

function listing(config: WebDAVConfig, target: string, signal?: AbortSignal): Promise<WebDAVEntry[]> {
  const key = `${config.id}|${config.url}|${config.username ?? ''}|${target}`
  const hit = kept.get(key)
  if (hit && Date.now() - hit.at < keepMs) return hit.entries
  const entries = propfind(config, target, signal)
  kept.set(key, { at: Date.now(), entries })
  // A listing that failed or was cut short isn't worth keeping.
  entries.catch(() => kept.delete(key))
  return entries
}

/** Forgets what was listed (Settings → Test, or after a share is edited). */
export const forgetListings = () => kept.clear()

/** Video files under a folder, down to `depth` levels. A folder that can't be read is skipped, so one bad
 *  subfolder never hides the rest; the first level's failure is the caller's. */
export async function videos(config: WebDAVConfig, target: string, depth = 2, signal?: AbortSignal): Promise<WebDAVEntry[]> {
  const entries = await listing(config, target, signal)
  const found = entries.filter(isVideo)
  if (depth <= 0) return found
  const folders = entries.filter((e) => e.isDirectory).slice(0, 400)
  const deeper = await Promise.all(folders.map((dir) => videos(config, urlForHref(config, dir.href), depth - 1, signal).catch((error) => (signal?.aborted ? Promise.reject(error) : []))))
  return [...found, ...deeper.flat()]
}

// MARK: Matching

/** Whether a file is the film: its name, or the folder it's in ("Movie (2020)/movie.mkv"), names the title, within a
 *  year of it when both say one. As FlowKit's WebDAVMatcher. */
export function matchesMovie(entry: Pick<WebDAVEntry, 'href' | 'name'>, title: string, year?: number): boolean {
  const parent = safePath(entry.href).replace(/\/+$/, '').split('/').slice(-2, -1)[0] ?? ''
  const wanted = normalizeTitle(title)
  return [entry.name, parent].some((name) => {
    const parsed = titleAndYear(name)
    if (parsed.title !== wanted) return false
    if (year === undefined || parsed.year === undefined) return true
    return Math.abs(year - parsed.year) <= 1
  })
}

/** The show's folder among a share's TV Shows folders: named exactly, or starting with the show's name. */
export function matchShowFolder(folders: readonly Pick<WebDAVEntry, 'href' | 'name'>[], title: string): Pick<WebDAVEntry, 'href' | 'name'> | undefined {
  const wanted = normalizeTitle(title)
  return folders.find((d) => titleAndYear(d.name).title === wanted) ?? folders.find((d) => normalizeTitle(d.name).startsWith(wanted))
}

/** Every file in the share that plays the title: the film, or the episode asked for. */
export async function findFiles(config: WebDAVConfig, request: PlaybackRequest, signal?: AbortSignal): Promise<WebDAVEntry[]> {
  if (request.type === 'show') {
    const season = request.season ?? 1
    const number = request.episode ?? 1
    const folders = (await listing(config, urlForPath(config, config.showsPath || '/TV Shows'), signal)).filter((e) => e.isDirectory)
    const dir = matchShowFolder(folders, request.item.title)
    if (!dir) return []
    return (await videos(config, urlForHref(config, dir.href), 2, signal)).filter((e) => {
      const ref = episodeRef(e.name)
      return ref?.season === season && ref.episode === number
    })
  }
  const all = await videos(config, urlForPath(config, config.moviesPath || '/Movies'), 2, signal)
  return all.filter((e) => matchesMovie(e, request.item.title, request.item.year))
}

export async function webdavSources(config: WebDAVConfig, request: PlaybackRequest, caps: Capabilities, signal?: AbortSignal): Promise<Source[]> {
  const files = await findFiles(config, request, signal)
  return files.map((entry) => {
    const traits = parseStream(entry.name)
    if (entry.size) traits.sizeBytes = entry.size
    traits.isCached = undefined
    const headers = authHeaders(config)
    return buildSource(
      {
        id: `${config.id}#${entry.href}`,
        origin: 'webdav',
        provider: config.name,
        providerId: config.id,
        title: entry.name,
        // The address holds no login: a browser blocks one in a media address. A share with a password sends it as a header.
        url: urlForHref(config, entry.href),
        filename: entry.name,
        detail: safePath(entry.href),
        traits,
        ...(Object.keys(headers).length ? { headers } : {}),
      },
      caps,
    )
  })
}
