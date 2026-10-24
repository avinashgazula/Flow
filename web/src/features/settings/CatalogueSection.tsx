import { useEffect, useRef, useState, type FormEvent } from 'react'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { Group, Note, Row, Select, Switch } from './controls'
import { languages, regions, withCurrent } from './options'
import { checkTMDBKey } from './tmdbKey'
import s from './SettingsScreen.module.css'

export function CatalogueSection() {
  const saved = useSettings((x) => x.tmdbKey)
  const demo = useSettings((x) => x.demo)
  const language = useSettings((x) => x.language)
  const region = useSettings((x) => x.region)
  const adult = useSettings((x) => x.includeAdult)
  const [key, setKey] = useState(saved)
  const [state, setState] = useState<{ kind: 'idle' | 'checking' } | { kind: 'ok' | 'error'; text: string }>({ kind: 'idle' })
  const check = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => check.current?.abort(), [])
  // A key that arrives from another device (Flow Sync) shows here at once.
  useEffect(() => {
    setKey(saved)
  }, [saved])

  async function submit(event: FormEvent) {
    event.preventDefault()
    check.current?.abort()
    const controller = new AbortController()
    check.current = controller
    setState({ kind: 'checking' })
    const result = await checkTMDBKey(key, controller.signal)
    if (controller.signal.aborted) return
    if (result.ok) {
      // A working key means real data; sample data stays available from its toggle.
      settingsStore.set({ tmdbKey: key.trim(), onboarded: true })
      setState({ kind: 'ok', text: 'TMDB accepted the key.' })
    } else {
      setState({ kind: 'error', text: result.error })
    }
  }

  return (
    <>
      <Group
        title="TMDB"
        footer={
          <>
            Flow uses TMDB for posters, cast and details. A key is free:{' '}
            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
              get one at themoviedb.org
            </a>
            . Either the API key or the read-access token works.
          </>
        }
      >
        <form className={s.inline} onSubmit={submit}>
          <input
            className="field"
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setState({ kind: 'idle' })
            }}
            placeholder="Paste your API key or read-access token"
            aria-label="TMDB API Key"
            type="password"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn btn-primary btn-compact" type="submit" disabled={!key.trim() || (key.trim() === saved && state.kind === 'idle') || state.kind === 'checking'}>
            {state.kind === 'checking' ? 'Checking…' : 'Save'}
          </button>
        </form>
        {(state.kind === 'ok' || state.kind === 'error') && (
          <div className={s.pad}>
            <Note tone={state.kind}>{state.text}</Note>
          </div>
        )}
        {state.kind === 'idle' && saved && (
          <div className={s.pad}>
            <Note tone="ok">A key is saved in this browser.</Note>
          </div>
        )}
      </Group>
      <Group footer="Language and region decide titles, overviews, release dates and where to watch.">
        <Row label="Language" htmlFor="language">
          <Select id="language" label="Language" value={language} onChange={(v) => settingsStore.set({ language: v })} options={withCurrent(languages, language)} />
        </Row>
        <Row label="Region" htmlFor="region">
          <Select id="region" label="Region" value={region} onChange={(v) => settingsStore.set({ region: v })} options={withCurrent(regions, region)} />
        </Row>
        <Row label="Include Adult Titles">
          <Switch label="Include adult titles" checked={adult} onChange={(on) => settingsStore.set({ includeAdult: on })} />
        </Row>
      </Group>
      <Group footer="Fills every screen with a built-in catalogue and sample streams, so you can look around without a key or accounts.">
        <Row label="Sample Data">
          <Switch
            label="Sample data"
            checked={demo}
            onChange={async (on) => {
              if (on) {
                const [{ seedDemo }, { libraryStore }] = await Promise.all([import('../../lib/tmdb/demo'), import('../../lib/store/library')])
                if (libraryStore.get().watchlist.length === 0) seedDemo()
              }
              settingsStore.set({ demo: on, ...(on ? { onboarded: true } : {}) })
            }}
          />
        </Row>
      </Group>
    </>
  )
}
