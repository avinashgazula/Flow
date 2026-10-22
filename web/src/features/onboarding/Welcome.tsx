import { useState, type FormEvent } from 'react'
import { Logo } from '../../components/Nav'
import { libraryStore } from '../../lib/store/library'
import { settingsStore, useSettings } from '../../lib/store/settings'
import s from './Welcome.module.css'

export function Welcome() {
  const saved = useSettings((x) => x.tmdbKey)
  const [key, setKey] = useState(saved)
  const [state, setState] = useState<'idle' | 'checking' | 'error'>('idle')
  const [message, setMessage] = useState('')

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
            placeholder="Paste your API key or read-access token"
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
        <button className={`btn btn-secondary ${s.sample}`} onClick={sample}>
          Explore with Sample Data
        </button>
      </div>
    </div>
  )
}
