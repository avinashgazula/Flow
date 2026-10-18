import type { PlaybackRequest, Source } from './types'

export type { PlaybackRequest, Source, ExternalSubtitle, PlaybackEngine, SourceOrigin } from './types'

/** Every enabled add-on and server, asked at once. Each provider's results are passed to
 *  `onResults` as they arrive, so the picker fills in instead of waiting for the slowest one.
 *  Resolves with everything found, ranked best first. (Placeholder: the sources work fills this in.) */
export async function findSources(_request: PlaybackRequest, _options: { signal?: AbortSignal; onResults?: (sources: Source[], provider: string) => void } = {}): Promise<Source[]> {
  return []
}
