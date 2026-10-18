import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { q } from '../../lib/queries'
import { queryClient } from '../../lib/queryClient'
import { findSources, type PlaybackRequest, type Source } from '../../lib/sources'
import { library, libraryStore, mediaKey, type EpisodeRef } from '../../lib/store/library'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { imageURL } from '../../lib/tmdb/images'
import type { Episode, MediaDetail, MediaItem, MediaType } from '../../lib/tmdb/types'
import { SourcePicker } from '../sources/SourcePicker'
import { ConnectingView, ErrorView } from './ConnectingView'
import { Controls } from './Controls'
import { PlayerController, usePlayer } from './controller'
import { attachSource, warmEngines, type Engine } from './engine'
import { mediaErrorMessage, PlaybackError } from './errors'
import { episodeLine } from './format'
import { Buffering, FeedbackFlash, SubtitleOverlay, TapLayer } from './Overlays'
import { sampleSources } from './sample'
import { lastSources, matchSource, nextEpisode, nextSource, resumePosition } from './session'
import { UpNext } from './UpNext'
import s from './Player.module.css'

type Phase = 'finding' | 'picking' | 'connecting' | 'playing' | 'error'

/** Only what a library entry needs: a full detail would store its cast and recommendations. */
const cardOf = (d: MediaItem): MediaItem => ({
  type: d.type,
  id: d.id,
  title: d.title,
  year: d.year,
  date: d.date,
  overview: d.overview,
  poster: d.poster,
  backdrop: d.backdrop,
  rating: d.rating,
  genres: d.genres,
})

const requestFor = (d: MediaDetail, type: MediaType, episode?: EpisodeRef): PlaybackRequest => ({
  item: cardOf(d),
  type,
  tmdbId: d.id,
  imdbId: d.imdb,
  season: episode?.season,
  episode: episode?.episode,
})

export interface PlayerScreenProps {
  type: MediaType
  id: number
  season?: number
  episode?: number
  sourceId?: string
  /** The element that goes full screen: it outlives this screen, so moving to the next episode
   *  stays full screen. */
  root: RefObject<HTMLDivElement | null>
}

/** One title or episode, from finding a source to the last frame: the source picker or the
 *  remembered source, the connecting screen, the engine, the controls, progress and Up Next. */
