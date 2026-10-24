import { useRouterState } from '@tanstack/react-router'
import { applyUpdate, dismissUpdate, useOnline, useUpdateReady } from '../lib/pwa/update'
import { Icon } from './Icon'
import s from './Notices.module.css'

/** Two quiet notes about the app itself, flat on the page like the player's notices: one while the browser
 *  has no connection, and one when a new version has downloaded and waits for a reload. Neither blocks
 *  anything, neither shows during playback (a film's own errors have their place), and the update note can be
 *  dismissed, because the new version opens on the next launch anyway. */
export function Notices() {
  const online = useOnline()
  const updateReady = useUpdateReady()
  const watching = useRouterState({ select: (r) => r.location.pathname.startsWith('/watch') })
  if (watching || (online && !updateReady)) return null
  return (
    <div className={s.stack}>
      {!online && (
        <p className={s.note} role="status">
          You’re offline. Flow needs a connection to reach your sources.
        </p>
      )}
      {updateReady && (
        <div className={s.note} role="status">
          <span className={s.text}>Flow was updated.</span>
          <button type="button" className="btn btn-secondary btn-compact" onClick={applyUpdate}>
            Reload
          </button>
          <button type="button" className="btn btn-quiet btn-circle btn-compact" onClick={dismissUpdate} aria-label="Dismiss">
            <Icon name="close" size={16} strokeWidth={2.4} />
          </button>
        </div>
      )}
    </div>
  )
}
