import { StillWatching } from '../features/player/stillWatching'
import { buildICS } from '../lib/ics'
import { isBareDay } from '../lib/airDates'
import { applying, moving } from '../lib/watchlistOrder'
import { bindsLinksToConnection, isSlateURL, isTooShort, isTooSmall, looksLikeSlate } from '../lib/sources/slate'
import { homeReleaseStatus } from '../lib/tmdb/homeRelease'
import { contract } from './support'

contract('source-slate', ({ op, input }) => {
  switch (op) {
    case 'isSlateURL':
      return isSlateURL(input)
    case 'isTooShort':
      return isTooShort(input.duration, input.runtime ?? undefined)
    case 'isTooSmall':
      return isTooSmall(input.bytes ?? undefined, input.listed ?? undefined)
    case 'detect':
      return looksLikeSlate({ finalURL: input.finalURL, duration: input.duration, bytes: input.bytes, listedBytes: input.listed, expectedRuntimeMinutes: input.runtime })
    case 'bindsLinks':
      return bindsLinksToConnection(input)
    default:
      throw new Error(`unknown op ${op}`)
  }
})

contract('playback-still-watching', ({ input }) => {
  const state = new StillWatching()
  for (const [event, time, duration] of input.events as [string, number?, number?][]) {
    if (event === 'interaction') state.noteInteraction()
    else if (event === 'advance') state.noteAutomaticAdvance()
    else if (event === 'pause') state.notePause(time!, duration!)
    else throw new Error(`unknown event ${event}`)
  }
  return { count: state.unattendedEpisodes, ask: state.shouldAsk(input.limit) }
})

contract('watchlist-order', ({ op, input }) => {
  if (op === 'applying') return applying(input.saved, input.keys)
  if (op === 'moving') return moving(input.moving, input.target ?? undefined, input.keys)
  throw new Error(`unknown op ${op}`)
})

contract('calendar-ics', ({ op, input }) => {
  if (op === 'isBareDay') return isBareDay(input)
  if (op === 'build') {
    const ms = (text?: string) => (text === undefined ? undefined : Date.parse(text))
    const events = (input.events as Record<string, string>[]).map((e) => ({ uid: e.uid!, title: e.title!, day: e.day, start: ms(e.start), end: ms(e.end), description: e.notes, url: e.url }))
    return buildICS(events, Date.parse(input.now))
  }
  throw new Error(`unknown op ${op}`)
})

contract('home-release', ({ op, input }) => {
  if (op === 'status') return homeReleaseStatus(input.releases, input.region ?? undefined, input.now)
  throw new Error(`unknown op ${op}`)
})
