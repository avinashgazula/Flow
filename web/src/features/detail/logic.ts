import { rank, type PrintPart } from '../../components/Frame'
import { formatBytes } from '../../lib/sources/parser'
import { resolutionText } from '../sources/labels'
import type { ProviderState, Source } from '../../lib/sources'
import { endTime, formatClock, formatLeft, formatRuntime } from '../../lib/time'
import { compactMoney } from '../../lib/reviewText'
import type { Episode, MediaDetail, MediaItem } from '../../lib/tmdb/types'
import { isAired } from '../../lib/watching'
import { endsPart, leftPart, secondsLeft } from '../home/logic'

/* What the title page says, as plain functions: the strip under the still, and the film-can label's rows. */

const hdrNames: Record<string, string> = { DV: 'Dolby Vision', 'HDR10+': 'HDR10+', HDR10: 'HDR10', HDR: 'HDR', HLG: 'HLG' }


/** The source the page offers first, and so what Play starts: the one played last time when it's still
 *  listed, else the best that this browser can play. The same choice the picker makes. */
export function bestSource(list: Source[], lastPlayed?: Source): Source | undefined {
  return lastPlayed ?? list.find((s) => !s.unsupported)
}

/** What Play opens, and whether that is the source played last time. Play goes where the player goes: the
 *  source the player remembered for this episode (the fresh copy from this search when it's listed, else as
 *  remembered, the way the player opens it), then the one the picker remembered, then the best that plays. The
 *  label says LAST PLAYED for the first two, so it never claims a ranking Play doesn't follow. */
export function playsFirst(list: Source[], remembered?: { source: Source; matched?: Source }, picked?: Source): { source?: Source; lastPlayed: boolean } {
  const last = remembered ? (remembered.matched ?? remembered.source) : picked
  return last ? { source: last, lastPlayed: true } : { source: list.find((s) => !s.unsupported), lastPlayed: false }
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

/** The strip under the still, as edge print. A film: "2024 · 2 H 47 · 1H44 LEFT · ENDS 22:56", the
 *  time left the one yellow fact; not started, just "2024 · 2 H 47 · ENDS 22:56". A series started prints
 *  the episode: "S3 E7 · 35M LEFT · ENDS 22:56"; not started, "2008 · 5 SEASONS · 47 MIN · ENDS 22:56".
 *  Every fact has a rank (stripLayout), so a strip with less room drops the year first and keeps the end time. */
export function titlePrint(
  d: Pick<MediaDetail, 'type' | 'year' | 'runtime' | 'seasons'>,
  progress: { position: number; duration: number; episode?: { season: number; episode: number } } | undefined,
  now: number,
  locale?: string,
): PrintPart[] {
  const seasons = d.seasons.filter((x) => x.number > 0).length
  const length: PrintPart = { text: d.runtime ? formatRuntime(d.runtime * 60) : '', rank: rank.facts }
  const started = progress && progress.duration > 0 ? progress : undefined
  const year: PrintPart = { text: d.year ? String(d.year) : '', rank: rank.year }
  const facts: PrintPart[] = []
  if (started) {
    const left = secondsLeft(started)
    if (d.type === 'show') facts.push({ text: started.episode ? `S${started.episode.season} E${started.episode.episode}` : '', rank: rank.episode })
    else facts.push(year, length)
    facts.push(leftPart(left), endsPart(left, now, locale))
  } else {
    facts.push(year)
    if (d.type === 'show') facts.push({ text: seasons ? `${seasons} ${seasons === 1 ? 'season' : 'seasons'}` : 'Series', rank: rank.facts })
    facts.push(length)
    if (d.runtime) facts.push(endsPart(d.runtime * 60, now, locale))
  }
  return facts
}

/** The meta line under the title: "2024 · 2 h 47 min · PG-13 · Science Fiction, Adventure". */
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

/** The facts under an episode's still: "Fri 12 Jan" is the air date; the strip carries runtime and NEW (print
 *  like the rest: yellow is for what you act on). */
export function episodePrint(e: Pick<Episode, 'runtime' | 'airDate'>, opts: { aired: boolean; watched: boolean; now: number }): PrintPart[] {
  const parts: PrintPart[] = []
  if (!opts.aired) return ['Not yet aired']
  if (isNew(e.airDate, opts.now) && !opts.watched) parts.push({ text: 'new', rank: rank.left })
  if (e.runtime) parts.push({ text: formatRuntime(e.runtime * 60), rank: rank.facts })
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

/** Seasons worth listing: real ones in order, and Specials last when Settings → Specials Season is on. */
export const realSeasons = <T extends { number: number }>(seasons: T[], specials = true): T[] =>
  [...seasons].filter((x) => specials || x.number > 0).sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number))

