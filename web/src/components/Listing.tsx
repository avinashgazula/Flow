import { Link, type LinkProps } from '@tanstack/react-router'
import { createContext, useContext, useId, type ReactNode, type Ref } from 'react'
import type { ImageKind } from '../lib/tmdb/images'
import { clockParts, endTime, userLocale, useMinuteTick } from '../lib/time'
import { Artwork } from './Artwork'
import { markZoomSource } from './Cards'
import s from './Listing.module.css'

/* The programme listing: Flow's one repeating component, after a printed cinema timetable. Every row
   reads left to right: a time column (when it would end if you pressed play now, or an air date, a
   rating, a resolution, a start time: whatever the section orders by), then artwork at ONE fixed size
   per section, then the title, plain facts, and the version line in ink-3. No badges, no chips.

   Use it for Continue Watching, picks, episodes, search results, library lists, sources and the guide.
   Wrap rows in a <ListingSection>, which also sets the artwork size so a section never mixes sizes. */

/** Posters are 2:3 (48x72 on phones, 64x96 on desktop); stills are 16:9 (128x72, 160x90). */
export type ListingArt = 'poster' | 'still'

const ArtContext = createContext<ListingArt>('poster')

/** What the time column says. `ends` is seconds of viewing (what's left of a resume item, a film's
 *  runtime, an episode's runtime): the column shows now + that, in the viewer's own clock style, and
 *  keeps itself right as the minutes pass. Anything else is plain text: `{ time: '2160p' }`,
 *  `{ time: 'Tue 12', label: 'airs' }`, `{ time: '7.8', label: 'TMDB' }`. */
export type ListingWhen = { ends: number } | { time: string; period?: string; label?: string }

export interface ListingProps {
  /** Opens a page: the same props a router Link takes (`to`, `params`, `search`). */
  link?: LinkProps
  /** Or runs something (a source that plays on tap). One of `link` and `onSelect` is needed. */
  onSelect?: () => void
  when: ListingWhen
  title: string
  /** The plain facts, ink-2: "S3 E7 · Fly · 18 min left". */
  meta?: string
  /** The version line, ink-3 plain text: "2160p · Dolby Vision · TrueHD 7.1". */
  version?: string
  artPath?: string
  /** Which TMDB size ladder `artPath` comes from. Defaults to poster for posters, backdrop for stills. */
  artKind?: ImageKind
  /** Overrides the section's artwork size, for a one-off row outside a ListingSection. */
  art?: ListingArt
  /** 0 to 1: a 2 px line under the artwork, the played part in pink. */
  progress?: number
  /** What a screen reader says. Defaults to title, meta, version and the time: "Breaking Bad, S3 E7, ends 9:48 PM". */
  label?: string
  /** The current item in a list (the source playing, the episode open): sits on the panel fill. */
  selected?: boolean
  /** Can't be played here: title and meta fall back to ink-3, and the reason belongs in `meta`. */
  dimmed?: boolean
  /** A visual-only mark at the right end (the ranked-best source's pink "Play" label). The row is the
   *  one tap target, so nothing interactive goes in here. */
  trailing?: ReactNode
  /** Pointer rests on the row, or it takes keyboard focus: prefetch the page, drive a preview frame. */
  onIntent?: () => void
  /** The page's first and largest image: fetched at once, never lazily. */
  priority?: boolean
  /** The row's <li>, for a caller that wants to know when it nears the screen. */
  itemRef?: Ref<HTMLLIElement>
}

