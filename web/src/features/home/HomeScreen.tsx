import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { lazy, Suspense, useEffect } from 'react'
import { q } from '../../lib/queries'
import { mediaKey, useLibrary } from '../../lib/store/library'
import { useSettings } from '../../lib/store/settings'
import { formatWeekdayDate, greetingTitle, userLocale, useMinuteTick } from '../../lib/time'
import { srcSet } from '../../lib/tmdb/images'
import type { MediaItem } from '../../lib/tmdb/types'
import { Lead, LeadGhost, leadSizes, type LeadItem } from './Lead'
import { inProgress } from './logic'
import { heroPicks, maxSlides } from './shelfQuery'
import { UpNext } from './UpNext'
import s from './HomeScreen.module.css'

/** The shelves are under the fold: their code arrives beside the page's first data, not ahead of the first paint. */
const Shelves = lazy(() => import('./Shelves'))

/** Home, by the hour: the greeting title and date, the lead (what's in progress with its yellow Resume, or the
 *  day's top picks, turning through up to ten), Up Next beside it (framed stills, perforations for progress, edge
 *  print for the facts), and then the viewer's shelves in the order Settings → Shelves keeps, each a row of posters
 *  or stills with a print-only strip. Everything is a Frame (components/Frame). */
export function HomeScreen() {
  const now = useMinuteTick()
  const progress = useLibrary((l) => l.progress)
  const watchlist = useLibrary((l) => l.watchlist)
  const shelves = useSettings((x) => x.shelves)
  const showContinue = useSettings((x) => x.showContinueWatching)
  const primary = useSettings((x) => x.heroSource)
  const secondary = useSettings((x) => x.heroSecondarySource)
  const auto = useSettings((x) => x.heroAutoAdvance)

  // The sources of the top picks. Each is asked for only if it is chosen; trending is the one Home paints from.
  const uses = (source: string) => primary === source || secondary === source
  const trending = useQuery({ ...q.trending('all', 'day'), enabled: uses('trending') })
  const popular = useQuery({ ...q.list('movie', 'popular'), enabled: uses('popular') })
  const from = (source: string): MediaItem[] => (source === 'trending' ? trending.data?.results : source === 'popular' ? popular.data?.results : watchlist.map((e) => e.item as MediaItem)) ?? []
  const picks = heroPicks(from(primary), secondary && secondary !== primary ? from(secondary) : undefined)
  const pending = (uses('trending') && trending.isPending) || (uses('popular') && popular.isPending)
  const failed = (uses('trending') && trending.isError) || (uses('popular') && popular.isError)

  // What's in progress leads, when Continue Watching is on; the picks follow it.
  const resume = showContinue ? inProgress(progress)[0] : undefined
  const resumeKey = resume && mediaKey(resume.item.type, resume.item.id)
  const slides: LeadItem[] = [
    ...(resume ? [{ item: resume.item, progress: resume }] : []),
    ...picks.filter((m) => mediaKey(m.type, m.id) !== resumeKey).map((item) => ({ item })),
  ].slice(0, maxSlides)

  // The next visit's HTML paints this still before any script runs, and preloads it (index.html).
  const still = slides[0]?.item.backdrop
  useEffect(() => {
    if (!still) return
    try {
      localStorage.setItem('flow.lcp', JSON.stringify({ path: location.pathname, d: srcSet(still, 'backdrop'), s: leadSizes }))
    } catch {
      // Only a head start for the next visit.
    }
  }, [still])

  // Continue Watching and Up Next are the apps' two shelves for this place. Continue Watching holds both what is in
  // progress and what is next, so it names the place when it is on; Up Next alone holds only the next episodes.
  const beside = showContinue ? shelves.filter((sh) => sh.enabled && sh.source.kind === 'builtIn' && (sh.source.id === 'continueWatching' || sh.source.id === 'nextUp')) : []
  const continuing = beside.find((sh) => sh.source.kind === 'builtIn' && sh.source.id === 'continueWatching')
  const upNext = continuing ?? beside[0]
  const none = slides.length === 0 && !pending && failed

  return (
    <div className={s.home}>
      <div className={s.wrap}>
        <header className={s.head}>
          <h1 className={s.title}>{greetingTitle(now)}</h1>
          <p className={`${s.date} num`}>{formatWeekdayDate(now, userLocale)}</p>
        </header>
        {none ? (
          <Setup error />
        ) : (
          <>
            <div className={s.top} data-lead={slides.length || pending ? undefined : 'none'}>
              {slides.length ? <Lead slides={slides} auto={auto} /> : pending ? <LeadGhost /> : null}
              {upNext && <UpNext leadKey={resume && resumeKey} title={upNext.title} nextOnly={!continuing} />}
            </div>
            <Suspense fallback={null}>
              <Shelves />
            </Suspense>
          </>
        )}
      </div>
    </div>
  )
}

/** No resume item and no picks: a fresh install, or the catalogue can't be reached. Say what to do. */
function Setup({ error }: { error: boolean }) {
  return (
    <section className={s.setup} aria-labelledby="setup">
      <h2 id="setup" className={s.setupTitle}>
        Set Up Your Sources
      </h2>
      <p className={s.setupText}>Flow plays from your own servers, stream add-ons and live TV. Add one in Settings, and Home fills in: what you’re watching, how long is left and what’s new.</p>
      {error && <p className={s.setupText}>Flow couldn’t reach TMDB just now. Check your connection, or the key in Settings.</p>}
      <div className={s.setupActions}>
        <Link to="/settings" className="btn btn-primary btn-large">
          Add a Source
        </Link>
        <Link to="/explore" className="btn btn-secondary btn-large">
          Explore
        </Link>
      </div>
    </section>
  )
}
