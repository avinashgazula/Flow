import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ChoiceSelect, Segmented } from '../../components/Choice'
import ContextMenu, { type MenuItem } from '../../components/ContextMenu'
import { Artwork } from '../../components/Artwork'
import { Icon } from '../../components/Icon'
import { q } from '../../lib/queries'
import { mediaKey, useLibrary } from '../../lib/store/library'
import { titleLibrary } from '../../lib/store/titleLibrary'
import { useSettings } from '../../lib/store/settings'
import { formatRuntime, spokenDuration, userLocale, useMinuteTick } from '../../lib/time'
import type { Episode, MediaDetail } from '../../lib/tmdb/types'
import { isAired, isWatched } from '../../lib/watching'
import { cardOf, formatDay, isNew, realSeasons, todayOf } from './logic'
import { episodesUpTo } from './upToHere'
import s from './Episodes.module.css'

const label = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`)

/** Seasons as a bordered segmented row (a select when there are many), and the season's episodes as numbered rows:
 *  a red condensed numeral, the still, the title, a serif synopsis, a mono line (air date, runtime, NEW) and a thin red
 *  bar for the progress. Each aired episode has a square to mark it watched or not, and the season has Watch Season.
 *  With Episode Spoilers off, an aired episode not yet watched keeps its still blurred and its synopsis hidden. */
export function Episodes({ detail, initial, onPlay }: { detail: MediaDetail; initial?: number; onPlay: (e: { season: number; episode: number }) => void }) {
  const specials = useSettings((x) => x.showSpecialsSeason)
  const spoilers = useSettings((x) => x.showEpisodeSpoilers)
  const seasons = realSeasons(detail.seasons, specials)
  const fallback = detail.lastEpisode?.season ?? seasons[0]?.number ?? 1
  const [season, setSeason] = useState(initial && seasons.some((x) => x.number === initial) ? initial : seasons.length > 1 ? (seasons.find((x) => x.number === 1)?.number ?? fallback) : fallback)
  // Specials turned off while they were the season in view.
  const shown = seasons.some((x) => x.number === season) ? season : (seasons[0]?.number ?? season)
  const { data: episodes, isPending } = useQuery(q.season(detail.id, shown))
  const watchedEpisodes = useLibrary((l) => l.watchedEpisodes)
  const rewatches = useLibrary((l) => l.rewatches)
  const lib = { watchedEpisodes, rewatches }
  const progress = useLibrary((l) => l.progress[mediaKey('show', detail.id)])
  const now = useMinuteTick()
  const today = todayOf(now)
  const item = cardOf(detail)
  // What Watch Season acts on: the aired episodes of this season. All of them watched makes it Unwatch Season.
  const airedList = (episodes ?? []).filter((e) => isAired(e.airDate, today)).map((e) => ({ season: e.season, episode: e.number }))
  const seasonDone = airedList.length > 0 && airedList.every((e) => isWatched(lib, detail.id, e))

  return (
    <section className={s.section} aria-labelledby="episodes-title">
      <div className={s.bar}>
        <h2 id="episodes-title" className="section-label">
          Episodes
        </h2>
        {airedList.length > 0 && (
          <button type="button" className={`btn btn-quiet btn-compact ${s.season}`} onClick={() => (seasonDone ? titleLibrary.markUnwatched(item, airedList) : titleLibrary.markEpisodesWatched(item, airedList))}>
            {seasonDone ? 'Unwatch Season' : 'Watch Season'}
          </button>
        )}
      </div>
      {seasons.length > 1 && (
        <div className={s.picker}>
          <SeasonPicker seasons={seasons} value={shown} onChange={setSeason} />
        </div>
      )}
      <ol className={s.list}>
        {isPending
          ? Array.from({ length: 6 }, (_, i) => <li key={i} className={s.ghost} aria-hidden />)
          : episodes?.map((e) => {
              const aired = !e.airDate || e.airDate <= today
              const ref = { season: e.season, episode: e.number }
              const done = isWatched(lib, detail.id, ref)
              const partial = progress?.episode?.season === e.season && progress.episode.episode === e.number && progress.duration > 0 ? progress.position / progress.duration : undefined
              const veiled = !spoilers && isAired(e.airDate, today) && !done
              return <EpisodeCard key={e.id} episode={e} aired={aired} watched={done} partial={partial} veiled={veiled} now={now} onPlay={() => onPlay(ref)} onToggle={() => (done ? titleLibrary.markUnwatched(item, [ref]) : titleLibrary.markEpisodesWatched(item, [ref]))} onUpToHere={() => titleLibrary.markEpisodesWatched(item, episodesUpTo(episodes, e))} />
            })}
      </ol>
      {!isPending && episodes?.length === 0 && <p className={s.empty}>TMDB doesn’t list episodes for this season yet.</p>}
    </section>
  )
}

function SeasonPicker({ seasons, value, onChange }: { seasons: { number: number }[]; value: number; onChange: (n: number) => void }) {
  const options = seasons.map((x) => ({ id: x.number, label: label(x.number) }))
  return seasons.length > 4 ? <ChoiceSelect options={options} value={value} onChange={onChange} label="Season" /> : <Segmented options={options} value={value} onChange={onChange} label="Season" />
}

function EpisodeCard({
  episode: e,
  aired,
  watched,
  partial,
  veiled,
  now,
  onPlay,
  onToggle,
  onUpToHere,
}: {
  episode: Episode
  aired: boolean
  watched: boolean
  partial?: number
  veiled: boolean
  now: number
  onPlay: () => void
  onToggle: () => void
  onUpToHere: () => void
}) {
  const day = formatDay(e.airDate, userLocale)
  const spoken = [
    `Episode ${e.number}`,
    e.name,
    aired ? (day ? `aired ${day}` : undefined) : `airs ${day ?? 'soon'}`,
    e.runtime ? spokenDuration(e.runtime * 60) : undefined,
    watched ? 'watched' : partial !== undefined ? 'in progress' : undefined,
  ]
    .filter(Boolean)
    .join(', ')
  // The apps' episode menu: play it, mark it either way, or mark it and every episode before it in the season.
  const items: MenuItem[] = [
    { id: 'play', label: 'Play', icon: 'play', onSelect: onPlay },
    { id: 'toggle', label: watched ? 'Mark as Unwatched' : 'Mark as Watched', icon: watched ? 'close' : 'check', onSelect: onToggle },
    { id: 'upTo', label: 'Mark Watched Up to Here', icon: 'check', onSelect: onUpToHere },
  ]
  const fact = [aired ? day : day ? `Airs ${day}` : 'Not yet aired', aired && e.runtime ? formatRuntime(e.runtime * 60) : undefined].filter(Boolean).join(' · ')
  const fresh = aired && !watched && isNew(e.airDate, now)
  const fraction = watched ? 1 : partial
  return (
    <li className={s.item} data-dimmed={aired ? undefined : ''}>
      <button type="button" className={`row ${s.open}`} onClick={onPlay} disabled={!aired}>
        <span className="sr-only">{spoken}</span>
        <span className={s.num} aria-hidden="true">
          {String(e.number).padStart(2, '0')}
        </span>
        <span className={s.thumb} data-veiled={veiled ? '' : undefined} aria-hidden="true">
          <Artwork path={e.still} kind="still" alt="" sizes="(max-width: 720px) 112px, 176px" fallback={`Episode ${e.number}`} className={s.still} />
        </span>
        <span className={s.text} aria-hidden="true">
          <span className={s.name}>{e.name}</span>
          <span className={s.fact}>
            {fresh && <b className={s.fresh}>New · </b>}
            {fact}
          </span>
          {aired && e.overview && !veiled && <span className={s.overview}>{e.overview}</span>}
          {fraction !== undefined && fraction > 0 && (
            <span className={s.progress}>
              <i style={{ width: `${Math.min(1, fraction) * 100}%` }} />
            </span>
          )}
        </span>
      </button>
      {aired && <ContextMenu label={`More options for episode ${e.number}, ${e.name}`} items={items} className={s.more} />}
      {aired && (
        <button type="button" className={s.mark} data-on={watched ? '' : undefined} onClick={onToggle} aria-label={`${watched ? 'Mark as unwatched' : 'Mark as watched'}: episode ${e.number}, ${e.name}`}>
          {/* An empty square until it is watched, then the check: the state is the shape, not only the colour. */}
          {watched ? <Icon name="check" size={16} strokeWidth={2.8} /> : <span className={s.box} aria-hidden="true" />}
        </button>
      )}
    </li>
  )
}
