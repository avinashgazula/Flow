import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { activeProviders, recordRecent } from '../../lib/livetv/favourites'
import { liveState, loadLiveTV, useLiveTV } from '../../lib/livetv/load'
import { nowAndNext } from '../../lib/livetv/epg'
import { matchChannels } from '../../lib/sports/match'
import type { SportsEvent } from '../../lib/sports/types'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { ChannelLogo } from '../livetv/shared'
import { timeRange } from '../livetv/logic'
import s from './SportsPage.module.css'

/* The channels carrying one game, best match first (the apps' GameChannelsView). It opens under the game it is
   about, not over the page: the games stay in view. This file holds everything that needs Live TV's code, so
   Sports loads it only when a game's channels are asked for. */

/** Loads the viewer's providers (as Live TV does) and says which channel is best for a game, if any. */
export async function bestChannel(event: SportsEvent): Promise<{ status: 'none-configured' } | { status: 'none-found' } | { status: 'found'; id: string }> {
  const settings = settingsStore.get()
  const providers = activeProviders(settings)
  if (providers.length === 0) return { status: 'none-configured' }
  await loadLiveTV(providers, { refreshHours: settings.liveTV?.epgRefreshHours ?? 12 })
  const live = liveState()
  const best = matchChannels(event, live.channels, live.epg)[0]
  return best ? { status: 'found', id: best.channel.id } : { status: 'none-found' }
}

export default function GameChannels({ event }: { event: SportsEvent }) {
  const live = useLiveTV()
  const configured = useSettings((x) => activeProviders(x).length > 0)
  const hours = useSettings((x) => x.liveTV?.epgRefreshHours ?? 12)
  const demo = useSettings((x) => x.demo)
  const own = useSettings((x) => x.liveTV?.providers)

  useEffect(() => {
    void loadLiveTV(activeProviders(settingsStore.get()), { refreshHours: hours })
  }, [hours, demo, own])

  if (!configured) {
    return (
      <p className={`${s.channelsNote} muted`} role="status">
        Add an M3U playlist or Xtream Codes login in{' '}
        <Link to="/settings" hash="livetv">
          Settings → Live TV
        </Link>{' '}
        to watch games.
      </p>
    )
  }
  if (live.status !== 'ready' && live.channels.length === 0) {
    return (
      <p className={`${s.channelsNote} muted`} role="status">
        Loading channels…
      </p>
    )
  }
  const matches = matchChannels(event, live.channels, live.epg)
  if (matches.length === 0) {
    return (
      <p className={`${s.channelsNote} muted`} role="status">
        Nothing in your guide is showing {event.title || 'this game'} around kick-off.
      </p>
    )
  }
  return (
    <ul className={s.channels} aria-label={`Channels showing ${event.title}`}>
      {matches.map(({ channel, programme }) => {
        const on = programme ?? nowAndNext(live.epg, channel.epgID).now
        return (
          <li key={channel.id}>
            <Link to="/live" search={{ play: channel.id }} className={s.channel} onClick={() => recordRecent(channel.id)}>
              <ChannelLogo channel={channel} size="s" />
              <span className={s.channelText}>
                <span className={s.channelName}>
                  {channel.number ? <span className="num">{channel.number} </span> : null}
                  {channel.name}
                </span>
                {on && (
                  <span className={s.channelMeta}>
                    {on.title} · <span className="num">{timeRange(on)}</span>
                  </span>
                )}
              </span>
              <span className={`btn btn-secondary btn-compact ${s.watch}`}>Watch</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
