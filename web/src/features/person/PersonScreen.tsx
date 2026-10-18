import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Artwork } from '../../components/Artwork'
import { PosterCard } from '../../components/Cards'
import { Shelf } from '../../components/Shelf'
import { q } from '../../lib/queries'
import { imageURL } from '../../lib/tmdb/images'
import type { MediaType, Person } from '../../lib/tmdb/types'
import { Segmented, Select, StateView, errorMessage } from '../explore/Controls'
import { PosterGrid } from '../explore/PosterGrid'
import { creditSorts, filmography, lifeLine, type CreditSort } from './logic'
import s from './PersonScreen.module.css'

const filters = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'show', label: 'Shows' },
] as const

/** A person: portrait, the facts, a biography that opens on request, what they're known for, and
 *  everything they've been in. */
export function PersonScreen({ id }: { id: number }) {
  const { data: person, isError, error, refetch, isRefetching } = useQuery(q.person(id))
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  if (!person) {
    if (isError)
      return (
        <div className={`page ${s.screen}`}>
          <StateView
            icon="person"
            title="Couldn’t Load This Person"
            message={errorMessage(error)}
            action={
              <button className="btn btn-glass" onClick={() => void refetch()} disabled={isRefetching}>
                Try Again
              </button>
            }
          />
        </div>
      )
    return <Skeleton />
  }
  return <Loaded key={person.id} person={person} />
}

function Loaded({ person }: { person: Person }) {
  const [type, setType] = useState<'all' | MediaType>('all')
  const [sort, setSort] = useState<CreditSort>('year')
  const line = lifeLine(person)
  const credits = filmography(person.credits, type === 'all' ? undefined : type, sort)
  const hasBoth = person.credits.some((c) => c.type === 'movie') && person.credits.some((c) => c.type === 'show')

  return (
    <div className={`page ${s.screen}`}>
      {person.profile && <div className={s.ambient} style={{ backgroundImage: `url(${imageURL(person.profile, 185)})` }} aria-hidden />}
      <header className={s.header}>
        <Artwork path={person.profile} kind="profile" alt="" sizes="(max-width: 720px) 160px, 220px" priority className={s.portrait} fallback={initials(person.name)} />
        <div className={s.facts}>
          <h1 className={s.name}>{person.name}</h1>
          {person.department && <p className={s.department}>{person.department}</p>}
          {line && <p className={s.life}>{line}</p>}
          {person.biography && <Biography text={person.biography} />}
        </div>
      </header>

      {person.credits.length > 0 ? (
        <>
          <div className={s.bleed}>
            <Shelf title="Known For">
              {person.credits.slice(0, 12).map((m) => (
                <PosterCard key={`${m.type}${m.id}`} item={m} />
              ))}
            </Shelf>
          </div>
          <section className={s.filmography}>
            <header className={s.filmHeader}>
              <h2 className={s.sectionTitle}>
                Filmography <span className={s.count}>{credits.length}</span>
              </h2>
              <div className={s.filmControls}>
                {hasBoth && <Segmented options={filters} value={type} onChange={setType} label="Show" />}
                <Select options={creditSorts} value={sort} onChange={setSort} label="Sort by" />
              </div>
            </header>
            <PosterGrid items={credits} label="Filmography" />
          </section>
        </>
      ) : (
        <StateView title="No Credits Yet" message="TMDB doesn’t list any films or shows for this person." />
      )}
    </div>
  )
}

/** Five lines, then "More" when there's more to read. */
function Biography({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])
  return (
    <div className={s.bio}>
      <p ref={ref} className={s.bioText} data-expanded={expanded ? '' : undefined} id="person-bio">
        {text}
      </p>
      {(overflows || expanded) && (
        <button className={s.more} onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="person-bio">
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className={`page ${s.screen}`} aria-busy>
      <header className={s.header}>
        <div className={`${s.portrait} ${s.ghost}`} />
        <div className={s.facts}>
          <div className={`${s.ghost} ${s.ghostName}`} />
          <div className={`${s.ghost} ${s.ghostLine}`} />
          <div className={`${s.ghost} ${s.ghostBio}`} />
        </div>
      </header>
      <div className={s.bleed}>
        <Shelf title="Known For" loading />
      </div>
    </div>
  )
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
