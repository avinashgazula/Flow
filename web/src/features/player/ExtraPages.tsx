import { Icon } from '../../components/Icon'
import { PlayerIcon } from './playerIcons'
import { Slider } from '../../components/Slider'
import { useSettings } from '../../lib/store/settings'
import { usePlayer, type PlayerController } from './controller'
import { keepFocus } from './Controls'
import { boostLabel, boostRange } from './volumeBoost'
import { clampDelay, delayLabel, delayRange } from './subtitleDelay'
import c from './Controls.module.css'
import s from './ExtraPages.module.css'

/** The options panel's Subtitle Delay page: nudge the subtitles Flow draws earlier or later, in tenths of a second,
 *  with a slider for the big moves and a Reset. The subtitle on screen moves as it's changed. */
export function DelayPage({ controller }: { controller: PlayerController }) {
  const delay = usePlayer(controller, (st) => st.subtitleDelay)
  const subtitleId = usePlayer(controller, (st) => st.subtitleId)
  const nudge = (by: number) => controller.setSubtitleDelay(clampDelay(delay + by))
  return (
    <>
      <div className={s.stepper}>
        <button className={s.step} aria-label="Show Subtitles Earlier" title="Show Subtitles Earlier" onClick={() => nudge(-delayRange.step)} onMouseDown={keepFocus} disabled={delay <= delayRange.min}>
          <PlayerIcon name="minus" size={18} strokeWidth={2.4} />
        </button>
        <output className={s.big} aria-live="polite">
          {delayLabel(delay)}
        </output>
        <button className={s.step} aria-label="Show Subtitles Later" title="Show Subtitles Later" onClick={() => nudge(delayRange.step)} onMouseDown={keepFocus} disabled={delay >= delayRange.max}>
          <Icon name="plus" size={18} strokeWidth={2.4} />
        </button>
      </div>
      <div className={s.slide}>
        <Slider label="Subtitle delay" value={delay} min={delayRange.min} max={delayRange.max} step={delayRange.step} valueText={delayLabel(delay)} onChange={(v) => controller.setSubtitleDelay(v)} />
      </div>
      <button className={c.row} disabled={delay === 0} onClick={() => controller.setSubtitleDelay(0)} onMouseDown={keepFocus}>
        <span className={c.rowText}>
          <span className={c.rowTitle}>Reset</span>
        </span>
      </button>
      <p className={c.groupFooter}>
        Positive shows subtitles later, negative earlier. Kept for this title until you close the player.
        {subtitleId === null && ' Subtitles are off; the delay applies when you turn them on.'}
      </p>
    </>
  )
}

/** The options panel's Volume Boost page: extra loudness in whole decibels, from Off to 12. */
export function BoostPage({ controller }: { controller: PlayerController }) {
  const db = useSettings((st) => st.volumeBoostDB ?? 0)
  return (
    <>
      <div className={s.stepper} data-single="">
        <output className={s.big} aria-live="polite">
          {boostLabel(db)}
        </output>
      </div>
      <div className={s.slide}>
        <Slider label="Volume boost" value={db} min={boostRange.min} max={boostRange.max} step={boostRange.step} valueText={boostLabel(db)} onChange={(v) => controller.setVolumeBoost(v)} />
      </div>
      <p className={c.groupFooter}>Plays this soundtrack up to {boostRange.max} dB louder, through a limiter so loud scenes don’t crackle. Applies straight away and stays on for other films.</p>
    </>
  )
}
