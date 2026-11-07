import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { Icon } from '../../components/Icon'
import { settingsStore, useSettings, type ListDestination } from '../../lib/store/settings'
import { syncStatus } from '../../lib/sync/engine'
import { destinationChoices, hasRole, listDestination, rolesOf, type ListKind } from '../../lib/tracking/destinations'
import { trackerBlurb, trackerName, trackerOrder, unavailable } from '../../lib/tracking/labels'
import { syncIntervalLabel, syncIntervalOf, syncIntervals } from '../../lib/tracking/schedule'
import { activeTracker, type TrackerKind } from '../../lib/tracking/service'
import { checkSimklClientID, finishPin, signOutOfSimkl, startPin, type Pin } from '../../lib/tracking/session'
import { useService, type ServiceState } from '../../lib/tracking/store'
import { ConfirmButton, Group, Note, Row, Select, Switch } from './controls'
import s from './SettingsScreen.module.css'
import { ago } from './SyncGroup'
import t from './TrackerGroups.module.css'

/* Settings → Account, below the Trakt groups: which service tracks (the apps' Tracking With list), and a group each
   for Simkl and MDBList with their sign-in or key, when they last synced and, in words, what went wrong. The code
   that talks to them is in lib/tracking and loads only when one of them tracks. */

/** The sentence under a signed-in service's name: how the last sync went, and what is waiting to reach it. */
export function syncDetail(state: Pick<ServiceState, 'lastSyncAt' | 'error' | 'ops'>, syncing: boolean, now: number): string {
  if (syncing) return 'Syncing…'
  const waiting = state.ops.length ? `${state.ops.length} ${state.ops.length === 1 ? 'change' : 'changes'} waiting to be sent` : ''
  const head = state.error ? 'Sync issues' : state.lastSyncAt ? `Last synced ${ago(state.lastSyncAt, now)}` : 'Waiting for the first sync'
  return waiting ? `${head}. ${waiting}` : head
}

/** The time, re-read every half minute while something on screen says "3 minutes ago". */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    setNow(Date.now())
    return () => clearInterval(timer)
  }, [running])
  return now
}

/** Choosing a service also points the watchlist at it, as the apps do, so a list follows tracking until it is set apart
 *  below. This Device takes the watchlist back too: nothing should leave the browser after choosing it. */
const choose = (kind: TrackerKind) => settingsStore.set({ tracker: kind, ...(kind === 'publicMetaDB' ? {} : { watchlistDestination: kind }) })

// MARK: Tracking With

/** One service tracks at a time. A service that can't be chosen yet says what to do first. */
export function TrackingWithGroup() {
  const sync = useSyncExternalStore(syncStatus.subscribe, syncStatus.get)
  const settings = useSettings((x) => x)
  const active = activeTracker(settings)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const open = trackerOrder.filter((k) => unavailable(k, settings) === undefined)

  // Arrow keys move the choice, as in any radio group.
  function onKey(event: KeyboardEvent, kind: TrackerKind) {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = open[(open.indexOf(kind) + step + open.length) % open.length]!
    choose(next)
    buttons.current[trackerOrder.indexOf(next)]?.focus()
  }

  return (
    <Group
      title="Tracking With"
      footer={`One service tracks at a time; the others keep their sign-ins so you can switch back. What you watch stays in this browser whichever you choose. ${
        sync.phase !== 'off' ? 'Sync carries a sign-in to your other devices.' : 'With Sync on (Settings → Data), a sign-in on one device arrives on the others.'
      }`}
    >
      <div role="radiogroup" aria-label="Tracking With" className={t.options}>
        {trackerOrder.map((kind, i) => {
          const why = unavailable(kind, settings)
          const checked = active === kind
          return (
            <button
              key={kind}
              ref={(el) => void (buttons.current[i] = el)}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-disabled={why !== undefined || undefined}
              tabIndex={checked ? 0 : -1}
              className={t.option}
              onClick={() => why === undefined && choose(kind)}
              onKeyDown={(e) => onKey(e, kind)}
            >
              <span className={t.text}>
                <span className={t.name}>{trackerName[kind]}</span>
                <span className={t.detail}>{why ?? trackerBlurb[kind]}</span>
              </span>
              <span className={t.mark} aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
            </button>
          )
        })}
      </div>
    </Group>
  )
}

// MARK: Saved To, Sync

const listLabel: Record<ListKind, string> = { watchlist: 'Watchlist Saved To', favourites: 'Favourites Saved To' }

function SavedTo({ list }: { list: ListKind }) {
  const settings = useSettings((x) => x)
  const value = listDestination(settings, list)
  const id = `${list}-destination`
  return (
    <Row label={listLabel[list]} htmlFor={id}>
      <Select
        id={id}
        label={listLabel[list]}
        value={value}
        onChange={(v) => settingsStore.set(list === 'watchlist' ? { watchlistDestination: v } : { favouritesDestination: v })}
        options={destinationChoices(list, settings).map((d: ListDestination) => ({ value: d, label: trackerName[d] }))}
      />
    </Row>
  )
}

