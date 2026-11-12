import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { Icon } from '../../components/Icon'
import { useSettings } from '../../lib/store/settings'
import { accountServer, accountStatus, createAccount, currentNumber, deleteAccount, logIn, logOut, syncNow } from '../../lib/account/engine'
import { typedServer, saveTypedServer } from '../../lib/account/config'
import { formatTyped, groupNumber, incompleteNumber, numberLength, parseNumber } from '../../lib/account/number'
import { normaliseServer } from '../../lib/sync/pairing'
import { ConfirmButton, Group, Note, Row } from './controls'
import { ago } from './ago'
import a from './AccountGroup.module.css'
import s from './SettingsScreen.module.css'

/* Settings → Account → Marquee Account (docs/SYNC.md). Logged out: Create Account, or Log In with the 16-digit number. Right
   after creating: the number, to write down. Logged in: the number (hidden until asked for) with Copy, when it last synced,
   Log Out and Delete Account. The engine and the rules are in lib/account; this is the form. */

const whatSyncs = 'Your account keeps your library (watchlist, favourites, history, resume points, ratings), keys, Trakt and Simkl sign-ins, add-ons, servers and playback settings the same on every device, the apps included. It’s end-to-end encrypted: your devices lock everything with a key made from your account number, and the server can’t read it.'

// MARK: Pieces shared with Welcome

/** The account number in four groups. `hidden` shows dots and the last four digits. */
export function NumberDisplay({ digits, hidden }: { digits: string; hidden?: boolean }) {
  const shown = hidden ? `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}` : digits
  return (
    <p className={`${a.number} ${hidden ? a.hidden : ''}`} aria-label={hidden ? 'Account number, hidden' : `Account number ${groupNumber(digits)}`} data-account-number="">
      {groupNumber(shown)
        .split(' ')
        .map((group, i) => (
          <span key={i} aria-hidden="true">
            {group}
          </span>
        ))}
    </p>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      className="btn btn-secondary btn-compact"
      onClick={() => {
        if (navigator.clipboard) void navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : label}
    </button>
  )
}

/** The number, with Copy, and the step that says it must be written down. `onDone` is the person's "I have". */
export function WriteItDown({ digits, onDone, doneLabel = 'Done' }: { digits: string; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false)
  return (
    <div className={a.panel}>
      <NumberDisplay digits={digits} />
      <div className={s.actions}>
        <CopyButton text={groupNumber(digits)} label="Copy Number" />
      </div>
      <p className={a.warn} role="note">
        <strong>Write this down.</strong> It’s the only way back into your account. There’s no password to reset, and nobody, Marquee included, can recover it for you.
      </p>
      <label className={a.step}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I’ve written it down somewhere safe
      </label>
      <div className={s.actions}>
        <button type="button" className="btn btn-primary btn-compact" onClick={onDone} disabled={!saved}>
          {doneLabel}
        </button>
      </div>
    </div>
  )
}

/** A field that formats as you type: digits only, grouped by four. */
export function NumberField({ value, onChange, id = 'account-number', autoFocus }: { value: string; onChange: (next: string) => void; id?: string; autoFocus?: boolean }) {
  return (
    <input
      id={id}
      className={`field ${a.field}`}
      value={value}
      onChange={(e) => onChange(formatTyped(e.target.value))}
      onPaste={(e) => {
        // A pasted number (with dashes, or a line break at its end) arrives clean.
        e.preventDefault()
        onChange(formatTyped(e.clipboardData.getData('text')))
      }}
      placeholder="0000 0000 0000 0000"
      aria-label="Account number"
      inputMode="numeric"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      maxLength={numberLength + 3}
      autoFocus={autoFocus}
    />
  )
}

/** Where the account server is, when the site wasn't built with one. */
export function ServerField({ onChange }: { onChange: () => void }) {
  const [text, setText] = useState(typedServer)
  return (
    <div className={s.form}>
      <label className={s.fieldLabel} htmlFor="account-server">
        Account Server
      </label>
      <input
        id="account-server"
        className="field"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          saveTypedServer(normaliseServer(e.target.value) ?? '')
          onChange()
        }}
        placeholder="https://flow-stream-proxy.example.workers.dev"
        type="text"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <p className={s.hint}>The address of the Worker that stores your account, the same one as your stream proxy. Setting it up takes a few minutes: see web/proxy/README.md in Marquee’s source.</p>
    </div>
  )
}

// MARK: The group

