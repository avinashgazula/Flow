import { useEffect, useRef, useState } from 'react'
import { Segmented } from '../../components/Choice'
import { Icon } from '../../components/Icon'
import { checkMDBListKey } from '../../lib/ratings/mdblist'
import { checkRPDBKey } from '../../lib/ratings/posters'
import { isDefaultSources, moveSource, orderedSources, ratingSources, ratingTitle, shownSources, toggleSource, type RatingSource } from '../../lib/ratings/sources'
import { settingsStore, useSettings, type Settings } from '../../lib/store/settings'
import { checkTVDBKey } from '../../lib/tvdb/client'
import { Group, Note, Row, Select, Switch } from './controls'
import { KeyField } from './KeyField'
import s from './SettingsScreen.module.css'

/* Settings → Metadata, after the apps' Metadata settings: where episodes are numbered from, the scores a title page
   shows and in what order, and rated posters. Each key is checked with its service before it is kept. None of the
   services needs the stream proxy: MDBList, TVDB and RatingPosterDB all send CORS headers. */

type Source = NonNullable<Settings['episodeSource']>
const sources: { value: Source; label: string }[] = [
  { value: 'tvdb', label: 'TVDB' },
  { value: 'tmdb', label: 'TMDB' },
  { value: 'trakt', label: 'Trakt' },
]

function EpisodeData() {
  const source = useSettings((x) => x.episodeSource ?? 'tvdb')
  const tvdbKey = useSettings((x) => x.tvdbKey ?? '')
  const traktID = useSettings((x) => x.traktClientID.trim())
  const demo = useSettings((x) => x.demo)
  const localDates = useSettings((x) => x.airDatesInLocalTimeZone !== false)
  return (
    <>
      <Group
        title="Episode Data"
        footer="Where season and episode numbers, titles and air dates come from. TVDB matches the numbering most stream sources use; posters and stills always come from TMDB. Applies from the next show you open. Air Dates in My Time Zone dates an episode with a known air time (Trakt gives one) in your own day; an air date without a time is always that day."
      >
        <Row label="Episode Source" detail="TVDB is recommended" htmlFor="episode-source">
          <Select id="episode-source" label="Episode Source" value={source} onChange={(v) => settingsStore.set({ episodeSource: v })} options={sources} />
        </Row>
        {source === 'tvdb' && !tvdbKey && (
          <div className={s.pad}>
            <Note tone="warning">Add a TVDB API key below. Until then Marquee numbers episodes the way TMDB does.</Note>
          </div>
        )}
        {source === 'trakt' && !traktID && (
          <div className={s.pad}>
            <Note tone="warning">Add a Trakt Client ID in Account. Until then Marquee numbers episodes the way TMDB does.</Note>
          </div>
        )}
        {demo && (
          <div className={s.pad}>
            <Note>Sample data uses TMDB’s numbering.</Note>
          </div>
        )}
        <Row label="Air Dates in My Time Zone">
          <Switch label="Air dates in my time zone" checked={localDates} onChange={(on) => settingsStore.set({ airDatesInLocalTimeZone: on })} />
        </Row>
      </Group>
      <KeyField
        title="TVDB"
        label="TVDB API Key"
        placeholder="Paste your TVDB project key"
        saved={tvdbKey}
        onSave={(key) => settingsStore.set({ tvdbKey: key })}
        check={(key, signal) => checkTVDBKey(key, { signal })}
        accepted="TVDB accepted the key."
        footer={
          <>
            Needed for the TVDB episode source. Without it Marquee falls back to TMDB’s numbering. Get a project key at{' '}
            <a href="https://thetvdb.com/dashboard/account/apikey" target="_blank" rel="noreferrer">
              thetvdb.com
            </a>
            .
          </>
        }
      />
    </>
  )
}

/** Which scores a title page shows and in what order: a switch to show or hide each, and arrows to move the shown ones,
 *  as the apps' Ratings Shown (arrows work with a keyboard and a screen reader as well as a thumb). */
