import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { Icon } from '../../components/Icon'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { syncStatus } from '../../lib/sync/engine'
import { redirectURI } from '../../lib/trakt/oauth'
import { beginSignIn, checkClientID, finishingSignIn, signOut } from '../../lib/trakt/session'
import { useTrakt } from '../../lib/trakt/store'
import { ConfirmButton, Group, Note, Row } from './controls'
import s from './SettingsScreen.module.css'
import { ago } from './SyncGroup'

/* Settings → Account: the Trakt app Flow signs in with, and the sign-in itself. The sign-in is a setting that
   Flow Sync carries, so signing in on any device signs in here too. The sign-in code, the library sync and the
   scrobbler are in lib/trakt and load only when they are used. */

/** The Client ID of the owner's Trakt app, and the one address they must add to it. */
function AppGroup() {
  const saved = useSettings((x) => x.traktClientID)
  const [id, setId] = useState(saved)
  const [state, setState] = useState<{ kind: 'idle' | 'checking' } | { kind: 'ok' | 'error'; text: string }>({ kind: 'idle' })
  const [copied, setCopied] = useState(false)
  const redirect = redirectURI()
  // A Client ID that arrives from another device (Flow Sync) shows here at once.
  useEffect(() => {
    setId(saved)
  }, [saved])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const next = id.trim()
    if (!next) {
      settingsStore.set({ traktClientID: '' })
      return setState({ kind: 'idle' })
    }
    setState({ kind: 'checking' })
    const problem = await checkClientID(next)
    if (problem) return setState({ kind: 'error', text: problem })
    settingsStore.set({ traktClientID: next })
    setState({ kind: 'ok', text: 'Trakt accepted the client ID.' })
  }

  return (
    <Group
      title="Trakt App"
      footer={
        <>
          Create an app at{' '}
          <a href="https://trakt.tv/oauth/applications" target="_blank" rel="noreferrer">
            trakt.tv/oauth/applications
          </a>{' '}
          and add the Redirect URI above to it, alongside the one it already lists (the Apple apps use <code>flow://trakt-callback</code>). Trakt no longer issues a client secret, and Flow doesn’t need one.
        </>
      }
    >
      <form className={s.inline} onSubmit={submit}>
        <input
          className="field"
          value={id}
          onChange={(e) => {
            setId(e.target.value)
            setState({ kind: 'idle' })
          }}
          placeholder="Paste your Trakt Client ID"
          aria-label="Trakt Client ID"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button className="btn btn-secondary btn-compact" type="submit" disabled={id.trim() === saved || state.kind === 'checking'}>
          {state.kind === 'checking' ? 'Checking…' : 'Save'}
        </button>
      </form>
      {(state.kind === 'ok' || state.kind === 'error') && (
        <div className={s.pad}>
          <Note tone={state.kind}>{state.text}</Note>
        </div>
      )}
      <Row label="Redirect URI" detail={<code className={s.mono}>{redirect}</code>}>
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          onClick={() => {
            if (navigator.clipboard) void navigator.clipboard.writeText(redirect).then(() => setCopied(true), () => undefined)
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </Row>
    </Group>
  )
}

/** Sign In to Trakt, or who is signed in, when it last synced and what went wrong. */
function SignInGroup() {
  const clientID = useSettings((x) => x.traktClientID.trim())
  const account = useSettings((x) => x.traktAccount)
  const trakt = useTrakt((x) => x)
  const sync = useSyncExternalStore(syncStatus.subscribe, syncStatus.get)
  const finishing = useSyncExternalStore(finishingSignIn.subscribe, finishingSignIn.get)
  const [busy, setBusy] = useState<'sign-in' | 'sync'>()
  const [problem, setProblem] = useState<string>()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!account) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    setNow(Date.now())
    return () => clearInterval(timer)
  }, [account, trakt.lastSyncAt])

  const sharing = sync.phase !== 'off'
  const footer = sharing
    ? 'Sign in once. A sign-in on any device arrives on the others through Sync, with no prompt, and so does signing out. Trakt keeps your watchlist, history and progress, and Flow keeps this browser’s in step.'
    : 'Sign in once. With Sync on (Settings → Data), a sign-in on any device arrives on the others with no prompt. Trakt keeps your watchlist, history and progress, and Flow keeps this browser’s in step.'

  async function signIn() {
    setProblem(undefined)
    setBusy('sign-in')
    try {
      await beginSignIn()
    } catch (error) {
      setBusy(undefined)
      setProblem(error instanceof Error ? error.message : 'Couldn’t open Trakt. Try again.')
    }
  }

  async function syncNow() {
    setBusy('sync')
    try {
      const { syncTrakt } = await import('../../lib/trakt/engine')
      await syncTrakt()
    } finally {
      setBusy(undefined)
    }
  }

  if (!account) {
    return (
      <>
        <Group title="Trakt" footer={footer}>
          <Row label="Not Signed In" detail={finishing ? 'Finishing with Trakt…' : clientID ? 'Opens Trakt to approve Flow' : 'Add a Trakt Client ID above first'}>
            <button type="button" className="btn btn-primary btn-compact" onClick={() => void signIn()} disabled={!clientID || busy === 'sign-in' || finishing}>
              {busy === 'sign-in' ? 'Opening Trakt…' : 'Sign In to Trakt'}
            </button>
          </Row>
          {(problem ?? trakt.error) && (
            <div className={`${s.pad} ${s.padTop}`}>
              <Note tone="error">{problem ?? trakt.error}</Note>
            </div>
          )}
        </Group>
      </>
    )
  }

  const syncing = busy === 'sync'
  const detail = syncing ? 'Syncing…' : trakt.lastSyncAt ? `Last synced ${ago(trakt.lastSyncAt, now)}` : 'Waiting for the first sync'
  return (
    <Group title="Trakt" footer={footer}>
      <Row label={trakt.username ? `Signed in as ${trakt.username}` : 'Signed in to Trakt'} detail={detail}>
        {trakt.signInAgain ? (
          <button type="button" className="btn btn-primary btn-compact" onClick={() => void signIn()} disabled={busy === 'sign-in' || !clientID}>
            {busy === 'sign-in' ? 'Opening Trakt…' : 'Sign In Again'}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => void syncNow()} disabled={syncing}>
            <Icon name="refresh" size={16} /> Sync Now
          </button>
        )}
      </Row>
      {(trakt.error || problem) && (
        <div className={`${s.pad} ${s.padTop}`}>
          <Note tone="error">{problem ?? trakt.error}</Note>
        </div>
      )}
      <Row label="Sign Out" detail={sharing ? 'Also signs out your other devices that use Sync' : 'Forget the sign-in on this device'}>
        <ConfirmButton label="Sign Out" confirm="Sign Out" onConfirm={() => void signOut()} />
      </Row>
    </Group>
  )
}

export function AccountSection() {
  return (
    <>
      <AppGroup />
      <SignInGroup />
    </>
  )
}
