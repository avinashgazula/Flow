import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { q } from '../../lib/queries'
import { queryClient } from '../../lib/queryClient'
import { browserCapabilities, findSources, rememberSource, type PlaybackRequest, type Source } from '../../lib/sources'
import { lastSourceStore, matchLastSource } from '../../lib/sources/lastSource'
import { hasPlayableAudio } from '../../lib/sources/rank'
import { library, libraryStore, mediaKey, type EpisodeRef } from '../../lib/store/library'
import { settingsStore, useSettings } from '../../lib/store/settings'
import { filmCreditsScenes } from '../../lib/tmdb/creditsScenes'
import { imageURL } from '../../lib/tmdb/images'
import type { Episode, MediaDetail, MediaItem, MediaType } from '../../lib/tmdb/types'
import { SourcePicker } from '../sources/SourcePicker'
import { ConnectingView, ErrorView } from './ConnectingView'
import { Controls } from './Controls'
import { PlayerController, usePlayer } from './controller'
import { attachSource, warmEngines, type Engine } from './engine'
import { mediaErrorMessage, PlaybackError } from './errors'
import { episodeLine } from './format'
import { NoSoundNotice } from './NoSound'
import { PlaybackInfo } from './PlaybackInfo'
import { FilmExtras } from './FilmExtras'
import { Buffering, FeedbackFlash, Notes, SubtitleOverlay, TapLayer } from './Overlays'
import { demoSegments, segmentsFromChapters, type SkipSegment } from './segments'
import { lookupSegments } from './segmentSources'
import { lastSources, matchSource, nextEpisode, nextSource, resolutionHeight, resumePosition } from './session'
import { Skip } from './Skip'
import { StillWatchingPrompt } from './StillWatchingPrompt'
import type { StillWatching } from './stillWatching'
import { StruggleNotice } from './Struggle'
import { UpNext } from './UpNext'
import { useTraktScrobble } from './useTraktScrobble'
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
  originalLanguage: d.originalLanguage,
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
  /** Counts episodes played one after another with nobody there. It outlives each episode's screen, so Player holds it. */
  binge: StillWatching
}

/** One title or episode, from finding a source to the last frame: the source picker or the
 *  remembered source, the connecting screen, the engine, the controls, progress and Up Next. */
