import { settingsStore } from '../../../lib/store/settings'
import type { CastMember } from '../../../lib/tmdb/types'
import type { PlayerController } from '../controller'
import { parseSubtitles, type SubtitleFormat } from '../subtitles'
import type { DialogueCue } from './xray'

/* Where X-Ray reads the dialogue from when the subtitles on screen can't be read: with none showing, one file is
   fetched quietly from the viewer's subtitle services, once for each title or episode. Hearing-impaired files are
   preferred, because their speaker labels ("JESSE:") name whoever is talking. */

const fetched = new Map<string, Promise<DialogueCue[] | null>>()

/** The dialogue of this title or episode from a subtitle service, or null when there is no service to ask or none has
 *  a file in the viewer's languages. Sample data has sample lines instead. Kept for the visit, so reopening X-Ray, or
 *  another pause, doesn't ask again. */
export function fetchedDialogue(controller: PlayerController, key: string, cast: CastMember[]): Promise<DialogueCue[] | null> {
  const known = fetched.get(key)
  if (known) return known
  const asked = ask(controller, cast).catch(() => null)
  fetched.set(key, asked)
  return asked
}

async function ask(controller: PlayerController, cast: CastMember[]): Promise<DialogueCue[] | null> {
  const plan = controller.subtitleSearchPlan()
  if ('problem' in plan) {
    // The sample data has no subtitle services to ask, so it brings a few lines of its own.
    if (plan.problem === 'services' && settingsStore.get().demo) return (await import('./demoDialogue')).demoDialogue(cast)
    return null
  }
  const { results } = await controller.searchSubtitles({ ...plan, preferSDH: true })
  const { languageKey } = await import('../../../lib/subtitles/names')
  const wanted = new Set(plan.query.languages.map(languageKey))
  const best = results.find((r) => wanted.has(languageKey(r.language)))
  if (!best) return null
  const [{ downloadSubtitle }, { learn, planFor }, { credentialsOf }] = await Promise.all([import('../../../lib/subtitles/download'), import('../../../lib/subtitles/reach'), import('../../../lib/subtitles/options')])
  const { season, episode } = plan.query
  const got = await downloadSubtitle(best, credentialsOf(settingsStore.get()), { plan: planFor, learn, episode: season !== undefined && episode !== undefined ? { season, episode } : undefined })
  const cues = parseSubtitles(got.text, got.format as SubtitleFormat)
  return cues.length > 0 ? cues.map((c) => ({ startTime: c.start, text: c.text })) : null
}
