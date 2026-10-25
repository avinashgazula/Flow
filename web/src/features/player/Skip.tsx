import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { useSettings } from '../../lib/store/settings'
import { usePlayer, type PlayerController } from './controller'
import { keepFocus } from './Controls'
import { activeSegment, behaviourFor, creditsRunToEnd, skippedTitle, skipTitle, type SkipKind, type SkipSegment } from './segments'
import s from './Controls.module.css'

/** How long "Skipped intro" and its Undo stay. */
const noteMs = 6000
/** The button fades for this long after its segment ends. */
const fadeMs = 200

interface Next {
  hasNext: boolean
  /** Goes to the next episode; `automatic` when nobody asked for it. */
  onNext: (automatic: boolean) => void
}

/** Skips the segment: to its end, or, for credits that run to the end of an episode with another after it, on to that
 *  episode. Returns whether it moved within this stream. */
function skipSegment(controller: PlayerController, segment: SkipSegment, { hasNext, onNext }: Next, automatic: boolean): boolean {
  // With the sleep timer on "End of Episode or Movie" the credits play out and the player closes: the next episode isn't started.
  if (segment.kind === 'credits' && hasNext && creditsRunToEnd(segment, controller.duration()) && !controller.sleepHold) {
    onNext(automatic)
    return false
  }
  controller.seekTo(segment.end)
  return true
}

/** The Skip button, bottom right above the scrubber as the apps put it: "Skip Intro", "Skip Recap", "Skip Credits".
 *  It is there while the segment plays and fades after. With Skip Automatically it skips once as the segment
 *  begins and says so for a few seconds, with Undo. Credits that lead into a next episode are the Up Next card's
 *  to offer ("Next Episode"), so here they only skip by themselves. It watches the clock itself and re-renders
 *  only when something comes or goes. */
export function Skip({ controller, hasNext, onNext, hidesCredits }: { controller: PlayerController; hasNext: boolean; onNext: (automatic: boolean) => void; hidesCredits?: boolean }) {
  const segments = usePlayer(controller, (st) => st.segments)
  const lifted = usePlayer(controller, (st) => st.controls)
  const panel = usePlayer(controller, (st) => st.panel)
  const upNext = usePlayer(controller, (st) => st.upNext)
  const intro = useSettings((st) => st.skipIntro)
  const recap = useSettings((st) => st.skipRecap)
  const credits = useSettings((st) => st.skipCredits)

  // The segment that should have a button now, and the one on screen (which lingers while it fades).
  const [wanted, setWanted] = useState<SkipSegment>()
  const [shown, setShown] = useState<{ segment: SkipSegment; leaving: boolean } | null>(null)
  const [note, setNote] = useState<{ kind: SkipKind; from: number } | null>(null)
  // Segments already skipped by themselves: a viewer who goes back into one gets the button, not a second skip.
  const done = useRef(new Set<number>())
  const latest = useRef({ hasNext, onNext, intro, recap, credits, hidesCredits })
  useEffect(() => {
    latest.current = { hasNext, onNext, intro, recap, credits, hidesCredits }
  })

  useEffect(() => {
    const video = controller.video
    if (!video) return
    const check = () => {
      const settings = latest.current
      const found = activeSegment(segments, video.currentTime)
      let behaviour = found && behaviourFor(found.kind, { skipIntro: settings.intro, skipRecap: settings.recap, skipCredits: settings.credits })
      // Credits that hide a scene are never skipped by themselves (the post-credits alert says why).
      if (found?.kind === 'credits' && settings.hidesCredits && behaviour === 'automatic') behaviour = 'button'
      if (found && behaviour === 'automatic' && !done.current.has(found.start)) {
        done.current.add(found.start)
        const from = controller.currentTime()
        if (skipSegment(controller, found, settings, true)) setNote({ kind: found.kind, from })
        return
      }
      // The card for the next episode is where "Skip Credits" would be.
      const want = found && behaviour !== 'off' && !(found.kind === 'credits' && settings.hasNext) ? found : undefined
      setWanted((now) => (now?.start === want?.start && now?.kind === want?.kind ? now : want))
    }
    check()
    const events = ['timeupdate', 'seeked', 'loadedmetadata']
    for (const e of events) video.addEventListener(e, check)
    return () => {
      for (const e of events) video.removeEventListener(e, check)
    }
  }, [controller, segments])

  useEffect(() => {
    if (wanted) {
      setShown({ segment: wanted, leaving: false })
      return
    }
    setShown((now) => (now ? { ...now, leaving: true } : now))
    const timer = window.setTimeout(() => setShown(null), fadeMs)
    return () => window.clearTimeout(timer)
  }, [wanted])

  // Enter and S do what the button does.
  const offered = shown && !shown.leaving && !panel && !upNext ? shown.segment : undefined
  useEffect(() => {
    if (!offered) return
    controller.registerSkip('skip', () => skipSegment(controller, offered, latest.current, false))
    return () => controller.registerSkip('skip', null)
  }, [controller, offered])

  useEffect(() => {
    if (!note) return
    const timer = window.setTimeout(() => setNote(null), noteMs)
    return () => window.clearTimeout(timer)
  }, [note])

  if (panel || upNext || (!shown && !note)) return null
  return (
    <div className={s.skipLayer} data-lifted={lifted ? '' : undefined}>
      {note && (
        <div className={s.skipNote} role="status" key={`${note.kind}:${note.from}`}>
          <span>{skippedTitle[note.kind]}</span>
          <button
            className={s.skipUndo}
            onClick={() => {
              controller.seekTo(note.from)
              setNote(null)
            }}
            onMouseDown={keepFocus}
          >
            Undo
          </button>
        </div>
      )}
      {shown && (
        <button
          key={shown.segment.start}
          className={`btn btn-primary ${s.skipButton}`}
          data-leaving={shown.leaving ? '' : undefined}
          tabIndex={shown.leaving ? -1 : 0}
          onClick={() => skipSegment(controller, shown.segment, latest.current, false)}
          onMouseDown={keepFocus}
        >
          {skipTitle[shown.segment.kind]}
          <Icon name="skipForward" size={16} />
        </button>
      )}
    </div>
  )
}