/** Which service each list goes to. Tracking With decides where history and progress go; the two lists can go
 *  elsewhere, as the apps' Watchlist Provider and Favourites Provider do. */
export function ListsGroup() {
  return (
    <Group
      title="Lists"
      footer="Where Add to Watchlist and the heart button save. A service keeps the list in step both ways; This Device keeps it in this browser only. A service appears here once you are signed in or have added its key, and only Trakt keeps favourites."
    >
      <SavedTo list="watchlist" />
      <SavedTo list="favourites" />
    </Group>
  )
}

/** How often history syncs by itself, and whether the player says what is playing. */
export function SyncPreferencesGroup() {
  const interval = useSettings(syncIntervalOf)
  const scrobble = useSettings((x) => x.scrobble !== false)
  return (
    <Group
      title="Sync"
      footer="How often Flow syncs your history by itself when you open it or come back to it. Sync Now always syncs, and changes you make are sent within moments. Scrobbling tells your tracker what is playing as you watch, so Resume follows you to your other devices. With it off, a title is still marked watched when you finish it, but its resume point isn’t sent."
    >
      <Row label="Sync Interval" htmlFor="sync-interval">
        <Select
          id="sync-interval"
          label="Sync interval"
          value={String(interval)}
          onChange={(v) => settingsStore.set({ syncInterval: Number(v) })}
          options={syncIntervals.map((n) => ({ value: String(n), label: syncIntervalLabel[n] }))}
        />
      </Row>
      <Row label="Scrobble While Watching">
        <Switch label="Scrobble while watching" checked={scrobble} onChange={(on) => settingsStore.set({ scrobble: on })} />
      </Row>
    </Group>
  )
}

// MARK: Simkl

/** The Client ID of the owner's Simkl app. Saved once Simkl has handed out a code for it, so a typo is caught here. */
export function SimklAppGroup() {
  const saved = useSettings((x) => x.simklClientID)
  const [id, setId] = useState(saved)
  const [state, setState] = useState<{ kind: 'idle' | 'checking' } | { kind: 'ok' | 'error'; text: string }>({ kind: 'idle' })
  // A Client ID that arrives from another device (Flow Sync) shows here at once.
  useEffect(() => {
    setId(saved)
  }, [saved])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const next = id.trim()
    if (!next) {
      settingsStore.set({ simklClientID: '' })
      return setState({ kind: 'idle' })
    }
    setState({ kind: 'checking' })
    const problem = await checkSimklClientID(next)
    if (problem) return setState({ kind: 'error', text: problem })
    settingsStore.set({ simklClientID: next })
    setState({ kind: 'ok', text: 'Simkl accepted the Client ID.' })
  }

  return (
    <Group
      title="Simkl App"
      footer={
        <>
          Create an app at{' '}
          <a href="https://simkl.com/settings/developer/" target="_blank" rel="noreferrer">
            simkl.com/settings/developer
          </a>{' '}
          and paste its Client ID. Flow signs in with a code, so it needs no secret, and any Redirect URI you give Simkl will do. The apps use the same Client ID through Sync.
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
          placeholder="Paste your Simkl Client ID"
          aria-label="Simkl Client ID"
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
    </Group>
  )
}

type SignIn = { step: 'idle' } | { step: 'asking' } | { step: 'code'; pin: Pin; copied: boolean }

