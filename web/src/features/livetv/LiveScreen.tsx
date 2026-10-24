import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { demoProvider } from '../../lib/livetv/demo'
import { activeProviders, recordRecent, toggleFavourite, useFavouriteIDs, useProviders } from '../../lib/livetv/favourites'
import { loadLiveTV, refreshLiveTV, useLiveTV } from '../../lib/livetv/load'
import type { Channel } from '../../lib/livetv/types'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { ChipRow } from '../explore/ChipRow'
import { Segmented, StateView } from '../explore/Controls'
import { ChannelList } from './ChannelList'
import { Guide } from './Guide'
import { favouritesGroup, groupsOf, visibleChannels } from './logic'
import { useNow, usePhone } from './shared'
import s from './LiveScreen.module.css'

const LivePlayer = lazy(() => import('./LivePlayer').then((m) => ({ default: m.LivePlayer })))

export type LiveView = 'guide' | 'channels'
const views = [
  { id: 'guide', label: 'Guide' },
  { id: 'channels', label: 'Channels' },
] as const

export interface LiveSearch {
  view?: LiveView
  /** A channel group, or the favourites chip (`favouritesGroup`). */
  group?: string
  /** The channel that is playing. */
  play?: string
}

/** Live TV: the channel list with what is on now, or the timeline guide, over the same groups and favourites.
 *  A channel plays full screen in `LivePlayer`, reached by `?play=` so Back returns here. */
