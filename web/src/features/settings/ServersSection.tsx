import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Icon } from '../../components/Icon'
import { hostOf, isMixedContent, SourceError } from '../../lib/sources/http'
import * as jellyfin from '../../lib/sources/jellyfin'
import * as plex from '../../lib/sources/plex'
import { settingsStore, useSettings, type ServerConfig, type Settings } from '../../lib/store/settings'
import { Segmented } from '../explore/Controls'
import { enabledServers, refreshServerIndex, serverIndexQuery } from '../home/marks'
import { ConfirmButton, Group, Note, Row, Switch } from './controls'
import { WebDAVGroups } from './WebDAVGroups'
import s from './SettingsScreen.module.css'

const kindNames: Record<ServerConfig['kind'], string> = { jellyfin: 'Jellyfin', emby: 'Emby', plex: 'Plex' }

function save(config: ServerConfig) {
  settingsStore.set((st) => {
    const at = st.servers.findIndex((x) => x.id === config.id)
    // Signing in again keeps the server where it was in the list.
    return { servers: at < 0 ? [...st.servers, config] : st.servers.map((x, i) => (i === at ? config : x)) }
  })
}

const message = (error: unknown) => (error instanceof SourceError ? error.message : (error as Error)?.name === 'AbortError' ? '' : 'Something went wrong. Try again.')

export function ServersSection() {
  const servers = useSettings((x) => x.servers)
  return (
    <>
      {servers.length > 0 && (
        <Group title="Servers" footer="Sign-ins stay in this browser and are sent only to the server they belong to.">
          {servers.map((server) => (
            <ServerRow key={server.id} server={server} />
          ))}
        </Group>
      )}
      <AddServer />
      <ServerOptions />
      <WebDAVGroups />
    </>
  )
}

/** The apps' Media Servers options, in their words: what a server changes about posters, Search, artwork and tracking. */
function ServerOptions() {
  const servers = useSettings((x) => x.servers)
  const badge = useSettings((x) => x.showBadgeOnPosters) !== false
  const only = useSettings((x) => x.onlyShowServerContent) === true
  const artwork = useSettings((x) => x.useServerArtwork) === true
  const trackOnly = useSettings((x) => x.trackOnlyWithTracker) === true
  const on = enabledServers(servers)
  const index = useQuery({ ...serverIndexQuery(on), enabled: on.length > 0 })
  const set = (patch: Partial<Settings>) => settingsStore.set(patch)
  if (servers.length === 0) return null
  return (
    <>
      <Group title="Display">
        <Row label="Show Badge on Posters" detail="Prints Server on the edge of any poster whose title is on one of your media servers.">
          <Switch checked={badge} onChange={(v) => set({ showBadgeOnPosters: v })} label="Show Badge on Posters" />
        </Row>
        <Row label="Only Show My Server’s Content" detail="Hides every movie and show that isn’t in your media server library, across Home and Search. Live TV channels are unaffected.">
          <Switch checked={only} onChange={(v) => set({ onlyShowServerContent: v })} label="Only Show My Server’s Content" />
        </Row>
        <Row label="Use Server Artwork" detail="Uses posters and backdrops from your media server for titles in its library. Everything else, and all text details, still comes from TMDB.">
          <Switch checked={artwork} onChange={(v) => set({ useServerArtwork: v })} label="Use Server Artwork" />
        </Row>
      </Group>
      <Group footer="Ignores the media server’s own watched state, resume position and Continue Watching, and stops reporting playback to it. Progress comes only from your tracking service. The server still provides artwork and streams.">
        <Row label="Track Only With Your Tracking Service">
          <Switch checked={trackOnly} onChange={(v) => set({ trackOnlyWithTracker: v })} label="Track Only With Your Tracking Service" />
        </Row>
      </Group>
      <Group footer="Flow lists what your servers hold to know which titles are on them. It refreshes about every half hour, and when you add or remove a server.">
        <Row label="Indexed Titles" detail={index.isPending && on.length > 0 ? 'Reading your servers…' : index.data ? undefined : 'None yet'}>
          <span className="num">{index.data ? index.data.count.toLocaleString() : ''}</span>
        </Row>
        {index.data && index.data.failed.length > 0 && (
          <div className={s.pad}>
            <Note tone="warning">{`Couldn’t read ${index.data.failed.join(' or ')}. Test its sign-in above, then refresh.`}</Note>
          </div>
        )}
        {index.isError && (
          <div className={s.pad}>
            <Note tone="error">{index.error instanceof SourceError ? index.error.message : 'Couldn’t read your servers. Test their sign-ins above, then refresh.'}</Note>
          </div>
        )}
        <div className={s.pad}>
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => void refreshServerIndex()} disabled={index.isFetching || on.length === 0}>
            <Icon name="refresh" size={16} /> {index.isFetching ? 'Refreshing…' : 'Refresh Library Index'}
          </button>
        </div>
      </Group>
    </>
  )
}

