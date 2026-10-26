import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { PosterItem } from '../../components/TitleCards'
import { q } from '../../lib/queries'
import { computeStats, durationText, histogramTitle, statsLead, statsPeriods, type Granularity, type StatsPeriod, type WatchStats } from '../../lib/stats'
import { useLibrary } from '../../lib/store/library'
import { userLocale } from '../../lib/time'
import { Segmented, StateView } from '../explore/Controls'
import { bars, firstWeekday, habitLines, leadSentence, shownLabels } from './statsView'
import s from './StatsPage.module.css'

/* Stats, as the apps' "Your Year in Flow": what you have watched, from History. The sums are in lib/stats.ts (a port of
   FlowKit's WatchStats); statsView.ts words them. Plays made before this version recorded no length, so a title's typical
   runtime is asked of TMDB for them (the most recent 300 titles; anything beyond uses the usual lengths). */

/** Titles to look up for runtimes, most recent first. */
const lookupLimit = 300

export default function StatsPage() {
  const [period, setPeriod] = useState<StatsPeriod>('thisYear')
  const history = useLibrary((l) => l.history)

  // Distinct titles with a play that recorded no length, newest first.
  const unknown = [...new Map(history.filter((e) => !e.runtime).map((e) => [e.key, e.item])).values()].slice(0, lookupLimit)
  const details = useQueries({ queries: unknown.map((item) => q.detail(item.type, item.id)) })
  const runtimes = new Map<string, number>(unknown.flatMap((item, i) => (details[i]?.data?.runtime && !details[i]?.isPlaceholderData ? [[`${item.type}:${item.id}`, details[i]!.data!.runtime!] as const] : [])))
  const settled = details.every((d) => !d.isPending || d.fetchStatus === 'idle')

  if (history.length === 0) {
    return (
      <StateView
        icon="history"
        title="No History Yet"
        message={
          <>
            Watch something, or connect Trakt in{' '}
            <Link to="/settings" hash="account">
              Settings → Account
            </Link>
            , and your stats appear here.
          </>
        }
      />
    )
  }

  const stats = computeStats(period, history, { runtimeOf: (key) => runtimes.get(key), weekStart: firstWeekday(userLocale) })
  const items = new Map(history.map((e) => [e.key, e.item]))

  return (
    <div className={s.page}>
      <Segmented options={statsPeriods} value={period} onChange={setPeriod} label="Period" className={s.period} />
      {stats.isEmpty ? (
        <StateView icon="history" title="Nothing Watched" message={`There’s no history for ${statsPeriods.find((p) => p.id === period)!.label.toLowerCase()}. Try another period.`} />
      ) : (
        <>
          <Lead stats={stats} settled={settled} />
          <Histogram stats={stats} />
          {stats.topGenres.length > 0 && <Genres stats={stats} />}
          <MostWatched stats={stats} items={items} />
          <Habits stats={stats} />
        </>
      )}
    </div>
  )
}

/** The whole answer in one sentence, set as the page's lead: how long, then what it was. */
function Lead({ stats, settled }: { stats: WatchStats; settled: boolean }) {
  return (
    <p className={s.lead} aria-busy={!settled || undefined}>
      {statsLead[stats.period]} <strong className="num">{durationText(stats.totalMinutes)}</strong>
      <span className="num">: {leadSentence(stats)}.</span>
    </p>
  )
}

function Histogram({ stats }: { stats: WatchStats }) {
  const granularity: Granularity = stats.histogramGranularity
  const columns = bars(stats.histogram)
  const labels = shownLabels(stats.histogram.length)
  const label = (start: number) => axisLabel(start, granularity, userLocale)
  return (
    <section className={s.section} aria-labelledby="stats-hours">
      <h2 id="stats-hours" className={s.heading}>
        {histogramTitle[granularity]}
      </h2>
      <figure className={s.chart}>
        <div className={s.bars} data-crowded={stats.histogram.length > 12 || undefined} role="list" aria-label={histogramTitle[granularity]}>
          {stats.histogram.map((b, i) => (
            <div key={b.start} className={s.column} role="listitem" aria-label={`${longLabel(b.start, granularity, userLocale)}, ${hours(b.minutes)}`} data-current={b.isCurrent || undefined}>
              <span className={`${s.value} num`} aria-hidden="true">
                {b.minutes > 0 ? hours(b.minutes) : ''}
              </span>
              <span className={s.bar} style={{ '--h': columns[i]!.toFixed(4) } as React.CSSProperties} data-empty={b.minutes === 0 || undefined} aria-hidden="true" />
              <span className={`${s.axis} num`} aria-hidden="true">
                {labels[i] ? label(b.start) : ''}
              </span>
            </div>
          ))}
        </div>
      </figure>
    </section>
  )
}

function Genres({ stats }: { stats: WatchStats }) {
  return (
    <section className={s.section} aria-labelledby="stats-genres">
      <h2 id="stats-genres" className={s.heading}>
        Top Genres
      </h2>
      <ol className={s.genres}>
        {stats.topGenres.map((g, i) => {
          const percent = Math.round(g.share * 100)
          return (
            <li key={g.name} className={s.genre} aria-label={`${g.name}, ${percent} percent`}>
              <span className={s.genreName}>{g.name}</span>
              <span className={`${s.genrePercent} num`}>{percent}%</span>
              <span className={s.track} aria-hidden="true">
                <span className={s.fill} data-first={i === 0 || undefined} style={{ width: `${Math.max(2, g.share * 100)}%` }} />
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function MostWatched({ stats, items }: { stats: WatchStats; items: Map<string, import('../../lib/tmdb/types').MediaItem> }) {
  const shows = stats.mostWatchedShows.flatMap((c) => {
    const item = items.get(c.key)
    return item ? [{ item, episodes: c.episodes }] : []
  })
  if (!shows.length) return null
  return (
    <section className={s.section} aria-labelledby="stats-shows">
      <h2 id="stats-shows" className={s.heading}>
        Most Watched
      </h2>
      <ul className={s.posters}>
        {shows.map(({ item, episodes }) => (
          <PosterItem key={item.id} item={item} meta={episodes === 1 ? '1 episode' : `${episodes.toLocaleString()} episodes`} sizes="(max-width: 720px) 112px, 180px" />
        ))}
      </ul>
    </section>
  )
}

function Habits({ stats }: { stats: WatchStats }) {
  const lines = habitLines(stats, userLocale)
  return (
    <section className={s.section} aria-labelledby="stats-habits">
      <h2 id="stats-habits" className={s.heading}>
        Habits
      </h2>
      <dl className={s.habits}>
        {lines.map((line) => (
          <div key={line.label} className={s.habit}>
            <dt>{line.label}</dt>
            <dd>
              <span className="num">{line.value}</span>
              {line.detail && <span className={`${s.habitDetail} num`}>{line.detail}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const hours = (minutes: number) => `${(minutes / 60).toLocaleString(userLocale, { maximumFractionDigits: minutes < 600 ? 1 : 0 })}h`

function axisLabel(start: number, granularity: Granularity, locale?: string): string {
  const d = new Date(start)
  if (granularity === 'year') return String(d.getFullYear())
  if (granularity === 'month') return new Intl.DateTimeFormat(locale, { month: 'short' }).format(d)
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d)
}

function longLabel(start: number, granularity: Granularity, locale?: string): string {
  const d = new Date(start)
  if (granularity === 'year') return String(d.getFullYear())
  if (granularity === 'month') return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(d)
  return `Week of ${new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(d)}`
}
