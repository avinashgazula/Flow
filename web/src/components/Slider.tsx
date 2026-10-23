import type { CSSProperties } from 'react'
import s from './Slider.module.css'

/** A range slider in the site's colours: a paper fill on a base-4 track. Arrow keys, Home and End are the
 *  browser's own; `valueText` is what a screen reader says in place of the bare number. */
export function Slider({ value, min, max, step, onChange, label, valueText, id }: { value: number; min: number; max: number; step: number; onChange: (value: number) => void; label: string; valueText?: string; id?: string }) {
  return (
    <input
      id={id}
      className={s.slider}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={valueText}
      style={{ '--level': (value - min) / (max - min) } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      // After a mouse drag, let go of the focus so the player's keys (Space, the arrows) work again.
      onPointerUp={(e) => e.pointerType === 'mouse' && e.currentTarget.blur()}
    />
  )
}
