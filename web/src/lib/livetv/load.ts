import { useSyncExternalStore } from 'react'
import { learn, planFor } from './access'
import { fingerprint, isFresh, readCache, writeCache, clearCache } from './cache'
import { demoGuide, demoPlaylist, isDemoAddress } from './demo'
import { isEmptyEPG, mergeEPG } from './epg'
import type { GuideRequest, GuideResponse } from './epg.worker'
import { parseM3U } from './m3u'
import { fetchPlanned, LiveTVError } from './net'
import { emptyEPG, type Channel, type EPG, type IPTVProviderConfig } from './types'
import { parseXMLTV } from './xmltv'
import { XtreamClient } from './xtream'

/* Loads channels and the guide from every enabled provider, as the apps' LiveTVStore does: playlists
   first so the list can show, then the guide for the hours Flow displays. What was downloaded is kept in
   IndexedDB until the refresh time passes. */

export interface LiveState {
  status: 'idle' | 'loading' | 'ready'
  channels: Channel[]
  epg: EPG
  /** Why a provider's channels couldn't be loaded, in words for the viewer. */
  error?: string
  /** Why the guide couldn't be loaded; the channels still play. */
  guideError?: string
  /** When the channels and guide were downloaded. */
  loadedAt?: number
  /** A newer download is under way behind what is shown. */
  refreshing: boolean
}

