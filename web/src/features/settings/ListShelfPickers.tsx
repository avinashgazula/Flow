import { useEffect, useState, type FormEvent } from 'react'
import { Icon } from '../../components/Icon'
import type { ShelfSource } from '../../lib/shelfDefaults'
import { addSourceShelf, parseTraktList, sameSource, titleFromSlug, traktShelf } from '../../lib/shelfLists'
import type { ListSummary } from '../../lib/listTitles'
import type { ServerLibrary } from '../../lib/sources/types'
import { settingsStore, useSettings, type ServerConfig } from '../../lib/store/settings'
import { Row, Select } from './controls'
import s from './SettingsScreen.module.css'

/* The rest of Add a Shelf, as the apps' Add List Shelf: a list from Trakt (one of yours, or any public one), a list from
   MDBList, and one library of a media server. A row shows only when its service is set up, and each asks that service
   for the choices when Settings is opened, so none of it costs the first page anything. */

type Choices<T> = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; items: T[] } | { state: 'failed' }
interface Found {
  server: ServerConfig
  library: ServerLibrary
}

function useChoices<T>(on: boolean, load: () => Promise<T[]>, deps: unknown[]): Choices<T> {
  const [choices, setChoices] = useState<Choices<T>>({ state: 'idle' })
  useEffect(() => {
    if (!on) return setChoices({ state: 'idle' })
    let live = true
    setChoices({ state: 'loading' })
    load().then(
      (items) => live && setChoices({ state: 'ready', items }),
      () => live && setChoices({ state: 'failed' }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ...deps])
  return choices
}

const add = (title: string, source: ShelfSource) => settingsStore.set((st) => ({ shelves: addSourceShelf(st.shelves, title, source) }))

/** A choice from the service's own lists, with an Add beside it. */
function ListPick({ label, detail, trouble, choices, source, id }: { label: string; detail: string; trouble: string; choices: Choices<{ id: string; name: string }>; source: (id: string) => ShelfSource; id: string }) {
  const shelves = useSettings((x) => x.shelves)
  const [picked, setPicked] = useState('')
  const items = choices.state === 'ready' ? choices.items : []
  const current = items.find((i) => i.id === picked) ?? items[0]
  const there = current ? shelves.some((x) => sameSource(x.source, source(current.id))) : false
  const note = choices.state === 'loading' ? 'Loading your lists…' : choices.state === 'failed' ? `Couldn’t load your lists. ${trouble}` : items.length === 0 ? 'No lists on your account yet.' : detail
  return (
    <Row label={label} detail={note} htmlFor={id}>
      {current && (
        <>
          <Select id={id} value={current.id} onChange={setPicked} options={items.map((i) => ({ value: i.id, label: i.name }))} label={`${label} to add`} />
          <button type="button" className="btn btn-secondary btn-compact" disabled={there} onClick={() => add(current.name, source(current.id))}>
            {there ? (
              'Added'
            ) : (
              <>
                <Icon name="plus" size={16} /> Add
              </>
            )}
          </button>
        </>
      )}
    </Row>
  )
}

export function ListShelfPickers() {
  const traktReady = useSettings((x) => x.traktClientID.trim().length > 0)
  const signedIn = useSettings((x) => !!x.traktAccount)
  const mdblistReady = useSettings((x) => !!x.mdblistKey?.trim())
  const servers = useSettings((x) => x.servers)
  const enabled = servers.filter((v) => v.enabled)
  const serverKey = enabled.map((v) => v.id).join(',')

  const mine = useChoices<ListSummary>(signedIn, async () => (await import('../../lib/listTitles')).myTraktLists(), [signedIn])
  const mdb = useChoices<ListSummary>(mdblistReady, async () => (await import('../../lib/listTitles')).myMDBLists(), [mdblistReady])
  const libraries = useChoices<Found>(
    enabled.length > 0,
    async () => {
      const { serverLibraries } = await import('../../lib/sources/serverCatalogue')
      // A server that doesn't answer adds nothing; the others still do.
      const lists = await Promise.all(enabled.map((server) => serverLibraries(server).then((libs) => libs.map((library) => ({ server, library })), () => [] as Found[])))
      return lists.flat()
    },
    [serverKey],
  )

  return (
    <>
      {traktReady && signedIn && <ListPick label="Trakt List" detail="One of yours" trouble="Check the sign-in in Settings → Account." id="shelf-trakt" choices={mine} source={(slug) => traktShelf('me', slug)} />}
      {traktReady && <PublicTraktList />}
      {mdblistReady && <ListPick label="MDBList List" detail="One of yours" trouble="Check the key in Settings → Metadata." id="shelf-mdblist" choices={mdb} source={(id) => ({ kind: 'mdblist', id: Number(id) })} />}
      {enabled.length > 0 && libraries.state === 'ready' && libraries.items.length > 0 && <LibraryPick items={libraries.items} named={enabled.length > 1} />}
    </>
  )
}

/** A library of a server as a shelf. Which server it is shows when there are several. */
function LibraryPick({ items, named }: { items: Found[]; named: boolean }) {
  const shelves = useSettings((x) => x.shelves)
  const [picked, setPicked] = useState('')
  const key = (f: Found) => `${f.server.id}\u0000${f.library.id}`
  const current = items.find((f) => key(f) === picked) ?? items[0]!
  const source: ShelfSource = { kind: 'mediaServerLibrary', serverID: current.server.id, libraryID: current.library.id }
  const there = shelves.some((x) => sameSource(x.source, source))
  return (
    <Row label="Server Library" detail="One library as its own shelf" htmlFor="shelf-library">
      <Select id="shelf-library" value={key(current)} onChange={setPicked} options={items.map((f) => ({ value: key(f), label: named ? `${f.library.name} · ${f.server.name}` : f.library.name }))} label="Library to add" />
      <button type="button" className="btn btn-secondary btn-compact" disabled={there} onClick={() => add(named ? `${current.server.name} · ${current.library.name}` : current.library.name, source)}>
        {there ? (
          'Added'
        ) : (
          <>
            <Icon name="plus" size={16} /> Add
          </>
        )}
      </button>
    </Row>
  )
}

/** Any public Trakt list, from its address or from the user and list names. */
function PublicTraktList() {
  const shelves = useSettings((x) => x.shelves)
  const [text, setText] = useState('')
  const [said, setSaid] = useState<{ tone: 'error' | 'ok'; text: string }>()

  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseTraktList(text)
    if (!parsed.ok) return setSaid({ tone: 'error', text: parsed.error })
    const source = traktShelf(parsed.user, parsed.slug)
    if (shelves.some((x) => sameSource(x.source, source))) return setSaid({ tone: 'ok', text: 'That list is already one of your shelves.' })
    add(titleFromSlug(parsed.slug), source)
    setText('')
    setSaid({ tone: 'ok', text: `Added ${titleFromSlug(parsed.slug)} to your shelves.` })
  }

  return (
    <form className={s.form} onSubmit={submit}>
      <label className={s.fieldLabel} htmlFor="shelf-trakt-public">
        Public Trakt List
      </label>
      <input
        id="shelf-trakt-public"
        className="field"
        value={text}
        onChange={(e) => (setText(e.target.value), setSaid(undefined))}
        placeholder="trakt.tv/users/name/lists/list-name"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-describedby="shelf-trakt-public-hint"
      />
      <p id="shelf-trakt-public-hint" className={s.hint} role={said ? (said.tone === 'error' ? 'alert' : 'status') : undefined}>
        {said?.text ?? 'Paste a list’s address, or type the username and the list name with a slash between.'}
      </p>
      <div className={s.actions}>
        <button type="submit" className="btn btn-secondary btn-compact" disabled={!text.trim()}>
          <Icon name="plus" size={16} /> Add
        </button>
      </div>
    </form>
  )
}
