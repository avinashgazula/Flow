import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FrameCard } from '../../components/Frame'
import { Icon } from '../../components/Icon'
import { prefetchDetail, q } from '../../lib/queries'
import { formatRuntime, useMinuteTick } from '../../lib/time'
import { pickMeta, pickPrint, spokenPick } from '../home/logic'
import { libraryStore, mediaKey } from '../../lib/store/library'
import { useSettings } from '../../lib/store/settings'
import { creditsAlert, type CreditsScenes } from '../../lib/tmdb/creditsScenes'
import type { MediaDetail, MediaItem } from '../../lib/tmdb/types'
import { usePlayer, type PlayerController } from './controller'
import { keepFocus } from './Controls'
import { alertDue, pickSuggestions, suggestionsMoment } from './filmExtras'
import { creditsStart } from './segments'
import s from './Controls.module.css'

type Card = 'hidden' | 'credits' | 'end'

/** How the viewer last gave input: a key, or a pointer (a finger included). Whether the end screen takes focus
 *  depends on it, because the ring that marks it is for someone who is steering with keys or a mouse. */
let lastInput: 'key' | 'pointer' = 'pointer'
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => (lastInput = 'key'), { capture: true, passive: true })
  window.addEventListener('pointerdown', () => (lastInput = 'pointer'), { capture: true, passive: true })
}
/** Keys and a precise pointer (a mouse) get focus on the first film; a finger gets the picture as it was, with no ring. */
const movesFocus = () => lastInput === 'key' || (typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches)

/** What a film adds at its end, as the apps do: a quiet note as the credits begin when a scene waits during or
 *  after them, and Because You Watched, a few films like it, as they roll and where the film ends. It watches the
 *  clock itself and draws nothing until there is something to say. `short` lets a sample clip count as a film. */
export function FilmExtras({ controller, film, scenes, short, onOpen, onClose }: { controller: PlayerController; film: MediaDetail | undefined; scenes: CreditsScenes | undefined; short: boolean; onOpen: (item: MediaItem) => void; onClose: () => void }) {
  const wanted = useSettings((st) => st.becauseYouWatched !== false)
  const segments = usePlayer(controller, (st) => st.segments)
  const segmentsRef = useRef(segments)
  useEffect(() => {
    segmentsRef.current = segments
  }, [segments])
  const suggestions = useMemo(() => (wanted && film ? pickSuggestions(film, (m) => libraryStore.get().history.some((h) => h.key === mediaKey(m.type, m.id))) : []), [wanted, film])
  const [card, setCard] = useState<Card>('hidden')
  const alerted = useRef(false)
  const offered = useRef(false)
  const latest = useRef({ scenes, suggestions })
  useEffect(() => {
    latest.current = { scenes, suggestions }
  })

  useEffect(() => {
    const video = controller.video
    if (!video) return
    const minLength = short ? 0 : undefined
    const check = () => {
      const duration = controller.duration()
      if (Number.isNaN(duration)) return
      const credits = creditsStart(segmentsRef.current, duration)
      const { scenes: found, suggestions: list } = latest.current
      const time = video.currentTime
      if (found && !alerted.current && alertDue({ time, duration, creditsStart: credits, minLength })) {
        alerted.current = true
        controller.notify(creditsAlert(found))
      }
      // A film with a scene to stay for keeps its credits to itself; the card waits for the end.
      if (list.length === 0 || found) return
      const moment = suggestionsMoment({ time, duration, creditsStart: credits, minLength })
      if (moment === 'before') {
        // Seeking back out of the credits takes the card away and lets it come back.
        offered.current = false
        setCard((now) => (now === 'credits' ? 'hidden' : now))
      } else if (moment === 'due' && !offered.current) {
        offered.current = true
        setCard('credits')
      }
    }
    // Where the film ends, the suggestions are the end screen: even a film with a scene had its credits.
    const ended = () => {
      if (latest.current.suggestions.length > 0 && !controller.sleepHold) setCard('end')
    }
    video.addEventListener('timeupdate', check)
    video.addEventListener('seeked', check)
    video.addEventListener('ended', ended)
    return () => {
      video.removeEventListener('timeupdate', check)
      video.removeEventListener('seeked', check)
      video.removeEventListener('ended', ended)
    }
  }, [controller, short])

  const lifted = usePlayer(controller, (st) => st.controls)
  const panel = usePlayer(controller, (st) => st.panel)
  const title = film?.title ?? ''
  const beside = card === 'credits' && suggestions.length > 0 && !panel
  // The card takes the corner the Skip button would stand in, as Up Next does; closing it gives the button back.
  useEffect(() => {
    controller.setUpNextShown(beside)
    return () => controller.setUpNextShown(false)
  }, [controller, beside])
  if (card === 'hidden' || suggestions.length === 0) return null

  if (card === 'end') return <EndScreen film={film} suggestions={suggestions} onOpen={onOpen} onClose={onClose} />
  // Beside the credits: a few of them, out of the way of an open panel.
  if (panel) return null
  return <CreditsCard controller={controller} title={title} suggestions={suggestions} lifted={lifted} onOpen={onOpen} onHide={() => setCard('hidden')} />
}