export function AccountGroup() {
  const status = useSyncExternalStore(accountStatus.subscribe, accountStatus.get)
  // The stream proxy setting can name the server, so it is read to re-render when it changes.
  useSettings((x) => x.streamProxy)
  const [, again] = useState(0)
  const [created, setCreated] = useState<string>()
  const [logging, setLogging] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'create' | 'login' | 'delete'>()
  const [revealed, setRevealed] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string }>()
  const [now, setNow] = useState(() => Date.now())

  const on = status.phase !== 'off'
  const number = on ? currentNumber() : ''
  const server = accountServer()

  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    setNow(Date.now())
    return () => clearInterval(timer)
  }, [on, status.lastSyncAt])

  async function create() {
    setNote(undefined)
    setBusy('create')
    const result = await createAccount()
    setBusy(undefined)
    if (result.ok) setCreated(result.number)
    else setNote({ tone: 'error', text: result.error })
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault()
    if (!parseNumber(text)) return setNote({ tone: 'error', text: incompleteNumber })
    setNote(undefined)
    setBusy('login')
    const result = await logIn(text)
    setBusy(undefined)
    if (result.ok) {
      setLogging(false)
      setText('')
    } else setNote({ tone: 'error', text: result.error })
  }

  // The number was just made: the one step that matters comes before anything else.
  if (created) {
    return (
      <Group title="Your Account Number" footer="You can show it again later from this page, but keep your own copy: if you lose every device, this number is all that brings your library back.">
        <WriteItDown digits={created} onDone={() => setCreated(undefined)} doneLabel="Continue" />
      </Group>
    )
  }

  if (on && number) {
    const syncing = status.phase === 'syncing'
    const detail = syncing ? 'Syncing…' : status.lastSyncAt ? `Last synced ${ago(status.lastSyncAt, now)}` : 'Waiting for the first sync'
    return (
      <>
        <Group title="Marquee Account" footer={`${whatSyncs} Log Out forgets the account on this device. Delete Account erases everything stored in it, for every device, and this device keeps its data.`}>
          <Row label="Account Number" detail={revealed ? 'Anyone with it can open your account' : 'Hidden until you ask for it'}>
            <button type="button" className="btn btn-secondary btn-compact" aria-pressed={revealed} onClick={() => setRevealed((v) => !v)}>
              {revealed ? 'Hide' : 'Show'}
            </button>
            <CopyButton text={groupNumber(number)} />
          </Row>
          <div className={s.pad}>
            <NumberDisplay digits={number} hidden={!revealed} />
          </div>
          <Row label="Sync" detail={detail}>
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => void syncNow()} disabled={syncing}>
              <Icon name="refresh" size={16} /> Sync Now
            </button>
          </Row>
          {status.error && (
            <div className={s.pad}>
              <Note tone="error">{status.error}</Note>
            </div>
          )}
          <Row label="Log Out" detail="Forget the account on this device">
            <button type="button" className="btn btn-secondary btn-compact" aria-expanded={leaving} onClick={() => setLeaving((v) => !v)}>
              Log Out
            </button>
          </Row>
          {leaving && (
            <>
              <p className={`${s.hint} ${s.pad}`}>Your account stays as it is for your other devices. What happens to what’s on this one?</p>
              <div className={a.choices}>
                <button
                  type="button"
                  className="btn btn-primary btn-compact"
                  onClick={() => {
                    logOut(true)
                    setLeaving(false)
                    setNote({ tone: 'ok', text: 'Logged out. Your library and settings stay on this device.' })
                  }}
                >
                  Log Out and Keep My Data
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={() => {
                    logOut(false)
                    setLeaving(false)
                    setNote({ tone: 'ok', text: 'Logged out, and this device’s library and settings are cleared. Log in again to bring them back.' })
                  }}
                >
                  Log Out and Clear This Device
                </button>
              </div>
            </>
          )}
          <Row label="Delete Account" detail="Erase it from every device">
            <ConfirmButton
              label="Delete Account"
              confirm={busy === 'delete' ? 'Deleting…' : 'Delete'}
              onConfirm={() => {
                setBusy('delete')
                void deleteAccount().then((result) => {
                  setBusy(undefined)
                  setNote(result.ok ? { tone: 'ok', text: 'The account is deleted. Your library and settings stay on this device.' } : { tone: 'error', text: result.error })
                })
              }}
            />
          </Row>
        </Group>
        {note && <Note tone={note.tone}>{note.text}</Note>}
      </>
    )
  }

  return (
    <>
      <Group title="Marquee Account" footer={whatSyncs}>
        {!server && <ServerField onChange={() => again((n) => n + 1)} />}
        <Row label="Create Account" detail="Makes a 16-digit account number. That’s all you need to log in">
          <button type="button" className={`btn ${logging ? 'btn-secondary' : 'btn-primary'} btn-compact`} onClick={() => void create()} disabled={busy !== undefined || !server}>
            {busy === 'create' ? 'Creating…' : 'Create Account'}
          </button>
        </Row>
        <Row label="Log In" detail="Use the account number from another device">
          <button type="button" className={`btn ${logging ? 'btn-primary' : 'btn-secondary'} btn-compact`} aria-expanded={logging} onClick={() => setLogging((v) => !v)} disabled={!server}>
            Log In
          </button>
        </Row>
        {logging && (
          <form className={s.inline} onSubmit={(e) => void submitLogin(e)}>
            <NumberField value={text} onChange={(v) => (setText(v), setNote(undefined))} autoFocus />
            <button className="btn btn-primary btn-compact" type="submit" disabled={!parseNumber(text) || busy === 'login'}>
              {busy === 'login' ? 'Logging In…' : 'Log In'}
            </button>
          </form>
        )}
      </Group>
      {note && <Note tone={note.tone}>{note.text}</Note>}
    </>
  )
}
