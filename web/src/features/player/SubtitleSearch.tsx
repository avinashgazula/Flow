import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { languageName } from '../../lib/language'
import type { ProviderOutcome, SearchOutcome } from '../../lib/subtitles/search'
import { providerNames, type ProviderId, type SubtitleResult } from '../../lib/subtitles/types'
import { usePlayer, type PlayerController } from './controller'
import { keepFocus } from './Controls'
import c from './Controls.module.css'
import s from './SubtitleSearch.module.css'

/** Provider names as a sentence: "OpenSubtitles", "OpenSubtitles and SubDL", "OpenSubtitles, SubDL and Wyzie". */
const sentence = (ids: readonly ProviderId[]) => {
  const names = ids.map((id) => providerNames[id])
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

const languagesSentence = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** One hole for each service asked, lit as it answers: the strip of film the player's other waiting states use. */
function Strip({ asked, answered }: { asked: ProviderId[]; answered: ProviderId[] }) {
  return (
    <span className={s.strip} aria-hidden="true">
      {asked.map((id) => (
        <span key={id} className={s.hole} data-lit={answered.includes(id) ? '' : undefined} />
      ))}
    </span>
  )
}

/** Results grouped by language, in the order they were ranked (the viewer's languages first). */
function groupByLanguage(results: SubtitleResult[]): { name: string; items: SubtitleResult[] }[] {
  const groups: { name: string; items: SubtitleResult[] }[] = []
  for (const r of results) {
    let g = groups.find((x) => x.name === r.languageName)
    if (!g) groups.push((g = { name: r.languageName, items: [] }))
    g.items.push(r)
  }
  return groups
}

/** The "Search Subtitles…" page of the options panel: asks every service that has a key, lists what they have
 *  for this title by language, and downloads the one you pick as a track of its own. As the apps' subtitle picker
 *  does, with the services' answers counted beside the list so a silent service isn't mistaken for an empty one. */
export function SubtitleSearchPage({ controller, onDone }: { controller: PlayerController; onDone: () => void }) {
  // The settings may change under an open panel (a key saved in another tab), so the plan is read as the page opens.
  const plan = useMemo(() => controller.subtitleSearchPlan(), [controller])
  const current = usePlayer(controller, (st) => st.subtitleId)
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)
  const [answered, setAnswered] = useState<ProviderOutcome[]>([])
  const [failed, setFailed] = useState<string>()
  const [pending, setPending] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    if ('problem' in plan) return
    const abort = new AbortController()
    controller
      .searchSubtitles(plan, abort.signal, (o) => alive.current && setAnswered((list) => [...list, o]))
      .then((o) => alive.current && setOutcome(o))
      .catch((error: Error) => alive.current && error.name !== 'AbortError' && setFailed(error.message))
    return () => {
      alive.current = false
      abort.abort()
    }
  }, [controller, plan])

  async function choose(r: SubtitleResult) {
    setPending(r.id)
    setProblem(undefined)
    try {
      await controller.addSubtitle(r)
      if (alive.current) onDone()
    } catch (error) {
      if (alive.current) setProblem((error as Error).message)
    } finally {
      if (alive.current) setPending(undefined)
    }
  }

  if ('problem' in plan) {
    return (
      <p className={s.empty}>
        {plan.problem === 'title' ? (
          'Flow hasn’t finished loading this title. Try again in a moment.'
        ) : (
          <>
            No subtitle service is set up. Add a key for OpenSubtitles, SubDL, Wyzie or SubSource in <Link to="/settings" hash="playback">Settings → Playback → Subtitle Services</Link>, then search from here.
          </>
        )}
      </p>
    )
  }

  const languages = plan.query.languages
  const names = outcome ? [...new Set(outcome.results.map((r) => r.languageName))] : []
  const groups = outcome ? groupByLanguage(outcome.results) : []
  const everyoneFailed = outcome && outcome.outcomes.every((o) => o.error)

  return (
    <>
      <div className={s.status} role="status">
        <Strip asked={plan.enabled} answered={outcome ? outcome.outcomes.filter((o) => !o.error).map((o) => o.provider) : answered.filter((o) => !o.error).map((o) => o.provider)} />
        <p className={s.statusText}>
          {failed ? (
            failed
          ) : !outcome ? (
            <>Searching {sentence(plan.enabled)}…</>
          ) : outcome.results.length > 0 ? (
            <>
              <span className="num">{outcome.results.length}</span> {outcome.results.length === 1 ? 'subtitle' : 'subtitles'} in {languagesSentence(names)}
            </>
          ) : everyoneFailed ? (
            'None of the services answered.'
          ) : (
            <>
              Nothing found in {languagesSentence(languages.map((l) => languageName(l) ?? l))} for this title.
            </>
          )}
        </p>
      </div>

      {problem && (
        <p className={s.problem} role="alert">
          {problem}
        </p>
      )}

      {groups.map((g) => (
        <div key={g.name} role="group" aria-label={g.name}>
          <p className={c.groupTitle}>{g.name}</p>
          {g.items.map((r) => {
            const trackId = controller.trackForResult(r.id)
            const checked = !!trackId && trackId === current
            const downloads = r.downloads !== undefined ? `${r.downloads.toLocaleString()} downloads` : undefined
            return (
              <button key={r.id} className={c.row} onClick={() => void choose(r)} onMouseDown={keepFocus} disabled={!!pending} aria-busy={pending === r.id} role="menuitemradio" aria-checked={checked}>
                <span className={c.rowText}>
                  <span className={`${c.rowTitle} ${s.release}`} data-checked={checked ? '' : undefined}>
                    {r.release || r.languageName}
                  </span>
                  <span className={c.rowDetail}>
                    {pending === r.id ? (
                      'Downloading…'
                    ) : (
                      <>
                        {r.hearingImpaired && <span className={s.sdh}>SDH</span>}
                        {[providerNames[r.provider], downloads].filter(Boolean).join(' · ')}
                      </>
                    )}
                  </span>
                </span>
                {checked && (
                  <span className={c.check}>
                    <Icon name="check" size={16} strokeWidth={2.8} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}

      {outcome && (
        <ul className={s.notes} aria-label="What each service said">
          {outcome.outcomes.map((o) => (
            <li key={o.provider} data-trouble={o.error && o.kind !== 'blocked' ? '' : undefined}>
              <span className={s.noteName}>{providerNames[o.provider]}</span>
              <span className={s.noteText}>{o.error ?? (o.count === 0 ? 'None for this title' : `${o.count} found`)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
