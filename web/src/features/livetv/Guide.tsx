import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { isAiring, progress, schedule } from '../../lib/livetv/epg'
import type { Channel, EPG, Programme } from '../../lib/livetv/types'
import { guideHours, guideStart, timeRange, timeText, timingText } from './logic'
import { ChannelLogo, LiveBadge, usePhone } from './shared'
import s from './Guide.module.css'

const rowHeight = 64
const rulerHeight = 36
const halfHour = 30 * 60_000

interface Selection {
  channel: Channel
  programme: Programme
}
/** The programme on now keeps its words to the right of the red line, where what is left of it runs on, so the
 *  line never crosses a word. Returns how far in the words start and how wide they may be, or none when what is
 *  left of the programme is too short to read a title in (the block says what it is to a screen reader). */
function afterNowLine(lineAt: number, width: number): { offset: number; room: number } | undefined {
  const offset = lineAt > 0 ? lineAt + 8 : 10
  const room = width - offset - 10
  return room >= 64 ? { offset, room } : undefined
}

/** One observer per guide and column width, telling each label whether all of it is in view. A label is readable
 *  only whole: the one a programme's remaining stretch squeezes under the channel column would otherwise show as
 *  a fragment ("PM", "ion"). Only the left edge counts; the right edge and the rows scroll as they always do. */
const observers = new WeakMap<Element, Map<number, IntersectionObserver>>()
function watchLabel(el: HTMLElement) {
  const root = el.closest('[data-guide-scroller]')
  if (!root || typeof IntersectionObserver === 'undefined') return
  const col = Math.round(parseFloat(getComputedStyle(el).getPropertyValue('--col')) || 0)
  let byColumn = observers.get(root)
  if (!byColumn) observers.set(root, (byColumn = new Map()))
  let watcher = byColumn.get(col)
  if (!watcher) {
    watcher = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.intersectionRatio >= 0.98) e.target.removeAttribute('data-cut')
          else e.target.setAttribute('data-cut', '')
        }
      },
      { root, rootMargin: `400px 4000px 400px -${col}px`, threshold: [0.98] },
    )
    byColumn.set(col, watcher)
  }
  watcher.observe(el)
  return () => watcher.unobserve(el)
}

const selectionKey = (x: Selection) => `${x.channel.id}@${x.programme.start}`

/** The timeline guide: channels down the left, a sticky ruler of half hours along the top, a red line for
 *  now, and each programme as a block as long as it runs. The one on now is a lighter base with a red hairline
 *  for how far through it is; yellow is left for the focus ring.
 *  Rows are virtualised and the whole guide scrolls sideways through time; the channel column and the ruler
 *  stay put. Choosing a programme opens its details below, and Watch Now there (or the channel on the left)
 *  starts it. */
