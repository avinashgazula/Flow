import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { peekLink, takeLink } from '../../lib/hashLink'
import { libraryStore } from '../../lib/store/library'
import { settingsStore, useSettings } from '../../lib/store/settings'
import s from './Welcome.module.css'

/* Reading a setup file and joining a sync pull in the codec and the sync engine, so they load when asked for. */
const SetupImport = lazy(() => import('../settings/SetupImport').then((m) => ({ default: m.SetupImport })))
const WelcomeJoin = lazy(() => import('./WelcomeJoin').then((m) => ({ default: m.WelcomeJoin })))

export function Welcome() {
  const saved = useSettings((x) => x.tmdbKey)
  const [key, setKey] = useState(saved)
  const [state, setState] = useState<'idle' | 'checking' | 'error'>('idle')
  const [message, setMessage] = useState('')
  // A setup or sync link opened by address goes straight to its review, or to the join with the link filled in.
  const [arrived] = useState(() => {
    const link = peekLink()
    return link ? { other: link.kind === 'setup' ? ('setup' as const) : ('join' as const), link: link.link } : undefined
  })
  // Taken once it is on screen: in development the first render runs twice, and the second must still find it.
  useEffect(() => {
    takeLink('setup')
    takeLink('sync')
  }, [])
  const [other, setOther] = useState<'setup' | 'join' | undefined>(arrived?.other)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = key.trim()
    if (!value) return
    setState('checking')
    try {
      const bearer = value.length > 40
      const response = await fetch(`https://api.themoviedb.org/3/configuration${bearer ? '' : `?api_key=${encodeURIComponent(value)}`}`, {
        headers: bearer ? { Authorization: `Bearer ${value}` } : {},
      })
      if (!response.ok) throw new Error(response.status === 401 ? "TMDB didn’t accept that key. Check it and try again." : `TMDB answered ${response.status}. Try again in a moment.`)
      settingsStore.set({ tmdbKey: value, demo: false, onboarded: true })
    } catch (error) {
      setState('error')
      setMessage(error instanceof TypeError ? "Couldn’t reach TMDB. Check your connection and try again." : (error as Error).message)
    }
  }

  async function sample() {
    const { seedDemo } = await import('../../lib/tmdb/demo')
    if (libraryStore.get().watchlist.length === 0) seedDemo()
    settingsStore.set({ demo: true, onboarded: true })
  }

  return (
    <div className={s.welcome}>
      <div className={s.bar}>
        <span className={s.logo}>Flow</span>
      </div>
      <header className={s.hero}>
        <h1 className={s.title}>Flow</h1>
        <p className={s.sub}>
          Your Jellyfin, Emby and Plex servers, stream add-ons and live TV, in one place. Flow hosts no content: it <span className={s.mark}>plays what you already have.</span>
        </p>
      </header>
      <div className={s.rule} />
      <div className={s.setup}>
        {other ? (
          <Suspense fallback={<p className={s.hint}>Loading…</p>}>
            {other === 'setup' ? (
              <div className={s.other}>
                <SetupImport backups link={arrived?.other === 'setup' ? arrived.link : undefined} onImported={() => setOther(undefined)} onCancel={() => setOther(undefined)} />
              </div>
            ) : (
              <WelcomeJoin onBack={() => setOther(undefined)} link={arrived?.other === 'join' ? arrived.link : undefined} />
            )}
          </Suspense>
        ) : (
          <>
            <form className={s.form} onSubmit={submit}>
              <label className={s.label} htmlFor="tmdb-key">
                TMDB API Key
              </label>
              <input
                id="tmdb-key"
                className="field"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value)
                  setState('idle')
                }}
                placeholder="API key or read-access token"
                autoComplete="off"
                spellCheck={false}
              />
              {state === 'error' && <p className={s.error}>{message}</p>}
              <p className={s.hint}>
                Flow uses TMDB for posters, cast and details. A key is free:{' '}
                <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
                  get one at themoviedb.org
                </a>
                . It stays in this browser.
              </p>
              <div className={s.buttons}>
                <button className="btn btn-primary btn-large" type="submit" disabled={!key.trim() || state === 'checking'}>
                  {state === 'checking' ? 'Checking…' : 'Continue'}
                </button>
                <button className="btn btn-secondary btn-large" type="button" onClick={sample}>
                  Explore with Sample Data
                </button>
              </div>
            </form>
            <ul className={`rows ${s.alternatives}`}>
              <li>
                <button className={`row ${s.alt}`} onClick={() => setOther('setup')}>
                  I Have a Setup From Another Device <span aria-hidden="true">→</span>
                </button>
              </li>
              <li>
                <button className={`row ${s.alt}`} onClick={() => setOther('join')}>
                  Join Flow Sync <span aria-hidden="true">→</span>
                </button>
              </li>
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
