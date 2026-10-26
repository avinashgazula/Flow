import { resolveAudioLanguages } from '../language'
import { queryClient } from '../queryClient'
import { q } from '../queries'
import { settingsStore, type Settings } from '../store/settings'
import { addonSources } from './addons'
import { browserCapabilities, type Capabilities } from './capabilities'
import { demoProviderId, demoSources } from './demo'
import { SourceError, withTimeout } from './http'
import { libraryOriginFor } from './libraryOrigin'
import { dedupe, dedupeKey, orderedSources } from './rank'
import { normaliseSourceOrdering } from './sourceSettings'
import type { PlaybackRequest, Source } from './types'

export type { PlaybackRequest, Source, ExternalSubtitle, PlaybackEngine, SourceOrigin, Trickplay } from './types'
export { lastSourceFor, rememberSource } from './lastSource'
export { browserCapabilities } from './capabilities'

/** How long one add-on or server gets before the search goes on without it. */
export const providerTimeoutMs = 12_000

export interface ProviderResult {
  sources: Source[]
  /** Torrent-only results this provider returned: a browser can't play them without a debrid service. */
  torrents?: number
}

export interface Provider {
  id: string
  name: string
  kind: 'addon' | 'jellyfin' | 'emby' | 'plex' | 'webdav' | 'demo'
  search(request: PlaybackRequest, caps: Capabilities, signal: AbortSignal): Promise<ProviderResult>
}

export type ProviderState = { id: string; name: string; kind: Provider['kind'] } & (
  | { state: 'loading' }
  | { state: 'done'; count: number; torrents: number }
  | { state: 'failed'; error: string }
)

export interface SearchUpdate {
  /** Everything found so far, in the viewer's order (Settings → Sources), best first. */
  sources: Source[]
  /** How many sources the viewer's filters and result cap left out of `sources`. */
  hidden?: number
  providers: ProviderState[]
  /** Torrent-only results skipped, across every provider. */
  torrents: number
  finished: boolean
}

/** Every enabled add-on and server, plus the sample provider in sample-data mode. */
export function enabledProviders(settings: Settings = settingsStore.get()): Provider[] {
  const providers: Provider[] = []
  if (settings.demo) {
    providers.push({ id: demoProviderId, name: 'AIOStreams', kind: 'demo', search: async (r, caps, signal) => ({ sources: await demoSources(r, caps, signal) }) })
  }
  for (const server of settings.servers) {
    if (!server.enabled) continue
    providers.push({
      id: server.id,
      name: server.name,
      kind: server.kind,
      search: async (r, caps, signal) => {
        if (server.kind === 'plex') return { sources: await (await import('./plex')).plexSources(server, r, caps, signal) }
        return { sources: await (await import('./jellyfin')).jellyfinSources(server, r, caps, signal) }
      },
    })
  }
  for (const share of settings.webDAV ?? []) {
    if (!share.enabled) continue
    providers.push({ id: share.id, name: share.name, kind: 'webdav', search: async (r, caps, signal) => ({ sources: await (await import('./webdav')).webdavSources(share, r, caps, signal) }) })
  }
  for (const addon of settings.addons) {
    if (!addon.enabled) continue
    providers.push({ id: addon.url, name: addon.name, kind: 'addon', search: (r, caps, signal) => addonSources(addon, r, caps, signal) })
  }
  return providers
}

/** Fills in the IMDb id add-ons need when the caller didn't have it: the title page usually already
 *  loaded it, so this is normally a cache hit. */
async function withIMDb(request: PlaybackRequest): Promise<PlaybackRequest> {
  if (request.imdbId) return request
  try {
    const detail = await queryClient.ensureQueryData(q.detail(request.type, request.tmdbId))
    return detail.imdb ? { ...request, imdbId: detail.imdb } : request
  } catch {
    return request
  }
}

type SearchOptions = { signal?: AbortSignal; onUpdate?: (update: SearchUpdate) => void; providers?: Provider[]; capabilities?: Capabilities; timeoutMs?: number }

/** Asks every provider at once, reporting each one's state and the ranked list as answers arrive. With Play From
 *  This Library Only on, a title opened from one of a server's libraries asks that server first, and everyone
 *  only if it has nothing for the title (FlowKit's SourcePickerView.gather). */
