import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Icon } from '../../components/Icon'
import { Plate } from '../../components/Frame'
import { prefetchDetail, q } from '../../lib/queries'
import { lastSourceStore } from '../../lib/sources/lastSource'
import { useStore } from '../../lib/store/createStore'
import { mediaKey, type Progress } from '../../lib/store/library'
import { userLocale, useMinuteTick } from '../../lib/time'
import type { MediaItem } from '../../lib/tmdb/types'
import { pickMeta, pickPrint, resumePrint, watchedFraction } from './logic'
import s from './Lead.module.css'

/** The lead of Home: a title, and where the viewer left off when they have. */
export interface LeadItem {
  item: MediaItem
  progress?: Progress
}

/** How wide the lead still renders, for `srcset`. index.html preloads the same still with the same string,
 *  so the browser reuses the download; keep the two in step with the layout in Lead.module.css. */
export const leadSizes = '(min-width: 1500px) 724px, (min-width: 1100px) 52vw, (min-width: 721px) 420px, calc(100vw - 32px)'

/** The one dominant item on Home: a large 16:9 still with its edge strip (perforations for what's
 *  watched, print for the episode, time left in yellow, when it would end, and the format), then the
 *  title, one line of facts, the yellow Resume or Play and a quiet Details. */
export function Lead({ lead }: { lead: LeadItem }) {
  const { item, progress } = lead
  const now = useMinuteTick()
  const key = mediaKey(item.type, item.id)
  const last = useStore(lastSourceStore, (st) => st.byTitle[key])
  // A title not started gets its runtime (and so its end time) from its detail.
  const detail = useQuery({ ...q.detail(item.type, item.id), enabled: !progress })

  const print = progress ? resumePrint(progress, now, last, userLocale) : pickPrint(item, detail.data?.runtime ? detail.data : undefined, now, { ends: true, locale: userLocale })
  const meta = progress?.episode ? `Season ${progress.episode.season}, Episode ${progress.episode.episode}${progress.episode.name ? ` · ${progress.episode.name}` : ''}` : pickMeta(item)
  const season = progress?.episode ? { season: progress.episode.season } : undefined

  return (
    <article className={s.lead}>
      <Link to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={season} className={s.plate} onPointerEnter={() => prefetchDetail(item)} viewTransition tabIndex={-1} aria-hidden="true">
        <Plate shape="still" artPath={item.backdrop} sizes={leadSizes} priority progress={progress ? watchedFraction(progress) : undefined} print={print} stripSize="lead" fallback={item.title} />
      </Link>
      <div className={s.info}>
        <h2 className={s.name}>{item.title}</h2>
        <p className={s.meta}>{meta}</p>
        <div className={s.actions}>
          {progress ? (
            <Link to="/watch/$type/$id" params={{ type: item.type, id: item.id }} search={progress.episode ? { season: progress.episode.season, episode: progress.episode.episode } : {}} className="btn btn-primary btn-large" onPointerEnter={() => prefetchDetail(item)}>
              <Icon name="play" size={18} /> Resume
            </Link>
          ) : (
            <Link to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={{ play: true }} className="btn btn-primary btn-large" onPointerEnter={() => prefetchDetail(item)}>
              <Icon name="play" size={18} /> Play
            </Link>
          )}
          <Link to="/title/$type/$id" params={{ type: item.type, id: item.id }} search={season} className="btn btn-secondary btn-large" onPointerEnter={() => prefetchDetail(item)}>
            Details
          </Link>
        </div>
      </div>
    </article>
  )
}

/** The lead's place while nothing is known yet: the still from the last visit if there is one (the page's
 *  HTML painted it already), else a flat block. Either way the box is the final size, so nothing moves. */
export function LeadGhost() {
  const still = lastLead()
  return (
    <div className={s.lead} aria-hidden="true">
      <div className={s.plate}>
        <span className={s.ghostFrame}>{still && <img className={s.ghostImg} src={still.d.split(' ')[0]} srcSet={still.d} sizes={leadSizes} alt="" fetchPriority="high" />}</span>
        <span className={s.ghostStrip} />
      </div>
    </div>
  )
}

/** The lead's still is remembered for the next visit: index.html preloads it and paints it before any script
 *  runs (`flow.lcp`: the address list, its sizes, and the page it belongs to). */
export function lastLead(): { d: string } | null {
  try {
    const h = JSON.parse(localStorage.getItem('flow.lcp') ?? 'null')
    return h && h.path === location.pathname && typeof h.d === 'string' ? { d: h.d } : null
  } catch {
    return null
  }
}
