import { Slider } from '../../components/Slider'
import { Swatches } from '../../components/Swatches'
import { SubtitlePreview } from '../player/SubtitlePreview'
import { subtitleColorValues } from '../player/subtitleStyle'
import { defaultSubtitleStyle, isDefaultSubtitleStyle, subtitleBackgrounds, subtitleColors, subtitleEdges, subtitleFonts, subtitleLift, subtitleOpacity, subtitleScale, subtitleWeights } from '../../lib/store/subtitleStyle'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { updateSubtitleStyle } from '../../lib/store/updateSubtitleStyle'
import { Group, Row, Select } from './controls'
import s from './SettingsScreen.module.css'

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`
const liftLabel = (fraction: number) => (fraction === 0 ? 'Default' : `+${percent(fraction)}`)

const swatches = subtitleColors.map((c) => ({ id: c.value, label: c.label, color: subtitleColorValues[c.value] }))

/** How subtitles look, with a live preview above the controls. The player's Subtitle Style page edits the
 *  same setting, and both draw it with the same style (player/subtitleStyle.ts). */
export function SubtitleStyleGroup() {
  const style = useSettings((x) => x.subtitleStyle)
  return (
    <Group
      title="Subtitle Style"
      footer="Applies to the subtitles Flow draws itself, whichever track you choose. Position raises the line from the bottom of the picture. You can also change the style from the player’s options."
    >
      <SubtitlePreview />
      <Row label="Size" htmlFor="sub-size">
        <span className={s.slide}>
          <Slider id="sub-size" label="Subtitle size" value={style.fontScale} min={subtitleScale.min} max={subtitleScale.max} step={subtitleScale.step} valueText={percent(style.fontScale)} onChange={(v) => updateSubtitleStyle({ fontScale: v })} />
          <output className={s.slideValue} htmlFor="sub-size">
            {percent(style.fontScale)}
          </output>
        </span>
      </Row>
      <Row label="Font" htmlFor="sub-font">
        <Select id="sub-font" label="Subtitle font" value={style.font} onChange={(v) => updateSubtitleStyle({ font: v })} options={[...subtitleFonts]} />
      </Row>
      <Row label="Weight" htmlFor="sub-weight">
        <Select id="sub-weight" label="Subtitle weight" value={style.weight} onChange={(v) => updateSubtitleStyle({ weight: v })} options={[...subtitleWeights]} />
      </Row>
      <Row label="Colour">
        <Swatches label="Subtitle colour" options={swatches} value={style.color} onChange={(v) => updateSubtitleStyle({ color: v })} />
      </Row>
      <Row label="Text Edge" htmlFor="sub-edge">
        <Select id="sub-edge" label="Subtitle text edge" value={style.edgeStyle} onChange={(v) => updateSubtitleStyle({ edgeStyle: v })} options={[...subtitleEdges]} />
      </Row>
      <Row label="Background" htmlFor="sub-background">
        <Select id="sub-background" label="Subtitle background" value={style.background} onChange={(v) => updateSubtitleStyle({ background: v })} options={[...subtitleBackgrounds]} />
      </Row>
      {style.background === 'translucent' && (
        <Row label="Opacity" htmlFor="sub-opacity">
          <span className={s.slide}>
            <Slider id="sub-opacity" label="Subtitle background opacity" value={style.backgroundOpacity} min={subtitleOpacity.min} max={subtitleOpacity.max} step={subtitleOpacity.step} valueText={percent(style.backgroundOpacity)} onChange={(v) => updateSubtitleStyle({ backgroundOpacity: v })} />
            <output className={s.slideValue} htmlFor="sub-opacity">
              {percent(style.backgroundOpacity)}
            </output>
          </span>
        </Row>
      )}
      <Row label="Position" htmlFor="sub-position">
        <span className={s.slide}>
          <Slider id="sub-position" label="Subtitle position" value={style.verticalPosition} min={subtitleLift.min} max={subtitleLift.max} step={subtitleLift.step} valueText={liftLabel(style.verticalPosition)} onChange={(v) => updateSubtitleStyle({ verticalPosition: v })} />
          <output className={s.slideValue} htmlFor="sub-position">
            {liftLabel(style.verticalPosition)}
          </output>
        </span>
      </Row>
      {!isDefaultSubtitleStyle(style) && (
        <Row label="Reset to Defaults" detail="Size, font, colour, edge, background and position">
          {/* A quiet button, no confirm step: the style is a few taps to set again and the preview shows the result. */}
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => settingsStore.set({ subtitleStyle: defaultSubtitleStyle })}>
            Reset
          </button>
        </Row>
      )}
    </Group>
  )
}
