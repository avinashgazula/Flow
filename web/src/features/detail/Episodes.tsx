import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ChoiceSelect, Segmented } from '../../components/Choice'
import { FrameCard } from '../../components/Frame'
import { q } from '../../lib/queries'
import { episodeKey, mediaKey, useLibrary } from '../../lib/store/library'
import { spokenDuration, userLocale, useMinuteTick } from '../../lib/time'
import type { Episode, MediaDetail } from '../../lib/tmdb/types'
import { episodePrint, formatDay, realSeasons } from './logic'
import s from './Episodes.module.css'

const label = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`)

/** Seasons as a segmented control (a select when there are many), and the season's episodes as framed
 *  stills: the strip prints the runtime and NEW, and its perforations fill as the episode is watched. */
export function Episodes({ detail, initial, onPlay }: { detail: MediaDetail; initial?: number; onPlay: (e: { season: number; episode: number }) => void }) {
  const seasons = realSeasons(detail.seasons)
  const fallback = detail.lastEpisode?.season ?? seasons[0]?.number ?? 1
  const [season, setSeason] = useState(initial && seasons.some((x) => x.number === initial) ? initial : seasons.length > 1 ? (seasons.find((x) => x.number === 1)?.number ?? fallback) : fallback)
  const { data: episodes, isPending } = useQuery(q.season(detail.id, season))
  const watched = useLibrary((l) => l.watchedEpisodes)
  const progress = useLibrary((l) => l.progress[mediaKey('show', detail.id)])
  const now = useMinuteTick()
  const today = new Date(now).toISOString().slice(0, 10)

  return (
    <section className={s.section} aria-labelledby="episodes-title">
      <div className={s.bar}>
        <h2 id="episodes-title" className={s.title}>
          Episodes
        </h2>
        {seasons.length > 1 && <SeasonPicker seasons={seasons} value={season} onChange={setSeason} />}
      </div>
      <ol className={s.grid}>
        {isPending
          ? Array.from({ length: 6 }, (_, i) => <li key={i} className={s.ghost} aria-hidden />)
          : episodes?.map((e) => {
              const aired = !e.airDate || e.airDate <= today
              const done = !!watched[episodeKey(detail.id, { season: e.season, episode: e.number })]
              const partial = progress?.episode?.season === e.season && progress.episode.episode === e.number && progress.duration > 0 ? progress.position / progress.duration : undefined
              return <EpisodeCard key={e.id} episode={e} aired={aired} watched={done} partial={partial} now={now} onPlay={() => onPlay({ season: e.season, episode: e.number })} />
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

function EpisodeCard({ episode: e, aired, watched, partial, now, onPlay }: { episode: Episode; aired: boolean; watched: boolean; partial?: number; now: number; onPlay: () => void }) {
  const day = formatDay(e.airDate, userLocale)
  const print = episodePrint(e, { aired, watched, now })
  const spoken = [
    `Episode ${e.number}`,
    e.name,
    aired ? (day ? `aired ${day}` : undefined) : `airs ${day ?? 'soon'}`,
    e.runtime ? spokenDuration(e.runtime * 60) : undefined,
    watched ? 'watched' : partial !== undefined ? 'in progress' : undefined,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <FrameCard
      shape="still"
      artKind="still"
      artPath={e.still}
      sizes="(max-width: 720px) 46vw, 260px"
      progress={watched ? 1 : partial}
      print={print}
      fallback={`Episode ${e.number}`}
      title={`${e.number}. ${e.name}`}
      meta={aired ? day : day ? `Airs ${day}` : 'Not yet aired'}
      label={spoken}
      onSelect={onPlay}
      disabled={!aired}
      extra={aired && e.overview ? <span className={s.overview}>{e.overview}</span> : undefined}
    />
  )
}
