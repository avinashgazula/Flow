import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Icon, type IconName } from './Icon'
import s from './Nav.module.css'

const tabs: { to: '/' | '/explore' | '/library' | '/search'; label: string; icon: IconName }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/explore', label: 'Explore', icon: 'explore' },
  { to: '/library', label: 'Library', icon: 'library' },
  { to: '/search', label: 'Search', icon: 'search' },
]

/** A top bar on every width: the "Flow" wordmark, the sections as plain text (the current one in paper
 *  with the pink underline), and Settings at the right. On phones the sections move to a flat tab bar
 *  at the bottom, current one in pink, like the system tab bar. No pill, no glass. */
export function Nav() {
  const path = useRouterState({ select: (r) => r.location.pathname })
  const [scrolled, setScrolled] = useState(false)

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
          Flow
        </Link>
        <nav className={s.links} aria-label="Main">
          {tabs.map((t) => (
            <Link key={t.to} to={t.to} className={s.link} aria-current={current(t.to) ? 'page' : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <Link to="/settings" className={`btn btn-quiet btn-circle ${s.settings}`} aria-label="Settings" aria-current={current('/settings') ? 'page' : undefined}>
          <Icon name="settings" size={20} strokeWidth={2} />
        </Link>
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

/** The play-triangle mark, flat: paper on ink. Used where the brand needs a face (the welcome screen). */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1d2853" />
      <path d="M12 9.2v13.6a1 1 0 0 0 1.5.86l10.6-6.8a1 1 0 0 0 0-1.72L13.5 8.34A1 1 0 0 0 12 9.2z" fill="#f3f1ea" />
    </svg>
  )
}