export function Guide({ channels, epg, now, onPlay }: { channels: Channel[]; epg: EPG; now: number; onPlay: (channel: Channel) => void }) {
  const phone = usePhone()
  const pointsPerMinute = phone ? 4.2 : 6
  const columnWidth = phone ? 76 : 176
  const start = useMemo(() => guideStart(now), [Math.floor(now / halfHour)])
  const timelineWidth = guideHours * 60 * pointsPerMinute
  const scroller = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Selection>()
  const nowX = ((now - start) / 60_000) * pointsPerMinute

  const virtualizer = useVirtualizer({ count: channels.length, getScrollElement: () => scroller.current, estimateSize: () => rowHeight, overscan: 6 })

  // Open with "now" in view, not at the far left where the programmes that have ended are.
  const placed = useRef(false)
  useEffect(() => {
    const el = scroller.current
    if (!el || placed.current || channels.length === 0) return
    placed.current = true
    // Far enough in that what has just ended shows beside the line, as a block you can still read.
    el.scrollLeft = Math.max(0, nowX - Math.min(120, (el.clientWidth - columnWidth) * 0.3))
  }, [channels.length, nowX])

  // A selection for a channel that is no longer listed (the group changed) goes away with it.
  useEffect(() => {
    if (selected && !channels.some((c) => c.id === selected.channel.id)) setSelected(undefined)
  }, [channels, selected])

  const ticks = Array.from({ length: guideHours * 2 }, (_, i) => start + i * halfHour)

  return (
    <div className={s.guide}>
      <div ref={scroller} className={s.scroller} data-guide-scroller="" role="region" aria-label="Programme guide" tabIndex={-1}>
        <div className={s.canvas} style={{ width: columnWidth + timelineWidth, height: rulerHeight + virtualizer.getTotalSize() }}>
          <div className={s.ruler} style={{ height: rulerHeight }}>
            <span className={s.corner} style={{ width: columnWidth }} />
            {ticks.map((t, i) => (
              <span key={t} className={`num ${s.tick}`} style={{ left: columnWidth + i * 30 * pointsPerMinute, width: 30 * pointsPerMinute }}>
                {timeText(t)}
              </span>
            ))}
            <span className={s.nowHead} style={{ left: columnWidth + nowX }} aria-hidden="true" />
          </div>
          {virtualizer.getVirtualItems().map((item) => {
            const channel = channels[item.index]!
            const programmes = schedule(epg, channel.epgID, start, guideHours)
            return (
              <div key={channel.id} className={s.row} style={{ height: item.size, transform: `translateY(${rulerHeight + item.start}px)`, width: columnWidth + timelineWidth }}>
                <button type="button" className={s.channel} style={{ width: columnWidth }} onClick={() => onPlay(channel)} aria-label={`Watch ${channel.name}`}>
                  <ChannelLogo channel={channel} size={phone ? 's' : 'm'} />
                  {!phone && <span className={s.channelName}>{channel.name}</span>}
                </button>
                <div className={s.cells} style={{ left: columnWidth, width: timelineWidth, ['--col' as string]: `${columnWidth}px` }}>
                  {programmes.length === 0 && <span className={s.empty}>No guide information</span>}
                  {/* In each row, so it passes over the programmes and under the channel column and the ruler. */}
                  <span className={s.nowLine} style={{ left: nowX }} aria-hidden="true" />
                  {programmes.map((p) => {
                    const from = Math.max(p.start, start)
                    const to = Math.min(p.end, start + guideHours * 3_600_000)
                    const x = ((from - start) / 60_000) * pointsPerMinute
                    const width = Math.max(2, ((to - from) / 60_000) * pointsPerMinute - 4)
                    const live = isAiring(p, now)
                    const words = live ? afterNowLine(nowX - x, width) : width > 44 ? { offset: 10, room: width - 20 } : undefined
                    const chosen = selected !== undefined && selectionKey(selected) === `${channel.id}@${p.start}`
                    return (
                      <button
                        key={p.start}
                        type="button"
                        className={s.programme}
                        data-live={live ? '' : undefined}
                        data-selected={chosen ? '' : undefined}
                        style={{ left: x, width }}
                        aria-pressed={chosen}
                        aria-label={`${p.title}, ${timeRange(p)}, ${channel.name}${live ? ', on now' : ''}`}
                        onClick={() => setSelected(chosen ? undefined : { channel, programme: p })}
                      >
                        {words && (
                          <span ref={watchLabel} className={s.label} style={{ marginLeft: words.offset, maxWidth: words.room }}>
                            <span className={s.title}>{p.title}</span>
                            <span className={`num ${s.when}`}>{timeRange(p)}</span>
                          </span>
                        )}
                        {live && width > 28 && <span className={s.progress} style={{ width: `${progress(p, now) * 100}%` }} />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {selected && <Details selection={selected} now={now} onClose={() => setSelected(undefined)} onWatch={() => onPlay(selected.channel)} />}
    </div>
  )
}

/** One programme's details, docked under the guide so the guide stays in view: what it is, when, a way in if it is on now. */
function Details({ selection, now, onClose, onWatch }: { selection: Selection; now: number; onClose: () => void; onWatch: () => void }) {
  const { channel, programme: p } = selection
  const live = isAiring(p, now)
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <section className={s.details} aria-label="Programme details">
      <div className={s.detailsBody}>
        <div className={s.detailsHead}>
          <ChannelLogo channel={channel} size="s" />
          <span className={s.detailsChannel}>{channel.name}</span>
          {live && <LiveBadge />}
        </div>
        <h2 className={s.detailsTitle}>{p.title}</h2>
        {p.subtitle && <p className={s.detailsSubtitle}>{p.subtitle}</p>}
        <p className={`num ${s.detailsTiming}`}>
          {timingText(p, now)}
          {p.category ? ` · ${p.category}` : ''}
        </p>
        {live && (
          <span className={s.detailsBar} role="progressbar" aria-label="How far through" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress(p, now) * 100)}>
            <span style={{ width: `${progress(p, now) * 100}%` }} />
          </span>
        )}
        {p.description && <p className={s.detailsText}>{p.description}</p>}
      </div>
      <div className={s.detailsActions}>
        {live && (
          <button type="button" className="btn btn-primary" onClick={onWatch}>
            <Icon name="play" size={18} /> Watch Now
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-circle" onClick={onClose} aria-label="Close programme details">
          <Icon name="close" size={20} strokeWidth={2.4} />
        </button>
      </div>
    </section>
  )
}
