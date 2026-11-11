import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Artwork } from '../../components/Artwork'
import { ChoiceSelect, Segmented } from '../../components/Choice'
import { PosterRow, PosterWall } from '../../components/PosterRow'
import { q } from '../../lib/queries'
import { useMinuteTick } from '../../lib/time'
import type { MediaType, Person } from '../../lib/tmdb/types'
import { RetryAction, StateView, errorMessage } from '../explore/Controls'
import { nameSize } from '../detail/nameSize'
import { creditSorts, filmography, lifeLine, type CreditSort } from './logic'
import s from './PersonScreen.module.css'

const filters = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'show', label: 'Shows' },
] as const

/** A person: the giant name and a mono facts line, a framed portrait beside a serif biography that opens on request,
 *  what they're known for, and everything they've been in under a ruled label. */
export function PersonScreen({ id }: { id: number }) {
  const { data: person, isError, error, refetch, isRefetching } = useQuery(q.person(id))
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  if (!person) {
    if (isError)
      return (
        <div className="page">
          <StateView heading="h1" icon="info" title="Couldn’t Load This Person" message={errorMessage(error)} action={<RetryAction error={error} onRetry={() => void refetch()} busy={isRefetching} />} />
        </div>
      )
    return <Skeleton />
  }
  return <Loaded key={person.id} person={person} />
}

function Loaded({ person }: { person: Person }) {
  const [type, setType] = useState<'all' | MediaType>('all')
  const [sort, setSort] = useState<CreditSort>('year')
  const now = useMinuteTick()
  const credits = filmography(person.credits, type === 'all' ? undefined : type, sort)
  const hasBoth = person.credits.some((c) => c.type === 'movie') && person.credits.some((c) => c.type === 'show')
  const [birth, ...rest] = (lifeLine(person) ?? '').split(' · ')
  const facts = [person.department, birth, ...rest].filter(Boolean)

  return (
    <div className="page">
      <header className={s.head}>
        <h1 className={s.name} data-size={nameSize(person.name)}>
          {person.name}
        </h1>
        {facts.length > 0 && <p className={s.meta}>{facts.join(' · ')}</p>}
      </header>
      <div className={s.wrap}>
        <div className={s.intro}>
          <Artwork path={person.profile} kind="profile" alt="" sizes="200px" priority className={s.portrait} fallback={initials(person.name)} />
          {person.biography && <Biography text={person.biography} />}
        </div>

        {person.credits.length > 0 ? (
          <>
            {/* A short career is already all on show below: a "Known For" row would repeat it. */}
            {person.credits.length > 6 && <PosterRow title="Known For" items={person.credits.slice(0, 12)} now={now} />}
            <section className={s.filmography} aria-labelledby="filmography-title">
              <header className={s.filmHeader}>
                <h2 id="filmography-title" className="section-label">
                  Filmography <span className={s.count}>{credits.length}</span>
                </h2>
                <div className={s.filmControls}>
                  {hasBoth && <Segmented options={filters} value={type} onChange={setType} label="Show" />}
                  <ChoiceSelect options={creditSorts} value={sort} onChange={setSort} label="Sort by" />
                </div>
              </header>
              <PosterWall items={credits} now={now} label="Filmography" />
            </section>
          </>
        ) : (
          <div className={s.state} role="status">
            <h2 className={s.stateTitle}>No Credits Yet</h2>
            <p className="reading">TMDB doesn’t list any films or shows for this person.</p>
          </div>
        )}
      </div>
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
      <p ref={ref} className={`reading ${s.bioText}`} data-expanded={expanded ? '' : undefined} id="person-bio">
        {text}
      </p>
      {(overflows || expanded) && (
        <button className={`quiet-link ${s.more}`} onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="person-bio">
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="page" aria-busy>
      <header className={s.head}>
        <div className={`${s.ghost} ${s.ghostName}`} />
      </header>
      <div className={s.wrap}>
        <div className={s.intro}>
          <div className={`${s.portrait} ${s.ghost}`} />
        </div>
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
