import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import { builtInTitles, type HeroSource, type ShelfConfig, type ShelfSource } from '../../lib/shelfDefaults'
import { addBuiltInShelf, addDiscoverShelf, missingBuiltIns, moveShelf, parseShelves, removeShelf, restoreDefaultShelves, setShelfEnabled, shelfSubtitle, shelvesToJSON, updateDiscoverShelf } from '../../lib/shelves'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { DiscoverEditor } from './DiscoverEditor'
import { ConfirmButton, Group, Note, Row, Select, Switch } from './controls'
import s from './SettingsScreen.module.css'

/* Settings → Shelves, as the apps': turn Home's rows on and off, put them in order, add Discover shelves, copy the
   list as JSON to keep or share (the apps read it too), and the few switches around Home. */

type Direction = -1 | 1

const iconFor = (source: ShelfSource): IconName => {
  switch (source.kind) {
    case 'builtIn':
      return source.id === 'streamingServices' || source.id === 'genres' ? 'grid' : 'star'
    case 'discover':
      return 'sparkles'
    case 'traktList':
    case 'mdblist':
      return 'bookmark'
    case 'mediaServerLibrary':
      return 'server'
  }
}

const set = (shelves: ShelfConfig[]) => settingsStore.set({ shelves })

const heroOptions: { value: HeroSource; label: string }[] = [
  { value: 'trending', label: 'Trending' },
  { value: 'popular', label: 'Popular' },
  { value: 'watchlist', label: 'Watchlist' },
]
const lengths = [10, 20, 30, 40].map((n) => ({ value: String(n), label: String(n) }))
const limits = [{ value: 'all', label: 'All' }, ...[5, 10, 20].map((n) => ({ value: String(n), label: String(n) }))]
const windows = [3, 7, 14, 30].map((n) => ({ value: String(n), label: `${n} days` }))

export function ShelvesSection() {
  return (
    <>
      <ShelfList />
      <TopPick />
      <HomeSwitches />
      <ShelfJSON />
    </>
  )
}

function ShelfList() {
  const shelves = useSettings((x) => x.shelves)
  const [editing, setEditing] = useState<{ id?: string } | undefined>()
  const [said, setSaid] = useState('')
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const refocus = useRef<{ id: string; direction: Direction } | null>(null)
  const missing = missingBuiltIns(shelves)
  const [pick, setPick] = useState('')

  // A moved row is the same element in a new place, which some browsers treat as losing focus: give it back to
  // the button that was pressed, or to its opposite when the row has reached an end.
  useEffect(() => {
    const next = refocus.current
    refocus.current = null
    if (!next) return
    const press = buttons.current.get(`${next.id}:${next.direction}`)
    const other = buttons.current.get(`${next.id}:${-next.direction}`)
    ;(press && !press.disabled ? press : other)?.focus()
  }, [shelves])

  function move(shelf: ShelfConfig, direction: Direction) {
    const next = moveShelf(shelves, shelf.id, direction)
    set(next)
    refocus.current = { id: shelf.id, direction }
    setSaid(`${shelf.title} is now ${next.findIndex((x) => x.id === shelf.id) + 1} of ${next.length}.`)
  }

  const editingShelf = editing?.id ? shelves.find((x) => x.id === editing.id) : undefined
  return (
    <>
      <Group title="Home Shelves" footer="Turn rows on or off and put them in order. Continue Watching sits beside the top pick on Home, and Streaming Services and Genres are rows of links to Explore.">
        {shelves.length === 0 && <Row label="No shelves" detail="Add one below, or restore the defaults." />}
        {shelves.map((shelf, i) => (
          <div key={shelf.id} className={s.item}>
            <span className={s.logo} aria-hidden>
              <Icon name={iconFor(shelf.source)} size={18} />
            </span>
            <span className={s.itemText}>
              <span className={s.itemTitle}>{shelf.title}</span>
              <span className={s.itemDetail}>{shelfSubtitle(shelf.source)}</span>
            </span>
            <span className={s.itemActions}>
              <button
                ref={(el) => void (el ? buttons.current.set(`${shelf.id}:-1`, el) : buttons.current.delete(`${shelf.id}:-1`))}
                type="button"
                className="btn btn-secondary btn-circle btn-compact"
                onClick={() => move(shelf, -1)}
                disabled={i === 0}
                aria-label={`Move ${shelf.title} up`}
              >
                <Icon name="chevronUp" size={16} strokeWidth={2.4} />
              </button>
              <button
                ref={(el) => void (el ? buttons.current.set(`${shelf.id}:1`, el) : buttons.current.delete(`${shelf.id}:1`))}
                type="button"
                className="btn btn-secondary btn-circle btn-compact"
                onClick={() => move(shelf, 1)}
                disabled={i === shelves.length - 1}
                aria-label={`Move ${shelf.title} down`}
              >
                <Icon name="chevronDown" size={16} strokeWidth={2.4} />
              </button>
              {shelf.source.kind === 'discover' && (
                <button type="button" className="btn btn-secondary btn-compact" onClick={() => setEditing({ id: shelf.id })} aria-label={`Edit ${shelf.title}`}>
                  Edit
                </button>
              )}
              <Switch checked={shelf.enabled} onChange={(on) => set(setShelfEnabled(shelves, shelf.id, on))} label={`Show ${shelf.title} on Home`} />
            </span>
            {shelf.source.kind !== 'builtIn' && (
              <span className={s.itemRemove}>
                <ConfirmButton label="Remove" confirm={`Remove ${shelf.title}`} onConfirm={() => set(removeShelf(shelves, shelf.id))} />
              </span>
            )}
          </div>
        ))}
      </Group>
      <p className="sr-only" role="status">
        {said}
      </p>

      {editing ? (
        <DiscoverEditor
          key={editing.id ?? 'new'}
          shelf={editingShelf}
          onCancel={() => setEditing(undefined)}
          onSave={(title, query) => {
            set(editingShelf ? updateDiscoverShelf(shelves, editingShelf.id, title, query) : addDiscoverShelf(shelves, title, query))
            setEditing(undefined)
          }}
        />
      ) : (
        <Group title="Add a Shelf" footer="A Discover shelf is a row from TMDB’s catalogue that you filter yourself: a genre, a streaming service, a decade, a rating. Trakt and MDBList lists, and a media server’s libraries, can be shelves too once those are connected.">
          <Row label="Discover Shelf" detail="Choose what it holds">
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => setEditing({})}>
              <Icon name="plus" size={16} /> Add
            </button>
          </Row>
          {missing.length > 0 && (
            <Row label="Built-in Shelf" detail={`${missing.length} not on your list`}>
              <Select
                value={pick || (missing[0] ?? '')}
                onChange={setPick}
                options={missing.map((id) => ({ value: id, label: builtInTitles[id] }))}
                label="Built-in shelf to add"
              />
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => (set(addBuiltInShelf(shelves, (pick || missing[0]) as (typeof missing)[number])), setPick(''))}>
                <Icon name="plus" size={16} /> Add
              </button>
            </Row>
          )}
          <Row label="Restore Defaults" detail="The apps’ shelves, in the apps’ order">
            <ConfirmButton label="Restore" confirm="Restore Defaults" onConfirm={() => set(restoreDefaultShelves())} />
          </Row>
        </Group>
      )}
    </>
  )
}

