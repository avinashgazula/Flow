import type { Episode } from '../../lib/tmdb/types'
import { keepFocus } from './Controls'
import s from './Controls.module.css'

/** After several episodes in a row with nobody touching anything: carry on, or call it a night. The picture is
 *  paused behind it, and Escape is Stop. */
export function StillWatchingPrompt({ next, onKeepWatching, onStop }: { next: Episode; onKeepWatching: () => void; onStop: () => void }) {
  return (
    <div className={s.ask} role="alertdialog" aria-modal="true" aria-labelledby="still-watching-title" aria-describedby="still-watching-next">
      <div className={s.askCard}>
        <h2 id="still-watching-title" className={s.askTitle}>
          Are You Still Watching?
        </h2>
        <p id="still-watching-next" className={s.askNext}>
          Next: Season {next.season}, Episode {next.number}
          {next.name ? ` · ${next.name}` : ''}
        </p>
        <div className={s.askActions}>
          <button className="btn btn-primary" onClick={onKeepWatching} onMouseDown={keepFocus} autoFocus>
            Keep Watching
          </button>
          <button className="btn btn-secondary" onClick={onStop} onMouseDown={keepFocus}>
            Stop
          </button>
        </div>
      </div>
    </div>
  )
}