export async function searchSources(request: PlaybackRequest, options: SearchOptions = {}): Promise<SearchUpdate> {
  const settings = settingsStore.get()
  const providers = options.providers ?? enabledProviders(settings)
  const origin = settings.sources?.playFromLibraryOnly ? libraryOriginFor(request.type, request.tmdbId) : undefined
  const library = origin ? providers.find((p) => p.id === origin) : undefined
  if (library && providers.length > 1) {
    // The library's answer stands in for the first pass; it only counts as finished once the rest is decided.
    const first = await searchAmong(request, { ...options, providers: [library], onUpdate: (u) => options.onUpdate?.({ ...u, finished: false }) })
    if (first.sources.length > 0) {
      options.onUpdate?.(first)
      return first
    }
  }
  return searchAmong(request, { ...options, providers })
}

async function searchAmong(request: PlaybackRequest, options: SearchOptions & { providers: Provider[] }): Promise<SearchUpdate> {
  const settings = settingsStore.get()
  const providers = options.providers
  const caps = options.capabilities ?? browserCapabilities()
  const prefs = { preferredQuality: settings.preferredQuality, kind: request.type, audioLanguage: resolveAudioLanguages(settings.audioLanguages, request.item.originalLanguage)[0] }
  const arrangement = { ordering: normaliseSourceOrdering(settings.sources), providers: providers.map((p) => ({ id: p.id, kind: p.kind })) }
  const states = new Map<string, ProviderState>(providers.map((p) => [p.id, { id: p.id, name: p.name, kind: p.kind, state: 'loading' }]))
  // Everything found, unfiltered: a provider that answers later can lift a source the cap had cut.
  let all: Source[] = []
  let found: Source[] = []
  let hidden = 0
  let torrents = 0
  const snapshot = (finished: boolean): SearchUpdate => ({ sources: found, hidden, providers: [...states.values()], torrents, finished })

  options.onUpdate?.(snapshot(providers.length === 0))
  if (providers.length === 0) return snapshot(true)
  const full = providers.some((p) => p.kind === 'addon') ? await withIMDb(request) : request

  await Promise.all(
    providers.map(async (provider) => {
      const { signal, done, timedOut } = withTimeout(options.signal, options.timeoutMs ?? providerTimeoutMs)
      try {
        const result = await provider.search(full, caps, signal)
        if (options.signal?.aborted) return
        torrents += result.torrents ?? 0
        all = dedupe([...all, ...result.sources])
        ;({ sources: found, hidden } = orderedSources(all, prefs, caps, arrangement))
        states.set(provider.id, { id: provider.id, name: provider.name, kind: provider.kind, state: 'done', count: result.sources.length, torrents: result.torrents ?? 0 })
      } catch (error) {
        if (options.signal?.aborted) return
        const message = timedOut() ? 'Didn’t answer in time.' : error instanceof SourceError ? error.message : 'Something went wrong. Try again.'
        states.set(provider.id, { id: provider.id, name: provider.name, kind: provider.kind, state: 'failed', error: message })
      } finally {
        done()
      }
      options.onUpdate?.(snapshot(false))
    }),
  )
  options.signal?.throwIfAborted()
  const final = snapshot(true)
  options.onUpdate?.(final)
  return final
}

/** Every enabled add-on and server, asked at once. Each provider's results are passed to
 *  `onResults` as they arrive, so the picker fills in instead of waiting for the slowest one.
 *  Resolves with everything found, ranked best first. */
export async function findSources(request: PlaybackRequest, options: { signal?: AbortSignal; onResults?: (sources: Source[], provider: string) => void } = {}): Promise<Source[]> {
  const reported = new Set<string>()
  const emitted = new Set<string>()
  const result = await searchSources(request, {
    signal: options.signal,
    onUpdate: (update) => {
      for (const p of update.providers) {
        if (p.state === 'loading' || reported.has(p.id)) continue
        reported.add(p.id)
        // Only this provider's sources that weren't already listed by another one.
        const fresh = update.sources.filter((s) => (s.providerId ?? s.provider) === p.id && !emitted.has(dedupeKey(s)))
        fresh.forEach((s) => emitted.add(dedupeKey(s)))
        options.onResults?.(fresh, p.name)
      }
    },
  })
  return result.sources
}
