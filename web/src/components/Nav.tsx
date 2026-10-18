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

/** One navigation for every width: a floating glass pill at the top of wide screens (as on Apple
 *  TV and iPad), a tab bar at the bottom on phones. */
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
          <Logo />
          <span>Flow</span>
        </Link>
        <nav className={s.pill} aria-label="Main">
          {tabs.map((t) => (
            <Link key={t.to} to={t.to} className={s.tab} aria-current={current(t.to) ? 'page' : undefined}>
              <Icon name={t.icon} size={17} strokeWidth={2.2} />
              <span>{t.label}</span>
            </Link>
          ))}
        </nav>
        <Link to="/settings" className={`btn btn-glass btn-circle btn-compact ${s.settings}`} aria-label="Settings" aria-current={current('/settings') ? 'page' : undefined}>
          <Icon name="settings" size={18} strokeWidth={2} />
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

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="flow-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7d8bff" />
          <stop offset="1" stopColor="#ff8a7a" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#0b0d1a" />
      <path d="M12 9.2v13.6a1 1 0 0 0 1.5.86l10.6-6.8a1 1 0 0 0 0-1.72L13.5 8.34A1 1 0 0 0 12 9.2z" fill="url(#flow-logo)" />
    </svg>
  )
}
