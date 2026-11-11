import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Icon } from '../../components/Icon'
import { Plate, PrintLine } from '../../components/Frame'
import { prefetchDetail, q } from '../../lib/queries'
import { lastSourceStore } from '../../lib/sources/lastSource'
import { useStore } from '../../lib/store/createStore'
import { mediaKey, useLibrary, type Progress } from '../../lib/store/library'
import { useSettings } from '../../lib/store/settings'
import { userLocale, useMinuteTick } from '../../lib/time'
import { useTheme } from '../../lib/theme'
import type { MediaItem } from '../../lib/tmdb/types'
import { rank, type PrintPart } from '../../components/printLayout'
import { episodesLeftText, showStatus } from './continue'
import { pickMeta, pickPrint, resumePrint, watchedFraction } from './logic'
import { posterMarks, watchedMovieKeys, watchedShowsOf } from './marks'
import { advancesByItself } from './shelfQuery'
import s from './Lead.module.css'

/** A title the lead can show, and where the viewer left off when they have. */
export interface LeadItem {
  item: MediaItem
  progress?: Progress
}

/** How wide the lead still renders, for `srcset`. index.html preloads the same still with the same string,
 *  so the browser reuses the download; keep the two in step with the layout in Lead.module.css. */
export const leadSizes = '(min-width: 1500px) 700px, (min-width: 1100px) 50vw, 92vw'
/** The Fullscreen style draws the still across the whole window. */
export const fullSizes = '100vw'

/** How long a pick stays up before the next one. */
const dwell = 8000

const noMotion = '(prefers-reduced-motion: reduce)'
function useReducedMotion() {
  return useSyncExternalStore(
    (on) => {
      const media = matchMedia(noMotion)
      media.addEventListener('change', on)
      return () => media.removeEventListener('change', on)
    },
    () => matchMedia(noMotion).matches,
    () => false,
  )
}

/** The one dominant item on Home: its title in giant Archivo capitals, one line of facts, a solid Resume or Play and a
 *  bordered Details, and its backdrop in a 3px rule with the time left, when it would end and the format printed under
 *  it and a red bar along its foot for how far you are.
 *
 *  With several titles it turns through them (up to ten: what's in progress first, then the top picks), with a numbered
 *  pager (`01 / 10`) for the one you are on. It turns by itself only when nothing is in progress, never while the
 *  pointer or keyboard focus is in it, and never under reduced motion.
 *
 *  `fullscreen` is the apps' Fullscreen top pick: the backdrop edge to edge between two rules, with the title, facts and
 *  buttons on a solid ink band across its foot. */
export function Lead({ slides, auto, fullscreen }: { slides: LeadItem[]; auto: boolean; fullscreen?: boolean }) {
  const [index, setIndex] = useState(0)
  const [hold, setHold] = useState(false)
  const [stopped, setStopped] = useState(false)
  const reduced = useReducedMotion()
  const now = useMinuteTick()
  const at = Math.min(index, slides.length - 1)
  const { item, progress } = slides[at]!
  const key = mediaKey(item.type, item.id)
  const last = useStore(lastSourceStore, (st) => st.byTitle[key])
  // The detail brings the runtime of a title not started.
  const detail = useQuery(q.detail(item.type, item.id))

  const running = advancesByItself({ setting: auto, resuming: !!slides[0]?.progress, slides: slides.length, reducedMotion: reduced })
  useEffect(() => {
    if (!running || hold || stopped) return
    const timer = setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % slides.length)
    }, dwell)
    return () => clearInterval(timer)
  }, [running, hold, stopped, slides.length])

  // A series started also says how many of its aired episodes are still to watch.
  const marks = useLibrary((x) => x.watchedEpisodes)
  const rewatches = useLibrary((x) => x.rewatches)
  const showLeft = useSettings((x) => x.showEpisodesRemaining)
  const left = progress && item.type === 'show' && detail.data ? showStatus(watchedShowsOf(marks, rewatches).get(item.id) ?? [], detail.data, now).left : 0
  const leftPrint: PrintPart[] = showLeft && left > 0 ? [{ text: episodesLeftText(left), rank: rank.episodesLeft }] : []
  // A pick the viewer has already seen says so in its line, as a poster does.
  const history = useLibrary((x) => x.history)
  const showWatched = useSettings((x) => x.showWatchedBadges)
  const seen = progress ? undefined : posterMarks(item, { movies: watchedMovieKeys(history), shows: watchedShowsOf(marks, rewatches) }, detail.data, now, { watched: showWatched, episodes: false })
  const print = progress ? resumePrint(progress, now, last, userLocale, leftPrint) : [...(seen?.parts ?? []), ...pickPrint(item, detail.data?.runtime ? detail.data : undefined, now, { ends: true, locale: userLocale })]
  const season = progress?.episode ? { season: progress.episode.season } : undefined
  const many = slides.length > 1
  const theme = useTheme()

  const go = (to: number) => {
    setIndex((to + slides.length) % slides.length)
    // Choosing a title is deciding where to stop: it stays put from here on.
    setStopped(true)
  }

  return (
    <section
      className={s.lead}
      data-style={fullscreen ? 'fullscreen' : undefined}
      aria-roledescription={many ? 'carousel' : undefined}
      aria-label={many ? 'Featured titles' : undefined}
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHold(false)}
    >
      <Link key={key} to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={season} className={s.plate} onPointerEnter={() => prefetchDetail(item)} viewTransition tabIndex={-1} aria-hidden="true">
        <Plate shape="still" artPath={item.backdrop} sizes={fullscreen ? fullSizes : leadSizes} priority={at === 0} progress={progress ? watchedFraction(progress) : seen?.progress} print={fullscreen ? undefined : print} fallback={item.title} />
      </Link>
      <div className={s.info} data-theme={fullscreen ? (theme === 'dark' ? 'light' : 'dark') : undefined}>
        {/* Every slide's words sit in one cell of a grid, so the block is as tall as the tallest and nothing
            below it moves when the lead turns. Only the one on show is read or reached. */}
        <div className={s.stack} aria-live={running && !hold && !stopped ? 'off' : 'polite'}>
          {slides.map((sl, i) => (
            <LeadText key={mediaKey(sl.item.type, sl.item.id)} lead={sl} current={i === at} />
          ))}
        </div>
        {fullscreen && <PrintLine print={print} hidden />}
        <div className={s.actions}>
          {progress ? (
            <Link to="/watch/$type/$id" params={{ type: item.type, id: item.id }} search={progress.episode ? { season: progress.episode.season, episode: progress.episode.episode } : {}} className="btn btn-primary btn-large" onPointerEnter={() => prefetchDetail(item)}>
              <Icon name="play" size={18} /> Resume
            </Link>
          ) : (
            <Link to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={{ play: true }} className="btn btn-primary btn-large" onPointerEnter={() => prefetchDetail(item)}>
              <Icon name="play" size={18} /> Play
            </Link>
          )}
          <Link to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={season} className="btn btn-secondary btn-large" onPointerEnter={() => prefetchDetail(item)}>
            Details
          </Link>
        </div>
        {many && <Pager count={slides.length} at={at} onGo={go} running={running} stopped={stopped} onToggle={() => setStopped((v) => !v)} />}
      </div>
    </section>
  )
}

