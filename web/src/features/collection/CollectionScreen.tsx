import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Artwork } from '../../components/Artwork'
import { PosterWall } from '../../components/PosterRow'
import { collectionQuery } from '../../lib/tmdb/collection'
import { useMinuteTick } from '../../lib/time'
import type { Collection } from '../../lib/tmdb/types'
import { nameSize } from '../detail/nameSize'
import { filmCount, yearSpan } from './logic'
import s from './CollectionScreen.module.css'

const stillSizes = '(min-width: 721px) 480px, calc(100vw - 32px)'

/** A film collection, as the apps' Collection page: the giant name with its film count and years, its framed picture
 *  beside the serif overview, and every film in release order. */
export function CollectionScreen({ id }: { id: number }) {
  const { data, isError, error, refetch, isRefetching } = useQuery(collectionQuery(id))
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  if (!data) {
    if (isError)
      return (
        <div className="page">
          <div className={s.state} role="status">
            <h1 className={s.stateTitle}>Couldn’t Load This Collection</h1>
            <p className="reading">{error instanceof Error && error.message ? `${error.message.replace(/[.!?]$/, '')}. Try again in a moment.` : 'Flow couldn’t reach TMDB. Check your connection, then try again.'}</p>
            <button className="btn btn-secondary" onClick={() => void refetch()} disabled={isRefetching}>
              Try Again
            </button>
          </div>
        </div>
      )
    return <Skeleton />
  }
  return <Loaded collection={data} />
}

function Loaded({ collection: c }: { collection: Collection }) {
  const now = useMinuteTick()
  const span = yearSpan(c.parts)
  const still = c.backdrop ?? c.parts.find((p) => p.backdrop)?.backdrop
  return (
    <div className="page">
      <header className={s.head}>
        <h1 className={s.name} data-size={nameSize(c.name)}>
          {c.name}
        </h1>
        <p className={s.meta}>{[filmCount(c.parts.length), span].filter(Boolean).join(' · ')}</p>
      </header>
      <div className={s.wrap}>
        {(still || c.overview) && (
          <div className={s.intro}>
            {still && (
              <div className={s.still}>
                <Artwork path={still} kind="backdrop" alt="" sizes={stillSizes} priority fallback={c.name} className={s.art} />
              </div>
            )}
            {c.overview && <p className={`reading ${s.overview}`}>{c.overview}</p>}
          </div>
        )}
        {c.parts.length > 0 ? (
          <section className={s.films} aria-labelledby="films-title">
            <h2 id="films-title" className="section-label">
              Films in Release Order
            </h2>
            <PosterWall items={c.parts} now={now} label={`Films in ${c.name}`} />
          </section>
        ) : (
          <div className={s.state} role="status">
            <h2 className={s.stateTitle}>No Films Yet</h2>
            <p className="reading">TMDB doesn’t list any films in this collection.</p>
          </div>
        )}
      </div>
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
          <div className={`${s.ghost} ${s.ghostStill}`} />
        </div>
      </div>
    </div>
  )
}
