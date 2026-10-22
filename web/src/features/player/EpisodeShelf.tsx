import { Plate } from '../../components/Frame'
import { Icon } from '../../components/Icon'
import type { Episode } from '../../lib/tmdb/types'
import { keepFocus } from './Controls'
import s from './Controls.module.css'

/** The rest of the season as a flat shelf over the scrubber, opened scrolled to the episode on
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
              <button
                className={s.episodeCard}
                disabled={!aired}
                onClick={() => (isCurrent ? onClose() : onPick(e))}
                onMouseDown={keepFocus}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={`Episode ${e.number}, ${e.name}${isCurrent ? ', now playing' : aired ? '' : ', not out yet'}`}
              >
                <Plate
                  className={s.episodeStill}
                  shape="still"
                  artPath={e.still ?? fallbackStill}
                  artKind={e.still ? 'still' : 'backdrop'}
                  sizes="200px"
                  fallback={`Episode ${e.number}`}
                  stripSize="still"
                  print={[`E${e.number}`, isCurrent ? { key: 'Now playing' } : aired ? (e.runtime ? `${e.runtime} min` : '') : 'Not out yet']}
                  hideStrip
                />
                <span className={s.episodeName}>{e.name}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
