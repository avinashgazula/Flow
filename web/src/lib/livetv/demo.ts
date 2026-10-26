import { demoAway, demoHome, demoKickoff, demoLeague } from '../sports/demoFixture'
import type { IPTVProviderConfig } from './types'

/* The sample IPTV provider, as FlowKit's DemoTransport serves it: twelve channels in six groups, each
   playing one of Apple's public HLS samples, and a generated guide that always has something on now.
   The playlist and the guide are produced as real M3U and XMLTV text and read by the same parsers as
   a provider's, so the sample exercises the same code. Nothing leaves the page. */

export const demoPlaylistURL = 'https://demo.flow.invalid/live.m3u'
export const demoGuideURL = 'https://demo.flow.invalid/guide.xml'

/** Reachable everywhere and always playable. */
export const demoStreams = [
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8',
]

/** As the apps' demo setup adds it. With sample data on, Live TV shows this provider and no other. */
export const demoProvider: IPTVProviderConfig = {
  id: 'demo-iptv',
  name: 'Flow Live',
  kind: 'm3u',
  url: demoPlaylistURL,
  epgURL: demoGuideURL,
  enabled: true,
  useForVOD: false,
}

export const isDemoAddress = (url: string) => {
  try {
    return new URL(url).hostname === 'demo.flow.invalid'
  } catch {
    return false
  }
}

export const demoChannels: { id: string; name: string; group: string }[] = [
  { id: 'flow.news', name: 'Flow News', group: 'News' },
  { id: 'world.24', name: 'World 24', group: 'News' },
  { id: 'city.live', name: 'City Live', group: 'News' },
  { id: 'cinema.one', name: 'Cinema One', group: 'Movies' },
  { id: 'classics', name: 'Classics', group: 'Movies' },
  { id: 'indie.screen', name: 'Indie Screen', group: 'Movies' },
  { id: 'sport.hd', name: 'Sport HD', group: 'Sports' },
  { id: 'arena', name: 'Arena', group: 'Sports' },
  { id: 'discover.earth', name: 'Discover Earth', group: 'Documentary' },
  { id: 'deep.space', name: 'Deep Space', group: 'Documentary' },
  { id: 'kids.club', name: 'Kids Club', group: 'Kids' },
  { id: 'music.wave', name: 'Music Wave', group: 'Music' },
]

const programmeTitles: Record<string, string[]> = {
  News: ['Morning Briefing', 'World Report', 'Market Watch', 'The Evening Edition', 'Late Desk'],
  Movies: ['Feature Presentation', 'Double Bill', 'Director’s Cut', 'Midnight Movie'],
  Sports: ['Match Day Live', 'Highlights', 'The Locker Room', 'Championship Replay'],
  Documentary: ['Planet Unseen', 'Life in the Deep', 'Origins', 'The Frontier'],
  Kids: ['Cartoon Hour', 'Science Squad', 'Story Time'],
  Music: ['Top 40 Countdown', 'Live Sessions', 'Unplugged'],
}

export function demoPlaylist(): string {
  const lines = [`#EXTM3U x-tvg-url="${demoGuideURL}"`]
  demoChannels.forEach((ch, index) => {
    lines.push(`#EXTINF:-1 tvg-id="${ch.id}" tvg-chno="${index + 1}" group-title="${ch.group}",${ch.name}`)
    lines.push(demoStreams[index % demoStreams.length]!)
  })
  return lines.join('\n')
}

const pad = (n: number) => String(n).padStart(2, '0')
/** "20260101193000 +0000" */
const xmltvTime = (ms: number) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`
}

/** A guide from a little before `now` to the next fifteen hours or so: sixteen programmes a channel, half an
 *  hour to an hour and a half long, staggered by channel so they don't all change on the hour. */
export function demoGuide(now: number): string {
  const slot = 30 * 60_000
  const hour = Math.floor(now / slot) * slot
  // The sample game from Library → Sports: Sport HD shows it, and Arena has the home side's build-up, so a game
  // has a best channel and a second.
  const kickoff = demoKickoff(now)
  let xml = '<?xml version="1.0" encoding="UTF-8"?><tv>'
  demoChannels.forEach((ch, index) => {
    xml += `<channel id="${ch.id}"><display-name>${ch.name}</display-name></channel>`
    const titles = programmeTitles[ch.group] ?? ['Programme']
    let start = hour - (index % 3) * 600_000 - slot
    for (let n = 0; n < 16; n++) {
      const end = start + (30 + ((n + index) % 3) * 30) * 60_000
      const onAir = start < kickoff + 2 * slot && end > kickoff - slot
      const title =
        ch.id === 'sport.hd' && onAir ? `${demoLeague}: ${demoHome} v ${demoAway}` : ch.id === 'arena' && onAir ? `${demoHome} Matchday Live` : titles[(n + index) % titles.length]
      xml += `<programme start="${xmltvTime(start)}" stop="${xmltvTime(end)}" channel="${ch.id}"><title>${title}</title><desc>Live on ${ch.name}.</desc></programme>`
      start = end
    }
  })
  return xml + '</tv>'
}
