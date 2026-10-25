import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { SkipGlyph } from './Controls'
import { usePlayer, type Feedback, type PlayerController } from './controller'
import { useSettings } from '../../lib/store/settings'
import { SubtitleLines, plainLines } from './SubtitleText'
import { subtitleCSS, sampleSubtitle } from './subtitleStyle'
import { activeCueText } from './subtitleDelay'
import { cueSegments, type Segment } from './subtitles'
import s from './Player.module.css'

/** Subtitles drawn by Flow rather than the browser: browsers style cues differently and ignore
 *  most of what WebVTT asks for, and this way every engine's subtitles look the same. Raised clear
 *  of the scrubber while the controls show, as in Apple's TV app. The viewer's style (Settings, or the
 *  options panel's Subtitle Style) is applied here, and while that panel is open a sample line stands in
 *  whenever no real one is on screen, so there is always something to judge a change by. With a subtitle delay
 *  the browser's own cue changes (which know nothing of it) aren't used: the clock is read as it plays and the
 *  cues are looked up shifted. */
export function SubtitleOverlay({ controller }: { controller: PlayerController }) {
  const track = usePlayer(controller, (st) => st.subtitleTrack)
  const lifted = usePlayer(controller, (st) => st.controls)
  const styling = usePlayer(controller, (st) => st.styling)
  const delay = usePlayer(controller, (st) => st.subtitleDelay)
  const style = useSettings((st) => st.subtitleStyle)
  const [lines, setLines] = useState<Segment[][]>([])

  useEffect(() => {
    if (!track) {
      setLines([])
      return
    }
    let last = ''
    const show = (text: string) => {
      if (text === last) return
      last = text
      setLines(text ? cueSegments(text) : [])
    }
    const video = controller.video
    if (delay === 0 || !video) {
      const update = () =>
        show(
          Array.from(track.activeCues ?? [])
            .map((c) => (c as VTTCue).text)
            .join('\n'),
        )
      update()
      track.addEventListener('cuechange', update)
      return () => track.removeEventListener('cuechange', update)
    }
    // Shifted: look the cues up on every frame while playing (a quarter-second tick would show a line late by up
    // to that much, which is the very thing being corrected), and once on each pause or seek.
    const update = () => show(activeCueText((track.cues ?? []) as unknown as ArrayLike<{ startTime: number; endTime: number; text: string }>, video.currentTime, delay))
    let frame = 0
    const loop = () => {
      update()
      frame = requestAnimationFrame(loop)
    }
    const start = () => {
      if (!frame) loop()
    }
    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
      update()
    }
    const events: [string, () => void][] = [
      ['playing', start],
      ['pause', stop],
      ['seeked', update],
      ['timeupdate', update],
    ]
    for (const [name, fn] of events) video.addEventListener(name, fn)
    update()
    if (!video.paused) start()
    return () => {
      for (const [name, fn] of events) video.removeEventListener(name, fn)
      cancelAnimationFrame(frame)
    }
  }, [track, delay, controller])

  const shown = lines.length > 0 ? lines : styling === 'style' ? plainLines(sampleSubtitle) : lines
  if (shown.length === 0) return null
  return (
    <div className={s.subtitles} style={subtitleCSS(style)} data-lifted={lifted ? '' : undefined} aria-live="off">
      <SubtitleLines lines={shown} />
    </div>
  )
}

