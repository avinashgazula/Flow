import { lazy, Suspense } from 'react'
import { usePlayer } from '../controller'
import type { XRayProps } from './XRayPanel'

/** The panel, its photos' frames, its logic and the dialogue it reads are one chunk, fetched the first time X-Ray
 *  opens (a pause with Show X-Ray When Paused on, the button, or X). */
const Panel = lazy(() => import('./XRayPanel').then((m) => ({ default: m.XRayPanel })))

export function XRay(props: XRayProps) {
  const open = usePlayer(props.controller, (st) => st.panel === 'xray')
  return open ? (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  ) : null
}
