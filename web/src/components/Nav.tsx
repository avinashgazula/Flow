import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../lib/store/settings'
import { setTheme, useTheme } from '../lib/theme'
import { orderTabs } from '../lib/tabs'
import { Icon } from './Icon'
import { Logo } from './Logo'
import s from './Nav.module.css'

/** The top bar, in Index's grammar: a blue logo cell with the Marquee wordmark, then the sections as 3px-bordered
 *  uppercase cells (the current one inverted, the hovered one blue), Settings, and the Light/Dark toggle at the
 *  end. It slides away while the page scrolls down and comes back as soon as it scrolls up. On phones the top
 *  bar keeps only the logo, Settings and the toggle, and the sections move to a bar of bordered cells at the
 *  bottom, where a thumb reaches them. */
export function Nav() {
  const path = useRouterState({ select: (r) => r.location.pathname })
  // The live player is full screen too, and is reached by ?play= on the Live TV page.
  const liveFull = useRouterState({ select: (r) => r.location.pathname === '/live' && typeof (r.location.search as Record<string, unknown>).play === 'string' })
  const [away, setAway] = useState(false)
  const header = useRef<HTMLElement>(null)
  const sample = useSettings((x) => x.demo)
  const saved = useSettings((x) => x.tabOrder)
  const tabs = orderTabs(saved)
  const dark = useTheme() === 'dark'

  useEffect(() => {
    let last = window.scrollY
    let queued = false
    const update = () => {
      queued = false
      const y = Math.max(0, window.scrollY)
      const delta = y - last
      // A twitch isn't a direction: wait for a few pixels before the bar moves either way.
      if (Math.abs(delta) < 6) return
      setAway(delta > 0 && y > (header.current?.offsetHeight ?? 0))
      last = y
    }
    const onScroll = () => {
      if (!queued) {
        queued = true
        requestAnimationFrame(update)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (path.startsWith('/watch') || liveFull) return null
  const current = (to: string) => (to === '/' ? path === '/' : path.startsWith(to))

  return (
    <>
      {/* Keyboard focus anywhere in the bar brings it back, so a hidden bar never holds the focus. */}
      <header ref={header} className={s.top} data-away={away ? '' : undefined} onFocus={() => setAway(false)}>
        <Link to="/" className={s.brand} aria-label="Marquee home">
          <Logo />
        </Link>
        <nav className={s.links} aria-label="Main">
          {tabs.map((t) => (
            <Link key={t.to} to={t.to} className={s.cell} aria-current={current(t.to) ? 'page' : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className={s.end}>
          {/* The catalogue, the credits and the streams on every screen are made up while this is on: say so,
              plainly, and link to where it is turned off. It is not there otherwise. */}
          {sample && (
            <Link to="/settings" className={`${s.cell} ${s.sample}`} aria-label="Sample data is on. Open Settings to turn it off.">
              Sample<span className={s.wide}> Data</span>
            </Link>
          )}
          <Link to="/settings" className={`${s.cell} ${s.settings}`} aria-label="Settings" aria-current={current('/settings') ? 'page' : undefined}>
            <Icon name="settings" size={20} strokeWidth={2} />
            <span className={s.wide}>Settings</span>
          </Link>
          <button type="button" className={`${s.cell} ${s.theme}`} aria-pressed={dark} aria-label="Dark mode" onClick={() => setTheme(dark ? 'light' : 'dark')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
            </svg>
            <span className={s.wide}>{dark ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>
      <nav className={s.bottom} aria-label="Tabs">
        {tabs.map((t) => (
          <Link key={t.to} to={t.to} className={s.bottomTab} aria-current={current(t.to) ? 'page' : undefined}>
            <Icon name={t.icon} size={20} strokeWidth={2} filled={false} />
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
    </>
  )
}
