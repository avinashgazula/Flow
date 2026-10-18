import type { PlaybackRequest, Source } from '../../lib/sources'

/** Lists what every add-on and server offers for the request, best first, and calls `onPick`.
 *  (Placeholder: the sources work fills this in.) */
export function SourcePicker(_props: { request: PlaybackRequest; onPick: (source: Source) => void; onClose: () => void }) {
  return null
}
