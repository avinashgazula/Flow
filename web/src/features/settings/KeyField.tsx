import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Group, Note } from './controls'
import s from './SettingsScreen.module.css'

type State = { kind: 'idle' | 'checking' } | { kind: 'ok' | 'error'; text: string }

/** One service's API key as a group: a password field, a Save that asks the service whether it accepts the key before
 *  keeping it (so a typo is caught here, not as a missing score later), and Remove Key when the field is emptied.
 *  A key that arrives from another device (Flow Sync) shows at once. */
export function KeyField({
  title,
  label,
  placeholder,
  saved,
  onSave,
  check,
  accepted,
  footer,
}: {
  title: string
  label: string
  placeholder: string
  saved: string
  onSave: (key: string) => void
  check: (key: string, signal: AbortSignal) => Promise<{ ok: true } | { ok: false; error: string }>
  /** What to say once the service has accepted the key. */
  accepted: string
  footer: ReactNode
}) {
  const [key, setKey] = useState(saved)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const running = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => running.current?.abort(), [])
  useEffect(() => {
    setKey(saved)
  }, [saved])

  const next = key.trim()
  const removing = next === '' && saved !== ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (removing) {
      onSave('')
      return setState({ kind: 'idle' })
    }
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setState({ kind: 'checking' })
    const result = await check(next, controller.signal)
    if (controller.signal.aborted) return
    if (result.ok) {
      onSave(next)
      setState({ kind: 'ok', text: accepted })
    } else {
      setState({ kind: 'error', text: result.error })
    }
  }

  return (
    <Group title={title} footer={footer}>
      <form className={s.inline} onSubmit={submit}>
        <input
          className="field"
          value={key}
          onChange={(e) => {
            setKey(e.target.value)
            setState({ kind: 'idle' })
          }}
          placeholder={placeholder}
          aria-label={label}
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button className="btn btn-secondary btn-compact" type="submit" disabled={state.kind === 'checking' || next === saved}>
          {state.kind === 'checking' ? 'Checking…' : removing ? 'Remove Key' : 'Save'}
        </button>
      </form>
      {(state.kind === 'ok' || state.kind === 'error') && (
        <div className={s.pad}>
          <Note tone={state.kind}>{state.text}</Note>
        </div>
      )}
      {state.kind === 'idle' && saved && next === saved && (
        <div className={s.pad}>
          <Note tone="ok">A key is saved in this browser.</Note>
        </div>
      )}
    </Group>
  )
}
