import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Plate } from '../../components/Frame'
import { markZoomSource } from '../../components/zoom'
import { buildICS, downloadICS, icsFileName } from '../../lib/ics'
import { prefetchDetail, q } from '../../lib/queries'
import { useLibrary } from '../../lib/store/library'
import { useSettings } from '../../lib/store/settings'
import { userLocale, useMinuteTick } from '../../lib/time'
import { isWatched } from '../../lib/watching'
import { ChipRow } from '../explore/ChipRow'
import { errorMessage, StateView } from '../explore/Controls'
import { filmCandidates, type UpcomingFilm } from '../home/upcoming'
import {
  arrange,
  code,
  eventFileName,
  filmEntries,
  followedShowItems,
  fullDate,
  icsEvent,
  meta,
  needsSeason,
  relativeDay,
  showEntries,
  spoken,
  stripDays,
  stripPrint,
  type CalendarEntry,
} from './calendar'
import s from './UpcomingPage.module.css'

/* Upcoming, as the apps' Calendar: what is new and what is next from the shows and films you follow, day by day. A
   strip of the next two weeks jumps to a day, the last week's episodes are Just Aired, and every entry can go into
   a calendar app as an .ics file (calendar.ts and lib/ics.ts do the deciding and the writing). */

const maxFilms = 30

function useCalendar(now: number) {
  const progress = useLibrary((l) => l.progress)
  const watchlist = useLibrary((l) => l.watchlist)
  const favourites = useLibrary((l) => l.favourites)
  const history = useLibrary((l) => l.history)
  const filmDates = useSettings((x) => x.filmDates ?? 'digital')
  const region = useSettings((x) => x.region)

  const shows = followedShowItems({ progress, watchlist, favourites, history })
  const details = useQueries({ queries: shows.map((item) => q.detail('show', item.id)) })
  // The rest of an airing season is one more request, only for a show whose next episode is in the window.
  const seasonOf = shows.map((_, i) => needsSeason(details[i]?.data, now))
  const seasons = useQueries({ queries: shows.map((item, i) => ({ ...q.season(item.id, seasonOf[i] ?? 0), enabled: seasonOf[i] !== undefined && !details[i]?.isPlaceholderData })) })
  const filmItems = filmCandidates(watchlist, now, maxFilms)
  const filmDetails = useQueries({ queries: filmItems.map((item) => q.detail('movie', item.id)) })

  const episodes = shows.flatMap((item, i) => showEntries(item, details[i]?.isPlaceholderData ? undefined : details[i]?.data, seasons[i]?.data, now))
  const films: UpcomingFilm[] = filmItems.map((item, i) => ({ item, releases: filmDetails[i]?.data?.releases ?? [] }))
  const entries = [...episodes, ...filmEntries(films, filmDates, region, now)]

  const asked = [...details, ...filmDetails]
  const waiting = (x: { isPlaceholderData: boolean; isPending: boolean; fetchStatus: string }) => x.isPlaceholderData || (x.isPending && x.fetchStatus !== 'idle')
  const loading = asked.some(waiting) || seasons.some((x) => x.isFetching && !x.data)
  // Every lookup failed (no TMDB key, no connection): say so, rather than "nothing coming up".
  const error = asked.length > 0 && asked.every((x) => x.isError) ? asked.find((x) => x.error)?.error : undefined
  return { entries, loading, error, hasTitles: shows.length + filmItems.length > 0 }
}

