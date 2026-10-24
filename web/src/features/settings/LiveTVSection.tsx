import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Icon } from '../../components/Icon'
import { clearFavourites, updateLiveTV, useFavouriteIDs, useProviders } from '../../lib/livetv/favourites'
import { demoProvider } from '../../lib/livetv/demo'
import type { IPTVProviderConfig, IPTVProviderKind } from '../../lib/livetv/types'
import { isWebAddress } from '../../lib/livetv/validate'
import { hostOf, isMixedContent, uuid } from '../../lib/sources/http'
import { streamProxy } from '../../lib/sources/proxy'
import { useSettings } from '../../lib/store/settings'
import { Segmented } from '../explore/Controls'
import { ConfirmButton, Group, Note, Row, Select, Switch } from './controls'
import s from './SettingsScreen.module.css'

const kindNames: Record<IPTVProviderKind, string> = { m3u: 'M3U Playlist', xtream: 'Xtream Codes' }
const kinds = (Object.keys(kindNames) as IPTVProviderKind[]).map((k) => ({ id: k, label: kindNames[k] }))
const refreshChoices = [3, 6, 12, 24, 48].map((h) => ({ value: String(h), label: `${h} hours` }))

const words = (error: unknown) => (error instanceof Error && error.name !== 'AbortError' ? error.message : 'Something went wrong. Try again.')

/** Settings → Live TV: the IPTV providers (an M3U playlist, or an Xtream Codes login), the guide's refresh time and the
 *  favourite channels. */
export function LiveTVSection() {
  const providers = useProviders()
  const sample = useSettings((x) => x.demo)
  const hours = useSettings((x) => x.liveTV?.epgRefreshHours ?? 12)
  const favourites = useFavouriteIDs()
  const [editing, setEditing] = useState<IPTVProviderConfig | undefined>()
  const [refresh, setRefresh] = useState<{ kind: 'idle' | 'working' } | { kind: 'ok' | 'error'; text: string }>({ kind: 'idle' })

  async function refreshNow() {
    setRefresh({ kind: 'working' })
    try {
      const { refreshLiveTV, liveState } = await import('../../lib/livetv/load')
      const { activeProviders } = await import('../../lib/livetv/favourites')
      const { settingsStore } = await import('../../lib/store/settings')
      await refreshLiveTV(activeProviders(settingsStore.get()), hours)
      const now = liveState()
      if (now.error) setRefresh({ kind: 'error', text: now.error })
      else if (now.guideError) setRefresh({ kind: 'error', text: `The channels loaded, but the guide didn’t. ${now.guideError}` })
      else setRefresh({ kind: 'ok', text: `${now.channels.length.toLocaleString()} channels, guide refreshed.` })
    } catch (error) {
      setRefresh({ kind: 'error', text: words(error) })
    }
  }

  const proxy = streamProxy()
  return (
    <>
      <Group
        title="IPTV Providers"
        footer={
          <>
            Logins stay in this browser. Most providers don’t let web pages read their playlists, so Flow fetches them through your stream proxy{' '}
            {proxy ? '(set in Playback)' : '(not set: add one in Playback)'}; the proxy then sees the provider’s address and login. Raw MPEG-TS channels can’t play in a browser, and a browser can’t send the User-Agent the apps do.
          </>
        }
      >
        {sample && <ProviderRow provider={demoProvider} sample />}
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} onEdit={() => setEditing(p)} />
        ))}
        {!sample && providers.length === 0 && <Row label="No Providers Yet" detail="Add an M3U playlist or an Xtream Codes login below to watch live channels." />}
      </Group>
      {sample && <Note>Sample data is on, so Live TV shows the Flow Live sample channels. Turn it off in Catalogue to use your own providers.</Note>}
      <ProviderForm key={editing?.id ?? 'new'} provider={editing} onDone={() => setEditing(undefined)} />
      <Group title="Guide" footer="The guide and channel list are kept in this browser and downloaded again after this long, or when you refresh.">
        <Row label="Refresh Guide Every" htmlFor="livetv-refresh">
          <Select id="livetv-refresh" label="Refresh Guide Every" value={String(hours)} options={refreshChoices} onChange={(v) => updateLiveTV({ epgRefreshHours: Number(v) })} />
        </Row>
        <Row label="Refresh Now" detail={refresh.kind === 'ok' || refresh.kind === 'error' ? refresh.text : 'Download the channels and the guide again.'}>
          <button type="button" className="btn btn-secondary btn-compact" onClick={refreshNow} disabled={refresh.kind === 'working' || (!sample && providers.every((p) => !p.enabled))}>
            <Icon name="refresh" size={16} /> {refresh.kind === 'working' ? 'Refreshing…' : 'Refresh'}
          </button>
        </Row>
        <Row label="Favourite Channels" detail={favourites.length ? `${favourites.length} saved` : 'None yet. Star a channel in Live TV.'}>
          {favourites.length > 0 && <ConfirmButton label="Clear" confirm="Clear Favourites" onConfirm={clearFavourites} />}
        </Row>
      </Group>
    </>
  )
}