function RatingsShown() {
  const saved = useSettings((x) => x.ratingsShown)
  const links = useSettings((x) => x.tapRatingOpensReviews !== false)
  const shown = shownSources(saved)
  const rows = orderedSources(shown)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const refocus = useRef<{ id: RatingSource; direction: -1 | 1 } | null>(null)
  const [said, setSaid] = useState('')

  // A moved row is the same element in a new place, which some browsers treat as losing focus: give it back to the
  // button pressed, or its opposite when the row has reached an end and that one is disabled.
  useEffect(() => {
    const next = refocus.current
    refocus.current = null
    if (!next) return
    const press = buttons.current.get(`${next.id}:${next.direction}`)
    const other = buttons.current.get(`${next.id}:${-next.direction}`)
    ;(press && !press.disabled ? press : other)?.focus()
  }, [saved])

  const set = (list: RatingSource[]) => settingsStore.set({ ratingsShown: list })

  return (
    <>
      <Group
        title="Ratings Shown"
        footer={
          <>
            Picks which scores appear on title pages and in what order. Scores with no value for a title are left out. IMDb, Rotten Tomatoes, Popcornmeter, Metacritic, Letterboxd and Trakt come from MDBList, so they need its key; TMDB’s needs none.
          </>
        }
      >
        {rows.map((source) => {
          const on = shown.includes(source)
          const index = shown.indexOf(source)
          const name = ratingTitle(source)
          return (
            <Row key={source} label={name}>
              <button
                ref={(el) => void (el ? buttons.current.set(`${source}:-1`, el) : buttons.current.delete(`${source}:-1`))}
                type="button"
                className="btn btn-secondary btn-circle btn-compact"
                onClick={() => {
                  const list = moveSource(shown, source, -1)
                  set(list)
                  refocus.current = { id: source, direction: -1 }
                  setSaid(`${name} is now ${list.indexOf(source) + 1} of ${list.length}.`)
                }}
                disabled={!on || index === 0}
                aria-label={`Move ${name} up`}
              >
                <Icon name="chevronUp" size={16} strokeWidth={2.4} />
              </button>
              <button
                ref={(el) => void (el ? buttons.current.set(`${source}:1`, el) : buttons.current.delete(`${source}:1`))}
                type="button"
                className="btn btn-secondary btn-circle btn-compact"
                onClick={() => {
                  const list = moveSource(shown, source, 1)
                  set(list)
                  refocus.current = { id: source, direction: 1 }
                  setSaid(`${name} is now ${list.indexOf(source) + 1} of ${list.length}.`)
                }}
                disabled={!on || index === shown.length - 1}
                aria-label={`Move ${name} down`}
              >
                <Icon name="chevronDown" size={16} strokeWidth={2.4} />
              </button>
              <Switch
                label={`Show ${name}`}
                checked={on}
                onChange={() => {
                  set(toggleSource(shown, source))
                  setSaid(`${name} ${on ? 'hidden' : 'shown'}.`)
                }}
              />
            </Row>
          )
        })}
        <Row label="Default Order" detail={ratingSources.map(ratingTitle).join(', ')}>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            disabled={isDefaultSources(shown)}
            onClick={() => {
              set([...ratingSources])
              setSaid('Ratings reset.')
            }}
          >
            Reset
          </button>
        </Row>
      </Group>
      <p className="sr-only" role="status">
        {said}
      </p>
      <Group footer="With this on, each score opens that site’s page for the title in a new tab.">
        <Row label="Tap a Rating to Open Its Reviews">
          <Switch label="Tap a rating to open its reviews" checked={links} onChange={(on) => settingsStore.set({ tapRatingOpensReviews: on })} />
        </Row>
      </Group>
    </>
  )
}

function Posters() {
  const mode = useSettings((x) => x.posterEnhancement ?? 'off')
  const key = useSettings((x) => x.rpdbKey ?? '')
  const demo = useSettings((x) => x.demo)
  return (
    <>
      <Group
        title="Poster Enhancement"
        footer={`Draws ratings onto poster art across every shelf, from RatingPosterDB (needs your RPDB key). Applies to posters loaded after you change it.${demo ? ' Sample data keeps its own posters.' : ''}`}
      >
        <Row label="Rated Posters" detail={mode === 'rpdb' && !key ? 'Add your RPDB key below' : undefined}>
          <Segmented
            label="Rated posters"
            value={mode}
            onChange={(v) => settingsStore.set({ posterEnhancement: v })}
            options={[
              { id: 'off', label: 'Off' },
              { id: 'rpdb', label: 'RPDB' },
            ]}
          />
        </Row>
      </Group>
      <KeyField
        title="RatingPosterDB"
        label="RPDB API Key"
        placeholder="Paste your RatingPosterDB key"
        saved={key}
        onSave={(k) => settingsStore.set({ rpdbKey: k })}
        check={(k, signal) => checkRPDBKey(k, signal)}
        accepted="RatingPosterDB accepted the key."
        footer={
          <>
            Posters with ratings drawn on, for Poster Enhancement. Get a key at{' '}
            <a href="https://ratingposterdb.com" target="_blank" rel="noreferrer">
              ratingposterdb.com
            </a>
            .
          </>
        }
      />
    </>
  )
}

/** Availability and Performance, as the apps' Metadata page words them. */
function Availability() {
  const unreleased = useSettings((x) => x.showUnreleasedTitles !== false)
  const prefetch = useSettings((x) => x.prefetchOnDetail !== false)
  return (
    <>
      <Group
        title="Availability"
        footer="Switch this off and Marquee uses TMDB release dates to drop titles you can’t play yet, such as a film with only a cinema release, from Home shelves, Explore and the trending rows. Rows that exist to show what’s coming are left alone: your watchlist, Continue Watching, Upcoming, Now Playing, and any Discover shelf pointed at future dates. Search still finds everything, so you can add a title before it’s out."
      >
        <Row label="Show Unreleased Titles">
          <Switch label="Show unreleased titles" checked={unreleased} onChange={(on) => settingsStore.set({ showUnreleasedTitles: on })} />
        </Row>
      </Group>
      <Group
        title="Performance"
        footer="Asks your sources in the background when you open a title so Play starts quickly. Turn it off to save bandwidth on a slow connection: the title page then waits, and Play or Choose a Source looks when you ask."
      >
        <Row label="Prefetch on Detail View">
          <Switch label="Prefetch on detail view" checked={prefetch} onChange={(on) => settingsStore.set({ prefetchOnDetail: on })} />
        </Row>
      </Group>
    </>
  )
}

export function MetadataSection() {
  const mdblist = useSettings((x) => x.mdblistKey ?? '')
  return (
    <>
      <EpisodeData />
      <Availability />
      <KeyField
        title="MDBList"
        label="MDBList API Key"
        placeholder="Paste your MDBList API key"
        saved={mdblist}
        onSave={(key) => settingsStore.set({ mdblistKey: key })}
        check={(key, signal) => checkMDBListKey(key, { signal })}
        accepted="MDBList accepted the key."
        footer={
          <>
            Adds IMDb, Rotten Tomatoes, Popcornmeter, Metacritic, Letterboxd and Trakt scores to title pages. A free key is at{' '}
            <a href="https://mdblist.com/preferences/" target="_blank" rel="noreferrer">
              mdblist.com/preferences
            </a>
            .
          </>
        }
      />
      <RatingsShown />
      <Posters />
    </>
  )
}
