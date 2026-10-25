import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Icon } from '../../components/Icon'
import { Plate } from '../../components/Frame'
import { prefetchDetail, q } from '../../lib/queries'
import { lastSourceStore } from '../../lib/sources/lastSource'
import { useStore } from '../../lib/store/createStore'
import { mediaKey, useLibrary, type Progress } from '../../lib/store/library'
import { useSettings } from '../../lib/store/settings'
import { userLocale, useMinuteTick } from '../../lib/time'
import { imageURL, srcSet } from '../../lib/tmdb/images'
import type { MediaDetail, MediaItem } from '../../lib/tmdb/types'
import { rank, type PrintPart } from '../../components/stripLayout'
import { episodesLeftText, showStatus } from './continue'
import { pickMeta, pickPrint, resumePrint, watchedFraction } from './logic'
import { watchedShowsOf } from './marks'
import { advancesByItself } from './shelfQuery'
import s from './Lead.module.css'

/** A title the lead can show, and where the viewer left off when they have. */
export interface LeadItem {
  item: MediaItem
  progress?: Progress
}

/** How wide the lead still renders, for `srcset`. index.html preloads the same still with the same string,
 *  so the browser reuses the download; keep the two in step with the layout in Lead.module.css. */
export const leadSizes = '(min-width: 1500px) 738px, (min-width: 1100px) 52vw, (min-width: 721px) 420px, calc(100vw - 32px)'

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

/** The one dominant item on Home: a large 16:9 still with its edge strip (perforations for what's watched,
 *  print for the episode, time left in yellow, when it would end, and the format), then the title (as its logo
 *  where TMDB has one), one line of facts, the yellow Resume or Play and a quiet Details.
 *
 *  With several titles it turns through them (up to ten: what's in progress first, then the top picks), with a
 *  row of perforations under it for the page you are on. It turns by itself only when nothing is in progress,
 *  never while the pointer or keyboard focus is in it, and never under reduced motion. */
export function Lead({ slides, auto }: { slides: LeadItem[]; auto: boolean }) {
  const [index, setIndex] = useState(0)
  const [hold, setHold] = useState(false)
  const [stopped, setStopped] = useState(false)
  const reduced = useReducedMotion()
  const now = useMinuteTick()
  const at = Math.min(index, slides.length - 1)
  const { item, progress } = slides[at]!
  const key = mediaKey(item.type, item.id)
  const last = useStore(lastSourceStore, (st) => st.byTitle[key])
  // The detail brings the runtime of a title not started, and the logo.
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
  const showLeft = useSettings((x) => x.showEpisodesRemaining)
  const left = progress && item.type === 'show' && detail.data ? showStatus(watchedShowsOf(marks).get(item.id) ?? [], detail.data, now).left : 0
  const leftPrint: PrintPart[] = showLeft && left > 0 ? [{ text: episodesLeftText(left), rank: rank.episodesLeft }] : []
  const print = progress ? resumePrint(progress, now, last, userLocale, leftPrint) : pickPrint(item, detail.data?.runtime ? detail.data : undefined, now, { ends: true, locale: userLocale })
  const season = progress?.episode ? { season: progress.episode.season } : undefined
  const many = slides.length > 1

  const go = (to: number) => {
    setIndex((to + slides.length) % slides.length)
    // Choosing a title is deciding where to stop: it stays put from here on.
    setStopped(true)
  }

  return (
    <section
      className={s.lead}
      aria-roledescription={many ? 'carousel' : undefined}
      aria-label={many ? 'Featured titles' : undefined}
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHold(false)}
    >
      <Link key={key} to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={season} className={s.plate} onPointerEnter={() => prefetchDetail(item)} viewTransition tabIndex={-1} aria-hidden="true">
        <Plate shape="still" artPath={item.backdrop} sizes={leadSizes} priority={at === 0} progress={progress ? watchedFraction(progress) : undefined} print={print} stripSize="lead" fallback={item.title} />
      </Link>
      <div className={s.info}>
        {/* Every slide's words sit in one cell of a grid, so the block is as tall as the tallest and nothing
            below it moves when the lead turns. Only the one on show is read or reached. */}
        <div className={s.stack} aria-live={running && !hold && !stopped ? 'off' : 'polite'}>
          {slides.map((sl, i) => (
            <LeadText key={mediaKey(sl.item.type, sl.item.id)} lead={sl} current={i === at} logo={i === at ? detail.data?.logo : undefined} />
          ))}
        </div>
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
        {many && <Reel titles={slides.map((x) => x.item.title)} at={at} onGo={go} running={running} stopped={stopped} onToggle={() => setStopped((v) => !v)} />}
      </div>
    </section>
  )
}

