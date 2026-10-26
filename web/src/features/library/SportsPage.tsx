import { useQuery, useQueries } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { scope } from '../../lib/queries'
import { followTeam, unfollowTeam, useFollowedTeams, useSportsSettings } from '../../lib/sports/settings'
import { sports } from '../../lib/sports/client'
import type { SportsEvent, SportsTeam } from '../../lib/sports/types'
import { userLocale } from '../../lib/time'
import { monogram } from '../livetv/logic'
import { StateView } from '../explore/Controls'
import { actionLabel, gameActions, metaText, scoreHidden, scoreText, type GameAction } from './sportsView'
import s from './SportsPage.module.css'

/* Sports, as the apps': the teams you follow, with their next fixtures and latest results from TheSportsDB. Tapping a
   game opens the matching Live TV channel (the best match, or a list to choose from, as Settings → Live TV says);
   scores can stay covered until you ask. The lookups are lib/sports; the Live TV matching loads on first use. */

/** SportsError's own sentence says what to do next; anything else gets a general one. */
const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.')

const GameChannels = lazy(() => import('./GameChannels'))

const fixtureOptions = (teamID: string, kind: 'next' | 'last', apiKey: string) => ({
  // Under the catalogue's identity like every query, so sample data never shows beside real fixtures.
  queryKey: [...scope(), 'sports', apiKey, teamID, kind] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => (kind === 'next' ? sports.nextEvents(teamID, signal) : sports.lastEvents(teamID, signal)),
  staleTime: 5 * 60_000,
})