function ServerRow({ server }: { server: ServerConfig }) {
  const [test, setTest] = useState<{ kind: 'idle' | 'testing' } | { kind: 'ok' | 'error'; text: string }>({ kind: 'idle' })
  async function run() {
    setTest({ kind: 'testing' })
    try {
      const version = server.kind === 'plex' ? await plex.testServer(server) : await jellyfin.testServer(server)
      setTest({ kind: 'ok', text: `Connected${version ? ` · ${version}` : ''}` })
    } catch (error) {
      setTest({ kind: 'error', text: message(error) || 'Couldn’t connect.' })
    }
  }
  return (
    <div className={s.item}>
      <span className={s.logo} aria-hidden>
        <Icon name="server" size={18} />
      </span>
      <span className={s.itemText}>
        <span className={s.itemTitle}>{server.name}</span>
        <span className={s.itemDetail}>{[kindNames[server.kind], hostOf(server.url), server.username].filter(Boolean).join(' · ')}</span>
        {test.kind === 'ok' && <Note tone="ok">{test.text}</Note>}
        {test.kind === 'error' && <Note tone="error">{test.text}</Note>}
        {isMixedContent(server.url) && <Note tone="warning">This page is HTTPS and this server is http://, so the browser blocks it. Add its https:// address instead.</Note>}
      </span>
      <span className={s.itemActions}>
        <button type="button" className="btn btn-secondary btn-compact" onClick={run} disabled={test.kind === 'testing'}>
          {test.kind === 'testing' ? 'Testing…' : 'Test'}
        </button>
        <Switch checked={server.enabled} onChange={(on) => settingsStore.set((st) => ({ servers: st.servers.map((x) => (x.id === server.id ? { ...x, enabled: on } : x)) }))} label={`Use ${server.name}`} />
      </span>
      <span className={s.itemRemove}>
        <ConfirmButton label="Remove" confirm={`Remove ${server.name}`} onConfirm={() => settingsStore.set((st) => ({ servers: st.servers.filter((x) => x.id !== server.id) }))} />
      </span>
    </div>
  )
}

const serverKinds = (['jellyfin', 'emby', 'plex'] as const).map((k) => ({ id: k, label: kindNames[k] }))

function AddServer() {
  const [kind, setKind] = useState<ServerConfig['kind']>('jellyfin')
  return (
    <Group title="Add a Server" footer="Connect your Jellyfin, Emby or Plex server to stream from your own library.">
      <div className={s.pad}>
        <Segmented options={serverKinds} value={kind} onChange={setKind} label="Server type" />
      </div>
      {kind === 'plex' ? <PlexLink /> : <JellyfinSignIn key={kind} kind={kind} />}
    </Group>
  )
}

function JellyfinSignIn({ kind }: { kind: 'jellyfin' | 'emby' }) {
  const [address, setAddress] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<{ kind: 'idle' | 'working' } | { kind: 'error' | 'done'; text: string } | { kind: 'code'; code: string }>({ kind: 'idle' })
  const quick = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => quick.current?.abort(), [])

  let mixed = false
  try {
    mixed = address.trim().length > 4 && isMixedContent(jellyfin.normaliseServerURL(address))
  } catch {
    mixed = false
  }

  async function signIn(event: FormEvent) {
    event.preventDefault()
    setState({ kind: 'working' })
    try {
      const config = await jellyfin.signIn(kind, address, username.trim(), password)
      save(config)
      setPassword('')
      setState({ kind: 'done', text: `Signed in to ${config.name} as ${config.username}.` })
    } catch (error) {
      setState({ kind: 'error', text: message(error) })
    }
  }

  async function quickConnect() {
    quick.current?.abort()
    const controller = new AbortController()
    quick.current = controller
    setState({ kind: 'working' })
    try {
      const started = await jellyfin.startQuickConnect(address, controller.signal)
      setState({ kind: 'code', code: started.code })
      const config = await jellyfin.finishQuickConnect(started.base, started.secret, controller.signal)
      save(config)
      setState({ kind: 'done', text: `Signed in to ${config.name} as ${config.username}.` })
    } catch (error) {
      const text = message(error)
      setState(text ? { kind: 'error', text } : { kind: 'idle' })
    }
  }

  const id = `server-${kind}`
  return (
    <form className={s.form} onSubmit={signIn}>
      <label className={s.fieldLabel} htmlFor={`${id}-address`}>
        Server Address
      </label>
      <input id={`${id}-address`} className="field" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={kind === 'emby' ? 'https://emby.example.com' : 'https://jellyfin.example.com'} inputMode="url" autoComplete="url" spellCheck={false} />
      {mixed && (
        <Note tone="warning">This page is served over HTTPS, so your browser will block an http:// server. Use the server’s https:// address, or run Flow locally to reach it on your network.</Note>
      )}
      <label className={s.fieldLabel} htmlFor={`${id}-user`}>
        Username
      </label>
      <input id={`${id}-user`} className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} />
      <label className={s.fieldLabel} htmlFor={`${id}-password`}>
        Password
      </label>
      <input id={`${id}-password`} className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      <p className={s.hint}>{kind === 'emby' ? 'Include /emby in the address if your server uses it.' : 'Use the address you open Jellyfin with in a browser.'}</p>
      {state.kind === 'error' && <Note tone="error">{state.text}</Note>}
      {state.kind === 'done' && <Note tone="ok">{state.text}</Note>}
      {state.kind === 'code' && (
        <div className={s.code}>
          <span className={s.codeValue}>{state.code}</span>
          <span>Enter this code under Quick Connect on a device that’s signed in to Jellyfin. Flow signs in as soon as you approve it.</span>
        </div>
      )}
      <div className={s.actions}>
        <button className="btn btn-primary btn-compact" type="submit" disabled={!address.trim() || !username.trim() || state.kind === 'working' || state.kind === 'code'}>
          {state.kind === 'working' ? 'Signing In…' : 'Sign In'}
        </button>
        {kind === 'jellyfin' &&
          (state.kind === 'code' ? (
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => (quick.current?.abort(), setState({ kind: 'idle' }))}>
              Cancel Quick Connect
            </button>
          ) : (
            <button type="button" className="btn btn-secondary btn-compact" onClick={quickConnect} disabled={!address.trim() || state.kind === 'working'}>
              Use Quick Connect
            </button>
          ))}
      </div>
    </form>
  )
}

