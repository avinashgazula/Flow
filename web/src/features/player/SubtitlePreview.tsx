import { useSettings } from '../../lib/store/settings'
import { SubtitleLines, plainLines } from './SubtitleText'
import { sampleSubtitle, subtitleCSS } from './subtitleStyle'
import s from './SubtitlePreview.module.css'

/** A sample line over a stand-in picture, drawn from the same style the player's subtitles use. */
export function SubtitlePreview() {
  const style = useSettings((st) => st.subtitleStyle)
  return (
    <div className={s.preview} aria-hidden="true">
      <div className={s.line} style={subtitleCSS(style)}>
        <SubtitleLines lines={plainLines(sampleSubtitle)} />
      </div>
    </div>
  )
}
