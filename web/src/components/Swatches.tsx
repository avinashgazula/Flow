import { Icon } from './Icon'
import s from './Swatches.module.css'

export interface Swatch<T extends string> {
  id: T
  label: string
  color: string
}

/** A few colours to pick from, as round chips. The chosen one carries a ring and a check, so the choice never
 *  rests on colour alone, and each has its name for a screen reader. Arrow keys move along the row. */
export function Swatches<T extends string>({ options, value, onChange, label }: { options: readonly Swatch<T>[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div
      className={s.swatches}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
        if (!step) return
        e.preventDefault()
        const group = e.currentTarget
        const i = options.findIndex((o) => o.id === value)
        onChange(options[(i + step + options.length) % options.length]!.id)
        requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
      }}
    >
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} aria-label={o.label} title={o.label} tabIndex={o.id === value ? 0 : -1} className={s.swatch} style={{ background: o.color }} onClick={() => onChange(o.id)}>
          {o.id === value && <Icon name="check" size={14} strokeWidth={3} />}
        </button>
      ))}
    </div>
  )
}
