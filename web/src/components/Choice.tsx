import s from './Choice.module.css'

export interface ChoiceOption<T extends string | number> {
  id: T
  label: string
}

/** A segmented control: a base-3 track, the current choice a lighter base with a yellow underline. Arrow
 *  keys move along it. For a few choices (up to four or five); use `ChoiceSelect` for more. */
export function Segmented<T extends string | number>({ options, value, onChange, label }: { options: readonly ChoiceOption<T>[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div
      className={s.segmented}
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
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} tabIndex={o.id === value ? 0 : -1} className={s.segment} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The device's own picker in a base-3 field, for choosing among many. */
export function ChoiceSelect<T extends string | number>({ options, value, onChange, label }: { options: readonly ChoiceOption<T>[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <label className={s.select}>
      <span className="sr-only">{label}</span>
      <select
        className="field"
        value={String(value)}
        onChange={(e) => {
          const picked = options.find((o) => String(o.id) === e.target.value)
          if (picked) onChange(picked.id)
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
