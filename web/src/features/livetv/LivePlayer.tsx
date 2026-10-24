import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../../components/Icon'
import { learn, planFor } from '../../lib/livetv/access'
import { mergeEPG, nowAndNext, progress } from '../../lib/livetv/epg'
import { isRawTransportStream, streamCandidates } from '../../lib/livetv/streamUrl'
import type { Channel, EPG } from '../../lib/livetv/types'
import { XtreamClient, xtreamStreamID } from '../../lib/livetv/xtream'
import { streamProxy } from '../../lib/sources/proxy'
import type { Source } from '../../lib/sources'
import { settingsStore } from '../../lib/store/settings'
import { PlayerController, usePlayer } from '../player/controller'
import { attachSource, type Engine } from '../player/engine'
import { mediaErrorMessage, PlaybackError } from '../player/errors'
import { neighbour, timeText } from './logic'
import { ChannelLogo, LiveBadge, useNow } from './shared'
import s from './LivePlayer.module.css'

/** How long a stream gets to start before the next way of opening it is tried. */
const startTimeout = 15_000

type Phase = { kind: 'connecting' } | { kind: 'playing' } | { kind: 'failed'; message: string; detail?: string }

/** One try at opening a channel: an address, and whether its manifest and segments go through the stream proxy. */
interface Way {
  url: string
  viaProxy: boolean
}

/** The ways to open a channel, best first, and what stopped any from being offered. Each address the provider
 *  might serve it at (HLS first for a raw transport stream, as in the apps) is tried directly and then, with a
 *  proxy set, through it; a stream a page can't call at all (http from an https page) goes straight to the proxy. */
export function waysToOpen(streamURL: string): { ways: Way[]; skippedTransportStream: boolean; problem?: string } {
  const ways: Way[] = []
  let skippedTransportStream = false
  let problem: string | undefined
  for (const url of streamCandidates(streamURL)) {
    // A browser plays MPEG-TS only inside HLS: the raw stream isn't worth a try.
    if (isRawTransportStream(url)) {
      skippedTransportStream = true
      continue
    }
    const plan = planFor(url)
    problem ??= plan.problem
    for (const a of plan.attempts) ways.push({ url, viaProxy: a.viaProxy })
  }
  return { ways, skippedTransportStream, problem }
}

/** What to tell the viewer when nothing opened, in words that say what to do. */
export function failureMessage(channel: Pick<Channel, 'name'>, last: PlaybackError | undefined, opened: { skippedTransportStream: boolean; problem?: string }, proxySet: boolean): string {
  if (opened.problem && !last) return opened.problem
  if (!last) {
    return opened.skippedTransportStream
      ? `${channel.name} is a raw MPEG-TS stream, which a browser can’t play, and its provider doesn’t offer an HLS version. Ask your provider for .m3u8 streams.`
      : `${channel.name} can’t be opened. Check its address in Settings → Live TV.`
  }
  if (/networkError|timed out/i.test(last.detail ?? '')) {
    return proxySet
      ? `${channel.name} didn’t start, directly or through your stream proxy. It may be off air, or the proxy can’t reach it: the Worker in web/proxy fetches only https addresses on the standard port, so a provider on http or a port such as :8080 needs a proxy that allows it, such as MediaFlow Proxy.`
      : `${channel.name} didn’t start. It may be off air, or its provider doesn’t let web pages play it (it sends no CORS headers, or it is http:// on an https page). Add a stream proxy in Settings → Playback to try it that way.`
  }
  return last.message
}

/** The live player: the channel full screen with a now-and-next card, channel up and down (arrow keys, swipe,
 *  buttons), a channel list, and back to the guide. It opens the stream with the same engine as films (hls.js
 *  where the browser has no HLS of its own) and takes volume, full screen, Picture in Picture and the idle
 *  cursor from the same controller. */
