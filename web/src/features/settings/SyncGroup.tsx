import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { Icon } from '../../components/Icon'
import { useSettings } from '../../lib/store/settings'
import { loadConfig } from '../../lib/sync/config'
import { groupKey } from '../../lib/sync/crypto'
import { joinSync, pairingLink, syncNow, syncStatus, turnOff, turnOffAndErase, turnOn } from '../../lib/sync/engine'
import { normaliseServer, parsePairing, serverFromProxy, type Pairing } from '../../lib/sync/pairing'
import { ConfirmButton, Group, Note, Row } from './controls'
import s from './SettingsScreen.module.css'

/* Flow Sync in Settings → Data. Off: turn it on (a new key) or join one (a key or link from another
   device). On: when it last synced, what went wrong, and the way to pair another device. The engine and
   the rules are in lib/sync; this is the form. */

const whatSyncs = 'Sync keeps your keys, Trakt and Simkl sign-ins, add-ons, servers, stream proxy, languages and subtitle style the same on every device. It’s end-to-end encrypted: your devices lock everything with a key only they hold, and it’s stored on your own Cloudflare Worker, which can’t read it.'
const workerAddress = 'https://flow-stream-proxy.example.workers.dev'

// MARK: A link from another device

/** A pairing link opened in this browser (`/settings#sync=…`). Read once and taken out of the address
 *  straight away, so the key doesn't stay in the address bar or the history. */
type Offer = { pairing: Pairing } | { error: string }
let opened: Offer | null | undefined

function takeOffer(): Offer | null {
  if (opened !== undefined) return opened
  if (typeof location === 'undefined' || !location.hash.startsWith('#sync=')) return (opened = null)
  const parsed = parsePairing(location.hash)
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  return (opened = parsed.ok ? { pairing: parsed.pairing } : { error: parsed.error })
}

// MARK: Small pieces

/** "just now", "5 minutes ago", or the date once it's old. */
export function ago(iso: string | undefined, now: number): string {
  const at = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(at)) return 'Not yet'
  const seconds = Math.max(0, (now - at) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

const hostOf = (server: string) => {
  try {
    return new URL(server).host
  } catch {
    return server
  }
}

/** The pairing link as a QR code, drawn as one SVG path. The generator is a separate chunk, fetched only
 *  when a code is shown. */
function QRCode({ text }: { text: string }) {
  const [shape, setShape] = useState<{ size: number; path: string }>()
  useEffect(() => {
    let live = true
    void import('qrcode-generator').then(({ default: qrcode }) => {
      if (!live) return
      const code = qrcode(0, 'L')
      code.addData(text)
      code.make()
      const size = code.getModuleCount()
      let path = ''
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; ) {
          if (!code.isDark(y, x)) {
            x++
            continue
          }
          const from = x
          while (x < size && code.isDark(y, x)) x++
          path += `M${from} ${y}h${x - from}v1h-${x - from}z`
        }
      }
      setShape({ size, path })
    })
    return () => {
      live = false
    }
  }, [text])
  const quiet = 3
  return (
    <div className={s.qr}>
      {shape ? (
        <svg viewBox={`${-quiet} ${-quiet} ${shape.size + quiet * 2} ${shape.size + quiet * 2}`} role="img" aria-label="QR code of the pairing link" shapeRendering="crispEdges">
          <path d={shape.path} />
        </svg>
      ) : null}
    </div>
  )
}