export function PlayerScreen({ type, id, season, episode, sourceId, root, binge }: PlayerScreenProps) {
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
  // A show is one title for remembered audio and subtitle picks, and its original language is what
  // "Original Language" in Settings means. A layout effect, so it's set before any engine starts.
  const originalLanguage = item?.originalLanguage
  useLayoutEffect(() => {
    controller.setContext(key, originalLanguage)
  }, [controller, key, originalLanguage])
  // The subtitle services are asked about this title or episode by its ids, and Anime Audio needs its genres.
  const imdbId = detail?.imdb
  const genres = item?.genres
  const epSeason = epRef?.season
  const epNumber = epRef?.episode
  useLayoutEffect(() => {
    controller.setTitle({ type: isShow ? 'show' : 'movie', tmdbId: id, imdbId, season: epSeason, episode: epNumber, genres: genres ?? [], original: originalLanguage })
  }, [controller, isShow, id, imdbId, epSeason, epNumber, genres, originalLanguage])
  const fit = usePlayer(controller, (st) => st.fit)
  const infoOpen = usePlayer(controller, (st) => st.info)
  const video = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<Phase>('finding')
  const [source, setSource] = useState<Source | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [sources, setSources] = useState<Source[]>([])
  const [error, setError] = useState<PlaybackError | null>(null)
  const [progress, setProgress] = useState(0)
  // A film's scene during or after its credits (TMDB keywords): the note at the credits, and credits that hide one
  // are never skipped by themselves. Asked for once the film is playing, and kept for good.
  const alertScenes = useSettings((st) => st.postCreditsAlert !== false) && type === 'movie'
  const { data: scenesFound } = useQuery({ queryKey: ['creditsScenes', id], queryFn: () => filmCreditsScenes(id), enabled: alertScenes && phase === 'playing', staleTime: Infinity, retry: false })
  const creditsScenes = scenesFound ?? undefined

  const [resumeAt, setResumeAt] = useState<number | null>(null)
  const [picker, setPicker] = useState(false)
  const [connectingShown, setConnectingShown] = useState(true)
  // The file is playing through the browser's own player because its host blocks web pages.
  const [blocked, setBlocked] = useState(false)
  /** The file's audio was being converted for this browser and that failed: the picture plays without sound. */
  const [convertFailed, setConvertFailed] = useState(false)
  /** The No Sound notice is on screen, so the struggling notice waits. */
  const [noSoundUp, setNoSoundUp] = useState(false)
  /** What a server, IntroDB or PublicMetaDB (or the sample data) say can be skipped, and what the file's chapter
   *  names say; the first wins, as in the apps. */
  const [looked, setLooked] = useState<SkipSegment[]>([])
  const [chapterSegments, setChapterSegments] = useState<SkipSegment[]>([])
  /** "Are You Still Watching?" is up, so the next episode waits for an answer. */
  const [asking, setAsking] = useState(false)
  const askingRef = useRef(false)
  /** The next episode has been asked for: Up Next's countdown and the stream ending can both say so. */
  const advanced = useRef(false)

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

  /** Goes on to the next episode. `automatic` is for the countdown running out, the credits being skipped by
   *  themselves or the stream ending: after enough of those in a row it asks before going on. */
  const advance = (automatic: boolean) => {
    const target = latest.current.next
    if (!target || askingRef.current || advanced.current) return
    // The sleep timer's "End of Episode or Movie": this one finishes and the player closes (see onSleepEnd).
    if (automatic && controller.sleepHold) return
    if (automatic) {
      if (binge.shouldAsk(settingsStore.get().stillWatchingAfterEpisodes)) {
        askingRef.current = true
        setAsking(true)
        controller.pause()
        return
      }
      binge.noteAutomaticAdvance()
    }
    advanced.current = true
    playEpisode(target)
  }

  const keepWatching = () => {
    const target = latest.current.next
    binge.noteInteraction()
    askingRef.current = false
    setAsking(false)
    if (!target) return
    advanced.current = true
    playEpisode(target)
  }

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

  // The sleep timer's "End of Episode or Movie": the stream has ended, so the player closes as the apps' does.
  useEffect(() => {
    return controller.onSleepEnd(close)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tryAnother = () => {
    const { sources: list, source: cur } = latest.current
    const keep = started.current ? controller.currentTime() : startAt.current
    const candidate = nextSource(list, cur ?? undefined, tried.current)
    if (candidate) start(candidate, keep)
    else setPicker(true)
  }

  // From a file that plays without sound: the best source left that this browser can decode, and
  // none that is marked unsupported, since another silent file would only be the same problem. The
  // picker opens when there isn't one.
  const tryWithSound = () => {
    const { sources: list, source: cur } = latest.current
    const caps = browserCapabilities()
    const candidate = nextSource(list, cur ?? undefined, tried.current, { playableOnly: true, best: true, prefer: (x) => hasPlayableAudio(x.audio, caps) })
    if (candidate) start(candidate, controller.currentTime())
    else setPicker(true)
  }

  // The best source of a lower resolution that plays, for a picture that's too much for the
  // connection or the device. The current source's resolution if it says one, else the picture's.
  const findLower = () => {
    const { sources: list, source: cur } = latest.current
    const height = resolutionHeight(cur?.resolution) ?? (controller.video?.videoHeight || undefined)
    if (!height) return undefined
    const caps = browserCapabilities()
    return nextSource(list, cur ?? undefined, tried.current, { playableOnly: true, best: true, below: height, prefer: (x) => hasPlayableAudio(x.audio, caps) })
  }

  // From a picture that stutters with no lower resolution to step down to: the next source that plays,
  // else the picker. Never one marked unsupported: that would only trade a stutter for a silence.
  const tryPlayable = () => {
    const { sources: list, source: cur } = latest.current
    const candidate = nextSource(list, cur ?? undefined, tried.current, { playableOnly: true })
    if (candidate) start(candidate, controller.currentTime())
    else setPicker(true)
  }

  const fail = (err: PlaybackError) => {
    if (!started.current) {
      // Nothing has played yet: move on to the next source quietly, as the apps do. Sources marked
      // unsupported are left for the viewer to choose: they'd only fail the same way, or play silent.
      const candidate = nextSource(latest.current.sources, latest.current.source ?? undefined, tried.current, { playableOnly: true })
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
    // Remember last source is a setting: off, Play always starts from the ranking (or the picker).
    const remember = settingsStore.get().rememberLastSource
    const remembered = remember ? lastSources.get(key) : undefined
    // What the title page's label said Play would open when nothing is in the player's own memory: the
    // picker's record of the title, which also seeds sample data.
    const recorded = remember ? lastSourceStore.get().byTitle[key] : undefined
    const sameEpisode = !epRef || (remembered?.episode?.season === epRef.season && remembered.episode.episode === epRef.episode)
    const direct = sourceId ? (remembered?.source.id === sourceId ? remembered.source : undefined) : sameEpisode ? remembered?.source : undefined
    if (direct) {
      start(direct)
      return () => abort.abort()
    }
    void (async () => {
      const demo = settingsStore.get().demo
      if (sourceId || remembered || recorded || demo) {
        // Add-ons look titles up by IMDb id, which only the full detail carries.
        const full = await queryClient.ensureQueryData(q.detail(type, id)).catch(() => undefined)
        if (abort.signal.aborted) return
        const list = full ? await findSources(requestFor(full, type, epRef), { signal: abort.signal }).catch(() => []) : []
        if (abort.signal.aborted) return
        setSources(list)
        const found = sourceId ? list.find((x) => x.id === sourceId) : (remembered ? matchSource(remembered.source, list) : undefined) ?? matchLastSource(recorded, list)
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
      if (src) {
        lastSources.remember(key, src, ep)
        // The title page, Home's strips and the picker read the other record: keep the two the same.
        rememberSource({ type, tmdbId: id }, src)
      }
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
    // Someone pausing is someone there; the stream ending on its own, or the question being asked, isn't.
    const paused = () => {
      if (started.current && !askingRef.current) binge.notePause(el.currentTime, controller.duration())
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
      fail(new PlaybackError(controller.engine?.failureMessage ?? mediaErrorMessage(code, latest.current.source ?? undefined), `MediaError ${code}${el.error?.message ? `: ${el.error.message}` : ''}`))
    }
    const events: [string, EventListener][] = [
      ['loadstart', loadstart],
      ['loadedmetadata', metadata],
      ['loadeddata', loadeddata],
      ['canplay', canplay],
      ['playing', playing],
      ['timeupdate', timeupdate],
      ['pause', paused],
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
    setBlocked(false)
    setConvertFailed(false)
    const onAudioFailed = () => {
      if (abort.signal.aborted) return
      controller.refreshTracks()
      setConvertFailed(true)
    }
    const onFatal = (err: PlaybackError) => !abort.signal.aborted && fail(err)
    attachSource(el, source, { startAt: startAt.current, signal: abort.signal, onTracks: controller.refreshTracks, onFatal, onAudioFailed })
      .then((e) => {
        if (abort.signal.aborted) return e.destroy()
        engine = e
        controller.setEngine(e, source)
        setBlocked(e.fallback === 'blocked')
        // Chapters named "Opening" or "Ending" stand in when no server or service knows this episode.
        setChapterSegments(segmentsFromChapters(e.chapters?.() ?? [], e.duration()))
      })
      .catch((err: Error) => {
        if (abort.signal.aborted || err.name === 'AbortError') return
        onFatal(err instanceof PlaybackError ? err : new PlaybackError(err.message || 'This source couldn’t be opened. Pick another source.'))
      })
    return () => {
      abort.abort()
      engine?.destroy()
      controller.setEngine(null, null)
      setChapterSegments([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, attempt])

  // What can be skipped: the server the file plays from, then IntroDB and PublicMetaDB if they have keys, then
  // the file's chapters. Asked as soon as the source is known, so an intro at the very start has its button.
  // Sample data has its own, set once the length is known. No answer means no button.
  const ready = !!detail && !isPlaceholderData
  const playing = phase === 'playing'
  useEffect(() => {
    setLooked((now) => (now.length ? [] : now))
    if (!source || !detail || !ready || source.origin === 'demo') return
    const abort = new AbortController()
    const { servers, introDBKey, publicMetaDBKey } = settingsStore.get()
    void lookupSegments({ source, request: requestFor(detail, type, epRef), servers, introDBKey, publicMetaDBKey, signal: abort.signal }).then((found) => {
      if (!abort.signal.aborted) setLooked(found)
    })
    return () => abort.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, ready])
  useEffect(() => {
    if (source?.origin === 'demo' && playing) setLooked(demoSegments(controller.duration()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, playing])
  useEffect(() => {
    controller.setSegments(looked.length ? looked : chapterSegments)
  }, [controller, looked, chapterSegments])

  // Any sign of someone there starts the count of unattended episodes again.
  useEffect(() => {
    const container = root.current
    const there = () => binge.noteInteraction()
    container?.addEventListener('pointerdown', there)
    window.addEventListener('keydown', there)
    return () => {
      container?.removeEventListener('pointerdown', there)
      window.removeEventListener('keydown', there)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Trakt, for a viewer signed in to it. Declared after the progress effect so a close saves progress first.
  useTraktScrobble(video, phase === 'playing', () => {
    const { item: it, epRef: ep } = latest.current
    return started.current && it ? { item: it, episode: ep, position: position.current, duration: length.current } : null
  })

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
    // The media keys count as someone being there.
    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play', () => controller.play()],
      ['pause', () => controller.pause()],
      ['seekbackward', (d) => (binge.noteInteraction(), controller.seekBy(-(d.seekOffset ?? 10)))],
      ['seekforward', (d) => (binge.noteInteraction(), controller.seekBy(d.seekOffset ?? 10))],
      ['seekto', (d) => d.seekTime !== undefined && (binge.noteInteraction(), controller.seekTo(d.seekTime))],
      ['nexttrack', next ? () => (binge.noteInteraction(), playEpisode(next)) : null],
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
      if (askingRef.current) {
        // "Are You Still Watching?" takes the keys: its buttons answer, and Escape stops.
        if (key === 'Escape') {
          e.preventDefault()
          close()
        }
        return
      }
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
          c.peek(c.currentTime())
          break
        case 'ArrowRight':
        case 'l':
          c.seekBy(10)
          c.flash('forward10')
          c.poke()
          c.peek(c.currentTime())
          break
        case 'ArrowUp':
        case 'ArrowDown': {
          const level = Math.round(((el.muted ? 0 : el.volume) + (key === 'ArrowUp' ? 0.1 : -0.1)) * 100) / 100
          c.setVolume(level)
          const v = Math.round(Math.min(1, Math.max(0, level)) * 100)
          c.flash(v === 0 ? 'mute' : 'volume', `${v}%`)
          break
        }
        case 's':
        case 'Enter':
          // Skip what the button on screen skips (or play the next episode, when its card is up). On a focused
          // control, Enter presses that control instead; with nothing to skip the key is left alone.
          if (key === 'Enter' && target.closest('button, a, summary')) return
          if (!c.skipNow()) return
          break
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
        case 'w':
          c.replayWithSubtitles()
          break
        case 'x':
          // Hold for 2×: it lasts as long as the key is down (the keyup below).
          if (!e.repeat) c.holdFast(true)
          break
        case 'i':
          c.toggleInfo()
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
              c.peek(c.currentTime())
            }
            break
          }
          return
      }
      e.preventDefault()
    }
    const letGo = (e: KeyboardEvent) => e.key.toLowerCase() === 'x' && controller.holdFast(false)
    const letGoAll = () => controller.holdFast(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', letGo)
    window.addEventListener('blur', letGoAll)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', letGo)
      window.removeEventListener('blur', letGoAll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker])

  // A suggested film's page; this one's place is saved first.
  const openSuggestion = (film: MediaItem) => {
    save()
    void navigate({ to: '/title/$type/$id', params: { type: film.type, id: film.id }, replace: true })
  }

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
          <Notes controller={controller} />
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
          {(blocked || convertFailed) && (
            <NoSoundNotice key={`${source?.id}#${attempt}`} controller={controller} source={source} conversionFailed={convertFailed} onSilent={() => lastSources.forget(key)} onTryAnother={tryWithSound} onShowing={setNoSoundUp} />
          )}
          <StruggleNotice
            key={`${source?.id}#${attempt}`}
            controller={controller}
            titleKey={key}
            sources={sources}
            findLower={findLower}
            suppressed={noSoundUp}
            onSwitch={(x) => start(x, controller.currentTime())}
            onTryAnother={tryPlayable}
          />
          {infoOpen && <PlaybackInfo controller={controller} source={source} />}
          <Skip controller={controller} hasNext={!!next} onNext={advance} hidesCredits={!!creditsScenes} />
          {type === 'movie' && <FilmExtras controller={controller} film={ready ? detail : undefined} scenes={creditsScenes} short={source?.origin === 'demo'} onOpen={openSuggestion} onClose={close} />}
          {next && !asking && <UpNext key={next.id} controller={controller} next={next} autoplay={autoplayNext} fallbackStill={item?.backdrop} onPlay={advance} />}
          <FeedbackFlash controller={controller} />
          {asking && next && <StillWatchingPrompt next={next} onKeepWatching={keepWatching} onStop={close} />}
        </>
      )}
      {connectingShown && phase !== 'error' && (
        <ConnectingView
          backdrop={item?.backdrop}
          logo={detail?.logo}
          title={title}
          line={line}
          print={
            phase === 'connecting' || phase === 'playing'
              ? [source?.provider ? `From ${source.provider}` : '', source?.resolution ?? '', ...(source?.hdr ?? [])].filter(Boolean)
              : [phase === 'finding' ? 'Finding a source' : 'Choose a source']
          }
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