export function LivePlayer({ channel, lineup, epg, onTune, onClose }: { channel: Channel; lineup: Channel[]; epg: EPG; onTune: (channel: Channel) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [controller] = useState(() => new PlayerController())
  const [phase, setPhase] = useState<Phase>({ kind: 'connecting' })
  const [attempt, setAttempt] = useState(0)
  const [listOpen, setListOpen] = useState(false)
  const controls = usePlayer(controller, (x) => x.controls)
  const muted = usePlayer(controller, (x) => x.muted)
  const paused = usePlayer(controller, (x) => x.paused)
  const waiting = usePlayer(controller, (x) => x.waiting)
  const fullscreen = usePlayer(controller, (x) => x.fullscreen)
  const now = useNow(15_000)
  const canZap = lineup.length > 1

  const zap = (offset: number) => {
    const next = neighbour(lineup, channel.id, offset)
    if (next && next.id !== channel.id) {
      onTune(next)
      controller.showControls()
    }
  }
  // The handlers below are bound once; they read the latest through this.
  const latest = useRef({ zap, onClose, listOpen })
  latest.current = { zap, onClose, listOpen }

  useEffect(() => {
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [])

  // The element and the controller.
  useEffect(() => {
    const el = video.current
    const container = root.current
    if (!el || !container) return
    const unbind = controller.bind(el, container)
    container.focus({ preventScroll: true })
    return unbind
  }, [controller])

  // The stream: each channel (and each Try Again) opens afresh, trying one way after another until one plays.
  useEffect(() => {
    const el = video.current
    if (!el) return
    const abort = new AbortController()
    let engine: Engine | null = null
    let fatal: ((error: PlaybackError) => void) | undefined
    setPhase({ kind: 'connecting' })
    const settle = (e: Engine | null) => {
      engine?.destroy()
      engine = e
    }

    void (async () => {
      const opened = waysToOpen(channel.streamURL)
      let last: PlaybackError | undefined
      for (const way of opened.ways) {
        if (abort.signal.aborted) return
        const source: Source = { id: channel.id, origin: 'iptv', provider: 'Live TV', title: channel.name, url: way.url, engine: 'hls', headers: undefined, viaProxy: way.viaProxy || undefined }
        try {
          const started = new Promise<void>((resolve, reject) => {
            fatal = reject
            const timer = setTimeout(() => reject(new PlaybackError(`${channel.name} didn’t start in ${startTimeout / 1000} seconds.`, 'timed out')), startTimeout)
            const done = () => {
              clearTimeout(timer)
              el.removeEventListener('playing', done)
              resolve()
            }
            el.addEventListener('playing', done)
            abort.signal.addEventListener('abort', () => (clearTimeout(timer), el.removeEventListener('playing', done)), { once: true })
          })
          started.catch(() => {})
          const e = await attachSource(el, source, { signal: abort.signal, onTracks: controller.refreshTracks, onFatal: (error) => fatal?.(error), onAudioFailed: () => {} })
          if (abort.signal.aborted) return e.destroy()
          settle(e)
          controller.setEngine(e, source)
          el.play().catch(() => {})
          await started
          fatal = undefined
          if (abort.signal.aborted) return
          // Reached only through the proxy: remember it, so next time the proxy goes first.
          const direct = opened.ways.find((w) => w.url === way.url && !w.viaProxy)
          if (way.viaProxy && direct) learn(way.url, { viaProxy: true, directBlocked: true })
          setPhase({ kind: 'playing' })
          // After this a fatal error is a drop in the middle of watching.
          fatal = (error) => !abort.signal.aborted && setPhase({ kind: 'failed', message: failureMessage(channel, error, opened, !!streamProxy()), detail: error.detail })
          return
        } catch (error) {
          if (abort.signal.aborted || (error as Error).name === 'AbortError') return
          last = error instanceof PlaybackError ? error : new PlaybackError((error as Error).message || 'This stream couldn’t be opened.')
          settle(null)
          controller.setEngine(null, null)
        }
      }
      if (!abort.signal.aborted) setPhase({ kind: 'failed', message: failureMessage(channel, last, opened, !!streamProxy()), detail: last?.detail })
    })()

    // A media error on the element itself (not hls.js's): a stream the browser can't decode.
    const onError = () => {
      const code = el.error?.code
      if (!code || code === 1 || !el.currentSrc) return
      if (engine?.recover()) return
      fatal?.(new PlaybackError(mediaErrorMessage(code), `MediaError ${code}`))
    }
    el.addEventListener('error', onError)
    return () => {
      abort.abort()
      el.removeEventListener('error', onError)
      settle(null)
      controller.setEngine(null, null)
    }
  }, [channel.id, channel.streamURL, attempt, controller])

  // A paused picture or a stalled one keeps the controls up; coming back from one after a tune shows them.
  useEffect(() => {
    controller.showControls()
  }, [channel.id, controller])

  // The channel list holds the controls up while it is open.
  useEffect(() => {
    controller.hovering = listOpen
    if (listOpen) controller.showControls(false)
    else controller.scheduleHide()
  }, [listOpen, controller])

  // The keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const onButton = !!target?.closest('button, a, [role="option"]')
      const { zap: go, onClose: close, listOpen: open } = latest.current
      switch (e.key) {
        case 'ArrowUp':
        case 'PageUp':
          if (open) return
          e.preventDefault()
          go(-1)
          break
        case 'ArrowDown':
        case 'PageDown':
          if (open) return
          e.preventDefault()
          go(1)
          break
        case 'Escape':
          e.preventDefault()
          if (open) setListOpen(false)
          else close()
          break
        case 'l':
        case 'L':
          setListOpen((x) => !x)
          break
        case 'f':
        case 'F':
          controller.toggleFullscreen()
          break
        case 'm':
        case 'M':
          controller.toggleMute()
          controller.flash(controller.video?.muted ? 'mute' : 'volume')
          break
        case 'p':
        case 'P':
          if (controller.canPip) controller.togglePip()
          break
        case ' ':
        case 'k':
        case 'K':
          if (onButton) return
          e.preventDefault()
          controller.togglePlay()
          break
        default:
          controller.poke()
          return
      }
      controller.poke()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller])

  // Touch: swipe up for the next channel and down for the one before, like a remote's channel buttons; a tap
  // shows or hides the controls. A mouse click plays and pauses, and a double click goes full screen.
  const press = useRef<{ x: number; y: number; id: number } | undefined>(undefined)
  const onDown = (e: ReactPointerEvent) => {
    press.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
  }
  const onUp = (e: ReactPointerEvent) => {
    const start = press.current
    press.current = undefined
    if (!start || start.id !== e.pointerId) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (e.pointerType !== 'mouse' && Math.abs(dy) > 48 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      zap(dy < 0 ? 1 : -1)
      return
    }
    if (Math.hypot(dx, dy) > 10) return
    if (e.pointerType === 'mouse') controller.togglePlay()
    else controller.toggleControls()
  }

  // What is on, from the guide, or for a channel the guide doesn't list, from its panel's short guide.
  const extra = useShortGuide(channel, epg, phase.kind === 'playing')
  const guide = useMemo(() => (extra ? mergeEPG(epg, extra) : epg), [epg, extra])
  const { now: on, next } = nowAndNext(guide, channel.epgID ?? extraKey(channel), now)
  const show = controls || phase.kind !== 'playing' || paused

  return (
    <div ref={root} className={s.root} tabIndex={-1} data-fullscreen={fullscreen ? '' : undefined} onPointerMove={controller.poke} role="region" aria-label={`Live: ${channel.name}`}>
      <video ref={video} className={s.video} playsInline autoPlay aria-label={channel.name} onDoubleClick={controller.toggleFullscreen} />
      <div className={s.tap} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (press.current = undefined)} />

      {phase.kind === 'connecting' && (
        <div className={s.connecting} role="status">
          <ChannelLogo channel={channel} />
          <p className={s.connectingText}>
            Connecting to <strong>{channel.name}</strong>…
          </p>
        </div>
      )}
      {phase.kind === 'playing' && (waiting || paused) && (
        <div className={s.centre} aria-hidden={!paused}>
          {paused ? (
            <button type="button" className={`btn btn-secondary btn-circle ${s.bigPlay}`} onClick={controller.togglePlay} aria-label="Play">
              <Icon name="play" size={28} />
            </button>
          ) : (
            <span className={s.buffering} role="status" aria-label="Buffering" />
          )}
        </div>
      )}

      <div className={s.chrome} data-visible={show ? '' : undefined} data-list={listOpen ? '' : undefined}>
        <div className={s.top}>
          <button type="button" className={`btn btn-secondary ${s.back}`} onClick={onClose} aria-label="Back to the guide" title="Back (Esc)">
            <Icon name="chevronLeft" size={18} strokeWidth={2.4} /> Guide
          </button>
          <div className={s.cluster}>
            <button type="button" className={s.round} onClick={() => setListOpen((x) => !x)} aria-pressed={listOpen} aria-label="Channels" title="Channels (L)">
              <Icon name="list" size={20} />
            </button>
            <button type="button" className={s.round} onClick={controller.toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute (M)' : 'Mute (M)'}>
              <Icon name={muted ? 'mute' : 'volume'} size={20} />
            </button>
            {controller.canPip && (
              <button type="button" className={s.round} onClick={controller.togglePip} aria-label="Picture in Picture" title="Picture in Picture (P)">
                <Icon name="pip" size={20} />
              </button>
            )}
            <button type="button" className={s.round} onClick={controller.toggleFullscreen} aria-label={fullscreen ? 'Exit Full Screen' : 'Full Screen'} title={fullscreen ? 'Exit Full Screen (F)' : 'Full Screen (F)'}>
              <Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} size={20} />
            </button>
          </div>
        </div>

        <div className={s.bottom}>
          <div className={s.card}>
            <div className={s.cardHead}>
              {channel.number !== undefined && <span className={`num ${s.number}`}>{channel.number}</span>}
              <span className={s.channelName}>{channel.name}</span>
              <LiveBadge />
            </div>
            {on ? (
              <>
                <p className={s.programme}>{on.title}</p>
                <div className={`num ${s.times}`}>
                  <span>{timeText(on.start)}</span>
                  <span className={s.bar} role="progressbar" aria-label="How far through" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress(on, now) * 100)}>
                    <span style={{ width: `${progress(on, now) * 100}%` }} />
                  </span>
                  <span>{timeText(on.end)}</span>
                </div>
              </>
            ) : (
              <p className={s.noGuide}>No guide information for this channel.</p>
            )}
            {next && (
              <p className={s.next}>
                Next <span className="num">{timeText(next.start)}</span> · {next.title}
              </p>
            )}
          </div>
          {canZap && (
            <div className={s.zap}>
              <button type="button" className={s.round} onClick={() => zap(-1)} aria-label="Previous Channel" title="Previous Channel (↑)">
                <Icon name="chevronUp" size={22} strokeWidth={2.4} />
              </button>
              <button type="button" className={s.round} onClick={() => zap(1)} aria-label="Next Channel" title="Next Channel (↓)">
                <Icon name="chevronDown" size={22} strokeWidth={2.4} />
              </button>
            </div>
          )}
        </div>
      </div>

      {listOpen && <ChannelPanel lineup={lineup} current={channel} epg={guide} now={now} onPick={(c) => (onTune(c), setListOpen(false))} onClose={() => setListOpen(false)} />}

      {phase.kind === 'failed' && (
        <div className={s.failed} role="alertdialog" aria-labelledby="live-failed-title" aria-describedby="live-failed-message">
          <span className={s.failedIcon}>
            <Icon name="alert" size={36} strokeWidth={2.2} />
          </span>
          <h2 id="live-failed-title" className={s.failedTitle}>
            Couldn’t Play {channel.name}
          </h2>
          <p id="live-failed-message" className={s.failedMessage}>
            {phase.message}
          </p>
          <div className={s.failedActions}>
            {canZap && (
              <button type="button" className="btn btn-primary" onClick={() => zap(1)} autoFocus>
                Next Channel
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)} autoFocus={!canZap}>
              Try Again
            </button>
            <button type="button" className="btn btn-quiet" onClick={onClose}>
              Back to the Guide
            </button>
          </div>
          {phase.detail && <p className={s.failedDetail}>{phase.detail}</p>}
        </div>
      )}
    </div>
  )
}