/** Today as the calendar day TMDB's air dates are written in. */
export const todayOf = (now: number) => new Date(now).toISOString().slice(0, 10)

/** The aired episodes among a show's, as the references the library and Next Up work in. An episode with no air
 *  date is not yet scheduled, so it is not one of them (as the apps count). */
export function airedRefs(episodes: Pick<Episode, 'season' | 'number' | 'airDate'>[], today: string): { season: number; episode: number }[] {
  return episodes.filter((e) => isAired(e.airDate, today)).map((e) => ({ season: e.season, episode: e.number }))
}

/** TMDB says "Returning Series"; the row's label already says it is a show. */
export const statusLabel = (status: string) => (status === 'Returning Series' ? 'Returning' : status)

/** "2 h 47 min", "45 min": a runtime as a sentence. */
export const runtimeText = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`)

export interface AboutRow {
  label: string
  value: string
  /** A long list sits across two columns. */
  wide?: boolean
}

type AboutFacts = Pick<MediaDetail, 'type' | 'date' | 'runtime' | 'seasons' | 'crew' | 'certification' | 'status' | 'originalLanguage' | 'originCountries' | 'budget' | 'revenue' | 'productionCompanies' | 'networks'>

/** The About table, row for row as the apps list it: the essentials (release, runtime, seasons, director, rating)
 *  always, and with About on in Settings the rest (status, language, country, money, companies, network). A row
 *  with nothing to say is left out. */
export function aboutRows(d: AboutFacts, opts: { full: boolean; locale?: string }): AboutRow[] {
  const rows: AboutRow[] = []
  const add = (label: string, value: string | undefined, wide?: boolean) => value && rows.push({ label, value, ...(wide ? { wide } : {}) })
  const names = (type: 'language' | 'region', code: string) => {
    try {
      return new Intl.DisplayNames([opts.locale ?? 'en'], { type }).of(code) ?? code
    } catch {
      return code
    }
  }
  add(d.type === 'movie' ? 'Released' : 'First Aired', formatDay(d.date, opts.locale))
  add('Runtime', d.runtime && d.runtime > 0 ? runtimeText(d.runtime) : undefined)
  const seasons = d.seasons.filter((x) => x.number > 0).length
  add('Seasons', seasons ? String(seasons) : undefined)
  const directors = d.crew.filter((c) => c.role === 'Director' || c.role === 'Creator').map((c) => c.name)
  add(d.type === 'movie' ? (directors.length > 1 ? 'Directors' : 'Director') : 'Created By', directors.join(', '), directors.length > 2)
  add('Rated', d.certification)
  if (!opts.full) return rows
  add('Status', d.status ? statusLabel(d.status) : undefined)
  add('Original Language', d.originalLanguage ? names('language', d.originalLanguage) : undefined)
  const countries = (d.originCountries ?? []).map((c) => names('region', c))
  add(countries.length > 1 ? 'Countries' : 'Country', countries.join(', '), countries.length > 2)
  add('Budget', d.budget && d.budget > 0 ? compactMoney(d.budget) : undefined)
  add('Revenue', d.revenue && d.revenue > 0 ? compactMoney(d.revenue) : undefined)
  const companies = d.productionCompanies ?? []
  add('Production', companies.join(', '), companies.length > 1)
  add(d.networks.length > 1 ? 'Networks' : 'Network', d.networks.join(', '), d.networks.length > 2)
  return rows
}

/** A 1 to 10 score as whole stars, two points each (as the apps' RatingStars): 7 is three stars. */
export const starsOf = (score: number | undefined) => Math.floor((score ?? 0) / 2)

/** Only what a library entry needs: a full detail would store its cast and recommendations. */
export const cardOf = (d: MediaItem): MediaItem => ({
  type: d.type,
  id: d.id,
  title: d.title,
  year: d.year,
  date: d.date,
  overview: d.overview,
  poster: d.poster,
  backdrop: d.backdrop,
  rating: d.rating,
  genres: d.genres,
  originalLanguage: d.originalLanguage,
})
