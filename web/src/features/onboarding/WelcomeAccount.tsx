import { useState, type FormEvent } from 'react'
import { accountServer, createAccount, logIn } from '../../lib/account/engine'
import { groupNumber, incompleteNumber, parseNumber } from '../../lib/account/number'
import { hasCatalog, settingsStore } from '../../lib/store/settings'
import { NumberDisplay, NumberField, ServerField, CopyButton } from '../settings/AccountGroup'
import s from './Welcome.module.css'

/* "Log In to Your Account" and "Create an Account" on Welcome: the same as Settings → Account → Marquee Account, for a browser
   with nothing set up yet. Logging in brings the TMDB key, sign-ins, add-ons, servers and library, which is the way in. It
   loads only when asked for, so Welcome's own code stays small. */

export function WelcomeLogIn({ onBack }: { onBack: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [, again] = useState(0)
  const server = accountServer()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!parseNumber(text)) return setError(incompleteNumber)
    setError(undefined)
    setBusy(true)
    const result = await logIn(text)
    setBusy(false)
    // Logging in brings the TMDB key in, which turns Welcome off. Without one there is still nothing to show.
    if (!result.ok) setError(result.error)
    else if (!hasCatalog(settingsStore.get())) setError('Logged in, but that account holds no TMDB key yet. Go back, add a key, then continue.')
  }

  return (
    <form className={s.form} onSubmit={(e) => void submit(e)}>
      <label className={s.label} htmlFor="account-number">
        Account Number
      </label>
      <NumberField value={text} onChange={(v) => (setText(v), setError(undefined))} autoFocus />
      {!server && <ServerField onChange={() => again((n) => n + 1)} />}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <p className={s.hint}>The 16-digit number from Settings → Account on another device. Your library, keys and sign-ins come back with it.</p>
      <button className="btn btn-primary" type="submit" disabled={!parseNumber(text) || busy || !server}>
        {busy ? 'Logging In…' : 'Log In'}
      </button>
      <button type="button" className="btn btn-quiet" onClick={onBack} disabled={busy}>
        Back
      </button>
    </form>
  )
}

export function WelcomeCreate({ onBack }: { onBack: () => void }) {
  const [number, setNumber] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [, again] = useState(0)
  const server = accountServer()

  async function create() {
    setError(undefined)
    setBusy(true)
    const result = await createAccount()
    setBusy(false)
    if (result.ok) setNumber(result.number)
    else setError(result.error)
  }

  if (number) {
    return (
      <div className={s.form}>
        <span className={s.label}>Your Account Number</span>
        <NumberDisplay digits={number} />
        <div className={s.buttons}>
          <CopyButton text={groupNumber(number)} label="Copy Number" />
        </div>
        <p className={s.error}>Write this down. It’s the only way back into your account, and nobody can recover it for you.</p>
        <label className={s.hint} style={{ display: 'flex', gap: 'var(--space-s)', alignItems: 'center' }}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--blue)' }} />I’ve written it down somewhere safe
        </label>
        <p className={s.hint}>Next, add your TMDB key. Once it’s in, it’s saved to your account and comes with you to every device.</p>
        <button className="btn btn-primary" type="button" disabled={!saved} onClick={onBack}>
          Continue
        </button>
      </div>
    )
  }

  return (
    <div className={s.form}>
      <span className={s.label}>New Account</span>
      <p className={s.hint}>Marquee makes a random 16-digit account number. There’s no username or password: the number is all you need to log in on another device, and everything you save is encrypted with it.</p>
      {!server && <ServerField onChange={() => again((n) => n + 1)} />}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" type="button" onClick={() => void create()} disabled={busy || !server}>
        {busy ? 'Creating…' : 'Create Account'}
      </button>
      <button type="button" className="btn btn-quiet" onClick={onBack} disabled={busy}>
        Back
      </button>
    </div>
  )
}