/** The channel list over the picture: a panel at the right (the bottom on a phone) with every channel in the
 *  lineup, the one playing marked, each with what is on. Choosing one tunes to it. */
function ChannelPanel({ lineup, current, epg, now, onPick, onClose }: { lineup: Channel[]; current: Channel; epg: EPG; now: number; onPick: (channel: Channel) => void; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const index = Math.max(0, lineup.findIndex((c) => c.id === current.id))
  const virtualizer = useVirtualizer({ count: lineup.length, getScrollElement: () => scroller.current, estimateSize: () => 60, overscan: 8, initialOffset: Math.max(0, index * 60 - 120) })
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    scroller.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus({ preventScroll: true })
    return () => opener.current?.focus?.({ preventScroll: true })
  }, [])
  return (
    <aside className={s.panel} aria-label="Channels">
      <div className={s.panelHead}>
        <h2 className={s.panelTitle}>Channels</h2>
        <button type="button" className={s.round} onClick={onClose} aria-label="Close channel list">
          <Icon name="close" size={20} strokeWidth={2.4} />
        </button>
      </div>
      <div ref={scroller} className={s.panelList} role="list">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const c = lineup[item.index]!
            const { now: on } = nowAndNext(epg, c.epgID, now)
            const here = c.id === current.id
            return (
              <div key={c.id} role="listitem" className={s.panelItem} style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
                <button type="button" className={s.panelRow} aria-current={here ? 'true' : undefined} onClick={() => onPick(c)}>
                  <ChannelLogo channel={c} size="s" />
                  <span className={s.panelText}>
                    <span className={s.panelName}>
                      {c.number !== undefined && <span className={`num ${s.panelNumber}`}>{c.number}</span>}
                      {c.name}
                    </span>
                    <span className={s.panelNow}>{on ? on.title : c.group}</span>
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}

const extraKey = (channel: Channel) => xtreamStreamID(channel)

/** For an Xtream channel with nothing on now in the full guide: the panel's short guide for just that channel,
 *  asked for once the picture is moving. */
function useShortGuide(channel: Channel, epg: EPG, playing: boolean): EPG | undefined {
  const [extra, setExtra] = useState<{ id: string; epg: EPG }>()
  const missing = !nowAndNext(epg, channel.epgID).now
  useEffect(() => {
    if (!playing || !missing) return
    const settings = settingsStore.get()
    const config = settings.demo ? undefined : settings.liveTV?.providers.find((p) => p.id === channel.providerID && p.kind === 'xtream')
    const streamID = xtreamStreamID(channel)
    if (!config || !streamID) return
    const abort = new AbortController()
    new XtreamClient(config, planFor, { signal: abort.signal })
      .shortEPG(streamID, channel.epgID ?? streamID)
      .then((result) => setExtra({ id: channel.id, epg: result }))
      .catch(() => {})
    return () => abort.abort()
  }, [channel.id, channel.providerID, channel.epgID, playing, missing])
  return extra?.id === channel.id ? extra.epg : undefined
}
