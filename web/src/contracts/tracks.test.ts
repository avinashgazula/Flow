import { audioLanguagesFor, decideSubtitle, pickAudio, trackLanguage, type TrackInfo } from '../features/player/languages'
import { languageName, sameLanguage } from '../lib/language'
import { contract } from './support'

contract('language', ({ op, input }) => {
  if (op === 'same') return sameLanguage(input[0] || undefined, input[1] || undefined)
  if (op === 'name') return languageName(input) ?? null
  throw new Error(`unknown op ${op}`)
})

interface VectorTrack {
  id: number
  language: string
  commentary?: boolean
  forced?: boolean
  sdh?: boolean
  online?: boolean
}

/** A track as the website's player sees it: the kind is in its label, as the file or the service names it. */
const trackOf = (t: VectorTrack): TrackInfo => ({
  id: String(t.id),
  label: [t.commentary ? 'Commentary' : '', t.forced ? 'Forced' : ''].filter(Boolean).join(' ') || 'Track',
  language: t.language,
  ...(t.online ? { online: true } : {}),
  ...(t.sdh !== undefined ? { hearingImpaired: t.sdh } : {}),
})

const modes = { always: 'always', forced: 'forced', foreign: 'foreign', never: 'off' } as const

contract('track-selection', ({ op, input }) => {
  if (op !== 'decide') throw new Error(`unknown op ${op}`)
  const anime = (input.anime ?? undefined) as 'sub' | 'dub' | undefined
  const choice = input.choice as { audio?: string; subtitle?: string }
  const audio = pickAudio((input.audio as VectorTrack[]).map(trackOf), {
    languages: audioLanguagesFor(input.audioLanguages, anime),
    ...(choice.audio ? { choice: { audio: choice.audio } } : {}),
  })
  const decision = decideSubtitle((input.subtitles as VectorTrack[]).map(trackOf), {
    audioLanguage: audio ? trackLanguage(audio) : undefined,
    preferences: { subtitleLanguages: input.subtitleLanguages, subtitleMode: modes[input.mode as keyof typeof modes], subtitleType: input.type },
    ...(choice.subtitle ? { choice: { subtitle: choice.subtitle === 'off' ? null : choice.subtitle } } : {}),
    ...(anime ? { anime } : {}),
  })
  const subtitle = decision.kind === 'track' ? { kind: 'track', id: Number(decision.track.id) } : decision.kind === 'search' ? { kind: 'search', languages: decision.languages } : { kind: 'off' }
  return { audio: audio ? Number(audio.id) : null, subtitle }
})
