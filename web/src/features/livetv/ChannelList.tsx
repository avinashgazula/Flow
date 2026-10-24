import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { Icon } from '../../components/Icon'
import { nowAndNext, progress, remainingText } from '../../lib/livetv/epg'
import type { Channel, EPG } from '../../lib/livetv/types'
import { timeText } from './logic'
import { ChannelLogo } from './shared'
import s from './ChannelList.module.css'

const rowHeight = 88

/** The channel list: logo, number and name, what is on with the time left and a red line for how far through
 *  it is, then what is next. One row is one channel; the star beside it is a favourite. The list is
 *  virtualised, since a provider can have thousands. */
export function ChannelList({ channels, epg, favourites, now, onPlay, onToggleFavourite }: { channels: Channel[]; epg: EPG; favourites: ReadonlySet<string>; now: number; onPlay: (channel: Channel) => void; onToggleFavourite: (channel: Channel) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({ count: channels.length, getScrollElement: () => scroller.current, estimateSize: () => rowHeight, overscan: 8 })

  return (
    <div ref={scroller} className={s.scroller} role="list" aria-label="Channels">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const channel = channels[item.index]!
          const starred = favourites.has(channel.id)
          const { now: on, next } = nowAndNext(epg, channel.epgID, now)
          return (
            <div key={channel.id} role="listitem" className={s.row} data-first={item.index === 0 ? '' : undefined} style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
              <button type="button" className={s.main} onClick={() => onPlay(channel)} aria-label={`Watch ${channel.name}${on ? `, now ${on.title}` : ''}`}>
                <ChannelLogo channel={channel} />
                <span className={s.text}>
                  <span className={s.name}>
                    {channel.number !== undefined && <span className={`num ${s.number}`}>{channel.number}</span>}
                    <span className={s.nameText}>{channel.name}</span>
                  </span>
                  {on ? (
                    <>
                      <span className={s.now}>
                        <span className={s.nowTitle}>{on.title}</span>
                        <span className={`num ${s.left}`}>{remainingText(on.end - now)}</span>
                      </span>
                      <span className={s.bar} role="progressbar" aria-label={`${on.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress(on, now) * 100)}>
                        <span style={{ width: `${progress(on, now) * 100}%` }} />
                      </span>
                      {next && (
                        <span className={s.next}>
                          Next <span className="num">{timeText(next.start)}</span> · {next.title}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className={s.group}>{channel.group}</span>
                  )}
                </span>
              </button>
              <button type="button" className={s.star} aria-pressed={starred} aria-label={starred ? `Remove ${channel.name} from favourites` : `Add ${channel.name} to favourites`} onClick={() => onToggleFavourite(channel)}>
                <Icon name="star" size={18} filled={starred} strokeWidth={2} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
