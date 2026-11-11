import { useRef, type ReactNode } from 'react'
import type { Source } from '../../lib/sources'
import { useSettings } from '../../lib/store/settings'
import type { Episode } from '../../lib/tmdb/types'
import { usePlayer, type Panel, type PlayerController } from './controller'
import { EpisodeShelf } from './EpisodeShelf'
import { OptionsPanel } from './OptionsPanel'
import { PlayerIcon, SkipGlyph, type PlayerIconName } from './playerIcons'
import { playbackPreferences } from './preferences'
import { Scrubber } from './Scrubber'
import { VolumeControl } from './Volume'
import s from './Controls.module.css'

export interface ControlsProps {
  controller: PlayerController
  title: string
  line?: string
  onClose: () => void
  sources: Source[]
  source: Source | null
  onPickSource: (source: Source) => void
  onMoreSources: () => void
  /** The current season, for the Episodes shelf; undefined for films. */
  episodes?: { season: number; current: number; list: Episode[] | undefined; onPick: (episode: Episode) => void; fallbackStill?: string }
}

/** Laid out like any modern player: Close top left (with the title beside it on a phone), one progress bar over a single row of
 *  controls (play, skip back and forward, volume and the title on the left; Episodes, X-Ray, Audio and Subtitles, Options,
 *  Picture in Picture and full screen on the right), and for a finger the transport in the middle.
 *  Re-renders only when it shows, hides or opens a panel; each part subscribes to its own state. */
export function Controls({ controller, title, line, onClose, sources, source, onPickSource, onMoreSources, episodes }: ControlsProps) {
  const visible = usePlayer(controller, (st) => st.controls)
  const panel = usePlayer(controller, (st) => st.panel)
  const styling = usePlayer(controller, (st) => st.styling)
  const toggle = (p: Exclude<Panel, null>) => controller.setPanel(panel === p ? null : p)
  const hover = {
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && (controller.hovering = true),
    onPointerLeave: () => {
      controller.hovering = false
      controller.poke()
    },
  }

  return (
    <>
      {/* Its own layer under the subtitles, so the scrim never dims them. */}
      <div className={s.scrim} data-visible={visible ? '' : undefined} aria-hidden="true" />
      <div className={s.controls} data-visible={visible ? '' : undefined} data-panel={panel ?? undefined} data-styling={styling ? '' : undefined}>
        <div className={s.top}>
          <Cluster {...hover}>
            <ClusterButton icon="close" label="Close Player" onClick={onClose} />
          </Cluster>
          <Titles where="top" title={title} line={line} />
        </div>

        <Transport controller={controller} hover={hover} />

        <div className={s.bottom}>
          <div className={s.interactive} {...hover}>
            <Scrubber controller={controller} />
          </div>
          <div className={`${s.bar} ${s.interactive}`} {...hover}>
            <div className={s.left}>
              <PlayButton controller={controller} />
              <SkipButton controller={controller} direction={-1} />
              <SkipButton controller={controller} direction={1} />
              <VolumeControl controller={controller} />
              <Titles where="bar" title={title} line={line} />
            </div>
            <div className={s.right}>
              {episodes && <ClusterButton icon="episodes" label="Episodes" active={panel === 'episodes'} onClick={() => toggle('episodes')} />}
              <ClusterButton icon="xray" label="X-Ray" active={panel === 'xray'} onClick={controller.toggleXRay} />
              <ClusterButton icon="subtitles" label="Audio and Subtitles" active={panel === 'tracks'} onClick={() => toggle('tracks')} />
              <ClusterButton icon="settings" label="Options" active={panel === 'options'} onClick={() => toggle('options')} />
              <CastButton controller={controller} />
              <PipButton controller={controller} />
              <FullscreenButton controller={controller} />
            </div>
          </div>
        </div>

        {(panel === 'options' || panel === 'tracks') && (
          <OptionsPanel
            key={panel}
            controller={controller}
            start={panel === 'tracks' ? 'tracks' : 'root'}
            sources={sources}
            source={source}
            onPickSource={onPickSource}
            onMoreSources={onMoreSources}
          />
        )}
        {panel === 'episodes' && episodes && <EpisodeShelf controller={controller} {...episodes} onClose={() => controller.setPanel(null)} />}
      </div>
    </>
  )
}

/** The title, and "S1 E1 · Episode name" under it. Two copies stand in the page, the one for the window's size shown (a phone has the room beside Close, not in the bottom row). */
function Titles({ where, title, line }: { where: 'top' | 'bar'; title: string; line?: string }) {
  return (
    <div className={s.titles} data-where={where}>
      <p className={s.title}>{title}</p>
      {line && <p className={s.line}>{line}</p>}
    </div>
  )
}

/** Keeps focus where it was when a control is clicked with a mouse, so Space still plays and
 *  pauses instead of pressing the last button again. Keyboard focus is untouched. */
