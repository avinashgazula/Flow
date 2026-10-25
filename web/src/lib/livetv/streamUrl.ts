/* Addresses to try for a live channel, after FlowKit's LiveStreamURL. Browsers (like Apple's players) play
   MPEG-TS only inside HLS, and most IPTV panels serve the same channel as HLS at ".m3u8". */

const extensionOf = (pathname: string) => {
  const last = pathname.split('/').pop() ?? ''
  const dot = last.lastIndexOf('.')
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : ''
}

function withExtension(url: string, ext: string): string | undefined {
  try {
    const u = new URL(url)
    u.pathname = u.pathname.replace(/\.[^./]+$/, '') + '.' + ext
    return u.toString()
  } catch {
    return undefined
  }
}

export function streamCandidates(url: string): string[] {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return [url]
  }
  const ext = extensionOf(parsed.pathname)
  if (ext === 'ts' || ext === 'mpegts') return [withExtension(url, 'm3u8'), url].filter((x): x is string => !!x)
  if (ext === '') {
    // ".../live/user/pass/1234" or ".../user/pass/1234": a panel stream id without an extension.
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length >= 3 && /^\d+$/.test(parts[parts.length - 1]!)) {
      const hls = new URL(url)
      hls.pathname += '.m3u8'
      return [url, hls.toString()]
    }
  }
  return [url]
}

/** True for a raw MPEG transport stream, which a browser can't play outside HLS. */
export const isRawTransportStream = (url: string): boolean => {
  try {
    const ext = extensionOf(new URL(url).pathname)
    return ext === 'ts' || ext === 'mpegts'
  } catch {
    return false
  }
}

/** True when the browser can play the address as a plain file rather than as HLS. */
export const isPlainMedia = (url: string): boolean => {
  try {
    return ['mp4', 'm4v', 'webm', 'mov'].includes(extensionOf(new URL(url).pathname))
  } catch {
    return false
  }
}
