import { useEffect, useState, type ReactNode } from 'react'
import { AboutSection } from './AboutSection'
import { AddonsSection } from './AddonsSection'
import { CatalogueSection } from './CatalogueSection'
import { DataSection } from './DataSection'
import { PlaybackSection } from './PlaybackSection'
import { ServersSection } from './ServersSection'
import s from './SettingsScreen.module.css'

const sections: { id: string; title: string; body: ReactNode }[] = [
  { id: 'catalogue', title: 'Catalogue', body: <CatalogueSection /> },
  { id: 'addons', title: 'Stream Add-ons', body: <AddonsSection /> },
  { id: 'servers', title: 'Media Servers', body: <ServersSection /> },
  { id: 'playback', title: 'Playback', body: <PlaybackSection /> },
  { id: 'data', title: 'Data', body: <DataSection /> },
  { id: 'about', title: 'About', body: <AboutSection /> },
]

/** Settings, sectioned like the native screen: a list of anchors beside the sections on wide
 *  screens, and the sections one after another on a phone. */
export function SettingsScreen() {
  const [current, setCurrent] = useState(sections[0]!.id)

  // The anchor for the section in view follows the scroll; observers don't run per frame.
  useEffect(() => {
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id)
        const first = sections.find((x) => visible.has(x.id))
        if (first) setCurrent(first.id)
      },
      { rootMargin: '-20% 0px -65% 0px' },
    )
    sections.forEach((x) => {
      const el = document.getElementById(x.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      <div className={s.layout}>
        <nav className={s.toc} aria-label="Settings sections">
          {sections.map((x) => (
            <a
              key={x.id}
              href={`#${x.id}`}
              aria-current={current === x.id ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(x.id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
                setCurrent(x.id)
              }}
            >
              {x.title}
            </a>
          ))}
        </nav>
        <div className={s.content}>
          {sections.map((x) => (
            <section key={x.id} id={x.id} className={s.section} aria-labelledby={`${x.id}-title`}>
              <h2 id={`${x.id}-title`} className={s.sectionTitle}>
                {x.title}
              </h2>
              {x.body}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