function PlexLink() {
  const [state, setState] = useState<{ kind: 'idle' | 'working' } | { kind: 'waiting'; url: string } | { kind: 'error'; text: string } | { kind: 'servers'; list: plex.DiscoveredServer[] }>({ kind: 'idle' })
  const [adding, setAdding] = useState<Record<string, string>>({})
  const controller = useRef<AbortController | undefined>(undefined)
  const saved = useSettings((x) => x.servers)
  useEffect(() => () => controller.current?.abort(), [])

  async function link() {
    controller.current?.abort()
    const c = new AbortController()
    controller.current = c
    // Opened straight from the click, so pop-up blockers allow it; it's pointed at Plex once the PIN exists.
    const popup = window.open('', 'flow-plex', 'popup,width=560,height=720')
    setState({ kind: 'working' })
    try {
      const pin = await plex.createPin(c.signal)
      if (popup) popup.location.href = pin.authURL
      setState({ kind: 'waiting', url: pin.authURL })
      const token = await plex.pollPin(pin, c.signal)
      popup?.close()
      const list = await plex.discoverServers(token, c.signal)
      setState(list.length ? { kind: 'servers', list } : { kind: 'error', text: 'Your Plex account has no servers. Set up Plex Media Server, then try again.' })
    } catch (error) {
      popup?.close()
      const text = message(error)
      setState(text ? { kind: 'error', text } : { kind: 'idle' })
    }
  }

  async function add(server: plex.DiscoveredServer) {
    setAdding((a) => ({ ...a, [server.machineId]: 'Connecting…' }))
    try {
      save(await plex.connectServer(server))
      setAdding((a) => ({ ...a, [server.machineId]: '' }))
    } catch (error) {
      setAdding((a) => ({ ...a, [server.machineId]: message(error) }))
    }
  }

  return (
    <div className={s.form}>
      {state.kind === 'servers' ? (
        <>
          <p className={s.hint}>Choose the servers to add.</p>
          {state.list.map((server) => {
            const added = saved.some((x) => x.machineId === server.machineId)
            const note = adding[server.machineId]
            return (
              <div key={server.machineId} className={s.choice}>
                <span>
                  <span className={s.itemTitle}>{server.name}</span>
                  {note && note !== 'Connecting…' && <Note tone="error">{note}</Note>}
                </span>
                <button type="button" className="btn btn-secondary btn-compact" onClick={() => add(server)} disabled={added || note === 'Connecting…'}>
                  {added ? (
                    <>
                      <Icon name="check" size={16} /> Added
                    </>
                  ) : note === 'Connecting…' ? (
                    note
                  ) : (
                    'Add'
                  )}
                </button>
              </div>
            )
          })}
        </>
      ) : (
        <>
          <p className={s.hint}>Flow opens plex.tv in a new window. Sign in there and allow Flow; it then finds the servers on your account.</p>
          {state.kind === 'waiting' && (
            <Note>
              Waiting for you to allow Flow on plex.tv…{' '}
              <a href={state.url} target="flow-plex" rel="noreferrer">
                Open plex.tv
              </a>
            </Note>
          )}
          {state.kind === 'error' && <Note tone="error">{state.text}</Note>}
          <div className={s.actions}>
            {state.kind === 'waiting' ? (
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => (controller.current?.abort(), setState({ kind: 'idle' }))}>
                Cancel
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-compact" onClick={link} disabled={state.kind === 'working'}>
                {state.kind === 'working' ? 'Opening Plex…' : 'Link Plex Account'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
