import { useEffect, useState, type ReactNode } from 'react'
import s from './SettingsScreen.module.css'

/* The pieces every settings section is built from, after the grouped lists of the native Settings:
   a heading, rounded rows with hairlines between them, and a sentence-case footer. */

export function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.groupWrap}>
      {title && <h3 className={s.groupTitle}>{title}</h3>}
      <div className={s.group}>{children}</div>
      {footer && <p className={s.footer}>{footer}</p>}
    </div>
  )
}

export function Row({ label, detail, htmlFor, children, stacked }: { label: ReactNode; detail?: ReactNode; htmlFor?: string; children?: ReactNode; stacked?: boolean }) {
  const Label = htmlFor ? 'label' : 'span'
  return (
    <div className={s.row} data-stacked={stacked ? '' : undefined}>
      <span className={s.rowText}>
        <Label className={s.rowLabel} htmlFor={htmlFor}>
          {label}
        </Label>
        {detail && <span className={s.rowDetail}>{detail}</span>}
      </span>
      {children && <span className={s.rowControl}>{children}</span>}
    </div>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={s.switch} onClick={() => onChange(!checked)} disabled={disabled}>
      <span className={s.knob} />
    </button>
  )
}

export function Select<T extends string>({ value, onChange, options, label, id, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; id?: string; disabled?: boolean }) {
  return (
    <select id={id} className={`field ${s.select}`} value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label} disabled={disabled}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** A destructive action asks once more in place, instead of a dialog that hides the page. */
export function ConfirmButton({ label, confirm, onConfirm, compact = true }: { label: string; confirm: string; onConfirm: () => void; compact?: boolean }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 5000)
    return () => clearTimeout(timer)
  }, [armed])
  const size = compact ? 'btn-compact' : ''
  if (!armed) {
    return (
      <button type="button" className={`btn btn-glass ${size} ${s.danger}`} onClick={() => setArmed(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className={s.confirm}>
      <button type="button" className={`btn btn-glass ${size}`} onClick={() => setArmed(false)}>
        Cancel
      </button>
      <button
        type="button"
        className={`btn ${size} ${s.dangerSolid}`}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
        autoFocus
      >
        {confirm}
      </button>
    </span>
  )
}

/** A line of feedback under a control: what happened, or what to do next. */
export function Note({ tone = 'muted', children }: { tone?: 'muted' | 'ok' | 'error' | 'warning'; children: ReactNode }) {
  return (
    <p className={s.note} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  )
}