/** Sign In to Simkl with a code, or who is signed in, when it last synced and what went wrong. */
export function SimklGroup() {
  const clientID = useSettings((x) => x.simklClientID.trim())
  const account = useSettings((x) => x.simklAccount)
  // Holding the watchlist is a job too, with a sync to show.
  const working = useSettings((x) => hasRole(rolesOf('simkl', x)))
  const state = useService('simkl', (x) => x)
  const [flow, setFlow] = useState<SignIn>({ step: 'idle' })
  const [problem, setProblem] = useState<string>()
  const [syncing, setSyncing] = useState(false)
  const now = useNow(!!account)
  const waiting = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => waiting.current?.abort(), [])
  useEffect(() => {
    if (flow.step !== 'code' || !flow.copied) return
    const timer = setTimeout(() => setFlow((f) => (f.step === 'code' ? { ...f, copied: false } : f)), 2000)
    return () => clearTimeout(timer)
  }, [flow])

  async function signIn() {
    setProblem(undefined)
    setFlow({ step: 'asking' })
    const controller = new AbortController()
    waiting.current?.abort()
    waiting.current = controller
    try {
      const pin = await startPin()
      if (controller.signal.aborted) return
      setFlow({ step: 'code', pin, copied: false })
      const result = await finishPin(pin, controller.signal)
      if (controller.signal.aborted) return
      if (!result.ok && !result.cancelled) setProblem(result.error)
    } catch (error) {
      if (!controller.signal.aborted) setProblem(error instanceof Error ? error.message : 'Couldn’t reach Simkl. Check your connection.')
    }
    if (!controller.signal.aborted) setFlow({ step: 'idle' })
  }

  function cancel() {
    waiting.current?.abort()
    setFlow({ step: 'idle' })
  }

  async function syncNow() {
    setSyncing(true)
    try {
      const { syncTracker } = await import('../../lib/tracking/engine')
      await syncTracker()
    } finally {
      setSyncing(false)
    }
  }

  const issue = problem ?? state.error

  if (flow.step === 'code') {
    const { pin } = flow
    return (
      <Group title="Simkl">
        <div className={s.pad}>
          <div className={t.pin}>
            <span className={s.fieldLabel}>Your Code</span>
            <span className={t.pinCode}>{pin.code}</span>
            <span className={t.pinHint}>
              Type it at{' '}
              <a href={pin.url} target="_blank" rel="noreferrer">
                {pin.url.replace(/^https:\/\//, '')}
              </a>
              , signed in to Simkl. Flow is waiting for you to approve it.
            </span>
          </div>
        </div>
        <div className={s.pad}>
          <div className={s.actions}>
            <a className="btn btn-primary btn-compact" href={pin.url} target="_blank" rel="noreferrer">
              Open Simkl
            </a>
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              onClick={() => {
                if (navigator.clipboard) void navigator.clipboard.writeText(pin.code).then(() => setFlow({ ...flow, copied: true }), () => undefined)
              }}
            >
              <Icon name={flow.copied ? 'check' : 'copy'} size={16} /> {flow.copied ? 'Copied' : 'Copy Code'}
            </button>
            <button type="button" className="btn btn-secondary btn-compact" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      </Group>
    )
  }

  if (!account) {
    const asking = flow.step === 'asking'
    return (
      <Group title="Simkl">
        <Row label="Not Signed In" detail={clientID ? 'Gives you a code to approve at simkl.com/pin' : 'Add a Simkl Client ID above first'}>
          <button type="button" className="btn btn-primary btn-compact" onClick={() => void signIn()} disabled={!clientID || asking}>
            {asking ? 'Asking Simkl…' : 'Sign In to Simkl'}
          </button>
        </Row>
        {issue && (
          <div className={s.pad}>
            <Note tone="error">{issue}</Note>
          </div>
        )}
      </Group>
    )
  }

  return (
    <Group title="Simkl">
      <Row label={state.username ? `Signed in as ${state.username}` : 'Signed in to Simkl'} detail={working ? syncDetail(state, syncing, now) : 'Choose Simkl under Tracking With to track with it'}>
        {state.signInAgain ? (
          <button type="button" className="btn btn-primary btn-compact" onClick={() => void signIn()} disabled={!clientID || flow.step === 'asking'}>
            Sign In Again
          </button>
        ) : working ? (
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => void syncNow()} disabled={syncing}>
            <Icon name="refresh" size={16} /> Sync Now
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-compact" onClick={() => choose('simkl')}>
            Track With Simkl
          </button>
        )}
      </Row>
      {working && issue && (
        <div className={s.pad}>
          <Note tone="error">{issue}</Note>
        </div>
      )}
      <Row label="Sign Out" detail="Forget the sign-in here, and on your other devices that use Sync">
        <ConfirmButton label="Sign Out" confirm="Sign Out" onConfirm={() => void signOutOfSimkl()} />
      </Row>
    </Group>
  )
}

// MARK: MDBList

/** MDBList tracks with the API key from Settings → Metadata: no sign-in, so this group is its status. */
export function MDBListGroup() {
  const key = useSettings((x) => !!x.mdblistKey?.trim())
  const tracking = useSettings((x) => activeTracker(x) === 'mdblist')
  const working = useSettings((x) => hasRole(rolesOf('mdblist', x)))
  const state = useService('mdblist', (x) => x)
  const [syncing, setSyncing] = useState(false)
  const now = useNow(working)

  async function syncNow() {
    setSyncing(true)
    try {
      const { syncTracker } = await import('../../lib/tracking/engine')
      await syncTracker()
    } finally {
      setSyncing(false)
    }
  }

  const footer = 'MDBList lets web pages read your watchlist, history and resume points. Sending updates from a web page may not work; if MDBList refuses one, this says so and the change stays in this browser.'
  return (
    <Group title="MDBList" footer={footer}>
      {!key ? (
        <Row label="No API Key" detail="Add one in Settings → Metadata to track with MDBList">
          <a
            className="btn btn-secondary btn-compact"
            href="#metadata"
            onClick={(e) => {
              e.preventDefault()
              document.getElementById('metadata')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
            }}
          >
            Add API Key
          </a>
        </Row>
      ) : working ? (
        <Row label={tracking ? (state.username ? `Tracking as ${state.username}` : 'Tracking With MDBList') : state.username ? `Watchlist as ${state.username}` : 'Holding Your Watchlist'} detail={syncDetail(state, syncing, now)}>
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => void syncNow()} disabled={syncing}>
            <Icon name="refresh" size={16} /> Sync Now
          </button>
        </Row>
      ) : (
        <Row label="API Key Added" detail="Choose MDBList under Tracking With to track with it">
          <button type="button" className="btn btn-primary btn-compact" onClick={() => choose('mdblist')}>
            Track With MDBList
          </button>
        </Row>
      )}
      {working && state.error && (
        <div className={s.pad}>
          <Note tone="error">{state.error}</Note>
        </div>
      )}
    </Group>
  )
}