/** Where Home's top pick comes from when nothing is in progress, as the apps' Top Pick. */
function TopPick() {
  const primary = useSettings((x) => x.heroSource)
  const secondary = useSettings((x) => x.heroSecondarySource)
  const auto = useSettings((x) => x.heroAutoAdvance)
  return (
    <Group title="Top Pick" footer="When nothing is in progress, Home leads with the first title from these sources, and turns through up to ten of them. With something in progress it leads with that and stays put.">
      <Row label="Primary Source" htmlFor="hero-primary">
        <Select id="hero-primary" value={primary} onChange={(v) => settingsStore.set({ heroSource: v })} options={heroOptions} label="Primary source" />
      </Row>
      <Row label="Secondary Source" htmlFor="hero-secondary">
        <Select
          id="hero-secondary"
          value={secondary ?? 'none'}
          onChange={(v) => settingsStore.set({ heroSecondarySource: v === 'none' ? null : v })}
          options={[{ value: 'none' as const, label: 'None' }, ...heroOptions]}
          label="Secondary source"
        />
      </Row>
      <Row label="Rotate Automatically" detail="Never while the pointer or keyboard is on it, or with reduced motion">
        <Switch checked={auto} onChange={(on) => settingsStore.set({ heroAutoAdvance: on })} label="Rotate the top picks automatically" />
      </Row>
    </Group>
  )
}

