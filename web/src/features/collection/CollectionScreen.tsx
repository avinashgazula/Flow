import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Plate } from '../../components/Frame'
import { PosterWall } from '../../components/PosterRow'
import { collectionQuery } from '../../lib/tmdb/collection'
import { useMinuteTick } from '../../lib/time'
import type { Collection } from '../../lib/tmdb/types'
import { filmCount, yearSpan } from './logic'
import s from './CollectionScreen.module.css'

const stillSizes = '(min-width: 721px) 480px, calc(100vw - 32px)'

/** A film collection, as the apps' Collection page: its picture, what it is, and every film in release order. */
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
            <p>{error instanceof Error && error.message ? `${error.message.replace(/[.!?]$/, '')}. Try again in a moment.` : 'Flow couldn’t reach TMDB. Check your connection, then try again.'}</p>
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
      <div className={s.wrap}>
        <header className={s.header}>
          {still && (
            <div className={s.still}>
              <Plate shape="still" artPath={still} sizes={stillSizes} priority stripSize="title" print={[filmCount(c.parts.length), span ?? '']} fallback={c.name} />
            </div>
          )}
          <div className={s.facts}>
            <h1 className={s.name}>{c.name}</h1>
            {c.overview && <p className={s.overview}>{c.overview}</p>}
          </div>
        </header>
        {c.parts.length > 0 ? (
          <section className={s.films} aria-labelledby="films-title">
            <h2 id="films-title" className={s.sectionTitle}>
              Films in Release Order
            </h2>
            <PosterWall items={c.parts} now={now} label={`Films in ${c.name}`} />
          </section>
        ) : (
          <div className={s.state} role="status">
            <h2 className={s.stateTitle}>No Films Yet</h2>
            <p>TMDB doesn’t list any films in this collection.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="page" aria-busy>
      <div className={s.wrap}>
        <header className={s.header}>
          <div className={`${s.ghost} ${s.ghostStill}`} />
          <div className={s.facts}>
            <div className={`${s.ghost} ${s.ghostName}`} />
          </div>
        </header>
      </div>
    </div>
  )
}
