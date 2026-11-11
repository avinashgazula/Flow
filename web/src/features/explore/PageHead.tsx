import type { ReactNode } from 'react'
import s from './PageHead.module.css'

/* The page head, the toolbar row and the ruled section the browsing screens share (Explore, Search, Library, Live TV).
   They are here and not in global.css because a flex row around .page-title cut its rule short: the rule belongs to
   the row, not to the title. */

/** The giant title with a short mono note at its right, and the 2px rule under both, edge to edge. `compact` is a smaller title for a screen that must also fit a guide (Live TV). `back` is a link
 *  above the title (a list's way back to Library); `children` sit at the right too (a button beside the title). */
export function PageHead({ title, note, back, long, compact, children, as: Heading = 'h1' }: { title: string; note?: ReactNode; back?: ReactNode; long?: boolean; compact?: boolean; children?: ReactNode; as?: 'h1' | 'h2' }) {
  return (
    <header className={s.head}>
      {back && <div className={s.back}>{back}</div>}
      <div className={s.row}>
        <Heading className={s.title} data-long={long || undefined} data-compact={compact || undefined}>
          {title}
        </Heading>
        {(note || children) && (
          <div className={s.aside}>
            {note && <p className={s.note}>{note}</p>}
            {children}
          </div>
        )}
      </div>
    </header>
  )
}

/** A row of filters and sorts under the head: full width, a 2px rule below, controls that share borders. */
export function Toolbar({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={`${s.toolbar} ${className}`} role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  )
}

/** A section of a page: a 2px rule, a red mono label with its count, a link at the far end, then the content. */
export function Section({ id, title, count, end, children, className = '' }: { id: string; title: string; count?: number | string; end?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${s.section} ${className}`} aria-labelledby={id}>
      <header className={s.sectionHead}>
        <h2 id={id} className={s.sectionLabel}>
          {title}
        </h2>
        {count !== undefined && <span className={`${s.sectionCount} num`}>{count}</span>}
        {end && <span className={s.sectionEnd}>{end}</span>}
      </header>
      {children}
    </section>
  )
}
