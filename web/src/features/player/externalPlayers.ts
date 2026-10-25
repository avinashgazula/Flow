/* Handing a stream to another app by its link, as the apps' ExternalPlayer does: the same list, the same
   link shapes (the ones Stremio uses), and Infuse also takes the resume point and the file's name. Pure, so
   it's tested; the page only has to point the browser at the link. */

import type { ExternalPlayerId } from '../../lib/store/settings'
import type { Source } from '../../lib/sources'

export type { ExternalPlayerId }
export type DevicePlatform = 'ios' | 'macos'

export const externalPlayerIds: ExternalPlayerId[] = ['none', 'infuse', 'vlc', 'outplayer', 'senPlayer', 'vidHub', 'cineUltra', 'moonPlayer', 'iina', 'mpv']

interface Player {
  title: string
  /** Where the app exists and takes a link. */
  platforms: DevicePlatform[]
  /** The link that opens `stream` (already percent-encoded where the app wants that). */
  link(stream: { raw: string; encoded: string }, options: { position?: number; filename?: string }): string
}

const both: DevicePlatform[] = ['ios', 'macos']
const phone: DevicePlatform[] = ['ios']
const mac: DevicePlatform[] = ['macos']

const players: Record<Exclude<ExternalPlayerId, 'none'>, Player> = {
  infuse: {
    title: 'Infuse',
    platforms: both,
    link: ({ encoded }, { position, filename }) => {
      let link = `infuse://x-callback-url/play?url=${encoded}`
      if (position && position > 0) link += `&position=${Math.floor(position)}`
      if (filename) link += `&filename=${encodeURIComponent(filename)}`
      return link
    },
  },
  vlc: { title: 'VLC', platforms: phone, link: ({ encoded }) => `vlc-x-callback://x-callback-url/stream?url=${encoded}` },
  outplayer: { title: 'Outplayer', platforms: phone, link: ({ raw }) => raw.replace(/^https?:\/\//i, 'outplayer://') },
  senPlayer: { title: 'SenPlayer', platforms: phone, link: ({ encoded }) => `SenPlayer://x-callback-url/play?url=${encoded}` },
  vidHub: { title: 'VidHub', platforms: both, link: ({ encoded }) => `open-vidhub://x-callback-url/open?url=${encoded}` },
  cineUltra: { title: 'CineUltra', platforms: phone, link: ({ encoded }) => `cineultra://playback?url=${encoded}` },
  moonPlayer: { title: 'Moon Player', platforms: phone, link: ({ raw }) => `moonplayer://open?url=${raw}` },
  iina: { title: 'IINA', platforms: mac, link: ({ encoded }) => `iina://weblink?url=${encoded}` },
  mpv: { title: 'mpv', platforms: mac, link: ({ raw }) => `mpv://${raw}` },
}

/** "Built-in Player" for the setting's own choice, else the app's name. */
export const externalPlayerTitle = (id: ExternalPlayerId): string => (id === 'none' ? 'Built-in Player' : players[id].title)

/** iPhone, iPad (which says "Macintosh" when asked for desktop sites, but has a touch screen) or Mac; any
 *  other device has none of these apps, so no link is offered. */
export function detectPlatform(userAgent: string, maxTouchPoints: number): DevicePlatform | undefined {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios'
  if (/Macintosh|Mac OS X/.test(userAgent)) return maxTouchPoints > 1 ? 'ios' : 'macos'
  return undefined
}

/** The apps that can be opened on this platform, the viewer's own choice first. */
export function playersFor(platform: DevicePlatform | undefined, preferred: ExternalPlayerId = 'none'): ExternalPlayerId[] {
  if (!platform) return []
  const ids = (Object.keys(players) as Exclude<ExternalPlayerId, 'none'>[]).filter((id) => players[id].platforms.includes(platform))
  return ids.sort((a, b) => Number(b === preferred) - Number(a === preferred))
}

/** The address an app can open for this source, or undefined when none can. The app fetches the file itself,
 *  so a link is only worth offering when the address alone is enough: a web address, with no request headers
 *  the stream needs (the app can't send them), and on a phone not one that points at this same computer.
 *  The remuxed or proxied copy the page plays is never it: that is the page's own, and the app gets the origin. */
export function streamLink(source: Pick<Source, 'url' | 'headers'>, platform: DevicePlatform | undefined): string | undefined {
  if (!platform) return undefined
  let url: URL
  try {
    url = new URL(source.url)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (source.headers && Object.keys(source.headers).length > 0) return undefined
  if (platform === 'ios' && /^(localhost|127\.|\[::1\]$|0\.0\.0\.0$)/.test(url.hostname)) return undefined
  return url.href
}

/** The link that hands `stream` to the app, or undefined for the built-in player. */
export function launchURL(id: ExternalPlayerId, stream: string, options: { position?: number; filename?: string } = {}): string | undefined {
  if (id === 'none') return undefined
  return players[id].link({ raw: stream, encoded: encodeURIComponent(stream) }, options)
}