/** One slide's title and facts. */
function LeadText({ lead, current }: { lead: LeadItem; current: boolean }) {
  const { item, progress } = lead
  const meta = progress?.episode ? `Season ${progress.episode.season}, Episode ${progress.episode.episode}${progress.episode.name ? ` · ${progress.episode.name}` : ''}` : pickMeta(item)
  const Heading = current ? 'h2' : 'p'
  return (
    <div className={s.text} data-current={current ? '' : undefined} aria-hidden={current ? undefined : true} inert={!current}>
      <Heading className={s.name}>{item.title}</Heading>
      <p className={s.meta}>{meta}</p>
    </div>
  )
}

/** Which title of the turn you are on, as red condensed figures (`01 / 10`) between two square buttons. The arrow keys
 *  go along it from anywhere in the pager, and Home and End to either end. */
function Pager({ count, at, onGo, running, stopped, onToggle }: { count: number; at: number; onGo: (i: number) => void; running: boolean; stopped: boolean; onToggle: () => void }) {
  const onKey = (e: KeyboardEvent) => {
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : undefined
    if (to === undefined) return
    e.preventDefault()
    onGo(to)
  }
  const two = (n: number) => String(n).padStart(2, '0')
  return (
    <div className={s.pager} role="group" aria-label="Choose a title" onKeyDown={onKey}>
      <button type="button" className={s.step} onClick={() => onGo(at - 1)} aria-label="Previous title">
        <Icon name="chevronLeft" size={18} strokeWidth={2.6} />
      </button>
      <span className={`${s.count} num`} role="status" aria-label={`${at + 1} of ${count}`}>
        {two(at + 1)} <span aria-hidden="true">/ {two(count)}</span>
      </span>
      <button type="button" className={s.step} onClick={() => onGo(at + 1)} aria-label="Next title">
        <Icon name="chevronRight" size={18} strokeWidth={2.6} />
      </button>
      {running && (
        <button type="button" className={s.step} onClick={onToggle} aria-label={stopped ? 'Turn automatic rotation back on' : 'Stop automatic rotation'}>
          <Icon name={stopped ? 'play' : 'pause'} size={16} />
        </button>
      )}
    </div>
  )
}

/** The lead's place while nothing is known yet: the still from the last visit if there is one (the page's
 *  HTML painted it already), else a flat block. Either way the box is the final size, so nothing moves. */
export function LeadGhost({ fullscreen }: { fullscreen?: boolean }) {
  const still = lastLead()
  return (
    <div className={s.lead} data-style={fullscreen ? 'fullscreen' : undefined} aria-hidden="true">
      <div className={s.plate}>
        <span className={s.ghostFrame}>{still && <img className={s.ghostImg} src={still.d.split(' ')[0]} srcSet={still.d} sizes={fullscreen ? fullSizes : leadSizes} alt="" fetchPriority="high" />}</span>
      </div>
    </div>
  )
}

/** The lead's still is remembered for the next visit: index.html preloads it and paints it before any script
 *  runs (`flow.lcp`: the address list, its sizes, and the page it belongs to). */
export function lastLead(): { d: string } | null {
  try {
    const h = JSON.parse(localStorage.getItem('flow.lcp') ?? 'null')
    return h && h.path === location.pathname && typeof h.d === 'string' ? { d: h.d } : null
  } catch {
    return null
  }
}
