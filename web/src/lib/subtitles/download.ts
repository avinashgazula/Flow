/* Fetching a chosen subtitle: ask the service where the file is, fetch it (directly, or through the stream
   proxy when the file's host sends no CORS headers), unzip it, and decode it. Nothing here reads the
   settings; `planFor` and `learn` in lib/livetv/access.ts, which do, are handed in by the caller. */

import { hostOf, withTimeout } from '../sources/http'
import { episodeRef } from '../sources/parser'
import type { Attempt } from '../livetv/net'
import { decodeSubtitleBytes, subtitleFormat } from './decode'
import { providers, type Io } from './providers'
import { unpackSubtitle } from './zip'
import { SubtitleError, type Credentials, type Fetch, type SubtitleResult } from './types'
import type { SubtitleFormat } from '../../features/player/subtitles'

/** The requests to make for a file's address (the stream proxy setting and what is known of its host decide). */
export interface Plan {
  attempts: Attempt[]
  problem?: string
}

export interface DownloadedSubtitle {
  text: string
  format: SubtitleFormat
  /** The file's name inside a zip, when it came in one. */
  fileName?: string
}

export interface DownloadOptions {
  fetch?: Fetch
  signal?: AbortSignal
  /** For an episode: the zip of a season holds one file each, and this one is wanted. */
  episode?: { season: number; episode: number }
  /** How to reach a file's address: see lib/livetv/plan.ts. */
  plan(url: string): Plan
  /** Told when an address could only be read through the proxy, so the next one goes there first. */
  learn?(url: string, result: { viaProxy: boolean; directBlocked: boolean }): void
  timeoutMs?: number
}

const maxDownload = 12 * 1024 * 1024

const proxyHint = 'Add the host to your proxy’s ALLOWED_HOSTS (web/proxy/README.md).'

async function proxyReason(response: Response): Promise<string> {
  try {
    const said = (await response.text()).trim().replace(/\s+/g, ' ').slice(0, 200)
    return said && !said.startsWith('<') ? ` It said: “${said}”` : ''
  } catch {
    return ''
  }
}

/** Gets a file's bytes by the plan: the first attempt that answers decides. Only a request that never got an
 *  answer moves on to the next one (a host without CORS headers looks the same as a host that's down). */
async function fetchFile(url: string, headers: Record<string, string> | undefined, options: DownloadOptions): Promise<Uint8Array> {
  const plan = options.plan(url)
  if (plan.problem) throw new SubtitleError(plan.problem)
  // The proxy passes on no request headers, so a file that needs one is read directly or not at all.
  const attempts = headers ? plan.attempts.filter((a) => !a.viaProxy) : plan.attempts
  const doFetch = options.fetch ?? ((u, init) => fetch(u, init))
  const host = hostOf(url)
  let directBlocked = false
  for (const attempt of attempts) {
    const timer = withTimeout(options.signal, options.timeoutMs ?? 30000)
    let response: Response
    try {
      response = await doFetch(attempt.url, { signal: timer.signal, headers, credentials: 'omit', cache: 'no-store' })
    } catch (error) {
      timer.done()
      if (options.signal?.aborted) throw error
      if (timer.timedOut()) throw new SubtitleError(`${host} took too long to send the subtitle. Try again.`, 'network')
      if ((error as Error)?.name === 'AbortError') throw error
      if (!attempt.viaProxy) directBlocked = true
      continue
    }
    timer.done()
    if (!response.ok) {
      if (attempt.viaProxy) throw new SubtitleError(`Your stream proxy couldn’t open the subtitle at ${host} (it answered ${response.status}).${await proxyReason(response)} ${proxyHint}`, 'blocked')
      throw new SubtitleError(`${host} answered ${response.status} for that subtitle. Try again, or choose another.`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > maxDownload) throw new SubtitleError('That subtitle file is far bigger than a subtitle can be. Choose another.')
    options.learn?.(url, { viaProxy: attempt.viaProxy, directBlocked })
    return bytes
  }
  const triedProxy = plan.attempts.some((a) => a.viaProxy)
  if (headers) throw new SubtitleError(`${host} doesn’t let web pages download its files, and a stream proxy can’t pass on the key it needs. Use another service for this one.`, 'blocked')
  if (!triedProxy) {
    throw new SubtitleError(`${host} doesn’t let web pages download its files. Add a stream proxy in Settings → Playback with ${host} in its allowed hosts, then choose the subtitle again.`, 'blocked')
  }
  throw new SubtitleError(`Flow couldn’t download the subtitle from ${host}, directly or through your stream proxy. Check that the proxy is running, lists this page in ALLOWED_ORIGINS, and has ${host} in ALLOWED_HOSTS.`, 'blocked')
}

/** A result's file, ready to become a track. */
export async function downloadSubtitle(result: SubtitleResult, credentials: Credentials, options: DownloadOptions): Promise<DownloadedSubtitle> {
  const io: Io = { fetch: options.fetch ?? ((url, init) => fetch(url, init)), signal: options.signal }
  const where = await providers[result.provider].locate(result, credentials, io)
  const raw = await fetchFile(where.url, where.headers, options)
  const { episode } = options
  const { bytes, name } = await unpackSubtitle(raw, episode ? (file) => {
    const ref = episodeRef(file)
    return ref?.season === episode.season && ref.episode === episode.episode
  } : undefined)
  const text = decodeSubtitleBytes(bytes)
  if (!text.trim()) throw new SubtitleError('That subtitle file is empty. Choose another.')
  return { text, format: subtitleFormat(text), fileName: name }
}
