import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { Logo } from '../../components/Nav'
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
      <div className={s.panel}>
        <Logo size={48} />
        <h1 className={s.title}>Welcome to Flow</h1>
        <p className={s.lede}>Your Jellyfin, Emby and Plex servers, stream add-ons and live TV, in one beautiful place. Flow hosts no content: it plays what you already have.</p>
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
              <button className="btn btn-primary" type="submit" disabled={!key.trim() || state === 'checking'}>
                {state === 'checking' ? 'Checking…' : 'Continue'}
              </button>
            </form>
            <div className={s.alternatives}>
              <button className={`btn btn-secondary ${s.sample}`} onClick={sample}>
                Explore with Sample Data
              </button>
              <button className={`btn btn-quiet ${s.sample}`} onClick={() => setOther('setup')}>
                I Have a Setup From Another Device
              </button>
              <button className={`btn btn-quiet ${s.sample}`} onClick={() => setOther('join')}>
                Join Flow Sync
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
