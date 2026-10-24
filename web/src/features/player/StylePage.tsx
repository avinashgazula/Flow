import type { ReactNode } from 'react'
import { Slider } from '../../components/Slider'
import { Swatches } from '../../components/Swatches'
import { defaultSubtitleStyle, isDefaultSubtitleStyle, subtitleBackgrounds, subtitleColors, subtitleEdges, subtitleFonts, subtitleLift, subtitleOpacity, subtitleScale, subtitleWeights } from '../../lib/store/subtitleStyle'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { updateSubtitleStyle } from '../../lib/store/updateSubtitleStyle'
import { keepFocus } from './Controls'
import { subtitleColorValues } from './subtitleStyle'
import c from './Controls.module.css'
import s from './StylePage.module.css'

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`
const liftLabel = (fraction: number) => (fraction === 0 ? 'Default' : `+${percent(fraction)}`)
const swatches = subtitleColors.map((x) => ({ id: x.value, label: x.label, color: subtitleColorValues[x.value] }))

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={htmlFor}>
        {label}
      </label>
      <div className={s.control}>{children}</div>
    </div>
  )
}

function Pick<T extends string>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <select id={id} className={`field ${s.select}`} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} onPointerUp={(e) => e.pointerType === 'mouse' && e.currentTarget.blur()}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** The Subtitle Style page of the options panel: the same choices as Settings → Playback, closer together.
 *  A change applies to the subtitles on screen as it's made (the overlay reads the same setting), and the
 *  player keeps a sample line up while this page is open. */
export function StylePage() {
  const style = useSettings((x) => x.subtitleStyle)
  return (
    <>
      <Field label="Size" htmlFor="style-size">
        <Slider id="style-size" label="Subtitle size" value={style.fontScale} min={subtitleScale.min} max={subtitleScale.max} step={subtitleScale.step} valueText={percent(style.fontScale)} onChange={(v) => updateSubtitleStyle({ fontScale: v })} />
        <span className={s.value}>{percent(style.fontScale)}</span>
      </Field>
      <Field label="Font" htmlFor="style-font">
        <Pick id="style-font" label="Subtitle font" value={style.font} options={subtitleFonts} onChange={(v) => updateSubtitleStyle({ font: v })} />
      </Field>
      <Field label="Weight" htmlFor="style-weight">
        <Pick id="style-weight" label="Subtitle weight" value={style.weight} options={subtitleWeights} onChange={(v) => updateSubtitleStyle({ weight: v })} />
      </Field>
      <Field label="Colour">
        <Swatches label="Subtitle colour" options={swatches} value={style.color} onChange={(v) => updateSubtitleStyle({ color: v })} />
      </Field>
      <Field label="Edge" htmlFor="style-edge">
        <Pick id="style-edge" label="Subtitle text edge" value={style.edgeStyle} options={subtitleEdges} onChange={(v) => updateSubtitleStyle({ edgeStyle: v })} />
      </Field>
      <Field label="Background" htmlFor="style-background">
        <Pick id="style-background" label="Subtitle background" value={style.background} options={subtitleBackgrounds} onChange={(v) => updateSubtitleStyle({ background: v })} />
      </Field>
      {style.background === 'translucent' && (
        <Field label="Opacity" htmlFor="style-opacity">
          <Slider id="style-opacity" label="Subtitle background opacity" value={style.backgroundOpacity} min={subtitleOpacity.min} max={subtitleOpacity.max} step={subtitleOpacity.step} valueText={percent(style.backgroundOpacity)} onChange={(v) => updateSubtitleStyle({ backgroundOpacity: v })} />
          <span className={s.value}>{percent(style.backgroundOpacity)}</span>
        </Field>
      )}
      <Field label="Position" htmlFor="style-position">
        <Slider id="style-position" label="Subtitle position" value={style.verticalPosition} min={subtitleLift.min} max={subtitleLift.max} step={subtitleLift.step} valueText={liftLabel(style.verticalPosition)} onChange={(v) => updateSubtitleStyle({ verticalPosition: v })} />
        <span className={s.value}>{liftLabel(style.verticalPosition)}</span>
      </Field>
      <button className={c.row} disabled={isDefaultSubtitleStyle(style)} onClick={() => settingsStore.set({ subtitleStyle: defaultSubtitleStyle })} onMouseDown={keepFocus}>
        <span className={c.rowText}>
          <span className={c.rowTitle}>Reset to Defaults</span>
        </span>
      </button>
      <p className={c.groupFooter}>Changes apply as you make them and are kept in Settings → Playback.</p>
    </>
  )
}
