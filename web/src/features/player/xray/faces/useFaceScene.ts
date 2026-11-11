import { useEffect, useRef, useState } from 'react'
import type { CastMember } from '../../../../lib/tmdb/types'
import type { PlayerController } from '../../controller'
import { facesIn, load, printOfPhoto } from './client'
import { grabFrame } from './frame'
import { matchFaces, type CastPrint } from './match'
import { collectPrints } from './prints'
import type { FaceState } from './scene'
import { currentConnection } from '../../preferences'
import { mayDownload, mayFollow } from './policy'

/** How long after the picture stops moving (a seek, a pause) before it is looked at, so a scrub doesn't start a look per frame. */
const settleMs = 300
/** How often the picture is looked at again while the film plays with X-Ray open. Each look costs a few hundred milliseconds of
 *  one thread (see the README), so this is a few seconds, not a frame rate. */
const followMs = 5_000

const mark = (name: string, start: number) => {
  try {
    performance.measure(name, { start, end: performance.now() })
  } catch {
    /* A timing that isn't kept is no loss. */
  }
}

/** Who is on screen, by their faces: the cast's photos worked into prints once (and kept), then the frame on screen worked into
 *  prints and each matched to the nearest actor. Runs when the card opens, after a seek or a pause, and every few seconds
 *  while the film plays. Everything stays on the device. `enabled` is the Recognise Faces setting. */
export function useFaceScene(controller: PlayerController, cast: CastMember[], enabled: boolean): { state: FaceState; matched: CastMember[] } {
  const [state, setState] = useState<FaceState>({ status: 'off' })
  const [matched, setMatched] = useState<CastMember[]>([])
  const castRef = useRef(cast)
  castRef.current = cast
  const castKey = cast.map((m) => `${m.id}:${m.profile ?? ''}`).join(',')

  useEffect(() => {
    const video = controller.video
    const supported = typeof Worker !== 'undefined' && typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined'
    if (!enabled || !supported || !video) return setState({ status: 'off' })
    if (castRef.current.length === 0) return
    if (!mayDownload(currentConnection())) return setState({ status: 'unavailable', reason: 'metered' })

    const abort = new AbortController()
    let prints: CastPrint[] | undefined
    let looked = false
    let busy = false
    let dirty = true
    let blocked = false
    let timers: number[] = []

    const look = async () => {
      if (!prints) {
        setState({ status: 'loading', stage: 'models' })
        let t = performance.now()
        await load()
        mark('xray-faces-models', t)
        setState({ status: 'loading', stage: 'photos' })
        t = performance.now()
        const got = await collectPrints(castRef.current, printOfPhoto, { signal: abort.signal })
        mark('xray-faces-photos', t)
        if (abort.signal.aborted) return
        if (got.prints.length === 0) {
          blocked = true
          return setState({ status: 'unavailable', reason: got.failed > 0 ? 'failed' : 'no-photos' })
        }
        prints = got.prints
      }
      const grab = grabFrame(video)
      if ('problem' in grab) {
        if (grab.problem === 'unreadable') blocked = true
        // No picture yet is for the next look to try; an unreadable one will never change.
        return setState({ status: 'unavailable', reason: grab.problem })
      }
      if (!looked) setState({ status: 'loading', stage: 'frame' })
      const t = performance.now()
      const { faces } = await facesIn(grab.frame)
      mark('xray-faces-frame', t)
      if (abort.signal.aborted) return
      const byId = new Map(castRef.current.map((m) => [m.id, m]))
      const found = matchFaces(faces, prints).flatMap((m) => byId.get(m.id) ?? [])
      looked = true
      setMatched((now) => (now.length === found.length && now.every((m, i) => m.id === found[i]!.id) ? now : found))
      setState({ status: 'done', faces: faces.length, matched: found.length })
    }

    // One look at a time; a seek during a look asks for another when it ends.
    const request = async () => {
      dirty = true
      if (busy || blocked) return
      busy = true
      try {
        while (dirty && !blocked && !abort.signal.aborted) {
          dirty = false
          await look()
        }
      } catch {
        if (!abort.signal.aborted) {
          blocked = true
          setState({ status: 'unavailable', reason: 'failed' })
        }
      } finally {
        busy = false
      }
    }

    const soon = () => {
      timers.forEach(clearTimeout)
      timers = [window.setTimeout(() => void request(), settleMs)]
    }
    const follow = window.setInterval(() => {
      if (!video.paused && mayFollow(currentConnection(), document.hidden)) void request()
    }, followMs)
    video.addEventListener('seeked', soon)
    video.addEventListener('pause', soon)
    void request()
    return () => {
      abort.abort()
      timers.forEach(clearTimeout)
      clearInterval(follow)
      video.removeEventListener('seeked', soon)
      video.removeEventListener('pause', soon)
    }
  }, [controller, enabled, castKey])

  return { state, matched }
}
