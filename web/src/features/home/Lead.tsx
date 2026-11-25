import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { Artwork } from '../../components/Artwork'
import { Icon } from '../../components/Icon'
import { nameSize } from '../detail/nameSize'
import { prefetchDetail, q } from '../../lib/queries'
import { mediaKey, type Progress } from '../../lib/store/library'
import { imageURL, srcSet } from '../../lib/tmdb/images'
import { imageTone, type Tone } from '../../lib/tmdb/logoTone'
import type { MediaItem } from '../../lib/tmdb/types'
import { heroFacts, watchedFraction } from './logic'
import { swipeTurn, turnTo } from './leadTurn'
import { advancesByItself } from './shelfQuery'
import s from './Lead.module.css'

/** A title the lead can show, and where the viewer left off when they have. */
export interface LeadItem {
  item: MediaItem
  progress?: Progress
}

/** How wide the lead's still renders, for `srcset`: the window's width, except on a phone, where the picture is cropped to a
 *  tall box and has to be as wide as that box is tall times 16:9 (the box is 68% of the window's height). index.html
 *  preloads the same still with the same string, so the browser reuses the download; keep the two in step with the
 *  heights in Lead.module.css. */
export const leadSizes = '(max-width: 720px) 121vh, 100vw'

/** How long a pick stays up before the next one. */
const dwell = 8000
/** How long a swipe takes to finish, as --dur-move. */
const settleMs = 250

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

/** Home's lead, as a streaming app's hero: the title's artwork runs edge to edge and up under the top bar, fading into the
 *  page below it, with the title's logo (its name in the display face when TMDB has none) over the fade, one short line of
 *  facts, a solid Resume or Play, a round Details, and a dot for each title.
 *
 *  With several titles it turns through them (up to ten: what's in progress first, then the top picks). It turns by itself
 *  with a cross-fade (never while the pointer or keyboard focus is in it, while a finger is on it, off screen, with the tab
 *  hidden or under reduced motion). A swipe on a touch screen follows the finger; the arrow keys turn it from inside it;
 *  the dots choose a title; the pause button at their end stops the turning for good. Choosing a title is deciding where
 *  to stop, so it stays put from then on. */
