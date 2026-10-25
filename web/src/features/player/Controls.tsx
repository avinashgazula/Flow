import { useRef, type ReactNode } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import type { Source } from '../../lib/sources'
import type { Episode } from '../../lib/tmdb/types'
import { usePlayer, volumeSettable, type Panel, type PlayerController } from './controller'
import { EpisodeShelf } from './EpisodeShelf'
import { OptionsPanel } from './OptionsPanel'
import { Scrubber } from './Scrubber'
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

/** Laid out like Apple's own players: what you leave by top left, sound top right, the title along the
 *  bottom with the panels' buttons at its end, the scrubber's strip under them, the transport in the middle.
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
            <PipButton controller={controller} />
            <CastButton controller={controller} />
            <FullscreenButton controller={controller} />
          </Cluster>
          <Volume controller={controller} hover={hover} />
        </div>

        <Transport controller={controller} hover={hover} />

        <div className={s.bottom}>
          <div className={s.bottomRow}>
            <div className={s.titles}>
              <p className={s.title}>{title}</p>
              {line && <p className={s.line}>{line}</p>}
            </div>
            <Cluster {...hover}>
              {episodes && <ClusterButton icon="grid" label="Episodes" active={panel === 'episodes'} onClick={() => toggle('episodes')} />}
              <ClusterButton icon="subtitles" label="Audio and Subtitles" active={panel === 'tracks'} onClick={() => toggle('tracks')} />
              <ClusterButton icon="settings" label="Options" active={panel === 'options'} onClick={() => toggle('options')} />
            </Cluster>
          </div>
          <div className={s.interactive} {...hover}>
            <Scrubber controller={controller} />
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
        {panel === 'episodes' && episodes && <EpisodeShelf {...episodes} onClose={() => controller.setPanel(null)} />}
      </div>
    </>
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

function ClusterButton({ icon, label, onClick, active }: { icon: IconName; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button className={s.clusterButton} aria-label={label} title={label} aria-pressed={active} onClick={onClick} onMouseDown={keepFocus}>
      <Icon name={icon} size={20} strokeWidth={2.2} />
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

function Volume({ controller, hover }: { controller: PlayerController; hover: Hover }) {
  const volume = usePlayer(controller, (st) => st.volume)
  const muted = usePlayer(controller, (st) => st.muted)
  const level = muted ? 0 : volume
  return (
    <div className={`${s.cluster} ${s.volume} ${s.interactive}`} data-compact={volumeSettable ? undefined : ''} {...hover}>
      <button className={s.clusterButton} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute (M)' : 'Mute (M)'} onClick={controller.toggleMute} onMouseDown={keepFocus}>
        <Icon name={level === 0 ? 'mute' : 'volume'} size={20} strokeWidth={2.2} />
      </button>
      {volumeSettable && (
        <>
          <span className={s.percent}>{Math.round(level * 100)}%</span>
          <input
            className={s.slider}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={level}
            aria-label="Volume"
            style={{ '--level': level } as React.CSSProperties}
            onChange={(e) => controller.setVolume(Number(e.target.value))}
          />
        </>
      )}
    </div>
  )
}

/** A finger held on Back 10 Seconds asks "What Did They Say?" (the apps do the same); the lift that ends the hold isn't a tap. */
const askMs = 500

function Transport({ controller, hover }: { controller: PlayerController; hover: Hover }) {
  const paused = usePlayer(controller, (st) => st.paused)
  const held = useRef({ timer: 0, asked: false })
  return (
    <div className={s.transport}>
      <button
        className={`${s.round} ${s.skip} ${s.interactive}`}
        aria-label="Back 10 Seconds"
        onClick={() => {
          if (held.current.asked) held.current.asked = false
          else controller.seekBy(-10)
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return
          held.current.asked = false
          clearTimeout(held.current.timer)
          held.current.timer = window.setTimeout(() => {
            held.current.asked = true
            controller.replayWithSubtitles()
          }, askMs)
        }}
        onPointerUp={() => clearTimeout(held.current.timer)}
        onPointerCancel={() => clearTimeout(held.current.timer)}
        onContextMenu={(e) => e.preventDefault()}
        onMouseDown={keepFocus}
        {...hover}
        onPointerLeave={() => {
          clearTimeout(held.current.timer)
          hover.onPointerLeave()
        }}
      >
        <SkipGlyph forward={false} />
      </button>
      <button className={`${s.round} ${s.play} ${s.interactive}`} aria-label={paused ? 'Play' : 'Pause'} onClick={controller.togglePlay} onMouseDown={keepFocus} {...hover}>
        <Icon name={paused ? 'play' : 'pause'} size={34} />
      </button>
      <button className={`${s.round} ${s.skip} ${s.interactive}`} aria-label="Forward 10 Seconds" onClick={() => controller.seekBy(10)} onMouseDown={keepFocus} {...hover}>
        <SkipGlyph forward />
      </button>
    </div>
  )
}

/** The go-back and go-forward arrows with "10" inside, as SF Symbols draws them. */
export function SkipGlyph({ forward, size = 30 }: { forward: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={forward ? 'M13 4.6h3.6V1M16.3 4.5A8.6 8.6 0 1 0 20.6 12' : 'M11 4.6H7.4V1M7.7 4.5A8.6 8.6 0 1 1 3.4 12'} />
      <text x="12" y="15.6" textAnchor="middle" fontSize="7.6" fontWeight="700" fill="currentColor" stroke="none" fontFamily="-apple-system, system-ui, sans-serif">
        10
      </text>
    </svg>
  )
}