export function LiveScreen({ search }: { search: LiveSearch }) {
  const navigate = useNavigate()
  const router = useRouter()
  const phone = usePhone()
  const view: LiveView = search.view ?? (phone ? 'channels' : 'guide')
  const sample = useSettings((x) => x.demo)
  const own = useProviders()
  const providers = useMemo(() => (sample ? [demoProvider] : own), [sample, own])
  const hours = useSettings((x) => x.liveTV?.epgRefreshHours ?? 12)
  const live = useLiveTV()
  const favouriteIDs = useFavouriteIDs()
  const favourites = useMemo(() => new Set(favouriteIDs), [favouriteIDs])
  const now = useNow(view === 'guide' ? 60_000 : 30_000)
  const [text, setText] = useState('')
  const [searching, setSearching] = useState(false)

  // Loads on arrival and when the providers change; what is kept from before paints first.
  useEffect(() => {
    void loadLiveTV(providers, { refreshHours: hours })
  }, [providers, hours])

  const groups = useMemo(() => groupsOf(live.channels), [live.channels])
  const hasFavourites = live.channels.some((c) => favourites.has(c.id))
  const group = search.group === favouritesGroup ? (hasFavourites ? favouritesGroup : undefined) : groups.includes(search.group ?? '') ? search.group : undefined
  const visible = useMemo(() => visibleChannels(live.channels, { group, favourites, search: text }), [live.channels, group, favourites, text])

  const go = (change: Partial<LiveSearch>, replace = true) => void navigate({ to: '/live', search: (prev) => ({ view: prev.view, group: prev.group, play: typeof prev.play === 'string' ? prev.play : undefined, ...change }) as LiveSearch, replace })

  // The player is a step in history, so Back leaves it; zapping replaces that step.
  const openedHere = useRef(false)
  const play = (channel: Channel) => {
    recordRecent(channel.id)
    openedHere.current = true
    go({ play: channel.id }, false)
  }
  const tune = (channel: Channel) => {
    recordRecent(channel.id)
    go({ play: channel.id })
  }
  const close = () => {
    if (openedHere.current) {
      openedHere.current = false
      router.history.back()
    } else go({ play: undefined })
  }
  const playing = search.play ? live.channels.find((c) => c.id === search.play) : undefined

  const refresh = () => void refreshLiveTV(activeProviders(settingsStore.get()), hours)

  if (providers.length === 0) {
    return (
      <div className={s.screen}>
        <h1 className={`page-title ${s.title}`}>Live TV</h1>
        <StateView
          icon="live"
          title="No IPTV Providers"
          message="Add an M3U playlist or an Xtream Codes login to watch live channels."
          action={
            <Link to="/settings" hash="livetv" className="btn btn-primary">
              Add Provider
            </Link>
          }
        />
      </div>
    )
  }

  const chips = [
    { id: undefined, label: 'All' },
    ...(hasFavourites ? [{ id: favouritesGroup, label: 'Favourites' }] : []),
    ...groups.map((g) => ({ id: g, label: g })),
  ]

  return (
    <div className={s.screen}>
      {/* Behind the full-screen player nothing here takes focus or a tap. */}
      <div className={s.inner} inert={!!search.play}>
        <header className={s.head}>
          <h1 className={`page-title ${s.title}`}>Live TV</h1>
          <div className={s.tools}>
            <button type="button" className={`btn btn-secondary btn-circle ${s.searchToggle}`} aria-label="Search channels" aria-expanded={searching} onClick={() => setSearching((x) => !x)}>
              <Icon name="search" size={18} strokeWidth={2.2} />
            </button>
            <button type="button" className="btn btn-secondary btn-circle" aria-label="Refresh channels and guide" onClick={refresh} disabled={live.refreshing}>
              <Icon name="refresh" size={18} strokeWidth={2.2} />
            </button>
          </div>
          <Segmented className={s.views} options={views} value={view} onChange={(v) => go({ view: v })} label="View" />
          <label className={s.search} data-open={searching ? '' : undefined}>
            <span className="sr-only">Search channels</span>
            <Icon name="search" size={16} strokeWidth={2.4} />
            <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Channels" autoComplete="off" spellCheck={false} />
          </label>
        </header>
        {live.channels.length > 0 && (
          <div className={s.chips}>
          <ChipRow label="Channel groups">
            {chips.map((chip) => (
              <button key={chip.id ?? 'all'} type="button" className="chip" aria-pressed={group === chip.id} onClick={() => go({ group: chip.id })}>
                {chip.id === favouritesGroup && <Icon name="star" size={14} className={s.chipStar} />}
                {chip.label}
              </button>
            ))}
          </ChipRow>
          </div>
        )}
        {live.error && (
          <p className={s.warning} data-tone="error" role="alert">
            <Icon name="warning" size={16} /> {live.error}
          </p>
        )}
        {!live.error && live.guideError && (
          <p className={s.warning} role="status">
            <Icon name="warning" size={16} /> The guide didn’t load, so channels show no programmes. {live.guideError}
          </p>
        )}
        <div className={s.body}>
          {live.status !== 'ready' && live.channels.length === 0 ? (
            <p className={`muted ${s.loading}`} role="status">
              Loading channels…
            </p>
          ) : live.channels.length === 0 ? (
            <StateView
              icon="live"
              title="No Channels"
              message={live.error ? 'Fix the provider in Settings, then refresh.' : 'Your providers are all switched off, or their playlists are empty. Check them in Settings.'}
              action={
                <Link to="/settings" hash="livetv" className="btn btn-secondary">
                  Open Live TV Settings
                </Link>
              }
            />
          ) : visible.length === 0 ? (
            <StateView icon="search" title="No Channels Found" message="Try another name, or pick a different group." />
          ) : view === 'guide' ? (
            <Guide channels={visible} epg={live.epg} now={now} onPlay={play} />
          ) : (
            <ChannelList channels={visible} epg={live.epg} favourites={favourites} now={now} onPlay={play} onToggleFavourite={(c) => toggleFavourite(c.id)} />
          )}
        </div>
      </div>
      {search.play && (
        <Suspense fallback={<div className={s.curtain} />}>
          {playing ? (
            <LivePlayer key="player" channel={playing} lineup={visible.some((c) => c.id === playing.id) ? visible : live.channels} epg={live.epg} onTune={tune} onClose={close} />
          ) : live.status === 'ready' ? (
            <div className={s.curtain}>
              <StateView title="That Channel Isn’t Here" message="It may have been removed from the provider’s list." action={<button type="button" className="btn btn-secondary" onClick={close}>Back to Live TV</button>} />
            </div>
          ) : (
            <div className={s.curtain} />
          )}
        </Suspense>
      )}
    </div>
  )
}
