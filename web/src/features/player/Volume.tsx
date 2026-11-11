import { PlayerIcon } from './playerIcons'
import { usePlayer, volumeSettable, type PlayerController } from './controller'
import s from './Controls.module.css'

type Hover = { onPointerEnter: (e: React.PointerEvent) => void; onPointerLeave: () => void }

/** The speaker, and beside it a slider that opens when the pointer or the keyboard is on it, as YouTube's does. Where the
 *  browser can't set the volume (an iPhone) it is only the mute button. Shared by the film player and the live one. */
export function VolumeControl({ controller, hover }: { controller: PlayerController; hover?: Hover }) {
  const volume = usePlayer(controller, (st) => st.volume)
  const muted = usePlayer(controller, (st) => st.muted)
  const level = muted ? 0 : volume
  return (
    <div className={`${s.volume} ${s.interactive}`} data-compact={volumeSettable ? undefined : ''} {...hover}>
      <button
        className={s.clusterButton}
        aria-label={muted ? 'Unmute' : 'Mute'}
        title={muted ? 'Unmute (M)' : 'Mute (M)'}
        onClick={controller.toggleMute}
        onMouseDown={(e) => e.preventDefault()}
      >
        <PlayerIcon name={level === 0 ? 'mute' : 'volume'} />
      </button>
      {volumeSettable && (
        <input
          className={s.slider}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={level}
          aria-label="Volume"
          aria-valuetext={`${Math.round(level * 100)} percent`}
          style={{ '--level': level } as React.CSSProperties}
          onChange={(e) => controller.setVolume(Number(e.target.value))}
        />
      )}
    </div>
  )
}
