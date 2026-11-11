import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Artwork } from '../../../components/Artwork'
import { PlayerIcon } from '../playerIcons'
import { q } from '../../../lib/queries'
import { useSettings } from '../../../lib/store/settings'
import type { CastMember, MediaType, Person } from '../../../lib/tmdb/types'
import { lifeLine } from '../../person/logic'
import { chapterAt, chapterTitle } from '../chapters'
import { usePlayer, type PlayerController } from '../controller'
import { keepFocus } from '../Controls'
import { clock } from '../format'
import { episodeCredits } from './credits'
import { fetchedDialogue } from './dialogue'
import { sceneView, type SceneView } from './faces/scene'
import { useFaceScene } from './faces/useFaceScene'
import { crewOf, inScene, type DialogueCue } from './xray'
import s from './XRayPanel.module.css'

type Tab = 'scene' | 'cast' | 'scenes'

/** How often "In Scene" is worked out again while the film plays with X-Ray open. */
const followMs = 10_000

export interface XRayProps {
  controller: PlayerController
  type: MediaType
  id: number
  season?: number
  episode?: number
}

/** X-Ray, as the apps have it: who the last few minutes of dialogue name (In Scene), everyone in the title (Cast, with the
 *  director or creator under it) and where each scene begins (Scenes, when the file has chapters). A person opens on a
 *  page inside the card, which pauses the film as in the apps; the full page is a link that opens in a tab of its own, so
 *  nothing here ever leaves the player or loses its place. */
export function XRayPanel({ controller, type, id, season, episode }: XRayProps) {
  const root = useRef<HTMLElement>(null)
  const [tab, setTab] = useState<Tab>('cast')
  // Once the viewer picks a tab, X-Ray stops choosing for them.
  const chose = useRef(false)
  const [person, setPerson] = useState<CastMember | null>(null)

  const detail = useQuery(q.detail(type, id))
  const isEpisode = type === 'show' && season !== undefined && episode !== undefined
  const episodeCast = useQuery({ ...episodeCredits(id, season ?? 1, episode ?? 1), enabled: isEpisode })
  // An episode has its own guest stars on top of the regular cast; without them the title's cast stands in.
  const cast = (episodeCast.data?.length ? episodeCast.data : detail.data?.cast) ?? []
  const crew = crewOf(detail.data?.crew ?? [])
  const loading = (detail.isPlaceholderData || detail.isPending || (isEpisode && episodeCast.isPending)) && cast.length === 0

  const chapters = usePlayer(controller, (st) => st.chapters)
  const subtitleId = usePlayer(controller, (st) => st.subtitleId)
  const tabs: { id: Tab; label: string }[] = [
    { id: 'scene', label: 'In Scene' },
    { id: 'cast', label: 'Cast' },
    ...(chapters.length > 0 ? [{ id: 'scenes' as const, label: 'Scenes' }] : []),
  ]

  const named = useScene(controller, `${type}:${id}:${season ?? ''}:${episode ?? ''}`, cast, subtitleId)
  // Who the faces on screen are comes first; the dialogue's guess is what is left when no face was matched.
  const recognise = useSettings((x) => x.recogniseFaces !== false)
  const proxySet = useSettings((x) => x.streamProxy.trim() !== '')
  const faces = useFaceScene(controller, cast, recognise)
  const view = sceneView({ state: faces.state, fromFaces: faces.matched.length, fromDialogue: named.scene.length, reads: named.reads, loaded: !loading })
  const scene = view.basis === 'faces' ? faces.matched : named.scene
  useEffect(() => {
    if (scene.length > 0 && !chose.current) setTab('scene')
  }, [scene.length])

  // Keeps the subtitle line clear of the card (the stylesheet reads where it stands from the player's element).
  useEffect(() => {
    const el = root.current
    const player = controller.root
    if (!el || !player) return
    const measure = () => controller.setXRayClear({ width: el.offsetWidth, room: player.getBoundingClientRect().bottom - el.getBoundingClientRect().top })
    measure()
    if (typeof ResizeObserver === 'undefined') return () => controller.setXRayClear(null)
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    watch.observe(player)
    return () => {
      watch.disconnect()
      controller.setXRayClear(null)
    }
  }, [controller])

  // Escape goes back from a person's page before it closes the card.
  useEffect(() => {
    if (!person) return
    const back = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setPerson(null)
    }
    window.addEventListener('keydown', back, true)
    return () => window.removeEventListener('keydown', back, true)
  }, [person])

  const choose = (next: Tab) => {
    chose.current = true
    setTab(next)
  }
  const openPerson = (member: CastMember) => {
    // Reading about someone shouldn't mean missing the scene they're in.
    controller.pause()
    setPerson(member)
  }
  const tabKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    // From the tab with focus, which isn't always the selected one.
    const focused = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab
    const at = tabs.findIndex((t) => t.id === (focused ?? tab))
    const next = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : undefined
    if (next === undefined) return
    e.preventDefault()
    const target = tabs[(next + tabs.length) % tabs.length]!
    choose(target.id)
    e.currentTarget.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus()
  }
  const close = () => controller.setPanel(null)

  return (
    <section ref={root} className={s.panel} aria-label="X-Ray" onPointerEnter={() => (controller.hovering = true)} onPointerLeave={() => (controller.hovering = false)}>
      {person ? (
        <>
          <div className={s.head}>
            <button className={s.back} onClick={() => setPerson(null)} onMouseDown={keepFocus}>
              <PlayerIcon name="chevronLeft" size={20} />
              X-Ray
            </button>
            <CloseButton onClick={close} />
          </div>
          <PersonPage key={person.id} member={person} />
        </>
      ) : (
        <>
          <div className={s.head}>
            <h2 className={s.title}>X-Ray</h2>
            <CloseButton onClick={close} />
          </div>
          <div className={s.tabs} role="tablist" aria-label="X-Ray" onKeyDown={tabKeys}>
            {tabs.map((t) => (
              <button key={t.id} className={s.tab} role="tab" id={`xray-tab-${t.id}`} data-tab={t.id} aria-selected={tab === t.id} aria-controls="xray-body" tabIndex={tab === t.id ? 0 : -1} onClick={() => choose(t.id)} onMouseDown={keepFocus}>
                {t.label}
              </button>
            ))}
          </div>
          <div className={s.body} id="xray-body" role="tabpanel" aria-labelledby={`xray-tab-${tab}`}>
            {tab === 'scene' && <InScene scene={scene} view={view} onOpen={openPerson} onProxy={faces.state.status === 'unavailable' && faces.state.reason === 'unreadable' && proxySet && controller.canReadThroughProxy ? () => controller.restartThroughProxy?.() : undefined} />}
            {tab === 'cast' && <Cast cast={cast} crew={crew} loading={loading} failed={detail.isError && cast.length === 0} onOpen={openPerson} />}
            {tab === 'scenes' && <Scenes controller={controller} />}
          </div>
        </>
      )}
    </section>
  )
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button className={s.iconButton} aria-label="Close X-Ray" title="Close (Esc)" onClick={onClick} onMouseDown={keepFocus}>
      <PlayerIcon name="close" size={20} />
    </button>
  )
}