const idle: LiveState = { status: 'idle', channels: [], epg: emptyEPG(), refreshing: false }
let state: LiveState = idle
const listeners = new Set<() => void>()
const publish = (patch: Partial<LiveState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const liveState = () => state
export const subscribeLive = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
export const useLiveTV = (): LiveState => useSyncExternalStore(subscribeLive, liveState, liveState)

/** The hours of guide kept: a little behind, so a programme that has just started still has its start. */
const guideWindow = (now: number) => ({ from: now - 3 * 3_600_000, to: now + 36 * 3_600_000 })

const byNumberThenName = (a: Channel, b: Channel) => (a.number ?? Infinity) - (b.number ?? Infinity) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/** One provider's channels, and where its playlist says the guide is. */
async function loadChannels(config: IPTVProviderConfig, signal: AbortSignal): Promise<{ channels: Channel[]; epgURL?: string }> {
  if (config.kind === 'xtream') {
    const client = new XtreamClient(config, planFor, { signal })
    return { channels: await client.channels(), epgURL: client.epgURL() }
  }
  let text: string
  if (isDemoAddress(config.url)) text = demoPlaylist()
  else {
    const fetched = await fetchPlanned(config.url, planFor(config.url), { signal, timeoutMs: 60_000 })
    learn(config.url, fetched)
    text = await fetched.response.text()
  }
  const playlist = parseM3U(text, config.id, { defaultUserAgent: config.userAgent, baseURL: config.url })
  return { channels: playlist.channels, epgURL: playlist.epgURL }
}

/** Reads a guide in a worker where there is one, else here. */
async function loadGuide(url: string, keep: { from: number; to: number; channels: string[] }, signal: AbortSignal): Promise<EPG> {
  if (isDemoAddress(url)) return parseXMLTV(demoGuide(Date.now()), { from: keep.from, to: keep.to, channels: new Set(keep.channels) })
  const plan = planFor(url)
  if (plan.problem) throw new LiveTVError(plan.problem)
  const answer = await runGuide({ url, attempts: plan.attempts, keep }, signal)
  if (!answer.ok) throw new LiveTVError(answer.message)
  learn(url, answer)
  return answer.epg
}

async function runGuide(request: GuideRequest, signal: AbortSignal): Promise<GuideResponse> {
  if (typeof Worker === 'undefined') {
    const { readXMLTV } = await import('./xmltv')
    try {
      const fetched = await fetchPlanned(request.url, { attempts: request.attempts }, { signal, timeoutMs: 120_000 })
      const epg = await readXMLTV(fetched.response.body!, { ...request.keep, channels: request.keep.channels ? new Set(request.keep.channels) : undefined }, signal)
      return { ok: true, epg, viaProxy: fetched.viaProxy, directBlocked: fetched.directBlocked }
    } catch (error) {
      if (signal.aborted) throw error
      return { ok: false, message: error instanceof Error ? error.message : 'The guide couldn’t be read.' }
    }
  }
  return new Promise<GuideResponse>((resolve, reject) => {
    const worker = new Worker(new URL('./epg.worker.ts', import.meta.url), { type: 'module' })
    const stop = () => {
      worker.terminate()
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    if (signal.aborted) return stop()
    signal.addEventListener('abort', stop, { once: true })
    worker.onmessage = (event: MessageEvent<GuideResponse>) => {
      signal.removeEventListener('abort', stop)
      worker.terminate()
      resolve(event.data)
    }
    worker.onerror = () => {
      signal.removeEventListener('abort', stop)
      worker.terminate()
      resolve({ ok: false, message: 'The guide couldn’t be read in this browser. Try a current Chrome, Edge, Safari or Firefox.' })
    }
    worker.postMessage(request)
  })
}

/** A short name for this set of providers: what a kept download belongs to. */
export const providersKey = (enabled: IPTVProviderConfig[]) =>
  fingerprint(enabled.map((p) => [p.id, p.kind, p.url, p.epgURL ?? '', p.username ?? '', p.password ?? ''].join('\u0001')).join('\u0002'))

let running: AbortController | undefined
let loadedKey = ''

export interface LoadOptions {
  refreshHours: number
  /** Download again even if what is kept is new enough. */
  force?: boolean
}

/** Loads Live TV for these providers. Called again for the same providers it does nothing unless `force`
 *  is set or the refresh time has passed. */
export async function loadLiveTV(providers: IPTVProviderConfig[], { refreshHours, force = false }: LoadOptions): Promise<void> {
  const enabled = providers.filter((p) => p.enabled)
  const key = providersKey(enabled)
  if (!force && key === loadedKey && state.status === 'ready' && state.loadedAt !== undefined && isFresh(state.loadedAt, refreshHours, Date.now(), !isEmptyEPG(state.epg))) return
  running?.abort()
  const controller = new AbortController()
  running = controller
  const { signal } = controller
  const sameProviders = key === loadedKey
  loadedKey = key

  if (enabled.length === 0) {
    publish({ ...idle, status: 'ready', loadedAt: Date.now() })
    return
  }

  // What was kept paints at once. If it is new enough that is all there is to do.
  const cached = force ? undefined : await readCache(key)
  if (signal.aborted) return
  if (cached) {
    publish({ status: 'ready', channels: cached.channels, epg: cached.epg, error: undefined, guideError: undefined, loadedAt: cached.at, refreshing: false })
    if (isFresh(cached.at, refreshHours, Date.now(), !isEmptyEPG(cached.epg))) return
  }
  // A refresh of what is on screen keeps it there; a first load shows the loading state.
  if (!cached && !(sameProviders && state.channels.length)) publish({ status: 'loading', channels: [], epg: emptyEPG(), error: undefined, guideError: undefined, loadedAt: undefined })
  publish({ refreshing: true })

  const settled = await Promise.allSettled(enabled.map(async (p) => ({ config: p, ...(await loadChannels(p, signal)) })))
  if (signal.aborted) return
  const loaded = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const errors = settled.flatMap((r) => (r.status === 'rejected' ? [r.reason instanceof Error ? r.reason.message : 'Couldn’t load the channels.'] : []))
  const channels = loaded.flatMap((l) => l.channels).sort(byNumberThenName)
  // A refresh that finds nothing (offline, a provider down) doesn't wipe the list the viewer is looking at.
  if (channels.length === 0 && state.channels.length > 0) {
    publish({ status: 'ready', error: errors[0], refreshing: false })
    return
  }
  publish({ status: 'ready', channels, error: errors[0], guideError: undefined })

  // The guide, for the channels there are: a guide lists far more than a playlist uses.
  const wanted = [...new Set(channels.flatMap((c) => (c.epgID ? [c.epgID.toLowerCase()] : [])))]
  const window = guideWindow(Date.now())
  let epg = emptyEPG()
  const guideErrors: string[] = []
  if (wanted.length > 0) {
    await Promise.all(
      loaded.map(async (l) => {
        const url = l.config.epgURL || l.epgURL
        if (!url) return
        try {
          epg = mergeEPG(epg, await loadGuide(url, { ...window, channels: wanted }, signal))
        } catch (error) {
          if (signal.aborted) return
          guideErrors.push(error instanceof Error ? error.message : 'Couldn’t load the guide.')
        }
      }),
    )
  }
  if (signal.aborted) return
  const at = Date.now()
  // A failed download is empty, and showing that over a good guide would hide it until the next refresh.
  const keepOld = isEmptyEPG(epg) && guideErrors.length > 0 && !isEmptyEPG(state.epg)
  publish({ epg: keepOld ? state.epg : epg, guideError: guideErrors[0], loadedAt: at, refreshing: false })
  if (channels.length > 0 && guideErrors.length === 0) void writeCache(key, { at, channels, epg })
}

/** A refresh the viewer asked for. */
export const refreshLiveTV = (providers: IPTVProviderConfig[], refreshHours: number) => loadLiveTV(providers, { refreshHours, force: true })

/** Forgets what was kept (a provider was removed or changed). */
export async function forgetLiveTV(providers: IPTVProviderConfig[]) {
  const enabled = providers.filter((p) => p.enabled)
  await clearCache(providersKey(enabled))
}

/** For Settings: tries one provider and says what it found, in words. */
export async function testProvider(config: IPTVProviderConfig): Promise<string> {
  const controller = new AbortController()
  if (config.kind === 'xtream') {
    const client = new XtreamClient(config, planFor, { signal: controller.signal })
    const info = await client.accountInfo()
    const channels = await client.channels()
    const expires = info.expiresAt ? `, expires ${new Date(info.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''
    return `Connected · ${channels.length.toLocaleString()} channels${expires}`
  }
  const { channels } = await loadChannels(config, controller.signal)
  return `Connected · ${channels.length.toLocaleString()} channels`
}