export default function SportsPage() {
  const teams = useFollowedTeams()
  const prefs = useSportsSettings()
  const router = useRouter()
  const [finding, setFinding] = useState(false)
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const [listed, setListed] = useState<string>()
  const [note, setNote] = useState<string>()

  const next = useQueries({ queries: teams.map((t) => fixtureOptions(t.id, 'next', prefs.apiKey)) })
  const last = useQueries({ queries: teams.map((t) => fixtureOptions(t.id, 'last', prefs.apiKey)) })

  const act = async (action: GameAction, event: SportsEvent) => {
    if (action === 'reveal') setRevealed((r) => new Set(r).add(event.id))
    else if (action === 'list') {
      setNote(undefined)
      setListed((id) => (id === event.id ? undefined : event.id))
    } else if (action === 'play') {
      setNote(`Looking for a channel for ${event.title || 'this game'}…`)
      const { bestChannel } = await import('./GameChannels')
      const found = await bestChannel(event)
      if (found.status === 'found') {
        setNote(undefined)
        void router.navigate({ to: '/live', search: { play: found.id } })
      } else if (found.status === 'none-configured') setNote('Add an IPTV provider in Settings → Live TV to watch games.')
      else setNote(`No channel found for ${event.title || 'this game'}.`)
    }
  }

  return (
    <div className={s.page}>
      <div className={s.tools}>
        <button type="button" className="btn btn-secondary btn-compact" aria-expanded={finding} aria-controls="find-team" onClick={() => setFinding((x) => !x)}>
          <Icon name={finding ? 'close' : 'plus'} size={16} strokeWidth={2.4} /> {finding ? 'Done' : 'Follow a Team'}
        </button>
        <p className={`${s.note} muted`} role="status">
          {note}
        </p>
      </div>
      {finding && <FindTeam />}

      {teams.length === 0 && !finding && (
        <StateView
          icon="live"
          title="No Teams"
          message="Follow teams to see their upcoming fixtures and results here."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setFinding(true)}>
              Find Teams
            </button>
          }
        />
      )}

      {teams.map((team, i) => {
        const coming = next[i]
        const gone = last[i]
        const upcoming = (coming?.data ?? []).slice(0, 5)
        const results = (gone?.data ?? []).slice(0, 3)
        const loading = (coming?.isPending && coming.fetchStatus !== 'idle') || (gone?.isPending && gone.fetchStatus !== 'idle')
        const failed = coming?.isError && gone?.isError
        return (
          <section key={team.id} className={s.team} aria-labelledby={`team-${team.id}`}>
            <header className={s.teamHead}>
              <Badge team={team} />
              <h2 id={`team-${team.id}`} className={s.teamName}>
                {team.name}
              </h2>
              {team.league && <span className={s.league}>{team.league}</span>}
              <button type="button" className={`btn btn-quiet btn-compact ${s.unfollow}`} onClick={() => unfollowTeam(team.id)} aria-label={`Unfollow ${team.name}`}>
                Unfollow
              </button>
            </header>
            {loading && !upcoming.length && !results.length ? (
              <div className={s.ghosts} aria-hidden="true">
                <div className={s.ghost} />
                <div className={s.ghost} />
              </div>
            ) : failed ? (
              <p className={`${s.channelsNote} muted`} role="alert">
                {errorText(coming?.error)}{' '}
                <button type="button" className={s.retry} onClick={() => void Promise.all([coming?.refetch(), gone?.refetch()])}>
                  Try again
                </button>
              </p>
            ) : upcoming.length + results.length === 0 ? (
              <p className={`${s.channelsNote} muted`}>No fixtures available.</p>
            ) : (
              <>
                {upcoming.length > 0 && (
                  <ul className={s.games}>
                    {upcoming.map((g) => (
                      <Game key={g.id} event={g} prefs={prefs} revealed={revealed} listed={listed === g.id} onAct={act} />
                    ))}
                  </ul>
                )}
                {results.length > 0 && (
                  <>
                    <h3 className={s.results}>Recent Results</h3>
                    <ul className={s.games}>
                      {results.map((g) => (
                        <Game key={g.id} event={g} prefs={prefs} revealed={revealed} listed={listed === g.id} onAct={act} />
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        )
      })}
    </div>
  )
}

function Game({ event, prefs, revealed, listed, onAct }: { event: SportsEvent; prefs: ReturnType<typeof useSportsSettings>; revealed: ReadonlySet<string>; listed: boolean; onAct: (a: GameAction, e: SportsEvent) => void }) {
  const hidden = scoreHidden(event, prefs.showScoreSpoilers, revealed)
  const { tap, other } = gameActions(event, { chooseChannelOnTap: prefs.chooseChannelOnTap, scoreHidden: hidden })
  const score = scoreText(event)
  const otherName = other === 'list' ? 'Channels' : 'Watch'
  return (
    <li className={s.game}>
      <div className={s.gameRow}>
        <button type="button" className={s.gameMain} data-inert={tap === 'none' || undefined} disabled={tap === 'none'} onClick={() => onAct(tap, event)} aria-label={`${actionLabel(tap, event)}. ${metaText(event, userLocale)}`} aria-expanded={tap === 'list' ? listed : undefined}>
          <span className={s.gameTitle}>{event.title}</span>
          <span className={s.gameMeta}>{metaText(event, userLocale)}</span>
        </button>
        {score &&
          (hidden ? (
            <button type="button" className={s.cover} onClick={() => onAct('reveal', event)} aria-label="Score hidden. Show the score.">
              <span className={`${s.blur} num`} aria-hidden="true">
                0 – 0
              </span>
              <span className={s.show}>Show score</span>
            </button>
          ) : (
            <span className={`${s.score} num`}>{score}</span>
          ))}
        {other !== 'none' && (
          <button type="button" className={`btn btn-quiet btn-compact ${s.other}`} onClick={() => onAct(other, event)} aria-label={actionLabel(other, event)} aria-expanded={other === 'list' ? listed : undefined}>
            {otherName}
          </button>
        )}
      </div>
      {listed && (
        <Suspense fallback={<p className={`${s.channelsNote} muted`}>Loading channels…</p>}>
          <GameChannels event={event} />
        </Suspense>
      )}
    </li>
  )
}

/** A team's badge, or its initials when TheSportsDB has none (or it won't load). */
function Badge({ team }: { team: SportsTeam }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={s.badge} aria-hidden="true">
      {team.badgeURL && !failed ? <img src={team.badgeURL} alt="" width={32} height={32} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className={s.monogram}>{monogram(team.name)}</span>}
    </span>
  )
}

/** Search for a team by name and follow it. Beside the games, not over them. */
function FindTeam() {
  const followed = useFollowedTeams()
  const prefs = useSportsSettings()
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  // Three letters before a search, and a pause after the last keystroke: the free key is rate-limited.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim().length >= 3 ? text.trim() : ''), 400)
    return () => clearTimeout(timer)
  }, [text])
  const found = useQuery({ queryKey: [...scope(), 'sports', prefs.apiKey, 'search', query], queryFn: ({ signal }) => sports.searchTeams(query, signal), enabled: query !== '', staleTime: 10 * 60_000 })

  return (
    <div id="find-team" className={s.find}>
      <label className={s.findField}>
        <span className="sr-only">Team name</span>
        <Icon name="search" size={16} strokeWidth={2.4} />
        <input type="text" role="searchbox" className={s.findInput} enterKeyHint="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Team name" autoComplete="off" spellCheck={false} autoFocus />
      </label>
      <div role="status" className={s.findState}>
        {text.trim().length > 0 && text.trim().length < 3 ? 'Type at least three letters.' : found.isFetching ? 'Searching…' : found.isError ? errorText(found.error) : query && found.data?.length === 0 ? `No teams called “${query}”.` : ''}
      </div>
      {found.data && found.data.length > 0 && (
        <ul className={s.found}>
          {found.data.map((team) => {
            const following = followed.some((t) => t.id === team.id)
            return (
              <li key={team.id} className={s.foundRow}>
                <Badge team={team} />
                <span className={s.foundText}>
                  <span className={s.foundName}>{team.name}</span>
                  <span className={s.foundMeta}>{[team.sport, team.league, team.country].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" className="btn btn-secondary btn-compact" disabled={following} onClick={() => followTeam(team)} aria-label={following ? `Following ${team.name}` : `Follow ${team.name}`}>
                  {following ? 'Following' : 'Follow'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