export const keepFocus = (e: React.MouseEvent) => e.preventDefault()

function Cluster({ children, ...rest }: { children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`${s.cluster} ${s.interactive}`} {...rest}>
      {children}
    </div>
  )
}

function ClusterButton({ icon, label, onClick, active }: { icon: PlayerIconName; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button className={s.clusterButton} aria-label={label} title={label} aria-pressed={active} onClick={onClick} onMouseDown={keepFocus}>
      <PlayerIcon name={icon} />
    </button>
  )
}

function PipButton({ controller }: { controller: PlayerController }) {
  const pip = usePlayer(controller, (st) => st.pip)
  if (!controller.canPip) return null
  return <ClusterButton icon="pip" label={pip ? 'Exit Picture in Picture' : 'Picture in Picture'} active={pip} onClick={controller.togglePip} />
}

function CastButton({ controller }: { controller: PlayerController }) {
  const cast = usePlayer(controller, (st) => st.cast)
  if (!cast) return null
  return <ClusterButton icon={cast === 'airplay' ? 'airplay' : 'cast'} label={cast === 'airplay' ? 'AirPlay' : 'Play on Another Screen'} onClick={controller.showCastPicker} />
}

function FullscreenButton({ controller }: { controller: PlayerController }) {
  const full = usePlayer(controller, (st) => st.fullscreen)
  return <ClusterButton icon={full ? 'exitFullscreen' : 'fullscreen'} label={full ? 'Exit Full Screen' : 'Full Screen'} onClick={controller.toggleFullscreen} />
}

type Hover = { onPointerEnter: (e: React.PointerEvent) => void; onPointerLeave: () => void }

function PlayButton({ controller }: { controller: PlayerController }) {
  const paused = usePlayer(controller, (st) => st.paused)
  return (
    <button className={`${s.clusterButton} ${s.rowTransport}`} aria-label={paused ? 'Play' : 'Pause'} title={paused ? 'Play (Space)' : 'Pause (Space)'} onClick={controller.togglePlay} onMouseDown={keepFocus}>
      <PlayerIcon name={paused ? 'play' : 'pause'} />
    </button>
  )
}

/** A finger held on Back asks "What Did They Say?" (the apps do the same); the lift that ends the hold isn't a tap. */
const askMs = 500

/** Skip back or forward by the seconds Settings say. `round` is the touch transport's translucent disc, otherwise a button of the control row. */
function SkipButton({ controller, direction, round, hover }: { controller: PlayerController; direction: -1 | 1; round?: boolean; hover?: Hover }) {
  const back = useSettings((st) => playbackPreferences(st).seekBack)
  const forward = useSettings((st) => playbackPreferences(st).seekForward)
  const held = useRef({ timer: 0, asked: false })
  const onBack = direction < 0
  const seconds = onBack ? back : forward
  return (
    <button
      className={round ? `${s.round} ${s.skip} ${s.interactive}` : `${s.clusterButton} ${s.rowTransport}`}
      aria-label={`${onBack ? 'Back' : 'Forward'} ${seconds} Seconds`}
      title={`${onBack ? 'Back' : 'Forward'} ${seconds} seconds`}
      onClick={() => {
        if (held.current.asked) held.current.asked = false
        else controller.skip(direction)
      }}
      onPointerDown={(e) => {
        if (!onBack || e.pointerType === 'mouse') return
        held.current.asked = false
        clearTimeout(held.current.timer)
        held.current.timer = window.setTimeout(() => {
          held.current.asked = true
          controller.replayWithSubtitles()
        }, askMs)
      }}
      onPointerUp={() => clearTimeout(held.current.timer)}
      onPointerCancel={() => clearTimeout(held.current.timer)}
      onContextMenu={onBack ? (e) => e.preventDefault() : undefined}
      onMouseDown={keepFocus}
      {...hover}
      onPointerLeave={() => {
        clearTimeout(held.current.timer)
        hover?.onPointerLeave()
      }}
    >
      <SkipGlyph forward={!onBack} seconds={seconds} size={round ? 32 : 24} />
    </button>
  )
}

/** The middle of the picture, for a finger: skip back, play or pause, skip forward. A mouse has these in the control row. */
function Transport({ controller, hover }: { controller: PlayerController; hover: Hover }) {
  const paused = usePlayer(controller, (st) => st.paused)
  return (
    <div className={s.transport}>
      <SkipButton controller={controller} direction={-1} round hover={hover} />
      <button className={`${s.round} ${s.play} ${s.interactive}`} aria-label={paused ? 'Play' : 'Pause'} onClick={controller.togglePlay} onMouseDown={keepFocus} {...hover}>
        <PlayerIcon name={paused ? 'play' : 'pause'} size={34} />
      </button>
      <SkipButton controller={controller} direction={1} round hover={hover} />
    </div>
  )
}
