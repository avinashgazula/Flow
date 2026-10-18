import { useState, type FormEvent } from 'react'
import { Logo } from '../../components/Nav'
import { libraryStore } from '../../lib/store/library'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { imageURL } from '../../lib/tmdb/images'
import s from './Welcome.module.css'

// A wall of posters from the sample catalogue, straight from TMDB's CDN.
const wall = [
  '/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg', '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg', '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
  '/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg', '/qJ2tW6WMUDux911r6m7haRef0WH.jpg', '/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg', '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
  '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg', '/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg', '/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg', '/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg',
  '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', '/9PFonBhy4cQy7Jz20NpMygczOkv.jpg', '/3bhkrj58Vtu7enYsRolD1fZdja1.jpg', '/sWgBv7LV2PRoQgkxwlibdGXKz1S.jpg',
  '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg', '/fC2HDm5t0kHl7mTm7jxMR31b7by.jpg', '/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg', '/z2yahl2uefxDCl0nogcRBstwruJ.jpg',
  '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg', '/7HW47XbkNQ5fiwQFYGWdw9gs144.jpg', '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg', '/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
]

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
    const { seededLibrary } = await import('../../lib/tmdb/demo')
    if (libraryStore.get().watchlist.length === 0) libraryStore.set(seededLibrary())
    settingsStore.set({ demo: true, onboarded: true })
  }

  return (
    <div className={s.welcome}>
      <div className={s.wall} aria-hidden>
        {wall.map((path, i) => (
          <img key={path} src={imageURL(path, 185)} alt="" loading={i < 12 ? 'eager' : 'lazy'} decoding="async" onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')} />
        ))}
      </div>
      <div className={s.panel}>
        <Logo size={64} />
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
        <button className={`btn btn-glass ${s.sample}`} onClick={sample}>
          Explore with Sample Data
        </button>
      </div>
    </div>
  )
}