function ProviderRow({ provider, sample, onEdit }: { provider: IPTVProviderConfig; sample?: boolean; onEdit?: () => void }) {
  const [test, setTest] = useState<{ kind: 'idle' | 'testing' } | { kind: 'ok' | 'error'; text: string }>({ kind: 'idle' })
  const proxy = streamProxy()
  const mixed = isMixedContent(provider.url)

  async function run() {
    setTest({ kind: 'testing' })
    try {
      const { testProvider } = await import('../../lib/livetv/load')
      setTest({ kind: 'ok', text: await testProvider(provider) })
    } catch (error) {
      setTest({ kind: 'error', text: words(error) })
    }
  }

  return (
    <div className={s.item}>
      <span className={s.logo} aria-hidden>
        <Icon name="live" size={18} />
      </span>
      <span className={s.itemText}>
        <span className={s.itemTitle}>{provider.name}</span>
        <span className={s.itemDetail}>{sample ? 'Sample data · M3U Playlist' : [kindNames[provider.kind], hostOf(provider.url), provider.username].filter(Boolean).join(' · ')}</span>
        {test.kind === 'ok' && <Note tone="ok">{test.text}</Note>}
        {test.kind === 'error' && <Note tone="error">{test.text}</Note>}
        {!sample && mixed && !proxy && (
          <Note tone="warning">This page is HTTPS and this provider is http://, so the browser blocks it. Add a stream proxy in Playback that can reach it, or use the provider’s https:// address.</Note>
        )}
      </span>
      <span className={s.itemActions}>
        <button type="button" className="btn btn-secondary btn-compact" onClick={run} disabled={test.kind === 'testing'}>
          {test.kind === 'testing' ? 'Testing…' : 'Test'}
        </button>
        {!sample && (
          <button type="button" className="btn btn-secondary btn-compact" onClick={onEdit}>
            Edit
          </button>
        )}
        {!sample && (
          <Switch
            checked={provider.enabled}
            onChange={(on) => updateLiveTV((c) => ({ providers: c.providers.map((x) => (x.id === provider.id ? { ...x, enabled: on } : x)) }))}
            label={`Use ${provider.name}`}
          />
        )}
      </span>
      {!sample && (
        <span className={s.itemRemove}>
          <ConfirmButton label="Remove" confirm={`Remove ${provider.name}`} onConfirm={() => updateLiveTV((c) => ({ providers: c.providers.filter((x) => x.id !== provider.id) }))} />
        </span>
      )}
    </div>
  )
}