export default function UpcomingPage() {
  const now = useMinuteTick()
  const { entries, loading, error, hasTitles } = useCalendar(now)
  const marks = useLibrary((l) => l.watchedEpisodes)
  const rewatches = useLibrary((l) => l.rewatches)
  const { justAired, days } = arrange(entries, now)
  const [saved, setSaved] = useState<string>()

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(undefined), 8000)
    return () => clearTimeout(timer)
  }, [saved])

  const watchedOf = (e: CalendarEntry) => !!e.episode && isWatched({ watchedEpisodes: marks, rewatches }, e.item.id, { season: e.episode.season, episode: e.episode.number })
  const save = (list: CalendarEntry[], fileName: string) => {
    downloadICS(buildICS(list.map(icsEvent), Date.now()), icsFileName(fileName))
    setSaved(`Saved ${icsFileName(fileName)}. Open it to add ${list.length === 1 ? 'it' : 'them'} to your calendar.`)
  }
  const upcoming = days.flatMap((d) => d.entries)

  const jump = (date: number) => {
    const day = days.find((d) => d.date === date)
    const el = day && document.getElementById(`day-${day.iso}`)
    if (!el) return
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    el.focus({ preventScroll: true })
  }

  if (error && entries.length === 0) {
    return <StateView icon="calendar" title="Upcoming Couldn’t Load" message={errorMessage(error)} />
  }
  if (!loading && entries.length === 0) {
    return (
      <StateView
        icon="calendar"
        title="Nothing Coming Up"
        message={hasTitles ? 'New episodes of the shows in your library, and films on your watchlist, appear here as their dates approach.' : 'Watch a series, or add a film to your watchlist, and new episodes and releases appear here as their dates approach.'}
        action={
          <Link to="/explore" className="btn btn-secondary">
            Browse Titles
          </Link>
        }
      />
    )
  }

  return (
    <div className={s.page}>
      <div className={s.tools}>
        <button type="button" className="btn btn-secondary btn-compact" disabled={upcoming.length === 0} onClick={() => save(upcoming, 'Flow Upcoming')}>
          <Icon name="calendar" size={16} /> Add All to Calendar
        </button>
        <p className={`${s.saved} muted`} role="status">
          {saved}
        </p>
      </div>

      {loading && entries.length === 0 ? (
        <Ghosts />
      ) : (
        <>
          <DayStrip now={now} marked={new Set(days.map((d) => d.date))} onSelect={jump} />
          {justAired.length > 0 && (
            <JustAired>
              {justAired.map((e) => (
                <JustAiredItem key={e.id} entry={e} now={now} watched={watchedOf(e)} />
              ))}
            </JustAired>
          )}
          {days.map((day) => (
            <section key={day.iso} id={`day-${day.iso}`} tabIndex={-1} className={s.day} aria-labelledby={`h-${day.iso}`}>
              <header className={s.dayHead}>
                <h2 id={`h-${day.iso}`} className={s.dayTitle}>
                  {relativeDay(day.date, now, userLocale)}
                </h2>
                <span className={s.dayDate}>{fullDate(day.date, userLocale)}</span>
              </header>
              <ul className={s.rows}>
                {day.entries.map((e) => (
                  <Row key={e.id} entry={e} now={now} watched={watchedOf(e)} onAdd={() => save([e], eventFileName(e))} />
                ))}
              </ul>
            </section>
          ))}
          {loading && <p className={`${s.more} muted`} role="status">Looking for more…</p>}
        </>
      )}
    </div>
  )
}

