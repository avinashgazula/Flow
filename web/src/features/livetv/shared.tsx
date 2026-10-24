import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Channel } from '../../lib/livetv/types'
import { monogram } from './logic'
import s from './Shared.module.css'

/** The time, kept current: `ms` is how often it ticks. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    // Back from a sleeping tab: don't wait out the interval to show the right programme.
    const visible = () => document.visibilityState === 'visible' && setNow(Date.now())
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [ms])
  return now
}

const phoneQuery = '(max-width: 720px)'
const subscribePhone = (listener: () => void) => {
  const query = matchMedia(phoneQuery)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
/** True at phone width, where the guide is narrower and the rows are tighter. */
export const usePhone = () =>
  useSyncExternalStore(
    subscribePhone,
    () => matchMedia(phoneQuery).matches,
    () => false,
  )

/** A channel's logo on a plate, or its initials when there is none (or it fails to load). */
export function ChannelLogo({ channel, size = 'm' }: { channel: Pick<Channel, 'name' | 'logoURL'>; size?: 's' | 'm' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [channel.logoURL])
  return (
    <span className={s.logo} data-size={size} aria-hidden="true">
      {channel.logoURL && !failed ? (
        <img src={channel.logoURL} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className={s.monogram}>{monogram(channel.name)}</span>
      )}
    </span>
  )
}

/** The red LIVE mark. Red means live and nothing else. */
export function LiveBadge() {
  return <span className={s.live}>Live</span>
}
