import { programmesFor } from '../livetv/epg'
import type { Channel, EPG, Programme } from '../livetv/types'
import type { SportsEvent } from './types'

/* Finds the IPTV channels showing a game, as FlowKit's SportsChannelMatcher does: guide entries around kick-off that
   name the teams, then channels named after the league. Pure, so the apps' scoring is tested here too. */

export interface ChannelMatch {
  channel: Channel
  /** The guide entry that named the teams, when that's how it matched. */
  programme?: Programme
  score: number
}

/** Programmes starting this long before kick-off, or running up to three hours after, count. */
const earlyWindow = 30 * 60_000
const lateWindow = 3 * 3_600_000
const minimumScore = 20

/** Lowercased, accents and punctuation folded away, club prefixes dropped ("FC Barcelona" and "Barcelona" agree). */
export function normalised(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w && !['fc', 'afc', 'cf', 'sc', 'ac', 'the'].includes(w))
    .join(' ')
}

/** Best first; the first element is what a press-and-hold (or a tap, by the setting) plays. */
export function matchChannels(event: SportsEvent, channels: readonly Channel[], epg: EPG, now: number = Date.now()): ChannelMatch[] {
  const teams = [event.homeTeam, event.awayTeam].filter((t): t is string => !!t).map(normalised).filter(Boolean)
  const league = event.league ? normalised(event.league) : ''
  const kickoff = event.date ?? now
  const from = kickoff - earlyWindow
  const to = kickoff + lateWindow

  const out: ChannelMatch[] = []
  for (const channel of channels) {
    let score = 0
    let found: Programme | undefined
    for (const programme of programmesFor(epg, channel.epgID) ?? []) {
      if (!(programme.end > from && programme.start < to)) continue
      const text = ` ${normalised([programme.title, programme.subtitle, programme.description].filter(Boolean).join(' '))} `
      const named = teams.filter((t) => text.includes(` ${t} `)).length
      if (named === 0) continue
      let s = named >= 2 ? 100 : 50
      // Airing at kick-off beats a repeat or preview later on.
      if (programme.start <= kickoff + 15 * 60_000 && programme.end > kickoff) s += 10
      if (s > score) {
        score = s
        found = programme
      }
    }
    if (league && ` ${normalised(`${channel.name} ${channel.group}`)} `.includes(` ${league} `)) score += 20
    if (score >= minimumScore) out.push({ channel, programme: found, score })
  }
  return out.sort((a, b) => b.score - a.score || (a.channel.number ?? Infinity) - (b.channel.number ?? Infinity) || (a.channel.name < b.channel.name ? -1 : a.channel.name > b.channel.name ? 1 : 0))
}