/** Adds a provider, or changes the one passed in. */
function ProviderForm({ provider, onDone }: { provider?: IPTVProviderConfig; onDone: () => void }) {
  const [kind, setKind] = useState<IPTVProviderKind>(provider?.kind ?? 'm3u')
  const [name, setName] = useState(provider?.name ?? '')
  const [url, setUrl] = useState(provider?.url ?? '')
  const [epg, setEpg] = useState(provider?.epgURL ?? '')
  const [username, setUsername] = useState(provider?.username ?? '')
  const [password, setPassword] = useState(provider?.password ?? '')
  const [state, setState] = useState<{ kind: 'idle' | 'testing' } | { kind: 'ok' | 'error'; text: string }>({ kind: 'idle' })
  const form = useRef<HTMLFormElement>(null)
  // Editing from a row brings the form into view: it is further down the section than the row.
  useEffect(() => {
    if (provider) form.current?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [provider])

  const xtream = kind === 'xtream'
  const address = url.trim()
  const problem = address && !isWebAddress(address) ? 'Start the address with http:// or https://.' : epg.trim() && !isWebAddress(epg.trim()) ? 'The guide address has to start with http:// or https://.' : undefined
  const ready = isWebAddress(address) && !problem && (!xtream || (username.trim() && password))

  const draft = (): IPTVProviderConfig => ({
    id: provider?.id ?? uuid(),
    name: name.trim() || hostOf(address),
    kind,
    url: address,
    epgURL: epg.trim() || undefined,
    username: xtream ? username.trim() : undefined,
    password: xtream ? password : undefined,
    enabled: provider?.enabled ?? true,
    useForVOD: provider?.useForVOD ?? true,
    userAgent: provider?.userAgent,
  })

  function save(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    const next = draft()
    updateLiveTV((c) => ({ providers: c.providers.some((x) => x.id === next.id) ? c.providers.map((x) => (x.id === next.id ? next : x)) : [...c.providers, next] }))
    if (provider) onDone()
    else {
      setName('')
      setUrl('')
      setEpg('')
      setUsername('')
      setPassword('')
      setState({ kind: 'ok', text: `${next.name} is added. Open Live TV to watch.` })
    }
  }

  async function test() {
    if (!ready) return
    setState({ kind: 'testing' })
    try {
      const { testProvider } = await import('../../lib/livetv/load')
      setState({ kind: 'ok', text: await testProvider(draft()) })
    } catch (error) {
      setState({ kind: 'error', text: words(error) })
    }
  }

  const id = provider ? `iptv-edit` : 'iptv-new'
  return (
    <Group title={provider ? `Edit ${provider.name}` : 'Add a Provider'} footer={xtream ? 'Use the server address your provider gave you, without /player_api.php.' : 'Use the playlist address your provider gave you (.m3u or .m3u8). Its guide address is read from the playlist when it names one.'}>
      <div className={s.pad}>
        <Segmented options={kinds} value={kind} onChange={setKind} label="Provider type" />
      </div>
      <form ref={form} className={s.form} onSubmit={save}>
        <label className={s.fieldLabel} htmlFor={`${id}-name`}>
          Name
        </label>
        <input id={`${id}-name`} className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="My IPTV" autoComplete="off" />
        <label className={s.fieldLabel} htmlFor={`${id}-url`}>
          {xtream ? 'Server URL' : 'Playlist URL'}
        </label>
        <input
          id={`${id}-url`}
          className="field"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={xtream ? 'http://provider.example:8080' : 'https://provider.example/playlist.m3u'}
          inputMode="url"
          autoCapitalize="off"
          spellCheck={false}
          autoComplete="off"
        />
        {xtream && (
          <>
            <label className={s.fieldLabel} htmlFor={`${id}-user`}>
              Username
            </label>
            <input id={`${id}-user`} className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" spellCheck={false} autoComplete="off" />
            <label className={s.fieldLabel} htmlFor={`${id}-password`}>
              Password
            </label>
            <input id={`${id}-password`} className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </>
        )}
        <label className={s.fieldLabel} htmlFor={`${id}-epg`}>
          Guide (XMLTV) URL, optional
        </label>
        <input id={`${id}-epg`} className="field" value={epg} onChange={(e) => setEpg(e.target.value)} placeholder="https://provider.example/guide.xml.gz" inputMode="url" autoCapitalize="off" spellCheck={false} autoComplete="off" />
        {problem && <Note tone="error">{problem}</Note>}
        {state.kind === 'ok' && <Note tone="ok">{state.text}</Note>}
        {state.kind === 'error' && <Note tone="error">{state.text}</Note>}
        <div className={s.actions}>
          <button className="btn btn-primary btn-compact" type="submit" disabled={!ready}>
            {provider ? 'Save Changes' : 'Add Provider'}
          </button>
          <button type="button" className="btn btn-secondary btn-compact" onClick={test} disabled={!ready || state.kind === 'testing'}>
            {state.kind === 'testing' ? 'Testing…' : 'Test'}
          </button>
          {provider && (
            <button type="button" className="btn btn-quiet btn-compact" onClick={onDone}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </Group>
  )
}