/** Two weeks at a glance. Days with something on carry a dot and jump to their section; the others are just days. */
function DayStrip({ now, marked, onSelect }: { now: number; marked: ReadonlySet<number>; onSelect: (date: number) => void }) {
  const days = stripDays(now, marked)
  const weekday = new Intl.DateTimeFormat(userLocale, { weekday: 'short' })
  const number = new Intl.DateTimeFormat(userLocale, { day: 'numeric' })
  const spokenDay = new Intl.DateTimeFormat(userLocale, { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <ChipRow label="Next two weeks">
      {days.map((d) => {
        const inner = (
          <>
            <span className={s.cellWeekday}>{weekday.format(d.date)}</span>
            <span className={`${s.cellNumber} num`}>{number.format(d.date)}</span>
            <span className={s.cellDot} aria-hidden="true" />
          </>
        )
        const label = `${spokenDay.format(d.date)}${d.today ? ', today' : ''}${d.marked ? ', has something coming up' : ''}`
        return d.marked ? (
          <button key={d.date} type="button" className={s.cell} data-today={d.today || undefined} data-marked="" aria-label={label} onClick={() => onSelect(d.date)}>
            {inner}
          </button>
        ) : (
          <span key={d.date} className={s.cell} data-today={d.today || undefined} role="img" aria-label={label}>
            {inner}
          </span>
        )
      })}
    </ChipRow>
  )
}

/** The last seven days' episodes and releases, newest first. Aired episodes play straight away. */
function JustAired({ children }: { children: React.ReactNode }) {
  const row = useRef<HTMLUListElement>(null)
  const scroll = (direction: 1 | -1) => row.current?.scrollBy({ left: direction * row.current.clientWidth * 0.85, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  return (
    <section className={s.justAired} aria-labelledby="just-aired">
      <header className={s.dayHead}>
        <h2 id="just-aired" className={s.dayTitle}>
          Just Aired
        </h2>
        <span className={s.dayDate}>The last seven days</span>
        <span className={s.arrows}>
          <button type="button" className="btn btn-secondary btn-circle btn-compact" onClick={() => scroll(-1)} aria-label="Scroll Just Aired back">
            <Icon name="chevronLeft" size={16} strokeWidth={2.6} />
          </button>
          <button type="button" className="btn btn-secondary btn-circle btn-compact" onClick={() => scroll(1)} aria-label="Scroll Just Aired forward">
            <Icon name="chevronRight" size={16} strokeWidth={2.6} />
          </button>
        </span>
      </header>
      <ul className={s.stills} ref={row}>
        {children}
      </ul>
    </section>
  )
}

function JustAiredItem({ entry, now, watched }: { entry: CalendarEntry; now: number; watched: boolean }) {
  const { item, episode } = entry
  const day = relativeDay(entry.date, now, userLocale)
  return (
    <li className={s.still}>
      <Link
        to="/watch/$type/$id"
        params={{ type: item.type, id: item.id }}
        search={episode ? { season: episode.season, episode: episode.number } : undefined}
        className={s.stillLink}
        aria-label={`Play ${spoken(entry, { now, watched, day })}`}
        onPointerEnter={() => prefetchDetail(item)}
        onFocus={() => prefetchDetail(item)}
      >
        <Plate shape="still" artKind={episode?.still ? 'still' : 'backdrop'} artPath={episode?.still ?? item.backdrop} sizes="280px" print={stripPrint(entry, { now, watched, day })} fallback={item.title} hideStrip />
        <span className={s.stillTitle}>{item.title}</span>
        <span className={s.stillMeta}>{meta(entry)}</span>
      </Link>
    </li>
  )
}

/** One entry under its day: the still with its strip, the show and the episode, and a way to add it to a calendar. */
function Row({ entry, now, watched, onAdd }: { entry: CalendarEntry; now: number; watched: boolean; onAdd: () => void }) {
  const { item, episode } = entry
  return (
    <li className={s.row}>
      <Link
        to="/title/$type/$id"
        params={{ type: item.type, id: item.id }}
        search={episode ? { season: episode.season } : undefined}
        className={s.rowLink}
        aria-label={spoken(entry, { now, watched })}
        onPointerEnter={() => prefetchDetail(item)}
        onFocus={() => prefetchDetail(item)}
        onClick={markZoomSource}
        viewTransition
      >
        <span className={s.rowPlate}>
          <Plate shape="still" artKind={episode?.still ? 'still' : 'backdrop'} artPath={episode?.still ?? item.backdrop} sizes="160px" print={stripPrint(entry, { now, watched })} fallback={item.title} hideStrip />
        </span>
        <span className={s.rowText}>
          <span className={s.rowTitle}>{item.title}</span>
          <span className={s.rowMeta}>{meta(entry)}</span>
        </span>
      </Link>
      <button type="button" className={`btn btn-quiet btn-compact ${s.add}`} onClick={onAdd} aria-label={`Add ${item.title}${episode ? ` ${code(episode)}` : ''} to Calendar`}>
        <Icon name="calendar" size={16} /> <span>Add to Calendar</span>
      </button>
    </li>
  )
}

function Ghosts() {
  return (
    <div className={s.ghosts} aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={s.ghost} />
      ))}
    </div>
  )
}
