import { useEffect, useMemo, useRef, useState } from 'react'
import { Plate } from '../../components/Frame'
import { Icon } from '../../components/Icon'
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

  if (card === 'end') {
    return (
      <section className={s.suggestEnd} aria-label="Because You Watched">
        <h2 className={s.suggestEndHead}>
          Because You Watched <span>{title}</span>
        </h2>
        <ul className={s.suggestEndRow}>
          {suggestions.map((m, i) => (
            <li key={m.id}>
              <SuggestionItem item={m} sizes="240px" autoFocus={i === 0} onOpen={onOpen} />
            </li>
          ))}
        </ul>
        <button className="btn btn-secondary" onClick={onClose} onMouseDown={keepFocus}>
          Done
        </button>
      </section>
    )
  }
  // Beside the credits: a few of them, out of the way of an open panel.
  if (panel) return null
  return (
    <aside className={s.suggest} data-lifted={lifted ? '' : undefined} aria-label="Because You Watched">
      <div className={s.suggestHead}>
        <h2>
          Because You Watched <span>{title}</span>
        </h2>
        <button className={s.suggestClose} onClick={() => setCard('hidden')} onMouseDown={keepFocus} aria-label="Keep Watching the Credits" title="Keep Watching the Credits">
          <Icon name="close" size={16} strokeWidth={2.4} />
        </button>
      </div>
      <ul className={s.suggestRow}>
        {suggestions.slice(0, 3).map((m) => (
          <li key={m.id}>
            <SuggestionItem item={m} sizes="148px" onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </aside>
  )
}

function SuggestionItem({ item, sizes, autoFocus, onOpen }: { item: MediaItem; sizes: string; autoFocus?: boolean; onOpen: (item: MediaItem) => void }) {
  return (
    <button className={s.suggestItem} onClick={() => onOpen(item)} onMouseDown={keepFocus} autoFocus={autoFocus} aria-label={item.year ? `${item.title}, ${item.year}` : item.title}>
      <Plate className={s.suggestPlate} shape="still" artPath={item.backdrop} artKind="backdrop" sizes={sizes} stripSize="still" fallback={item.title} />
      <span className={s.suggestTitle}>{item.title}</span>
    </button>
  )
}
