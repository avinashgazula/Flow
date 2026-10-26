import { useState, type FormEvent } from 'react'
import { Icon } from '../../components/Icon'
import { hostOf, isMixedContent, normaliseShareURL, SourceError, uuid } from '../../lib/sources/http'
import { settingsStore, useSettings, type WebDAVConfig } from '../../lib/store/settings'
import { ConfirmButton, Group, Note, Switch } from './controls'
import s from './SettingsScreen.module.css'

/* WebDAV shares in Settings → Media Servers, as the apps' WebDAV page: add one, edit it, turn it off or remove it.
   Flow scans each share's Movies and TV Shows folders and offers the files named like the title as sources. */

/** The WebDAV client loads when a share is tested or edited, not with the page. */
const davClient = () => import('../../lib/sources/webdav')

const shares = (): WebDAVConfig[] => settingsStore.get().webDAV ?? []
const saveShare = (config: WebDAVConfig) =>
  settingsStore.set((st) => {
    const list = st.webDAV ?? []
    return { webDAV: list.some((x) => x.id === config.id) ? list.map((x) => (x.id === config.id ? config : x)) : [...list, config] }
  })

const message = (error: unknown) => (error instanceof SourceError ? error.message : (error as Error)?.name === 'AbortError' ? '' : 'Something went wrong. Try again.')

export function WebDAVGroups() {
  const list = useSettings((x) => x.webDAV) ?? []
  // `undefined` is closed; an empty id is a new share.
  const [editing, setEditing] = useState<string | undefined>()
  const share = editing ? list.find((x) => x.id === editing) : undefined
  return (
    <>
      <Group
        title="WebDAV Shares"
        footer="Flow scans the Movies and TV Shows folders for files named like “Movie (2020).mkv” or “Show/Season 1/Show S01E02.mkv” and offers them as sources. A web page can only read a share that allows it (CORS), and a password-protected share plays Matroska (MKV) files only."
      >
        {list.map((x) => (
          <ShareRow key={x.id} share={x} onEdit={() => setEditing(x.id)} />
        ))}
        {list.length === 0 && editing === undefined && (
          <div className={s.pad}>
            <p className={s.hint}>No shares yet.</p>
          </div>
        )}
        {editing === undefined && (
          <div className={s.pad}>
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => setEditing('')}>
              <Icon name="plus" size={16} /> Add WebDAV Share
            </button>
          </div>
        )}
      </Group>
      {editing !== undefined && <ShareForm key={editing || 'new'} share={share} onDone={() => setEditing(undefined)} />}
    </>
  )
}