/** The switches around Home's rows: how long a shelf is, Continue Watching, Upcoming and what posters say. */
function HomeSwitches() {
  const length = useSettings((x) => x.contentShelfLength)
  const showContinue = useSettings((x) => x.showContinueWatching)
  const limit = useSettings((x) => x.continueWatchingLimit)
  const showUpcoming = useSettings((x) => x.showUpcoming)
  const premieres = useSettings((x) => x.includeWatchlistPremieres)
  const within = useSettings((x) => x.upcomingWithinDays)
  const watched = useSettings((x) => x.showWatchedBadges)
  const left = useSettings((x) => x.showEpisodesRemaining)
  return (
    <>
      <Group title="Home" footer="Content shelves such as Trending hold this many titles (a wide screen shows the first few across, a phone scrolls the rest). Upcoming lists the next episode of series you’re caught up on, with the day it airs. Watchlist premieres add the first episode of a new season of a series on your watchlist.">
        <Row label="Content Shelf Length" htmlFor="shelf-length">
          <Select id="shelf-length" value={String(length)} onChange={(v) => settingsStore.set({ contentShelfLength: Number(v) })} options={lengths} label="Content shelf length" />
        </Row>
        <Row label="Show Continue Watching">
          <Switch checked={showContinue} onChange={(on) => settingsStore.set({ showContinueWatching: on })} label="Show Continue Watching" />
        </Row>
        <Row label="Shelf Limit" detail="Most recent kept in Continue Watching" htmlFor="shelf-limit">
          <Select id="shelf-limit" value={limit === null ? 'all' : String(limit)} onChange={(v) => settingsStore.set({ continueWatchingLimit: v === 'all' ? null : Number(v) })} options={limits} label="Continue Watching limit" disabled={!showContinue} />
        </Row>
        <Row label="Show Upcoming">
          <Switch checked={showUpcoming} onChange={(on) => settingsStore.set({ showUpcoming: on })} label="Show Upcoming" />
        </Row>
        <Row label="Include Watchlist Premieres">
          <Switch checked={premieres} onChange={(on) => settingsStore.set({ includeWatchlistPremieres: on })} label="Include watchlist premieres" disabled={!showUpcoming} />
        </Row>
        <Row label="Upcoming Within" htmlFor="upcoming-within">
          <Select id="upcoming-within" value={String(within)} onChange={(v) => settingsStore.set({ upcomingWithinDays: Number(v) })} options={windows} label="Upcoming within" disabled={!showUpcoming} />
        </Row>
      </Group>
      <Group title="Posters" footer="Show Watched Marks prints WATCHED on the strip of a title you’ve finished. Show Episodes Left adds how many episodes you’ve watched of those aired (3/10) to a series’ strip, and “5 episodes left” to Continue Watching.">
        <Row label="Show Watched Marks">
          <Switch checked={watched} onChange={(on) => settingsStore.set({ showWatchedBadges: on })} label="Show watched marks" />
        </Row>
        <Row label="Show Episodes Left">
          <Switch checked={left} onChange={(on) => settingsStore.set({ showEpisodesRemaining: on })} label="Show episodes left" />
        </Row>
      </Group>
    </>
  )
}

/** The shelf list as JSON on the clipboard, to keep, share or move to another device. It is the apps' own JSON, so a
 *  list copied from an iPhone pastes here. Pasting asks before it replaces anything. */
function ShelfJSON() {
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string }>()
  const [found, setFound] = useState<{ shelves: ShelfConfig[]; skipped: number }>()
  const [manual, setManual] = useState<string>()

  async function copy() {
    try {
      await navigator.clipboard.writeText(shelvesToJSON(settingsStore.get().shelves))
      setNote({ tone: 'ok', text: 'Copied your shelves. Paste them on another device, or keep them somewhere safe.' })
    } catch {
      // Some browsers only copy from a gesture on a visible field: show the text to copy by hand.
      setManual(shelvesToJSON(settingsStore.get().shelves))
      setNote({ tone: 'error', text: 'Your browser wouldn’t copy it. The shelves are below: select them and copy.' })
    }
  }

  function read(text: string) {
    const parsed = parseShelves(text)
    if (!parsed.ok) return setNote({ tone: 'error', text: parsed.error })
    setNote(undefined)
    setManual(undefined)
    setFound({ shelves: parsed.shelves, skipped: parsed.skipped })
  }

  async function paste() {
    setFound(undefined)
    try {
      read(await navigator.clipboard.readText())
    } catch {
      setManual('')
      setNote({ tone: 'error', text: 'Your browser wouldn’t let Flow read the clipboard. Paste the shelves into the box below.' })
    }
  }

  return (
    <Group title="Import / Export" footer="Copies your shelves as JSON to share or keep, and replaces them with shelves copied the same way (from the website or the apps).">
      <Row label="Copy to Clipboard" detail="Your shelves, as JSON">
        <button type="button" className="btn btn-secondary btn-compact" onClick={() => void copy()}>
          <Icon name="copy" size={16} /> Copy
        </button>
      </Row>
      <Row label="Paste from Clipboard" detail="Replaces your shelves">
        <button type="button" className="btn btn-secondary btn-compact" onClick={() => void paste()}>
          <Icon name="upload" size={16} /> Paste
        </button>
      </Row>
      {manual !== undefined && (
        <div className={s.form}>
          <label className={s.fieldLabel} htmlFor="shelves-json">
            Shelves as JSON
          </label>
          <textarea id="shelves-json" className={`field ${s.json}`} value={manual} onChange={(e) => setManual(e.target.value)} spellCheck={false} rows={8} />
          <div className={s.actions}>
            <button type="button" className="btn btn-secondary btn-compact" disabled={!manual.trim()} onClick={() => read(manual)}>
              Read Shelves
            </button>
          </div>
        </div>
      )}
      {found && (
        <div className={s.form}>
          <p className={s.hint}>
            Replace your shelves with the {found.shelves.length} from the clipboard?
            {found.skipped > 0 && ` ${found.skipped} that Flow couldn’t read ${found.skipped === 1 ? 'was' : 'were'} left out.`}
          </p>
          <div className={s.actions}>
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => setFound(undefined)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-compact"
              autoFocus
              onClick={() => {
                set(found.shelves)
                setFound(undefined)
                setNote({ tone: 'ok', text: `Replaced your shelves with ${found.shelves.length}.` })
              }}
            >
              Replace
            </button>
          </div>
        </div>
      )}
      {note && (
        <div className={s.pad}>
          <Note tone={note.tone}>{note.text}</Note>
        </div>
      )}
    </Group>
  )
}