/** The link, a way to copy it, the code, and the key in groups of four for typing. */
function PairingPanel({ link, keyText }: { link: string; keyText: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <div className={s.pairing}>
      <p className={s.hint}>Open this link on your other devices, or scan the code with a phone’s camera. Anyone who has it can read and change your synced settings, so keep it to yourself.</p>
      <div className={s.linkRow}>
        <input className="field" readOnly value={link} aria-label="Pairing link" onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          onClick={() => {
            const done = () => setCopied(true)
            if (navigator.clipboard) void navigator.clipboard.writeText(link).then(done, () => undefined)
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className={s.pairingBody}>
        <QRCode text={link} />
        <div className={s.keyBlock}>
          <span className={s.fieldLabel}>Sync Key</span>
          <span className={s.codeValue}>{groupKey(keyText)}</span>
          <span className={s.hint}>To type it in the Apple apps, which also ask for your Worker’s address and token.</span>
        </div>
      </div>
    </div>
  )
}

/** Where the Worker is: its address and token. */
function ServerFields({ server, token, onChange, autoFocus }: { server: string; token: string; onChange: (next: { server: string; token: string }) => void; autoFocus?: boolean }) {
  return (
    <div className={s.form}>
      <label className={s.fieldLabel} htmlFor="sync-server">
        Worker Address
      </label>
      <input id="sync-server" className="field" value={server} onChange={(e) => onChange({ server: e.target.value, token })} placeholder={workerAddress} type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus={autoFocus} />
      <label className={s.fieldLabel} htmlFor="sync-token">
        Token
      </label>
      <input id="sync-token" className="field" value={token} onChange={(e) => onChange({ server, token: e.target.value })} placeholder="The Worker’s TOKEN" type="password" autoComplete="off" spellCheck={false} />
      <p className={s.hint}>
        Sync keeps its copy in the same Cloudflare Worker as your stream proxy. Setting that up takes a few minutes: see <code>web/proxy/README.md</code>.
      </p>
    </div>
  )
}

// MARK: The group

export function SyncGroup() {
  const status = useSyncExternalStore(syncStatus.subscribe, syncStatus.get)
  const proxy = useSettings((x) => x.streamProxy)
  const [offer, setOffer] = useState(takeOffer)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<'on' | 'join' | 'erase'>()
  const [typed, setTyped] = useState<{ server: string; token: string }>()
  const [joining, setJoining] = useState(false)
  const [paste, setPaste] = useState('')
  const [showLink, setShowLink] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string }>()

  const on = status.phase !== 'off'
  const config = on ? loadConfig() : null
  const fromProxy = serverFromProxy(proxy)
  const where = typed ?? fromProxy ?? { server: '', token: '' }

  useEffect(() => {
    if (offer) document.getElementById('data')?.scrollIntoView({ block: 'start' })
  }, [offer])
  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    setNow(Date.now())
    return () => clearInterval(timer)
  }, [on, status.lastSyncAt])

  /** The Worker to use: what was typed or came from the stream proxy, or the sentence that says what is missing. */
  function server(): { server: string; token: string } | string {
    const address = normaliseServer(where.server)
    return address ? { server: address, token: where.token.trim() } : `Enter your Worker’s address, like ${workerAddress}. Sync keeps its copy there.`
  }

  async function start() {
    const found = server()
    if (typeof found === 'string') return setNote({ tone: 'error', text: found })
    setNote(undefined)
    setBusy('on')
    const result = await turnOn(found.server, found.token)
    setBusy(undefined)
    if (result.ok) setShowLink(true)
    else setNote({ tone: 'error', text: result.error })
  }

  async function join(pairing: Pairing) {
    let target = pairing.server ? { server: pairing.server, token: pairing.token ?? '' } : server()
    if (typeof target === 'string') return setNote({ tone: 'error', text: `That link doesn’t say where your Worker is. ${target}` })
    // A link with a server but no token: the Worker may have none, or the token comes from the stream proxy.
    if (pairing.server && !pairing.token && fromProxy?.server === pairing.server) target = { server: pairing.server, token: fromProxy.token }
    setNote(undefined)
    setBusy('join')
    const result = await joinSync({ ...pairing, ...target })
    setBusy(undefined)
    if (result.ok) {
      opened = null
      setOffer(null)
      setJoining(false)
      setPaste('')
    } else setNote({ tone: 'error', text: result.error })
  }

  function submitPaste(event: FormEvent) {
    event.preventDefault()
    const parsed = parsePairing(paste)
    if (!parsed.ok) return setNote({ tone: 'error', text: parsed.error })
    void join(parsed.pairing)
  }

  const dismiss = () => {
    opened = null
    setOffer(null)
    setNote(undefined)
  }

  // A link was opened: show what joining does before doing it.
  if (offer) {
    if ('error' in offer) {
      return (
        <Group title="Sync">
          <div className={s.form}>
            <Note tone="error">{offer.error}</Note>
            <div className={s.actions}>
              <button type="button" className="btn btn-secondary btn-compact" onClick={dismiss}>
                OK
              </button>
            </div>
          </div>
        </Group>
      )
    }
    const { pairing } = offer
    const fixed = Boolean(pairing.server) || fromProxy !== null
    return (
      <Group title="Join This Sync?" footer="The pairing link has been removed from the address bar.">
        <div className={s.form}>
          <p className={s.hint}>
            {on ? 'This browser is already syncing. Joining switches it to this one. ' : ''}
            {pairing.server ? <>It syncs through your Worker at <strong>{hostOf(pairing.server)}</strong>. </> : null}
            Flow will bring in the keys, sign-ins, add-ons, servers, stream proxy and playback settings your other devices have saved, replacing the matching ones here, and send anything only this browser has.
          </p>
          {!fixed && <ServerFields server={where.server} token={where.token} onChange={setTyped} />}
          <div className={s.actions}>
            <button type="button" className="btn btn-primary btn-compact" onClick={() => void join(pairing)} disabled={busy === 'join'}>
              {busy === 'join' ? 'Joining…' : 'Join'}
            </button>
            <button type="button" className="btn btn-secondary btn-compact" onClick={dismiss} disabled={busy === 'join'}>
              Not Now
            </button>
          </div>
          {note && <Note tone={note.tone}>{note.text}</Note>}
        </div>
      </Group>
    )
  }

  if (on && config) {
    const syncing = status.phase === 'syncing'
    const detail = syncing ? 'Syncing…' : status.lastSyncAt ? `Last synced ${ago(status.lastSyncAt, now)}` : 'Waiting for the first sync'
    return (
      <>
        <Group title="Sync" footer={`${whatSyncs} Turning it off here keeps your settings on this device.`}>
          <Row label="Sync Is On" detail={detail}>
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => void syncNow()} disabled={syncing}>
              <Icon name="refresh" size={16} /> Sync Now
            </button>
          </Row>
          {status.error && (
            <div className={s.pad} style={{ paddingTop: 'var(--space-s)' }}>
              <Note tone="error">{status.error}</Note>
            </div>
          )}
          <Row label="Pairing Link" detail="Add another device to this sync">
            <button type="button" className="btn btn-secondary btn-compact" aria-expanded={showLink} onClick={() => setShowLink((v) => !v)}>
              {showLink ? 'Hide Pairing Link' : 'Show Pairing Link'}
            </button>
          </Row>
          {showLink && <PairingPanel link={pairingLink()} keyText={config.key} />}
          <Row label="Turn Off Sync" detail="Forget the key on this device">
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => (turnOff(), setShowLink(false), setNote({ tone: 'ok', text: 'Sync is off on this device. Your settings stay as they are.' }))}>
              Turn Off Sync
            </button>
          </Row>
          <Row label="Turn Off and Erase" detail="Also delete the synced copy for every device">
            <ConfirmButton
              label="Turn Off and Erase"
              confirm={busy === 'erase' ? 'Erasing…' : 'Erase'}
              onConfirm={() => {
                setBusy('erase')
                void turnOffAndErase().then((result) => {
                  setBusy(undefined)
                  setShowLink(false)
                  setNote(result.ok ? { tone: 'ok', text: 'Sync is off, and the synced copy is deleted. Your settings stay on this device.' } : { tone: 'error', text: result.error })
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
      <Group title="Sync" footer={whatSyncs}>
        {(!fromProxy || typed) && <ServerFields server={where.server} token={where.token} onChange={setTyped} />}
        <Row
          label="Turn On Sync"
          detail={
            fromProxy && !typed ? (
              // Change sits in the sentence, so on a phone the row keeps one button and its words room to breathe.
              <>
                Uses your stream proxy’s Worker, {hostOf(fromProxy.server)}.{' '}
                <button type="button" className={s.inlineLink} onClick={() => setTyped(fromProxy)}>
                  Change
                </button>
              </>
            ) : (
              'Makes a sync key for your devices'
            )
          }
        >
          <button type="button" className="btn btn-primary btn-compact" onClick={() => void start()} disabled={busy !== undefined}>
            {busy === 'on' ? 'Turning On…' : 'Turn On Sync'}
          </button>
        </Row>
        <Row label="Join a Sync" detail="Paste a pairing link or sync key">
          <button type="button" className="btn btn-secondary btn-compact" aria-expanded={joining} onClick={() => setJoining((v) => !v)}>
            Join a Sync
          </button>
        </Row>
        {joining && (
          <form className={s.inline} onSubmit={submitPaste}>
            <input className="field" value={paste} onChange={(e) => (setPaste(e.target.value), setNote(undefined))} placeholder="Paste a pairing link or sync key" aria-label="Pairing link or sync key" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus />
            <button className="btn btn-primary btn-compact" type="submit" disabled={!paste.trim() || busy === 'join'}>
              {busy === 'join' ? 'Joining…' : 'Join'}
            </button>
          </form>
        )}
      </Group>
      {note && <Note tone={note.tone}>{note.text}</Note>}
    </>
  )
}
