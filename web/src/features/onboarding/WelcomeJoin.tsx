import { useState, type FormEvent } from 'react'
import { hasCatalog, settingsStore, useSettings } from '../../lib/store/settings'
import { joinSync } from '../../lib/sync/engine'
import { normaliseServer, parsePairing, serverFromProxy } from '../../lib/sync/pairing'
import { ServerFields } from '../settings/SyncGroup'
import s from './Welcome.module.css'

/* "Join Flow Sync" on Welcome: the same join as Settings → Data → Sync, for a browser with nothing set up yet. A link
   or key from another device brings the TMDB key, sign-ins, add-ons and servers, which is the way in. It loads only when
   asked for, so Welcome's own code stays small. */

export function WelcomeJoin({ onBack, link = '' }: { onBack: () => void; link?: string }) {
  const proxy = useSettings((x) => x.streamProxy)
  const [paste, setPaste] = useState(link)
  const [typed, setTyped] = useState({ server: '', token: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const fromProxy = serverFromProxy(proxy)
  // A link that names its Worker needs no address; a bare key needs one.
  const parsed = paste.trim() ? parsePairing(paste) : undefined
  const needsServer = !(parsed?.ok && parsed.pairing.server) && !fromProxy

  async function submit(event: FormEvent) {
    event.preventDefault()
    const result = parsePairing(paste)
    if (!result.ok) return setError(result.error)
    const { pairing } = result
    let target = pairing.server ? { server: pairing.server, token: pairing.token ?? '' } : null
    if (!target) {
      const address = normaliseServer((fromProxy ?? typed).server)
      if (!address) return setError('Enter your Worker’s address. Sync keeps its copy there.')
      target = { server: address, token: (fromProxy ?? typed).token.trim() }
    } else if (!pairing.token && fromProxy && fromProxy.server === pairing.server) target = { server: pairing.server!, token: fromProxy.token }
    setError(undefined)
    setBusy(true)
    const joined = await joinSync({ ...pairing, ...target })
    setBusy(false)
    // Joining brings the TMDB key in, which turns Welcome off. Without one there is still nothing to show.
    if (!joined.ok) setError(joined.error)
    else if (!hasCatalog(settingsStore.get())) setError('Joined, but that sync holds no TMDB key yet. Go back, add a key, then continue.')
  }

  return (
    <form className={s.form} onSubmit={submit}>
      <label className={s.label} htmlFor="join-link">
        Pairing Link or Sync Key
      </label>
      <input id="join-link" className="field" value={paste} onChange={(e) => (setPaste(e.target.value), setError(undefined))} placeholder="Paste a pairing link or sync key" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus={!link} />
      {needsServer && paste.trim() !== '' && (
        <div className={s.server}>
          <ServerFields server={typed.server} token={typed.token} onChange={setTyped} />
        </div>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <p className={s.hint}>Open Settings → Data → Sync on a device that already syncs, and copy its pairing link.</p>
      <button className="btn btn-primary" type="submit" disabled={!paste.trim() || busy}>
        {busy ? 'Joining…' : 'Join Flow Sync'}
      </button>
      <button type="button" className="btn btn-quiet" onClick={onBack} disabled={busy}>
        Back
      </button>
    </form>
  )
}