export function Lead({ slides, auto }: { slides: LeadItem[]; auto: boolean }) {
  const [at, setAt] = useState(0)
  const [hold, setHold] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [visible, setVisible] = useState(true)
  /** Which neighbour a swipe is showing (1 the next, -1 the previous), and whether the finger is down or letting go. */
  const [peek, setPeek] = useState<-1 | 0 | 1>(0)
  const [phase, setPhase] = useState<'idle' | 'drag' | 'settle'>('idle')
  /** Set for the frame in which a swipe hands over to the next slide, so nothing fades while it does. */
  const [instant, setInstant] = useState(false)
  const reduced = useReducedMotion()
  const root = useRef<HTMLElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; at: number; last: number; lastAt: number; velocity: number; locked: boolean } | null>(null)
  const many = slides.length > 1
  const here = Math.min(at, slides.length - 1)

  const running = advancesByItself({ setting: auto, slides: slides.length, reducedMotion: reduced })
  const turning = running && !hold && !stopped && visible && phase === 'idle'
  useEffect(() => {
    if (!turning) return
    const timer = setInterval(() => {
      if (!document.hidden) setAt((i) => turnTo(i, 1, slides.length))
    }, dwell)
    return () => clearInterval(timer)
  }, [turning, slides.length])

  // The top bar turns transparent over the lead (Nav.module.css), and only while one is on the page.
  useEffect(() => {
    document.documentElement.setAttribute('data-hero', '')
    return () => document.documentElement.removeAttribute('data-hero')
  }, [])

  // Off screen it holds still: scrolled past, there is no one to turn it for.
  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const watch = new IntersectionObserver(([e]) => e && setVisible(e.isIntersecting), { threshold: 0.35 })
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  // The frame after a swipe hands over, fades are back on.
  useEffect(() => {
    if (!instant) return
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)))
    return () => cancelAnimationFrame(frame)
  }, [instant])

  const go = (to: number) => {
    setAt(turnTo(to, 0, slides.length))
    // Choosing a title is deciding where to stop: it stays put from here on.
    setStopped(true)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!many || e.altKey || e.ctrlKey || e.metaKey) return
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    go(turnTo(here, delta, slides.length))
  }

  // A swipe: touch and pen only (a mouse has the dots and the arrow keys). The track follows the finger through a CSS
  // variable, so a move doesn't re-render the lead; only which neighbour shows is state.
  const set = (dx: number) => root.current?.style.setProperty('--dx', `${dx}px`)
  const onDown = (e: PointerEvent) => {
    if (!many || e.pointerType === 'mouse' || phase !== 'idle') return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: here, last: e.clientX, lastAt: e.timeStamp, velocity: 0, locked: false }
  }
  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    if (!d.locked) {
      // The page scrolls up and down under the finger (touch-action: pan-y): only a mostly sideways move is ours.
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return
      d.locked = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setPhase('drag')
    }
    const dt = e.timeStamp - d.lastAt
    if (dt > 0) d.velocity = ((e.clientX - d.last) / dt) * 1000
    d.last = e.clientX
    d.lastAt = e.timeStamp
    set(dx)
    setPeek(dx < 0 ? 1 : dx > 0 ? -1 : 0)
  }
  const onUp = (e: PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.id !== e.pointerId || !d.locked) return
    const width = e.currentTarget.getBoundingClientRect().width
    const turn = swipeTurn(e.clientX - d.x, d.velocity, width)
    const done = () => {
      if (turn !== 0) {
        setStopped(true)
        setAt(turnTo(here, turn, slides.length))
      }
      // Nothing fades on the frame the neighbour takes over from the slide it was sliding in beside.
      setInstant(true)
      setPhase('idle')
      setPeek(0)
      set(0)
    }
    if (reduced) return done()
    // The slides finish the move the finger started, to the next one or back, then hand over.
    setPhase('settle')
    set(turn === 0 ? 0 : -turn * width)
    window.setTimeout(done, settleMs)
  }
  const onCancel = (e: PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    set(0)
    setPhase('idle')
    setPeek(0)
  }

  return (
    <section
      ref={root}
      className={s.lead}
      data-phase={phase}
      data-instant={instant ? '' : undefined}
      aria-roledescription={many ? 'carousel' : undefined}
      aria-label={many ? 'Featured titles' : undefined}
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHold(false)}
      onKeyDown={onKeyDown}
    >
      <div className={s.track} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
        {slides.map((slide, i) => {
          const gap = Math.min(Math.abs(i - here), slides.length - Math.abs(i - here))
          const role = i === here ? 'current' : peek !== 0 && i === turnTo(here, peek, slides.length) ? 'peek' : undefined
          return <Slide key={mediaKey(slide.item.type, slide.item.id)} lead={slide} role={role} near={gap <= 1} first={i === 0} peek={peek} />
        })}
      </div>
      {many && <Dots count={slides.length} at={here} onGo={go} running={running} stopped={stopped} onToggle={() => setStopped((v) => !v)} announce={!turning} />}
    </section>
  )
}

/** One title: its artwork, the fade into the page, and over the fade its logo, facts and buttons. All of it moves together
 *  when swiped. Only the slide on show (or the neighbour a swipe is bringing in) is visible, read or reached. */