export function Listing({ link, onSelect, when, title, meta, version, artPath, artKind, art, progress, label, selected, dimmed, trailing, onIntent, priority, itemRef }: ListingProps) {
  const sectionArt = useContext(ArtContext)
  const shape = art ?? sectionArt
  const now = useMinuteTick()
  const shown = 'ends' in when ? endsColumn(now, when.ends) : when
  const spoken = label ?? [title, meta, version, `${'ends' in when ? 'ends' : (when.label ?? '')} ${shown.time}${shown.period ? ` ${shown.period}` : ''}`.trim()].filter(Boolean).join(', ')

  const inside = (
    <>
      <span className={`${s.time} num`}>
        <span className={s.clock}>
          {shown.time}
          {shown.period && <span className={s.period}>{shown.period}</span>}
        </span>
        {shown.label && <span className={s.timeLabel}>{shown.label}</span>}
      </span>
      <span className={s.artCol} aria-hidden="true">
        <Artwork
          zoom={!!link}
          path={artPath}
          kind={artKind ?? (shape === 'poster' ? 'poster' : 'backdrop')}
          alt=""
          sizes={shape === 'poster' ? '(max-width: 720px) 48px, 64px' : '(max-width: 720px) 128px, 160px'}
          priority={priority}
          className={s.art}
        />
        {progress !== undefined && (
          <span className={s.track}>
            <span className={s.played} style={{ transform: `scaleX(${Math.max(0.03, Math.min(1, progress))})` }} />
          </span>
        )}
      </span>
      <span className={s.text}>
        <span className={s.title}>{title}</span>
        {/* A separator stays with the word before it, so a wrapped line never starts with a dot. */}
        {meta && <span className={s.meta}>{meta.replaceAll(' · ', '\u00a0· ')}</span>}
        {version && <span className={`${s.version} num`}>{version}</span>}
      </span>
      {trailing && <span className={s.trailing}>{trailing}</span>}
    </>
  )

  const shared = {
    className: s.row,
    'data-art': shape,
    'data-selected': selected ? '' : undefined,
    'data-dimmed': dimmed ? '' : undefined,
    'aria-label': spoken,
    onPointerEnter: (e: { pointerType: string }) => e.pointerType === 'mouse' && onIntent?.(),
    onFocus: onIntent,
  }

  return (
    <li className={s.item} ref={itemRef}>
      {link ? (
        <Link {...link} {...shared} aria-current={selected ? 'true' : undefined} onClick={markZoomSource} viewTransition>
          {inside}
        </Link>
      ) : (
        <button type="button" {...shared} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
          {inside}
        </button>
      )}
    </li>
  )
}

function endsColumn(now: number, seconds: number): { time: string; period?: string; label: string } {
  return { ...clockParts(endTime(now, seconds), userLocale), label: 'ends' }
}

/** A titled run of listings. The heading is plain text with an optional ink-2 aside beside it (a count,
 *  "4 sources"); `art` fixes one artwork size for every row inside. `loading` shows quiet placeholder
 *  rows of the same size, so nothing moves when the answers arrive. Use level 3 for a heading inside
 *  a group that already has an h2. */
export function ListingSection({
  title,
  aside,
  art = 'poster',
  level = 2,
  loading,
  placeholders = 6,
  children,
}: {
  title: string
  aside?: ReactNode
  art?: ListingArt
  level?: 2 | 3
  loading?: boolean
  placeholders?: number
  children?: ReactNode
}) {
  const id = useId()
  const Heading = `h${level}` as const
  return (
    <section className={s.section} aria-labelledby={id} aria-busy={loading || undefined}>
      <div className={s.head}>
        <Heading id={id} className={level === 2 ? s.heading : s.subheading}>
          {title}
        </Heading>
        {aside && <span className={`${s.aside} num`}>{aside}</span>}
      </div>
      <ArtContext.Provider value={art}>
        <ul className={s.list}>{loading ? Array.from({ length: placeholders }, (_, i) => <Ghost key={i} art={art} />) : children}</ul>
      </ArtContext.Provider>
    </section>
  )
}

function Ghost({ art }: { art: ListingArt }) {
  return (
    <li className={s.item} aria-hidden="true">
      <span className={s.row} data-art={art} data-ghost="">
        <span className={s.time}>
          <span className={s.ghostBar} style={{ width: 44, height: 17 }} />
        </span>
        <span className={s.artCol}>
          <span className={`${s.art} ${s.ghostArt}`} />
        </span>
        <span className={s.text}>
          <span className={s.ghostBar} style={{ width: '56%', height: 17 }} />
          <span className={s.ghostBar} style={{ width: '38%', height: 15 }} />
        </span>
      </span>
    </li>
  )
}
