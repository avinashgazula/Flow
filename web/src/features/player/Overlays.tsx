import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { SkipGlyph } from './Controls'
import { usePlayer, type Feedback, type PlayerController } from './controller'
import { useSettings } from '../../lib/store/settings'
import { SubtitleLines, plainLines } from './SubtitleText'
import { subtitleCSS, sampleSubtitle } from './subtitleStyle'
import { cueSegments, type Segment } from './subtitles'
import s from './Player.module.css'

/** Subtitles drawn by Flow rather than the browser: browsers style cues differently and ignore
 *  most of what WebVTT asks for, and this way every engine's subtitles look the same. Raised clear
 *  of the scrubber while the controls show, as in Apple's TV app. The viewer's style (Settings, or the
 *  options panel's Subtitle Style) is applied here, and while that panel is open a sample line stands in
 *  whenever no real one is on screen, so there is always something to judge a change by. */
export function SubtitleOverlay({ controller }: { controller: PlayerController }) {
  const track = usePlayer(controller, (st) => st.subtitleTrack)
  const lifted = usePlayer(controller, (st) => st.controls)
  const styling = usePlayer(controller, (st) => st.styling)
  const style = useSettings((st) => st.subtitleStyle)
  const [lines, setLines] = useState<Segment[][]>([])

  useEffect(() => {
    if (!track) {
      setLines([])
      return
    }
    let last = ''
    const update = () => {
      const text = Array.from(track.activeCues ?? [])
        .map((c) => (c as VTTCue).text)
        .join('\n')
      if (text === last) return
      last = text
      setLines(text ? cueSegments(text) : [])
    }
    update()
    track.addEventListener('cuechange', update)
    return () => track.removeEventListener('cuechange', update)
  }, [track])

  const shown = lines.length > 0 ? lines : styling ? plainLines(sampleSubtitle) : lines
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

/** The picture itself: click to play or pause and double-click for full screen with a mouse; with
 *  a finger, tap to show or hide the controls and double-tap either half to skip ten seconds. A tap
 *  outside an open panel closes it. */
export function TapLayer({ controller }: { controller: PlayerController }) {
  const lastTap = useRef({ at: 0, side: '' })
  const single = useRef(0)
  const touchedAt = useRef(0)

  useEffect(() => () => clearTimeout(single.current), [])

  return (
    <div
      className={s.tapLayer}
      onPointerMove={(e) => e.pointerType === 'mouse' && controller.poke()}
      onPointerUp={(e) => {
        if (e.pointerType === 'mouse') return
        touchedAt.current = performance.now()
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
