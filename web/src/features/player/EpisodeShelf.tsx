import { Artwork } from '../../components/Artwork'
import { Icon } from '../../components/Icon'
import type { Episode } from '../../lib/tmdb/types'
import { keepFocus } from './Controls'
import s from './Controls.module.css'

/** The rest of the season as a glass shelf over the scrubber, opened scrolled to the episode on
 *  screen so what's next is a glance away. */
export function EpisodeShelf({ season, current, list, onPick, onClose, fallbackStill }: {
  season: number
  current: number
  list: Episode[] | undefined
  onPick: (episode: Episode) => void
  onClose: () => void
  fallbackStill?: string
}) {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className={`${s.shelf} ${s.interactive}`} role="dialog" aria-label={`Season ${season}`}>
      <div className={s.shelfHeader}>
        <h2>Season {season}</h2>
        <button className={s.clusterButton} aria-label="Close Episodes" onClick={onClose} onMouseDown={keepFocus}>
          <Icon name="close" size={18} strokeWidth={2.4} />
        </button>
      </div>
      <ol className={s.shelfRow}>
        {(list ?? Array.from({ length: 6 }, () => undefined)).map((e, i) => {
          if (!e) return <li key={i} className={s.shelfGhost} />
          const isCurrent = e.number === current
          const aired = !e.airDate || e.airDate <= today
          return (
            <li
              key={e.id}
              ref={(el) => {
                if (el && isCurrent) el.scrollIntoView({ inline: 'center', block: 'nearest' })
              }}
            >
              <button className={s.episodeCard} disabled={!aired} onClick={() => (isCurrent ? onClose() : onPick(e))} onMouseDown={keepFocus} aria-current={isCurrent ? 'true' : undefined}>
                <span className={s.episodeStill}>
                  <Artwork path={e.still ?? fallbackStill} kind={e.still ? 'still' : 'backdrop'} alt="" sizes="200px" className={s.fill} fallback={`Episode ${e.number}`} />
                  {isCurrent && (
                    <span className={s.nowPlaying}>
                      <Icon name="play" size={10} /> Now Playing
                    </span>
                  )}
                </span>
                <span className={s.episodeName}>
                  E{e.number} · {e.name}
                </span>
                <span className={s.episodeMeta}>{aired ? (e.runtime ? `${e.runtime}m` : '') : 'Not out yet'}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
