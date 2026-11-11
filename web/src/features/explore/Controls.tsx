import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import s from './Controls.module.css'

/* Small controls shared by Explore, Search, Library and Person. */

/** A segmented control, after the platform Picker with .segmented style. Arrow keys move along it. */
export function Segmented<T extends string>({ options, value, onChange, label, className }: { options: readonly { id: T; label: string }[]; value: T; onChange: (value: T) => void; label: string; className?: string }) {
  return (
    <div
      className={`${s.segmented} ${className ?? ''}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
        if (!step) return
        e.preventDefault()
        const group = e.currentTarget
        const i = options.findIndex((o) => o.id === value)
        const next = options[(i + step + options.length) % options.length]!
        onChange(next.id)
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

/** A compact pop-up menu. The system's own picker opens, which on phones is the familiar wheel. */
export function Select<T extends string>({ options, value, onChange, label, className }: { options: readonly { id: T; label: string }[]; value: T; onChange: (value: T) => void; label: string; className?: string }) {
  return (
    <label className={`${s.select} ${className ?? ''}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={14} strokeWidth={2.6} />
    </label>
  )
}

/** TMDB turned the request down for the key: missing, mistyped or revoked. Trying again can't fix it. */
export function isKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401
}

/** An error as a sentence that says what to do next. A failed fetch reads as the browser's own
 *  jargon ("Failed to fetch"), so it's replaced with what actually happened, and a refused key
 *  points at Settings instead of "try again". */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : ''
  if (isKeyError(error)) return /add a tmdb key/i.test(raw) ? raw : 'TMDB didn’t accept this key. Check it in Settings.'
  if (!raw || error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(raw)) return 'Marquee couldn’t reach TMDB. Check your connection, then try again.'
  return /[.!?]$/.test(raw) ? `${raw} Try again in a moment.` : `${raw}. Try again in a moment.`
}

/** The one thing to do about a failed load: fix the key, or try again. */
export function RetryAction({ error, onRetry, busy }: { error: unknown; onRetry: () => void; busy?: boolean }) {
  if (isKeyError(error))
    return (
      <Link to="/settings" className="btn btn-primary">
        Open Settings
      </Link>
    )
  return (
    <button className="btn btn-secondary" onClick={onRetry} disabled={busy}>
      Try Again
    </button>
  )
}

/** What a screen shows when there's nothing to list or loading failed: a title, a line on what to do,
 *  and optionally an action. */
export function StateView({ icon, title, message, action, heading: Heading = 'h2' }: { icon?: Parameters<typeof Icon>[0]['name']; title: string; message?: ReactNode; action?: ReactNode; heading?: 'h1' | 'h2' }) {
  return (
    <div className={s.state} role="status">
      {icon && (
        <span className={s.stateIcon} aria-hidden="true">
          <Icon name={icon} size={24} strokeWidth={2} />
        </span>
      )}
      <Heading className={s.stateTitle}>{title}</Heading>
      {message && <p className={s.stateMessage}>{message}</p>}
      {action}
    </div>
  )
}
