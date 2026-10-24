import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useSettings } from '../lib/store/settings'
import { orderTabs } from '../lib/tabs'
import { Icon } from './Icon'
import s from './Nav.module.css'

/** A top bar on every width: the yellow mark and "Flow" wordmark, the sections as plain text (the current
 *  one in paper with the yellow underline), and Settings at the right. On phones the sections move to a
 *  flat tab bar at the bottom, current one in yellow, like the system tab bar. No pill, no glass. */
export function Nav() {
  const path = useRouterState({ select: (r) => r.location.pathname })
  const [scrolled, setScrolled] = useState(false)
  const sample = useSettings((x) => x.demo)
  const saved = useSettings((x) => x.tabOrder)
  const tabs = orderTabs(saved)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (path.startsWith('/watch')) return null
  const current = (to: string) => (to === '/' ? path === '/' : path.startsWith(to))

  return (
    <>
      <header className={s.top} data-scrolled={scrolled ? '' : undefined}>
        <Link to="/" className={s.brand} aria-label="Flow home">
          <span className={s.mark} aria-hidden="true" />
          Flow
        </Link>
        <nav className={s.links} aria-label="Main">
          {tabs.map((t) => (
            <Link key={t.to} to={t.to} className={s.link} aria-current={current(t.to) ? 'page' : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className={s.end}>
          {/* The catalogue, the credits and the streams on every screen are made up while this is on: say so,
              quietly, and link to where it is turned off. It is not there otherwise. */}
          {sample && (
            <Link to="/settings" className={s.sample} aria-label="Sample data is on. Open Settings to turn it off.">
              Sample data
            </Link>
          )}
          <Link to="/settings" className={`btn btn-quiet btn-circle ${s.settings}`} aria-label="Settings" aria-current={current('/settings') ? 'page' : undefined}>
            <Icon name="settings" size={20} strokeWidth={2} />
          </Link>
        </div>
      </header>
      <nav className={s.bottom} aria-label="Tabs">
        {tabs.map((t) => (
          <Link key={t.to} to={t.to} className={s.bottomTab} aria-current={current(t.to) ? 'page' : undefined}>
            <Icon name={t.icon} size={22} strokeWidth={2} filled={false} />
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
    </>
  )
}

/** The mark: a film-stock yellow frame (12 by 16, as in the top bar) with the play triangle cut out of it.
 *  Used where the brand needs a face (the welcome screen). */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size * 0.75} height={size} viewBox="0 0 12 16" aria-hidden="true">
      <rect width="12" height="16" rx="2" fill="#f6b40e" />
      <path d="M4.4 4.9v6.2a.5.5 0 0 0 .76.43l4.9-3.1a.5.5 0 0 0 0-.86l-4.9-3.1a.5.5 0 0 0-.76.43z" fill="#15120f" />
    </svg>
  )
}