/** The card as the credits roll. While it stands there the subtitle line is kept clear of it (the stylesheet reads
 *  its size from the player's element), the way the line keeps clear of the options panel's Subtitle Style page. */
function CreditsCard({ controller, title, suggestions, lifted, onOpen, onHide }: { controller: PlayerController; title: string; suggestions: MediaItem[]; lifted: boolean; onOpen: (item: MediaItem) => void; onHide: () => void }) {
  const card = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = card.current
    if (!el) return
    const measure = () => controller.setCardClear({ width: el.offsetWidth, height: el.offsetHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return () => controller.setCardClear(null)
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => {
      watch.disconnect()
      controller.setCardClear(null)
    }
  }, [controller])
  return (
    <aside ref={card} className={s.suggest} data-lifted={lifted ? '' : undefined} aria-label="Because You Watched">
      <div className={s.suggestHead}>
        <h2>
          Because You Watched <span>{title}</span>
        </h2>
        <button className={s.suggestClose} onClick={onHide} onMouseDown={keepFocus} aria-label="Keep Watching the Credits" title="Keep Watching the Credits">
          <Icon name="close" size={16} strokeWidth={2.4} />
        </button>
      </div>
      <ul className={s.suggestRow}>
        {suggestions.slice(0, 3).map((m) => (
          <Suggestion key={m.id} item={m} sizes="148px" onOpen={onOpen} />
        ))}
      </ul>
    </aside>
  )
}

/** Where the film ends: the film just finished as one quiet line, then Because You Watched, the row and Done,
 *  centred on the flat edge colour over the last frame. */
function EndScreen({ film, suggestions, onOpen, onClose }: { film: MediaDetail | undefined; suggestions: MediaItem[]; onOpen: (item: MediaItem) => void; onClose: () => void }) {
  const section = useRef<HTMLElement>(null)
  // The first film is where the keyboard starts. A finger doesn't need the place marked, and a ring on the first frame
  // when the screen opens would read as a choice made for it.
  useEffect(() => {
    if (movesFocus()) section.current?.querySelector('button')?.focus()
  }, [])
  const length = film?.runtime ? formatRuntime(film.runtime * 60) : undefined
  return (
    <section ref={section} className={s.suggestEnd} aria-label="Because You Watched">
      <div className={s.suggestEndBlock}>
        <p className={s.suggestEndDone}>
          <span>{film?.title}</span>
          <span>{['Ended', length].filter(Boolean).join(' · ')}</span>
        </p>
        <h2 className={s.suggestEndHead}>Because You Watched</h2>
        <ul className={s.suggestEndRow}>
          {suggestions.map((m) => (
            <Suggestion key={m.id} item={m} sizes="240px" detailed onOpen={onOpen} />
          ))}
        </ul>
        <button className="btn btn-secondary" onClick={onClose} onMouseDown={keepFocus}>
          Done
        </button>
      </div>
    </section>
  )
}

/** One suggested film, as a still anywhere else in Flow is: its frame and edge strip (runtime and rating through the
 *  same strip layout), the title and a line of facts under it (the year and genres). Each fact is said once: the strip
 *  has what is Film or its length, the line under the title has the rest. `detailed` asks for the runtime. */
function Suggestion({ item, sizes, detailed, onOpen }: { item: MediaItem; sizes: string; detailed?: boolean; onOpen: (item: MediaItem) => void }) {
  const now = useMinuteTick()
  const { data } = useQuery({ ...q.detail(item.type, item.id), enabled: !!detailed })
  const detail = data && data.runtime ? data : undefined
  const print = pickPrint(item, detail, now)
  return (
    <FrameCard
      shape="still"
      artPath={item.backdrop}
      artKind="backdrop"
      sizes={sizes}
      print={print}
      title={item.title}
      meta={pickMeta(item, { kind: false })}
      label={spokenPick(item, detail)}
      fallback={item.title}
      onSelect={() => onOpen(item)}
      onIntent={() => prefetchDetail(item)}
    />
  )
}