/** One slide's title and facts. The title is its logo when TMDB has one that has loaded, else plain text. */
function LeadText({ lead, current, logo }: { lead: LeadItem; current: boolean; logo?: MediaDetail['logo'] }) {
  const { item, progress } = lead
  const [state, setState] = useState<'wait' | 'ready' | 'broken'>('wait')
  const meta = progress?.episode ? `Season ${progress.episode.season}, Episode ${progress.episode.episode}${progress.episode.name ? ` · ${progress.episode.name}` : ''}` : pickMeta(item)
  const art = logo && state !== 'broken' ? logo : undefined
  const Heading = current ? 'h2' : 'p'
  return (
    <div className={s.text} data-current={current ? '' : undefined} aria-hidden={current ? undefined : true} inert={!current}>
      <Heading className={s.name} data-logo={art && state === 'ready' ? '' : undefined}>
        <span className={s.nameText}>{item.title}</span>
        {art && (
          <img
            className={s.logo}
            src={imageURL(art, 300)}
            srcSet={srcSet(art, 'logo')}
            sizes="300px"
            alt=""
            decoding="async"
            onLoad={() => setState('ready')}
            onError={() => setState('broken')}
          />
        )}
      </Heading>
      <p className={s.meta}>{meta}</p>
    </div>
  )
}

/** The page you are on, as a strip of perforations in edge print: one hole per title, the current one in paper.
 *  Arrow keys move along it, and Home and End go to either end. */
function Reel({ titles, at, onGo, running, stopped, onToggle }: { titles: string[]; at: number; onGo: (i: number) => void; running: boolean; stopped: boolean; onToggle: () => void }) {
  const holes = useRef<(HTMLButtonElement | null)[]>([])
  const move = (e: KeyboardEvent, to: number) => {
    e.preventDefault()
    const next = (to + titles.length) % titles.length
    onGo(next)
    holes.current[next]?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e, at + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e, at - 1)
    else if (e.key === 'Home') move(e, 0)
    else if (e.key === 'End') move(e, titles.length - 1)
  }
  return (
    <div className={s.reel}>
      <div className={s.holes} role="group" aria-label="Choose a title" onKeyDown={onKey}>
        {titles.map((title, i) => (
          <button
            key={i}
            ref={(el) => void (holes.current[i] = el)}
            type="button"
            className={s.hole}
            aria-label={`${title}, ${i + 1} of ${titles.length}`}
            aria-current={i === at ? 'true' : undefined}
            tabIndex={i === at ? 0 : -1}
            onClick={() => onGo(i)}
          />
        ))}
      </div>
      <span className={`${s.count} num`} aria-hidden="true">
        {String(at + 1).padStart(2, '0')} / {String(titles.length).padStart(2, '0')}
      </span>
      {running && (
        <button type="button" className={s.pause} onClick={onToggle} aria-label={stopped ? 'Turn automatic rotation back on' : 'Stop automatic rotation'}>
          <Icon name={stopped ? 'play' : 'pause'} size={14} />
        </button>
      )}
    </div>
  )
}

/** The lead's place while nothing is known yet: the still from the last visit if there is one (the page's
 *  HTML painted it already), else a flat block. Either way the box is the final size, so nothing moves. */
export function LeadGhost() {
  const still = lastLead()
  return (
    <div className={s.lead} aria-hidden="true">
      <div className={s.plate}>
        <span className={s.ghostFrame}>{still && <img className={s.ghostImg} src={still.d.split(' ')[0]} srcSet={still.d} sizes={leadSizes} alt="" fetchPriority="high" />}</span>
        <span className={s.ghostStrip} />
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
