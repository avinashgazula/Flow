import { Fragment } from 'react'
import { Link } from '@tanstack/react-router'
import { Icon } from '../../components/Icon'
import type { SearchUpdate, Source } from '../../lib/sources'
import { playFacts, sourcesSummary, versionParts } from './logic'
import s from './FilmCan.module.css'

/** The film-can label under the still: will it play well? Three rows, from what the sources said:
 *  the version Play starts (the best one, or the one played last time, and the label says which), how this browser plays it (and what is compromised), and who
 *  offered sources. The last row opens the picker. */
export function FilmCan({ search, best, lastPlayed, onOpen }: { search: SearchUpdate; best?: Source; lastPlayed?: boolean; onOpen: () => void }) {
  const { sources, providers, finished } = search
  const noProviders = finished && providers.length === 0
  const failed = providers.filter((p) => p.state === 'failed').length
  const hidden = search.hidden ?? 0
  const waiting = !finished && sources.length === 0
  const nothingPlays = finished && sources.length > 0 && !best
  const facts = best ? playFacts(best) : undefined
  const version = best ? versionParts(best) : []

  return (
    <section className={s.can} aria-label="How this plays">
      <dl className={s.rows}>
        {(waiting || best || nothingPlays) && (
          <>
          <div className={s.row}>
            <dt>{lastPlayed ? 'Last played' : 'Best version'}</dt>
            <dd>{waiting ? <Bar width="62%" /> : nothingPlays ? <span className={s.warn}>None plays in this browser</span> : version.length ? version.map((p, i) => (
                <Fragment key={p}>
                  {i > 0 && ' '}
                  {/* The dot travels with the item after it, so a wrapped line starts with one, never ends on one. */}
                  <span className={s.part}>{i > 0 && '· '}{p}</span>
                </Fragment>
              )) : 'Unnamed release'}</dd>
          </div>
          {!nothingPlays && (
            <div className={s.row}>
              <dt>Plays</dt>
              <dd>
                {waiting ? (
                  <Bar width="44%" />
                ) : facts ? (
                  <>
                    <span className={facts.direct ? s.direct : undefined}>{facts.mode}</span>
                    {facts.notes.map((n) => (
                      <span key={n.text}>
                        {'\u00a0· '}
                        <span className={n.tone === 'warn' ? s.warn : undefined}>{n.text}</span>
                      </span>
                    ))}
                  </>
                ) : null}
              </dd>
            </div>
          )}
          </>
        )}
        <div className={s.row}>
        <dt>Sources</dt>
        <dd>
          {noProviders ? (
            <Link to="/settings" className={s.open}>
              None yet · Add a source in Settings
              <Icon name="chevronRight" size={14} strokeWidth={2.6} />
            </Link>
          ) : waiting ? (
            <span className={s.quiet}>Looking…</span>
          ) : sources.length === 0 ? (
            <button type="button" className={s.open} onClick={onOpen}>
              {hidden > 0 ? `None shown · ${hidden} hidden by your settings` : 'None found'}
              {failed ? ` · ${failed} didn’t answer` : ''}
              <Icon name="chevronRight" size={14} strokeWidth={2.6} />
            </button>
          ) : (
            <button type="button" className={s.open} onClick={onOpen} aria-label={`${sources.length} sources from ${providers.filter((p) => p.state === 'done' && p.count > 0).map((p) => p.name).join(' and ')}. Choose one.`}>
              {sourcesSummary(sources.length, providers)}
              {hidden > 0 && ` · ${hidden} hidden`}
              {!finished && ' · still looking'}
              {failed > 0 && ` · ${failed} didn’t answer`}
              <Icon name="chevronRight" size={14} strokeWidth={2.6} />
            </button>
          )}
        </dd>
        </div>
      </dl>
    </section>
  )
}

/** Placeholder text in a row, the height of a line so nothing moves when the answer arrives. */
function Bar({ width }: { width: string }) {
  return <span className={s.bar} style={{ width }} aria-hidden />
}