/** Who the dialogue around the playhead names: from the subtitles on screen, else from a file fetched for X-Ray (or the
 *  sample lines). Worked out when the card opens, when the viewer seeks or changes subtitles, and every ten seconds
 *  while the film plays. `reads` is false until there is any dialogue to read, and stays false when there never is. */
function useScene(controller: PlayerController, key: string, cast: CastMember[], subtitleId: string | null): { scene: CastMember[]; reads: boolean | undefined } {
  const [scene, setScene] = useState<CastMember[]>([])
  const [reads, setReads] = useState<boolean | undefined>(undefined)
  // A file fetched for X-Ray: undefined while it's being asked for, null when there is none.
  const [fetched, setFetched] = useState<DialogueCue[] | null | undefined>(undefined)
  const showing = !!controller.subtitleCues()
  const castKey = cast.map((m) => m.id).join(',')

  useEffect(() => {
    if (showing || cast.length === 0) return
    let current = true
    void fetchedDialogue(controller, key, cast).then((cues) => current && setFetched(cues))
    return () => {
      current = false
    }
    // The cast only matters for the sample lines, which are made from it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, key, showing, cast.length > 0])

  useEffect(() => {
    const video = controller.video
    if (!video || cast.length === 0) return
    const update = () => {
      const shown = controller.subtitleCues()
      const cues = shown ?? fetched
      setReads(cues ? true : fetched === undefined ? undefined : false)
      if (!cues) return setScene((now) => (now.length ? [] : now))
      const found = inScene(cues, video.currentTime, cast, shown ? controller.get().subtitleDelay : 0)
      setScene((now) => (now.length === found.length && now.every((m, i) => m.id === found[i]!.id) ? now : found))
    }
    update()
    const timer = setInterval(update, followMs)
    video.addEventListener('seeked', update)
    return () => {
      clearInterval(timer)
      video.removeEventListener('seeked', update)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, castKey, fetched, subtitleId, showing])

  return { scene, reads }
}

function InScene({ scene, view, onOpen, onProxy }: { scene: CastMember[]; view: SceneView; onOpen: (m: CastMember) => void; onProxy?: () => void }) {
  return (
    <>
      {scene.map((m) => (
        <PersonRow key={m.id} member={m} onOpen={onOpen} />
      ))}
      <p className={s.note} data-after={scene.length > 0 ? '' : undefined} role={view.busy ? 'status' : undefined}>
        {view.note}
      </p>
      {onProxy && (
        <button className="btn btn-secondary btn-compact" onClick={onProxy} onMouseDown={keepFocus}>
          Play Through Your Stream Proxy
        </button>
      )}
    </>
  )
}

function Cast({ cast, crew, loading, failed, onOpen }: { cast: CastMember[]; crew: CastMember[]; loading: boolean; failed: boolean; onOpen: (m: CastMember) => void }) {
  return (
    <>
      {cast.length === 0 && <p className={s.note}>{failed ? 'Couldn’t load the cast. Check your connection, then close X-Ray and open it again.' : loading ? 'Loading…' : 'No cast listed for this title.'}</p>}
      {cast.map((m) => (
        <PersonRow key={`${m.id}:${m.role}`} member={m} onOpen={onOpen} />
      ))}
      {crew.length > 0 && <h3 className={s.heading}>Crew</h3>}
      {crew.map((m) => (
        <PersonRow key={`${m.id}:${m.role}`} member={m} onOpen={onOpen} />
      ))}
    </>
  )
}

/** Where each scene begins: a choice goes there, and the one playing is checked. */
function Scenes({ controller }: { controller: PlayerController }) {
  const chapters = usePlayer(controller, (st) => st.chapters)
  const [playing, setPlaying] = useState(() => chapterAt(chapters, controller.currentTime()))
  useEffect(() => {
    const video = controller.video
    if (!video) return
    const tick = () => setPlaying(chapterAt(chapters, video.currentTime))
    tick()
    video.addEventListener('timeupdate', tick)
    video.addEventListener('seeked', tick)
    return () => {
      video.removeEventListener('timeupdate', tick)
      video.removeEventListener('seeked', tick)
    }
  }, [controller, chapters])
  return (
    <>
      {chapters.map((c, i) => (
        <button key={`${c.start}:${i}`} className={s.scene} aria-current={playing === i ? 'true' : undefined} onClick={() => controller.seekTo(c.start)} onMouseDown={keepFocus}>
          <span className={s.sceneTime}>{clock(c.start)}</span>
          <span className={s.sceneName}>{chapterTitle(c, i)}</span>
          {playing === i && <PlayerIcon name="check" size={18} className={s.check} />}
        </button>
      ))}
    </>
  )
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')

function PersonRow({ member, onOpen }: { member: CastMember; onOpen: (m: CastMember) => void }) {
  return (
    <button className={s.row} onClick={() => onOpen(member)} onMouseDown={keepFocus} aria-label={member.role ? `${member.name} as ${member.role}` : member.name}>
      <Artwork path={member.profile} kind="profile" alt="" sizes="44px" className={s.face} fallback={initials(member.name)} />
      <span className={s.who}>
        <span className={s.name}>{member.name}</span>
        {member.role && <span className={s.role}>{member.role}</span>}
      </span>
    </button>
  )
}

/** Who someone is, without leaving the film: photo, character, age, a short biography and what else they're in. */
function PersonPage({ member }: { member: CastMember }) {
  const { data: person, isError, refetch, isRefetching } = useQuery(q.person(member.id))
  const [full, setFull] = useState(false)
  return (
    <div className={s.body}>
      <div className={s.person}>
        <div className={s.personTop}>
          <Artwork path={member.profile ?? person?.profile} kind="profile" alt="" sizes="96px" className={s.portrait} fallback={initials(member.name)} />
          <div className={s.personWho}>
            <h3 className={s.personName}>{member.name}</h3>
            {member.role && <p className={s.personRole}>{member.role}</p>}
            {person && lifeLine(person) && <p className={s.personFacts}>{lifeLine(person)}</p>}
          </div>
        </div>
        {person ? <Details person={person} full={full} onMore={() => setFull(!full)} /> : isError ? (
          <>
            <p className={s.error}>Couldn’t load this person. Check your connection, then try again.</p>
            <div className={s.foot}>
              <button className="btn btn-secondary btn-compact" onClick={() => void refetch()} disabled={isRefetching} onMouseDown={keepFocus}>
                Try Again
              </button>
            </div>
          </>
        ) : (
          <div className={s.ghosts} aria-hidden="true">
            <span className={s.ghost} />
            <span className={s.ghost} />
            <span className={s.ghost} />
          </div>
        )}
      </div>
    </div>
  )
}

function Details({ person, full, onMore }: { person: Person; full: boolean; onMore: () => void }) {
  const credits = person.credits.slice(0, 14)
  return (
    <>
      {person.biography && (
        <>
          <p className={s.bio} data-folded={full ? undefined : ''}>
            {person.biography}
          </p>
          {person.biography.length > 280 && (
            <button className={s.more} aria-expanded={full} onClick={onMore} onMouseDown={keepFocus}>
              {full ? 'Show Less' : 'Read More'}
            </button>
          )}
        </>
      )}
      {credits.length > 0 && (
        <div>
          <h3 className={s.alsoHead}>Also In</h3>
          <ul className={s.also}>
            {credits.map((m) => (
              <li key={`${m.type}${m.id}`}>
                {/* A tab of its own: a title's page is somewhere else, and the film here keeps its place. */}
                <Link to="/title/$type/$id" params={{ type: m.type, id: m.id }} target="_blank" rel="noopener noreferrer" title={`${m.title}, in a new tab`} aria-label={`${m.title}, in a new tab`}>
                  <Artwork path={m.poster} kind="poster" alt="" sizes="76px" className={s.poster} fallback={m.title} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={s.foot}>
        <Link to="/person/$id" params={{ id: person.id }} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-compact">
          Open Full Page
          <PlayerIcon name="external" size={16} />
        </Link>
      </div>
    </>
  )
}
