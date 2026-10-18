import type { Source } from '../../lib/sources'

/** A failure the viewer can act on: `message` says what happened and what to do next; `detail`
 *  is the engine's own code, small on the error screen, for reporting. */
export class PlaybackError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'PlaybackError'
  }
}

/** Words for an HTMLMediaElement error (MediaError.code). */
export function mediaErrorMessage(code: number | undefined, source?: Pick<Source, 'unsupported'>): string {
  if (source?.unsupported && (code === 3 || code === 4)) return `This browser can’t play ${source.unsupported}. Pick another source.`
  switch (code) {
    case 2:
      return 'The connection to this source dropped. Check your connection, or pick another source.'
    case 3:
      return 'This browser couldn’t decode this video. Pick another source.'
    case 4:
      return 'This browser can’t play this file. Pick another source.'
    default:
      return 'This source stopped playing. Try again, or pick another source.'
  }
}

/** Words for a fatal hls.js error, by its type and details strings. */
export function hlsErrorMessage(type: string, details: string): string {
  if (type === 'networkError') {
    if (/^manifest/i.test(details)) return 'Couldn’t reach this stream. It may have expired or moved. Pick another source.'
    return 'The stream stopped loading. Check your connection, or pick another source.'
  }
  if (type === 'keySystemError') return 'This stream is protected and can’t play in a browser. Pick another source.'
  if (type === 'mediaError') return 'This browser couldn’t play this stream. Pick another source.'
  return 'This stream stopped playing. Try again, or pick another source.'
}
