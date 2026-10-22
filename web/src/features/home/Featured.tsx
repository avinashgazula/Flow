import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Artwork } from '../../components/Artwork'
import { markZoomSource } from '../../components/Cards'
import { prefetchDetail, q } from '../../lib/queries'
import { lastSourceStore } from '../../lib/sources/lastSource'
import { useStore } from '../../lib/store/createStore'
import { mediaKey, type Progress } from '../../lib/store/library'
import { clockParts, endTime, formatClock, formatDuration, formatLeft, userLocale, useMinuteTick } from '../../lib/time'
import type { MediaItem } from '../../lib/tmdb/types'
import { episodeLine, pickMeta, ratingText, secondsLeft, versionLine } from './logic'
import s from './Featured.module.css'

/** What the lead frame shows: a title, and where the viewer left off when they have. */
export interface Preview {
  item: MediaItem
  progress?: Progress
}

/** How wide the lead still renders, for `srcset`. index.html preloads the same still with the same
 *  string, so the browser reuses the download; keep the two in step. */
export const leadSizes = '(min-width: 1100px) 560px, (min-width: 721px) 340px, calc(100vw - 32px)'

/** The lead listing: one framed 16:9 still, the timetable line beneath it (start to end, minutes left),
 *  the title and plain facts, the version that will play, the one pink action and a secondary
 *  "Details". On phones it's the first thing on Home; on desktop it's the sticky right-hand frame
 *  (`frame`) that follows the listing under the pointer or the keyboard, and adds the overview. */
export function Featured({ preview, frame, priority }: { preview: Preview; frame?: boolean; priority?: boolean }) {
  const { item, progress } = preview
  const now = useMinuteTick()
  const key = mediaKey(item.type, item.id)
  const last = useStore(lastSourceStore, (st) => st.byTitle[key])
  // A pick's runtime comes from its detail (already prefetched when the pointer rests on it).
  const detail = useQuery({ ...q.detail(item.type, item.id), enabled: !progress })
  const seconds = progress ? secondsLeft(progress) : detail.data?.runtime ? detail.data.runtime * 60 : undefined

  const end = seconds === undefined ? undefined : endTime(now, seconds)
  const facts = progress?.episode ? [episodeLine(progress.episode), ratingText(item)].filter(Boolean).join(' · ') : pickMeta(item)
  const version = progress ? versionLine(last) : undefined

  const resumeSearch = progress?.episode ? { season: progress.episode.season, episode: progress.episode.episode } : {}
  const play = progress ? (
    <Link to="/watch/$type/$id" params={{ type: item.type, id: item.id }} search={resumeSearch} className="btn btn-primary btn-large" onPointerEnter={() => prefetchDetail(item)}>
      Resume · {formatLeft(secondsLeft(progress))}
    </Link>
  ) : (
    <Link to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={{ play: true }} className="btn btn-primary btn-large" onPointerEnter={() => prefetchDetail(item)}>
      {end ? `Play · ends ${formatClock(end, userLocale)}` : 'Play'}
    </Link>
  )

  return (
    <article className={s.featured} data-frame={frame ? '' : undefined} aria-label={`${progress ? 'Resume' : 'Tonight'}: ${item.title}`}>
      <Link
        to="/title/$type/$id"
        params={{ type: item.type, id: item.id }}
        search={progress?.episode ? { season: progress.episode.season } : undefined}
        className={s.still}
        onClick={markZoomSource}
        onPointerEnter={() => prefetchDetail(item)}
        viewTransition
        tabIndex={-1}
        aria-hidden="true"
      >
        <Artwork key={key} zoom path={item.backdrop} kind="backdrop" alt="" sizes={leadSizes} priority={priority} className={s.stillArt} fallback={item.title} />
      </Link>
      <div className={s.info}>
      <p className={`${s.when} num`}>
        {end ? (
          <>
            <Clock at={now} /> <span aria-hidden="true">→</span> <Clock at={end} />
            <span className={s.left}> · {progress ? formatLeft(secondsLeft(progress)) : formatDuration(seconds!)}</span>
          </>
        ) : (
          ' '
        )}
      </p>
      <h2 className={s.name}>{item.title}</h2>
      {facts && <p className={s.facts}>{facts}</p>}
      {version && <p className={`${s.version} num`}>{version}</p>}
      <div className={s.actions}>
        {play}
        <Link
          to="/title/$type/$id"
          params={{ type: item.type, id: item.id }}
          search={progress?.episode ? { season: progress.episode.season } : undefined}
          className="btn btn-secondary btn-large"
          onPointerEnter={() => prefetchDetail(item)}
        >
          Details
        </Link>
      </div>
      {frame && item.overview && <p className={s.overview}>{item.overview}</p>}
      </div>
    </article>
  )
}

function Clock({ at }: { at: Date | number }) {
  const { time, period } = clockParts(at, userLocale)
  return (
    <span className={s.clock}>
      {time}
      {period && <span className={s.period}>{period}</span>}
    </span>
  )
}

/** The lead's place while nothing is known yet: the still from the last visit if there is one (the page's
 *  HTML painted it already), else a flat block. Either way the box is the final size, so nothing moves. */
export function FeaturedGhost({ frame }: { frame?: boolean }) {
  const still = lastLead()
  return (
    <div className={s.featured} data-frame={frame ? '' : undefined} aria-hidden="true">
      <div className={s.still}>
        <div className={s.stillArt}>{still && <img className={s.ghostImg} src={still.d.split(" ")[0]} srcSet={still.d} sizes={leadSizes} alt="" fetchPriority="high" />}</div>
      </div>
    </div>
  )
}

/** The lead's still is remembered for the next visit: index.html preloads it and paints it before any
 *  script runs (`flow.lcp`: the address list and the page it belongs to). */
export function lastLead(): { d: string } | null {
  try {
    const h = JSON.parse(localStorage.getItem('flow.lcp') ?? 'null')
    return h && h.path === location.pathname && typeof h.d === 'string' ? { d: h.d } : null
  } catch {
    return null
  }
}
