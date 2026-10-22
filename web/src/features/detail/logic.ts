import type { PrintPart } from '../../components/Frame'
import { formatBytes } from '../../lib/sources/parser'
import { resolutionText } from '../sources/labels'
import type { ProviderState, Source } from '../../lib/sources'
import { endTime, formatClock, formatLeft, formatRuntime } from '../../lib/time'
import type { Episode, MediaDetail } from '../../lib/tmdb/types'
import { secondsLeft } from '../home/logic'

/* What the title page says, as plain functions: the strip under the still, and the film-can label's rows. */

const hdrNames: Record<string, string> = { DV: 'Dolby Vision', 'HDR10+': 'HDR10+', HDR10: 'HDR10', HDR: 'HDR', HLG: 'HLG' }


/** The source the page offers first, and so what Play starts: the one played last time when it's still
 *  listed, else the best that this browser can play. The same choice the picker makes. */
export function bestSource(list: Source[], lastPlayed?: Source): Source | undefined {
  return lastPlayed ?? list.find((s) => !s.unsupported)
}

/** The BEST VERSION row: ["2160p", "Dolby Vision", "TrueHD 7.1", "18.2 GB"]. Only what the release says. */
export function versionParts(s: Source): string[] {
  const sound = [s.audio?.[0], s.audioChannels].filter(Boolean).join(' ')
  return [resolutionText(s), s.hdr?.[0] ? (hdrNames[s.hdr[0]] ?? s.hdr[0]) : undefined, sound || undefined, s.sizeBytes ? formatBytes(s.sizeBytes) : undefined].filter((p): p is string => !!p)
}

export interface PlayFacts {
  /** The browser plays the file as it is (a direct file or HLS), rather than Flow remuxing it first. */
  direct: boolean
  mode: string
  /** Things to know before pressing Play. `warn` is a degraded experience. */
  notes: { text: string; tone: 'plain' | 'warn' }[]
}

/** The PLAYS row: how this browser will play the source, and what's compromised. */
export function playFacts(s: Source): PlayFacts {
  const direct = s.engine !== 'remux'
  const notes: PlayFacts['notes'] = []
  if (s.convertsAudio) notes.push({ text: 'Audio converted for this browser', tone: 'plain' })
  if (s.mayStutter) notes.push({ text: 'May stutter on this device', tone: 'warn' })
  return { direct, mode: direct ? 'Direct' : 'Remuxed in this browser', notes }
}

/** The SOURCES row: how many were found and who offered them, "5 · AIOStreams, Trellis". */
export function sourcesSummary(count: number, providers: ProviderState[]): string {
  const names = providers.filter((p) => p.state === 'done' && p.count > 0).map((p) => p.name)
  return [String(count), names.join(', ')].filter(Boolean).join(' · ')
}

/** The strip under the still, as edge print. A film: "2024 · 2 H 47 · 1 H 44 MIN LEFT · ENDS 22:56", the
 *  time left the one yellow fact; not started, just "2024 · 2 H 47 · ENDS 22:56". A series started prints
 *  the episode: "S3 E7 · 35 MIN LEFT · ENDS 22:56"; not started, "2008 · 5 SEASONS · 47 MIN · ENDS 22:56".
 *  `compact` drops the year, for a strip too narrow to hold it (the meta line has it). */
export function titlePrint(
  d: Pick<MediaDetail, 'type' | 'year' | 'runtime' | 'seasons'>,
  progress: { position: number; duration: number; episode?: { season: number; episode: number } } | undefined,
  now: number,
  locale?: string,
  compact = false,
): PrintPart[] {
  const seasons = d.seasons.filter((x) => x.number > 0).length
  const length = d.runtime ? formatRuntime(d.runtime * 60) : ''
  const started = progress && progress.duration > 0 ? progress : undefined
  const year = d.year && !compact ? String(d.year) : ''
  const facts: PrintPart[] = []
  if (started) {
    const left = secondsLeft(started)
    if (d.type === 'show') facts.push(started.episode ? `S${started.episode.season} E${started.episode.episode}` : '')
    else facts.push(year, length)
    facts.push({ key: formatLeft(left) }, `ends ${formatClock(endTime(now, left), locale)}`)
  } else {
    facts.push(year)
    if (d.type === 'show') facts.push(seasons ? `${seasons} ${seasons === 1 ? 'season' : 'seasons'}` : 'Series')
    facts.push(length)
    if (d.runtime) facts.push(`ends ${formatClock(endTime(now, d.runtime * 60), locale)}`)
  }
  return facts.filter((p) => p !== '')
}

/** The meta line above the title: "2024 · 2 h 47 min · PG-13 · Science Fiction, Adventure". */
export function metaLine(d: Pick<MediaDetail, 'type' | 'year' | 'runtime' | 'certification' | 'genreNames'>, genres: string[]): string {
  const minutes = d.runtime ? (d.runtime >= 60 ? `${Math.floor(d.runtime / 60)} h ${d.runtime % 60} min` : `${d.runtime} min`) : undefined
  const names = (d.genreNames.length ? d.genreNames : genres).slice(0, 2).join(', ')
  return [d.year, d.type === 'show' && minutes ? `${minutes} episodes` : minutes, d.certification, names].filter(Boolean).join(' · ')
}

/** The label of the yellow button: "Resume · 1 h 44 min left", "Play · ends 22:56", "Play S1 E1 · ends 21:30". */
export function playLabel(d: Pick<MediaDetail, 'type' | 'runtime'>, progress: { position: number; duration: number; episode?: { season: number; episode: number } } | undefined, firstEpisode: { season: number; episode: number } | undefined, now: number, locale?: string): { text: string; spoken: string } {
  if (progress && progress.duration > 0) {
    const left = formatLeft(secondsLeft(progress)).replace(' left', '')
    const where = progress.episode ? ` S${progress.episode.season} E${progress.episode.episode}` : ''
    return { text: `Resume${where} · ${left} left`, spoken: `Resume${where}, ${left} left` }
  }
  const ends = d.runtime ? `ends ${formatClock(endTime(now, d.runtime * 60), locale)}` : ''
  const where = d.type === 'show' && firstEpisode ? ` S${firstEpisode.season} E${firstEpisode.episode}` : ''
  const text = [`Play${where}`, ends].filter(Boolean).join(' · ')
  return { text, spoken: text }
}

/** The facts under an episode's still: "Fri 12 Jan" is the air date; the strip carries runtime and NEW. */
export function episodePrint(e: Pick<Episode, 'runtime' | 'airDate'>, opts: { aired: boolean; watched: boolean; now: number }): PrintPart[] {
  const parts: PrintPart[] = []
  if (!opts.aired) return ['Not yet aired']
  if (isNew(e.airDate, opts.now) && !opts.watched) parts.push({ key: 'new' })
  if (e.runtime) parts.push(formatRuntime(e.runtime * 60))
  return parts
}

const day = 24 * 60 * 60_000
/** Aired in the last two weeks. TMDB dates are calendar days, read as local midnight. */
export function isNew(airDate: string | undefined, now: number): boolean {
  if (!airDate) return false
  const [y = 1970, m = 1, d = 1] = airDate.split('-').map(Number)
  const age = now - new Date(y, m - 1, d).getTime()
  return age >= 0 && age < 14 * day
}

/** A TMDB calendar day as "12 Jan 2024". */
export function formatDay(date?: string, locale?: string): string | undefined {
  if (!date) return undefined
  const d = new Date(`${date}T12:00:00`)
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Seasons worth listing: real ones, specials last. */
export const realSeasons = <T extends { number: number }>(seasons: T[]): T[] => [...seasons].sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number))
