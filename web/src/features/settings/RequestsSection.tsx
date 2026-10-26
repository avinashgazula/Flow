import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { connect, demoHost, normaliseURL, SeerrError } from '../../lib/requests/seerr'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { Group, Note, Row } from './controls'
import s from './SettingsScreen.module.css'

/* Settings → Requests: the Seerr, Overseerr or Jellyseerr instance the title page's Request button asks, after the
   apps' Connect Seerr. The address and key are checked together before they are kept: the status call answers without
   a key, so a second call proves the key. They stay in this browser; Flow Sync doesn't carry them yet.

   The page talks to the instance directly. Seerr sends no CORS headers of its own, so an instance that isn't behind a
   reverse proxy adding them can't be reached from a web page; the words below say so. */

type State = { kind: 'idle' | 'checking' } | { kind: 'ok' | 'error'; text: string }

export function RequestsSection() {
  const saved = useSettings((x) => x.seerr)
  const demo = useSettings((x) => x.demo)
  const client = useQueryClient()
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const running = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => running.current?.abort(), [])

  async function test(config: { url: string; key: string }, keep: boolean) {
    const address = normaliseURL(config.url)
    if (!address.ok) return setState({ kind: 'error', text: address.error })
    if (!config.key.trim()) return setState({ kind: 'error', text: 'Paste the API key from Seerr under Settings, General.' })
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setState({ kind: 'checking' })
    try {
      const version = await connect({ url: address.url, key: config.key.trim() }, { signal: controller.signal })
      if (controller.signal.aborted) return
      if (keep) {
        settingsStore.set({ seerr: { url: address.url, key: config.key.trim() } })
        // Status answers cached under the old instance or key must not outlive it.
        void client.invalidateQueries({ queryKey: ['seerr'] })
        setUrl('')
        setKey('')
      }
      setState({ kind: 'ok', text: version && version !== 'demo' ? `Connected to Seerr ${version}.` : 'Connected.' })
    } catch (error) {
      if (controller.signal.aborted || (error as Error)?.name === 'AbortError') return
      setState({ kind: 'error', text: error instanceof SeerrError ? error.message : 'Couldn’t check the connection. Try again.' })
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void test({ url, key }, true)
  }

  const footer = (
    <>
      Connect a Seerr, Overseerr or Jellyseerr instance to request films and series that aren’t in your library yet. A Request button appears on titles that none of your media servers has. Find the API key in Seerr under Settings, General. Your instance has to allow web pages to talk to it (CORS), which usually means a reverse proxy that adds the headers for this site.
      {demo && !saved && (
        <>
          {' '}
          With sample data on, connect to <span className={s.host}>{demoHost}</span> with any key to try it.
        </>
      )}
    </>
  )

  if (saved) {
    return (
      <Group title="Seerr" footer={footer}>
        <Row label={new URL(saved.url).host} detail={saved.url.startsWith('http://') ? 'Not encrypted' : 'Connected'}>
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => void test(saved, false)} disabled={state.kind === 'checking'}>
            {state.kind === 'checking' ? 'Testing…' : 'Test'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => {
              settingsStore.set({ seerr: undefined })
              void client.removeQueries({ queryKey: ['seerr'] })
              setState({ kind: 'idle' })
            }}
          >
            Disconnect
          </button>
        </Row>
        {(state.kind === 'ok' || state.kind === 'error') && (
          <div className={`${s.pad} ${s.padTop}`}>
            <Note tone={state.kind}>{state.text}</Note>
          </div>
        )}
      </Group>
    )
  }

  return (
    <Group title="Seerr" footer={footer}>
      <form className={s.form} onSubmit={submit}>
        <label className={s.fieldLabel} htmlFor="seerr-url">
          Server URL
        </label>
        <input id="seerr-url" className="field" value={url} onChange={(e) => (setUrl(e.target.value), setState({ kind: 'idle' }))} placeholder="https://seerr.example.com" type="url" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} />
        <label className={s.fieldLabel} htmlFor="seerr-key">
          API Key
        </label>
        <input id="seerr-key" className="field" value={key} onChange={(e) => (setKey(e.target.value), setState({ kind: 'idle' }))} placeholder="Paste the API key from Seerr" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} />
        <div className={s.actions}>
          <button type="submit" className="btn btn-secondary btn-compact" disabled={!url.trim() || !key.trim() || state.kind === 'checking'}>
            {state.kind === 'checking' ? 'Testing…' : 'Test and Save'}
          </button>
        </div>
        {(state.kind === 'ok' || state.kind === 'error') && <Note tone={state.kind}>{state.text}</Note>}
      </form>
    </Group>
  )
}