function Slide({ lead, role, near, first, peek }: { lead: LeadItem; role?: 'current' | 'peek'; near: boolean; first: boolean; peek: -1 | 0 | 1 }) {
  const { item, progress } = lead
  const current = role === 'current'
  // The lists a lead is picked from carry neither a logo nor a rating, so both are asked for by the slide, and only
  // once it is the one on show or the next to be.
  const logo = useQuery({ ...q.logo(item.type, item.id), enabled: near })
  const detail = useQuery({ ...q.detail(item.type, item.id), enabled: near })
  const [broken, setBroken] = useState(false)
  // Known once the logo has loaded: until then it isn't shown, so it never flashes in the wrong colour.
  const [tone, setTone] = useState<Tone>()
  const facts = heroFacts(item, progress, detail.data?.certification)
  const season = progress?.episode ? { season: progress.episode.season } : undefined
  const path = logo.data && !broken ? logo.data : undefined
  const Heading = current ? 'h2' : 'p'
  const style = { '--side': role === 'peek' ? peek : 0 } as CSSProperties

  return (
    <div className={s.slide} data-current={current ? '' : undefined} data-peek={role === 'peek' ? '' : undefined} style={style} aria-hidden={current ? undefined : true} inert={!current}>
      <Link to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={season} className={s.art} onPointerEnter={() => prefetchDetail(item)} viewTransition tabIndex={-1} aria-hidden="true">
        {near && <Artwork path={item.backdrop} kind="backdrop" alt="" sizes={leadSizes} priority={first} className={s.fill} fallback={item.title} />}
      </Link>
      <div className={s.fade} aria-hidden="true" />
      <div className={s.words}>
        <Heading className={s.name} data-size={path ? undefined : nameSize(item.title)}>
          {path ? <img className={s.logo} data-tone={tone} src={imageURL(path, 500)} srcSet={srcSet(path, 'logo')} sizes="(max-width: 720px) 72vw, 40vw" alt={item.title} crossOrigin="anonymous" decoding="async" onLoad={(e) => setTone(imageTone(e.currentTarget))} onError={() => setBroken(true)} /> : item.title}
        </Heading>
        {facts.length > 0 && (
          <p className={s.facts}>
            {facts.map((f, i) => (
              <span key={i}>{f}</span>
            ))}
          </p>
        )}
        {progress && (
          <span className={s.progress} aria-hidden="true">
            <i style={{ width: `${Math.round(watchedFraction(progress) * 100)}%` }} />
          </span>
        )}
        <div className={s.actions}>
          {progress ? (
            <Link to="/watch/$type/$id" params={{ type: item.type, id: item.id }} search={progress.episode ? { season: progress.episode.season, episode: progress.episode.episode } : {}} className={`btn btn-primary btn-large ${s.play}`} onPointerEnter={() => prefetchDetail(item)}>
              <Icon name="play" size={18} /> Resume
            </Link>
          ) : (
            <Link to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={{ play: true }} className={`btn btn-primary btn-large ${s.play}`} onPointerEnter={() => prefetchDetail(item)}>
              <Icon name="play" size={18} /> Play
            </Link>
          )}
          <Link to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={season} className={`btn btn-secondary ${s.details}`} aria-label="Details" onPointerEnter={() => prefetchDetail(item)}>
            <Icon name="info" size={24} strokeWidth={2.2} />
          </Link>
        </div>
      </div>
    </div>
  )
}

/** A dot for each title, then the pause button. The dots are small but their buttons are not: 28px wide and 44px high, so a
 *  thumb or a pointer finds them. The count is spoken, and announced when a person (not the clock) moves it. */
function Dots({ count, at, onGo, running, stopped, onToggle, announce }: { count: number; at: number; onGo: (i: number) => void; running: boolean; stopped: boolean; onToggle: () => void; announce: boolean }) {
  return (
    <div className={s.dots} role="group" aria-label="Choose a title">
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" className={s.dot} onClick={() => onGo(i)} aria-label={`Title ${i + 1} of ${count}`} aria-current={i === at ? 'true' : undefined} />
      ))}
      {running && (
        <button type="button" className={s.pause} onClick={onToggle} aria-label={stopped ? 'Turn automatic rotation back on' : 'Stop automatic rotation'}>
          <Icon name={stopped ? 'play' : 'pause'} size={14} />
        </button>
      )}
      <span className="sr-only" role="status" aria-live={announce ? 'polite' : 'off'}>
        {`Title ${at + 1} of ${count}`}
      </span>
    </div>
  )
}

/** The lead's place while nothing is known yet: the still from the last visit if there is one (the page's HTML painted it
 *  already), else a flat block. Either way the box is the final size, so nothing moves. */
export function LeadGhost() {
  const still = lastLead()
  return (
    <div className={s.lead} aria-hidden="true">
      <div className={s.track}>
        <div className={s.slide} data-current="">
          <span className={s.art}>{still && <img className={s.ghostImg} src={still.d.split(' ')[0]} srcSet={still.d} sizes={leadSizes} alt="" fetchPriority="high" />}</span>
          <div className={s.fade} />
        </div>
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
