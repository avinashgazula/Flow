import { arrangeSources, passes } from '../lib/sources/order'
import type { SourceFilters, SourceOrdering, SourceSortRule } from '../lib/sources/sourceSettings'
import type { Source } from '../lib/sources/types'
import { contract } from './support'

type Vector = Record<string, any>

const origins: Record<string, Source['origin']> = { mediaServers: 'jellyfin', webDAV: 'webdav', addons: 'addon' }

/** A source as the website holds it after parsing: names for resolution and codec, a string for the release. */
const sourceOf = (s: Vector): Source =>
  ({
    id: s.id,
    origin: origins[s.category ?? 'addons'],
    provider: s.provider ?? 'a',
    providerId: s.provider ?? 'a',
    title: s.title ?? '',
    url: `https://example.com/${s.id}`,
    engine: 'native',
    ...(s.resolution ? { resolution: s.resolution === 480 ? '480p' : `${s.resolution}p` } : {}),
    ...(s.quality ? { quality: s.quality } : {}),
    ...(s.videoCodec ? { videoCodec: s.videoCodec === 'H264' ? 'H.264' : s.videoCodec } : {}),
    ...((s.sizeBytes ?? s.size) !== undefined ? { sizeBytes: s.sizeBytes ?? s.size } : {}),
    ...(s.cached !== undefined && s.cached !== null ? { cached: s.cached } : {}),
    ...(s.seeders !== undefined ? { seeders: s.seeders } : {}),
    ...(s.hdr ? { hdr: s.hdr } : {}),
    ...(s.languages ? { languages: s.languages } : {}),
    ...(s.detail ? { detail: s.detail } : {}),
    ...(s.filename ? { filename: s.filename } : {}),
  }) as unknown as Source

contract('source-rank', ({ op, input }) => {
  if (op === 'passes') return passes(sourceOf(input.source), input.filters as SourceFilters)
  if (op === 'arrange') {
    const ordering = {
      useCustomOrdering: input.custom,
      categoryOrder: input.categoryOrder,
      providerOrder: input.providerOrder,
      sortRules: input.rules as SourceSortRule[],
      filters: input.filters,
      resultCap: input.cap,
    } as unknown as SourceOrdering
    const heights: Record<string, number> = { SD: 480, '480p': 480, '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160 }
    const arranged = arrangeSources((input.sources as Vector[]).map(sourceOf), ordering, {
      providers: input.providers,
      audioLanguage: input.audioLanguage ?? undefined,
      hdrScreen: input.hdrScreen,
      resolutionFit: (s) => (s.resolution ? heights[s.resolution]! : 0),
    })
    return arranged.sources.map((s) => s.id)
  }
  throw new Error(`unknown op ${op}`)
})
