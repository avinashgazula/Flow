import { useEffect, useRef, useState } from 'react'
import type { MediaType } from '../../lib/tmdb/types'
import { PlayerScreen } from './PlayerScreen'
import { sleepTimer } from './sleepTimer'
import { StillWatching } from './stillWatching'
import s from './Player.module.css'

/** The watch page: black, the whole viewport, nothing else of the site. The screen inside starts
 *  afresh for each episode while this element stays, so full screen survives Up Next. */
export function Player({ type, id, season, episode, source }: { type: MediaType; id: number; season?: number; episode?: number; source?: string }) {
  const root = useRef<HTMLDivElement>(null)
  // Episodes played in a row with nobody there, counted across screens for "Are You Still Watching?".
  const [binge] = useState(() => new StillWatching())

  useEffect(() => {
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      // The sleep timer counts through episodes, but not past the player being closed.
      sleepTimer.clear()
    }
  }, [])

  return (
    <div ref={root} className={s.root}>
      <PlayerScreen key={`${type}:${id}:${season ?? ''}:${episode ?? ''}`} type={type} id={id} season={season} episode={episode} sourceId={source} root={root} binge={binge} />
    </div>
  )
}