/** A brief icon in the middle for keyboard actions, or at the side for a double-tap skip. */
export function FeedbackFlash({ controller }: { controller: PlayerController }) {
  const [flash, setFlash] = useState<Feedback | null>(null)
  useEffect(() => {
    let timer = 0
    const off = controller.onFeedback((f) => {
      setFlash(f)
      clearTimeout(timer)
      timer = window.setTimeout(() => setFlash(null), f.side ? 650 : 600)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [controller])
  if (!flash) return null
  const glyph =
    flash.icon === 'back10' || flash.icon === 'forward10' ? (
      <SkipGlyph forward={flash.icon === 'forward10'} size={flash.side ? 30 : 38} />
    ) : (
      <Icon name={flash.icon} size={34} strokeWidth={2.2} />
    )
  if (flash.side) {
    return (
      <div key={flash.id} className={s.sideFlash} data-side={flash.side} aria-hidden="true">
        {glyph}
        {flash.text && <span>{flash.text}</span>}
      </div>
    )
  }
  return (
    <div key={flash.id} className={s.feedback} aria-hidden="true">
      <span className={s.feedbackDisc}>{glyph}</span>
      {flash.text && <span className={s.feedbackText}>{flash.text}</span>}
    </div>
  )
}

/** How long a notice stays, as in the apps. */
const noticeMs = 7000

/** Quiet words over the picture, top centre: "2×" while a hold plays at double speed, and the player's notices
 *  (the sleep timer, a scene to stay for, an app being opened). One line at a time, flat, on the panel colour. */
export function Notes({ controller }: { controller: PlayerController }) {
  const fast = usePlayer(controller, (st) => st.fast)
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)
  useEffect(() => {
    let timer = 0
    let id = 0
    const off = controller.onNotice((text) => {
      setNotice({ id: ++id, text })
      clearTimeout(timer)
      timer = window.setTimeout(() => setNotice(null), noticeMs)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [controller])
  if (!fast && !notice) return null
  return (
    <div className={s.notes} role="status">
      {fast ? (
        <span key="fast" className={s.note} data-fast="">
          <Icon name="skipForward" size={14} />
          <span aria-hidden="true">2×</span>
          <span className="sr-only">Playing at double speed</span>
        </span>
      ) : (
        <span key={notice!.id} className={s.note}>
          {notice!.text}
        </span>
      )}
    </div>
  )
}

/** Buffering, shown only while the controls are away (the play button is the centre otherwise): a row of
 *  perforations filling in yellow, on a flat card. */
export function Buffering({ controller }: { controller: PlayerController }) {
  const waiting = usePlayer(controller, (st) => st.waiting && !st.paused && !st.controls)
  return waiting ? (
    <div className={s.buffering} role="status" aria-label="Loading">
      <span className={s.holes} />
    </div>
  ) : null
}

/** How long a finger rests on the picture before it plays at double speed (the apps' 0.45 seconds), and how far it
 *  may wander meanwhile (their 40 points). */
const holdMs = 450
const holdSlop = 40

/** The picture itself: click to play or pause and double-click for full screen with a mouse; with
 *  a finger, tap to show or hide the controls, double-tap either half to skip ten seconds, and hold to play at 2× until
 *  you let go. A tap outside an open panel closes it. */
export function TapLayer({ controller }: { controller: PlayerController }) {
  const lastTap = useRef({ at: 0, side: '' })
  const single = useRef(0)
  const touchedAt = useRef(0)
  // A finger held on the picture plays at double speed until it lifts, and that lift is not a tap.
  const press = useRef({ timer: 0, x: 0, y: 0, held: false })

  useEffect(
    () => () => {
      clearTimeout(single.current)
      clearTimeout(press.current.timer)
    },
    [],
  )

  /** Lets go of a hold, or of a press that was never long enough to be one. Returns whether it was a hold. */
  const release = () => {
    clearTimeout(press.current.timer)
    const wasHeld = press.current.held
    press.current.held = false
    if (wasHeld) controller.holdFast(false)
    return wasHeld
  }

  return (
    <div
      className={s.tapLayer}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' || controller.get().panel) return
        press.current = { timer: window.setTimeout(() => (press.current.held = controller.holdFast(true)), holdMs), x: e.clientX, y: e.clientY, held: false }
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') return controller.poke()
        // A finger that slides away is scrolling or dragging, not holding.
        if (!press.current.held && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > holdSlop) clearTimeout(press.current.timer)
      }}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
      onPointerUp={(e) => {
        if (e.pointerType === 'mouse') return
        touchedAt.current = performance.now()
        if (release()) return
        if (controller.get().panel) {
          controller.setPanel(null)
          return
        }
        const box = e.currentTarget.getBoundingClientRect()
        const side = e.clientX - box.left < box.width / 2 ? 'left' : 'right'
        const now = performance.now()
        if (now - lastTap.current.at < 320 && lastTap.current.side === side) {
          clearTimeout(single.current)
          controller.seekBy(side === 'left' ? -10 : 10)
          controller.flash(side === 'left' ? 'back10' : 'forward10', '10 seconds', side)
          // Further taps on the same side keep skipping, as long as they come quickly.
          lastTap.current = { at: now, side }
          return
        }
        lastTap.current = { at: now, side }
        clearTimeout(single.current)
        single.current = window.setTimeout(() => controller.toggleControls(), 240)
      }}
      onClick={(e) => {
        // Touches send a click too; the pointer handler has already dealt with those.
        // Each click of a double-click toggles too, so going full screen leaves playback as it was.
        if (performance.now() - touchedAt.current < 800) return
        if (controller.get().panel) {
          if (e.detail > 1) return
          controller.setPanel(null)
          return
        }
        controller.togglePlay()
        controller.flash(controller.video?.paused ? 'pause' : 'play')
      }}
      onDoubleClick={() => {
        if (performance.now() - touchedAt.current < 800) return
        controller.toggleFullscreen()
      }}
    />
  )
}