function ShareRow({ share, onEdit }: { share: WebDAVConfig; onEdit: () => void }) {
  const [test, setTest] = useState<{ kind: 'idle' | 'testing' } | { kind: 'ok' | 'error'; text: string }>({ kind: 'idle' })
  async function run() {
    setTest({ kind: 'testing' })
    const webdav = await davClient()
    webdav.forgetListings()
    try {
      const count = await webdav.testShare(share)
      setTest({ kind: 'ok', text: `Connected · ${count} ${count === 1 ? 'item' : 'items'} at the root` })
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
        <span className={s.itemTitle}>{share.name}</span>
        <span className={s.itemDetail}>{['WebDAV', hostOf(share.url), share.username].filter(Boolean).join(' · ')}</span>
        {test.kind === 'ok' && <Note tone="ok">{test.text}</Note>}
        {test.kind === 'error' && <Note tone="error">{test.text}</Note>}
        {isMixedContent(share.url) && <Note tone="warning">This page is HTTPS and this share is http://, so the browser blocks it. Edit it to use its https:// address.</Note>}
      </span>
      <span className={s.itemActions}>
        <button type="button" className="btn btn-secondary btn-compact" onClick={run} disabled={test.kind === 'testing'}>
          {test.kind === 'testing' ? 'Testing…' : 'Test'}
        </button>
        <button type="button" className="btn btn-secondary btn-compact" onClick={onEdit} aria-label={`Edit ${share.name}`}>
          Edit
        </button>
        <Switch checked={share.enabled} onChange={(on) => saveShare({ ...share, enabled: on })} label={`Use ${share.name}`} />
      </span>
      <span className={s.itemRemove}>
        <ConfirmButton label="Remove" confirm={`Remove ${share.name}`} onConfirm={() => settingsStore.set({ webDAV: shares().filter((x) => x.id !== share.id) })} />
      </span>
    </div>
  )
}

/** The fields of a share, as the apps' editor: name, address, login and the two folders. Saved without testing,
 *  as in the apps; Test Connection says whether the address, the login and the browser's access all work. */
function ShareForm({ share, onDone }: { share?: WebDAVConfig; onDone: () => void }) {
  const [name, setName] = useState(share?.name ?? '')
  const [address, setAddress] = useState(share?.url ?? '')
  const [username, setUsername] = useState(share?.username ?? '')
  const [password, setPassword] = useState(share?.password ?? '')
  const [movies, setMovies] = useState(share?.moviesPath ?? '/Movies')
  const [shows, setShows] = useState(share?.showsPath ?? '/TV Shows')
  const [state, setState] = useState<{ kind: 'idle' | 'testing' } | { kind: 'ok' | 'error'; text: string }>({ kind: 'idle' })

  const draft = (): WebDAVConfig => ({
    id: share?.id ?? uuid(),
    name: name.trim() || (hostOf(normaliseShareURL(address)) || 'WebDAV'),
    url: normaliseShareURL(address),
    ...(username.trim() ? { username: username.trim() } : {}),
    ...(password ? { password } : {}),
    moviesPath: movies.trim() || '/Movies',
    showsPath: shows.trim() || '/TV Shows',
    enabled: share?.enabled ?? true,
  })
  // Said while typing, not after a failed save: an address that isn't one, or that this page can't call.
  let problem: string | undefined
  let mixed = false
  if (address.trim().length > 3) {
    try {
      mixed = isMixedContent(normaliseShareURL(address))
    } catch {
      problem = 'That doesn’t look like a web address.'
    }
  }

  async function test() {
    setState({ kind: 'testing' })
    const webdav = await davClient()
    webdav.forgetListings()
    try {
      const count = await webdav.testShare(draft())
      setState({ kind: 'ok', text: `Connected · ${count} ${count === 1 ? 'item' : 'items'} at the root` })
    } catch (error) {
      setState({ kind: 'error', text: message(error) || 'Couldn’t connect.' })
    }
  }

  function save(event: FormEvent) {
    event.preventDefault()
    // Listings kept for the old address or login are no use now.
    void davClient().then((webdav) => webdav.forgetListings())
    saveShare(draft())
    onDone()
  }

  const id = share ? 'webdav-edit' : 'webdav-new'
  const ready = address.trim().length > 3 && !problem
  return (
    <Group
      title={share ? `Edit ${share.name}` : 'Add a WebDAV Share'}
      footer={`Allow ${typeof location === 'undefined' ? 'this site' : location.origin} (CORS) on the server for Flow to list the share. Passwords stay in this browser and are sent only to the share.`}
    >
      <form className={s.form} onSubmit={save}>
        <label className={s.fieldLabel} htmlFor={`${id}-name`}>
          Name
        </label>
        <input id={`${id}-name`} className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="My NAS" autoComplete="off" />
        <label className={s.fieldLabel} htmlFor={`${id}-address`}>
          Address
        </label>
        <input id={`${id}-address`} className="field" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://nas.example.com/dav" inputMode="url" autoComplete="off" spellCheck={false} />
        {problem && <Note tone="error">{problem}</Note>}
        {mixed && <Note tone="warning">This page is served over HTTPS, so your browser will block an http:// share. Use the share’s https:// address, or run Flow locally to reach it on your network.</Note>}
        <label className={s.fieldLabel} htmlFor={`${id}-user`}>
          Username
        </label>
        <input id={`${id}-user`} className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
        <label className={s.fieldLabel} htmlFor={`${id}-password`}>
          Password
        </label>
        <input id={`${id}-password`} className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <label className={s.fieldLabel} htmlFor={`${id}-movies`}>
          Movies Folder
        </label>
        <input id={`${id}-movies`} className="field" value={movies} onChange={(e) => setMovies(e.target.value)} autoComplete="off" spellCheck={false} />
        <label className={s.fieldLabel} htmlFor={`${id}-shows`}>
          TV Shows Folder
        </label>
        <input id={`${id}-shows`} className="field" value={shows} onChange={(e) => setShows(e.target.value)} autoComplete="off" spellCheck={false} />
        {state.kind === 'ok' && <Note tone="ok">{state.text}</Note>}
        {state.kind === 'error' && <Note tone="error">{state.text}</Note>}
        <div className={s.actions}>
          <button className="btn btn-primary btn-compact" type="submit" disabled={!ready}>
            Save
          </button>
          <button type="button" className="btn btn-secondary btn-compact" onClick={test} disabled={!ready || state.kind === 'testing'}>
            {state.kind === 'testing' ? 'Testing…' : 'Test Connection'}
          </button>
          <button type="button" className="btn btn-quiet btn-compact" onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>
    </Group>
  )
}