export function PlayerScreen({ type, id, season, episode, sourceId, root }: PlayerScreenProps) {
  const navigate = useNavigate()
  const router = useRouter()
  const key = mediaKey(type, id)
  const isShow = type === 'show'
  const epRef: EpisodeRef | undefined = isShow && season !== undefined && episode !== undefined ? { season, episode } : undefined

  const { data: detail, isPlaceholderData } = useQuery(q.detail(type, id))
  const { data: seasonEpisodes } = useQuery({ ...q.season(id, season ?? 1), enabled: !!epRef })
  const hasNextInSeason = !!seasonEpisodes?.some((e) => e.number === (episode ?? 0) + 1)
  const nextSeasonNumber = epRef && detail?.seasons.some((x) => x.number === epRef.season + 1) ? epRef.season + 1 : undefined
  const { data: nextSeasonEpisodes } = useQuery({ ...q.season(id, nextSeasonNumber ?? 1), enabled: !!seasonEpisodes && !hasNextInSeason && nextSeasonNumber !== undefined })
  const current: Episode | undefined = seasonEpisodes?.find((e) => e.number === episode)
  const next = epRef ? nextEpisode(epRef, seasonEpisodes, nextSeasonEpisodes) : undefined
  const autoplayNext = useSettings((st) => st.autoplayNext)

  useEffect(warmEngines, [])

  // Read once: progress changes every ten seconds while playing, and nothing here should follow it.
  const [saved] = useState(() => libraryStore.get().progress[key])
  const item: MediaItem | undefined = detail ? cardOf(detail) : saved?.item
  const title = item?.title ?? ''
  const line = epRef ? episodeLine(epRef.season, epRef.episode, current?.name) : item?.year ? String(item.year) : undefined

  const [controller] = useState(() => new PlayerController())
  const fit = usePlayer(controller, (st) => st.fit)
  const video = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<Phase>('finding')
  const [source, setSource] = useState<Source | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [sources, setSources] = useState<Source[]>([])
  const [error, setError] = useState<PlaybackError | null>(null)
  const [progress, setProgress] = useState(0)
  const [resumeAt, setResumeAt] = useState<number | null>(null)
  const [picker, setPicker] = useState(false)
  const [connectingShown, setConnectingShown] = useState(true)

  const tried = useRef(new Set<string>())
  const startAt = useRef<number | undefined>(undefined)
  const started = useRef(false)
  const offeredResume = useRef(false)
  const position = useRef(0)
  const length = useRef(Number.NaN)
  // The latest values, for handlers that effects registered once.
  const latest = useRef({ item, epRef, current, source, sources, phase, resumeAt, next, title })
  useLayoutEffect(() => {
    latest.current = { item, epRef, current, source, sources, phase, resumeAt, next, title }
  })

  const save = () => {
    const { item: it, epRef: ep, current: cur } = latest.current
    if (!started.current || !it) return
    library.saveProgress(it, position.current, length.current, ep && { ...ep, name: cur?.name, still: cur?.still })
  }

  const start = (next: Source, at?: number) => {
    tried.current.add(next.id)
    let from = at
    if (from === undefined && !offeredResume.current) {
      // Resume is offered once, for the first source; switching sources keeps the position instead.
      offeredResume.current = true
      const resume = resumePosition(saved, epRef, next.serverPosition)
      if (resume) {
        from = resume
        setResumeAt(resume)
      }
    }
    startAt.current = from
    setError(null)
    setPicker(false)
    setProgress(0.04)
    setSource(next)
    setAttempt((n) => n + 1)
    setPhase((p) => (p === 'playing' ? p : 'connecting'))
    setSources((list) => (list.some((x) => x.id === next.id) ? list : [next, ...list]))
  }

  const close = () => {
    save()
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    if (router.history.canGoBack()) router.history.back()
    else void navigate({ to: '/title/$type/$id', params: { type, id }, replace: true })
  }

  const tryAnother = () => {
    const { sources: list, source: cur } = latest.current
    const keep = started.current ? controller.currentTime() : startAt.current
    const candidate = nextSource(list, cur ?? undefined, tried.current)
    if (candidate) start(candidate, keep)
    else setPicker(true)
  }

  const fail = (err: PlaybackError) => {
    if (!started.current) {
      // Nothing has played yet: move on to the next source quietly, as the apps do.
      const candidate = nextSource(latest.current.sources, latest.current.source ?? undefined, tried.current)
      if (candidate) {
        start(candidate, startAt.current)
        return
      }
    }
    setError(err)
    setPhase('error')
  }

  const playEpisode = (target: { season: number; number: number }) => {
    save()
    void navigate({ to: '/watch/$type/$id', params: { type, id }, search: { season: target.season, episode: target.number }, replace: true })
  }

  // Which source to open: the one named in the address, the one used last time, or the picker.
  useEffect(() => {
    performance.mark('flow:watch-start')
    const abort = new AbortController()
    const remembered = lastSources.get(key)
    const sameEpisode = !epRef || (remembered?.episode?.season === epRef.season && remembered.episode.episode === epRef.episode)
    const direct = sourceId ? [remembered?.source, ...sampleSources()].find((x) => x?.id === sourceId) : sameEpisode ? remembered?.source : undefined
    if (direct) {
      start(direct)
      return () => abort.abort()
    }
    void (async () => {
      const demo = settingsStore.get().demo
      if (sourceId || remembered || demo) {
        // Add-ons look titles up by IMDb id, which only the full detail carries.
        const full = await queryClient.ensureQueryData(q.detail(type, id)).catch(() => undefined)
        if (abort.signal.aborted) return
        const list = full ? await findSources(requestFor(full, type, epRef), { signal: abort.signal }).catch(() => []) : []
        if (abort.signal.aborted) return
        if (list.length === 0 && demo) {
          // Placeholder until sample data has sources of its own (see sample.ts).
          const samples = sampleSources()
          setSources(samples)
          start((remembered && matchSource(remembered.source, samples)) ?? samples[0]!)
          return
        }
        setSources(list)
        const found = sourceId ? list.find((x) => x.id === sourceId) : remembered ? matchSource(remembered.source, list) : undefined
        if (found) {
          start(found)
          return
        }
      }
      setPhase('picking')
    })()
    return () => abort.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The video element: its events drive the connecting screen and the playing phase.
  useEffect(() => {
    const el = video.current
    const container = root.current
    if (!el || !container) return
    const unbind = controller.bind(el, container)
    const bump = (p: number) => () => setProgress((now) => Math.max(now, p))
    const loadstart = bump(0.15)
    const loadeddata = bump(0.7)
    const metadata = () => {
      bump(0.4)()
      // A resume point from another cut can lie past this stream's end: start from the top instead.
      const d = controller.duration()
      const at = startAt.current
      if (at && !Number.isNaN(d) && at >= d - 30) {
        controller.seekTo(0)
        setResumeAt(null)
      }
    }
    const canplay = () => {
      bump(0.9)()
      if (started.current || latest.current.resumeAt !== null || !el.paused) return
      el.play().catch((err: Error) => {
        // The browser wants a tap before sound: show the paused player rather than spin forever.
        if (err.name === 'NotAllowedError') setPhase('playing')
      })
    }
    const playing = () => {
      if (started.current) return
      started.current = true
      setProgress(1)
      setPhase('playing')
      try {
        performance.mark('flow:first-frame')
        const measure = performance.measure('flow:time-to-first-frame', performance.getEntriesByName('flow:watch-start').length ? 'flow:watch-start' : undefined, 'flow:first-frame')
        console.info(`[player] first frame after ${Math.round(measure.duration)} ms`)
      } catch {
        // Marks are a nicety.
      }
      const { source: src, epRef: ep, sources: list } = latest.current
      if (src) lastSources.remember(key, src, ep)
      // The source list for switching mid-film, fetched once the picture is moving so it doesn't
      // compete with the stream for the first seconds.
      if (src && list.length <= 1 && src.origin !== 'demo') {
        const full = queryClient.getQueryData(q.detail(type, id).queryKey)
        if (full) {
          void findSources(requestFor(full, type, ep))
            .then((found) => found.length && setSources(found.some((x) => x.id === src.id) ? found : [src, ...found]))
            .catch(() => {})
        }
      }
    }
    const timeupdate = () => {
      if (!started.current) return
      position.current = el.currentTime
      length.current = controller.duration()
    }
    const onError = () => {
      const code = el.error?.code
      if (!code || code === 1 || !el.currentSrc) return
      if (controller.engine?.recover()) return
      fail(new PlaybackError(mediaErrorMessage(code, latest.current.source ?? undefined), `MediaError ${code}${el.error?.message ? `: ${el.error.message}` : ''}`))
    }
    const events: [string, EventListener][] = [
      ['loadstart', loadstart],
      ['loadedmetadata', metadata],
      ['loadeddata', loadeddata],
      ['canplay', canplay],
      ['playing', playing],
      ['timeupdate', timeupdate],
      ['error', onError],
    ]
    for (const [name, fn] of events) el.addEventListener(name, fn)
    return () => {
      for (const [name, fn] of events) el.removeEventListener(name, fn)
      unbind()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The engine for the current source; a new source or Try Again opens it afresh.
  useEffect(() => {
    const el = video.current
    if (!source || !el) return
    const abort = new AbortController()
    let engine: Engine | null = null
    started.current = false
    const onFatal = (err: PlaybackError) => !abort.signal.aborted && fail(err)
    attachSource(el, source, { startAt: startAt.current, signal: abort.signal, onTracks: controller.refreshTracks, onFatal })
      .then((e) => {
        if (abort.signal.aborted) return e.destroy()
        engine = e
        controller.setEngine(e, source)
      })
      .catch((err: Error) => {
        if (abort.signal.aborted || err.name === 'AbortError') return
        onFatal(err instanceof PlaybackError ? err : new PlaybackError(err.message || 'This source couldn’t be opened. Pick another source.'))
      })
    return () => {
      abort.abort()
      engine?.destroy()
      controller.setEngine(null, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, attempt])

  // Progress: every ten seconds while playing, on pause, when the page goes away and on close.
  useEffect(() => {
    if (phase !== 'playing') return
    const el = video.current!
    const timer = setInterval(() => !el.paused && save(), 10_000)
    const onHide = () => document.visibilityState === 'hidden' && save()
    el.addEventListener('pause', save)
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      clearInterval(timer)
      el.removeEventListener('pause', save)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', onHide)
      save()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === 'playing'])

  // The tab's title, and the system's Now Playing (lock screen, media keys, Control Centre).
  useEffect(() => {
    if (!title) return
    const before = document.title
    document.title = `${epRef ? `${title} · S${epRef.season} E${epRef.episode}` : title} – Flow`
    return () => void (document.title = before)
  }, [title, epRef?.season, epRef?.episode])

  useEffect(() => {
    if (!('mediaSession' in navigator) || !item) return
    const session = navigator.mediaSession
    const art = [
      item.backdrop && { src: imageURL(item.backdrop, 780)!, sizes: '780x439', type: 'image/jpeg' },
      item.poster && { src: imageURL(item.poster, 342)!, sizes: '342x513', type: 'image/jpeg' },
    ].filter(Boolean) as MediaImage[]
    session.metadata = new MediaMetadata({ title: current?.name ?? item.title, artist: epRef ? `${item.title} · S${epRef.season} E${epRef.episode}` : (item.year ? String(item.year) : ''), album: 'Flow', artwork: art })
    const el = video.current!
    const position = () => {
      const d = controller.duration()
      if (Number.isNaN(d)) return
      try {
        session.setPositionState({ duration: d, position: Math.min(d, el.currentTime), playbackRate: el.playbackRate })
      } catch {
        // Some browsers reject a position state mid-seek.
      }
    }
    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play', () => controller.play()],
      ['pause', () => controller.pause()],
      ['seekbackward', (d) => controller.seekBy(-(d.seekOffset ?? 10))],
      ['seekforward', (d) => controller.seekBy(d.seekOffset ?? 10)],
      ['seekto', (d) => d.seekTime !== undefined && controller.seekTo(d.seekTime)],
      ['nexttrack', next ? () => playEpisode(next) : null],
    ]
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler)
      } catch {
        // Not every browser knows every action.
      }
    }
    const events = ['loadedmetadata', 'seeked', 'ratechange', 'play', 'pause']
    for (const e of events) el.addEventListener(e, position)
    return () => {
      for (const e of events) el.removeEventListener(e, position)
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null)
        } catch {
          // As above.
        }
      }
      session.metadata = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.backdrop, current?.name, next?.id])

  // Keyboard, as in the apps and the usual web players.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"]') && e.key !== 'Escape') return
      const { phase: now } = latest.current
      if (now !== 'playing') {
        // The picker handles its own Escape; elsewhere it leaves the player.
        if (e.key === 'Escape' && !picker) close()
        return
      }
      const c = controller
      const el = c.video
      if (!el) return
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      switch (key) {
        case ' ':
        case 'k':
          // Space on a focused button presses that button instead.
          if (key === ' ' && target.tagName === 'BUTTON') return
          c.togglePlay()
          c.flash(el.paused ? 'pause' : 'play')
          break
        case 'ArrowLeft':
        case 'j':
          c.seekBy(-10)
          c.flash('back10')
          c.poke()
          break
        case 'ArrowRight':
        case 'l':
          c.seekBy(10)
          c.flash('forward10')
          c.poke()
          break
        case 'ArrowUp':
        case 'ArrowDown': {
          const level = Math.round(((el.muted ? 0 : el.volume) + (key === 'ArrowUp' ? 0.1 : -0.1)) * 100) / 100
          c.setVolume(level)
          const v = Math.round(Math.min(1, Math.max(0, level)) * 100)
          c.flash(v === 0 ? 'mute' : 'volume', `${v}%`)
          break
        }
        case 'm':
          c.toggleMute()
          c.flash(el.muted ? 'mute' : 'volume', el.muted ? 'Muted' : `${Math.round(el.volume * 100)}%`)
          break
        case 'f':
          c.toggleFullscreen()
          break
        case 'c':
          c.toggleSubtitles()
          break
        case 'Escape':
          if (c.get().panel) c.setPanel(null)
          else if (picker) setPicker(false)
          else close()
          break
        case ',':
          c.step(-1)
          break
        case '.':
          c.step(1)
          break
        default:
          if (/^[0-9]$/.test(key)) {
            const d = c.duration()
            if (!Number.isNaN(d)) {
              c.seekTo((d * Number(key)) / 10)
              c.poke()
            }
            break
          }
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker])

  const answerResume = (resume: boolean) => {
    setResumeAt(null)
    if (!resume) controller.seekTo(0)
    controller.play()
  }

  const request = detail && !isPlaceholderData ? requestFor(detail, type, epRef) : undefined
  const showPicker = (phase === 'picking' || picker) && request

  return (
    <>
      <video
        ref={video}
        className={s.video}
        style={{ objectFit: fit }}
        playsInline
        preload="auto"
        aria-label={title}
      />
      {phase === 'playing' && (
        <>
          <TapLayer controller={controller} />
          <SubtitleOverlay controller={controller} />
          <Buffering controller={controller} />
          <Controls
            controller={controller}
            title={title}
            line={line}
            onClose={close}
            sources={sources}
            source={source}
            onPickSource={(x) => start(x, controller.currentTime())}
            onMoreSources={() => setPicker(true)}
            episodes={epRef ? { season: epRef.season, current: epRef.episode, list: seasonEpisodes, onPick: playEpisode, fallbackStill: item?.backdrop } : undefined}
          />
          {next && <UpNext key={next.id} controller={controller} next={next} autoplay={autoplayNext} fallbackStill={item?.backdrop} onPlay={() => playEpisode(next)} />}
          <FeedbackFlash controller={controller} />
        </>
      )}
      {connectingShown && phase !== 'error' && (
        <ConnectingView
          backdrop={item?.backdrop}
          logo={detail?.logo}
          title={title}
          line={line}
          provider={phase === 'connecting' || phase === 'playing' ? source?.provider : undefined}
          sourceKey={source ? `${source.id}#${attempt}` : undefined}
          progress={phase === 'connecting' || phase === 'playing' ? progress : phase === 'finding' ? 'idle' : undefined}
          resumeAt={resumeAt}
          leaving={phase === 'playing'}
          onResume={() => answerResume(true)}
          onStartOver={() => answerResume(false)}
          onTryAnother={tryAnother}
          onClose={close}
          onGone={() => setConnectingShown(false)}
        />
      )}
      {phase === 'error' && error && (
        <ErrorView
          message={error.message}
          detail={error.detail}
          canTryAnother
          onTryAnother={tryAnother}
          onRetry={() => {
            if (!source) return setPhase('picking')
            setError(null)
            setPhase(started.current ? 'playing' : 'connecting')
            setConnectingShown(!started.current)
            startAt.current = started.current ? position.current : startAt.current
            setAttempt((n) => n + 1)
          }}
          onClose={close}
        />
      )}
      {showPicker && (
        <SourcePicker
          request={request}
          onPick={(x) => start(x, started.current ? controller.currentTime() : undefined)}
          onClose={() => (phase === 'picking' ? close() : setPicker(false))}
        />
      )}
    </>
  )
}
