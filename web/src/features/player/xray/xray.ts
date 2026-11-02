import type { CastMember } from '../../../lib/tmdb/types'

/* X-Ray: who's in the scene, worked out from what's being said. A port of FlowKit's `XRay`.

   Streaming services tag every scene by hand or with face recognition. Flow has the cast list and the
   subtitles instead, and characters are named in dialogue far more often than you'd think: "Jesse, get
   in", "Hank's on his way", "WALT: Say my name". Matching the last few minutes of lines against the
   characters' names gives a good guess at who's around right now. */

/** How far back the dialogue is read, in seconds. */
export const dialogueWindow = 180

/** A line of dialogue, as a text track's cue has it. */
export interface DialogueCue {
  startTime: number
  text: string
}

/** Credits that aren't characters at all. */
const notCharacters = new Set(['self', 'himself', 'herself', 'themselves', 'narrator', 'host', 'voice', 'various', 'additional voices'])

/** Forms of address: "Mr. White" is White, "Dr. House" is House. */
const titles = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'lady', 'lord', 'the', 'and', 'of', 'von', 'van', 'der', 'del', 'jr', 'sr',
  'captain', 'detective', 'agent', 'officer', 'professor', 'doctor', 'uncle', 'aunt', 'father', 'mother',
  'sergeant', 'lieutenant', 'general', 'colonel', 'major', 'king', 'queen', 'prince', 'princess', 'judge', 'nurse',
])

/** Words in generic credits ("Waitress", "Man in Bar", "Young Jesse") that aren't names. */
const roleWords = new Set([
  'man', 'woman', 'boy', 'girl', 'guy', 'kid', 'young', 'old', 'older', 'younger', 'little', 'big',
  'police', 'cop', 'guard', 'waiter', 'waitress', 'bartender', 'driver', 'reporter', 'anchor', 'student',
  'teacher', 'patient', 'customer', 'clerk', 'soldier', 'thug', 'henchman', 'member', 'worker', 'friend',
  'neighbor', 'neighbour', 'stranger', 'passenger', 'pilot', 'receptionist', 'secretary', 'assistant',
  'bar', 'club', 'store', 'shop', 'restaurant', 'hospital', 'school', 'office', 'street', 'news', 'tv',
])

/** Names that are also common words: counted only where the capital can't just be a sentence start. */
const everydayWords = new Set([
  'will', 'may', 'mark', 'rose', 'grace', 'hope', 'faith', 'joy', 'summer', 'dawn', 'june', 'april',
  'art', 'bill', 'sue', 'pat', 'max', 'ray', 'jack', 'frank', 'carol', 'chance', 'chase', 'hunter',
  'angel', 'honey', 'baby', 'buddy', 'sunny', 'rich', 'lucky', 'earl', 'dean', 'drew', 'gene', 'faye',
  'rob', 'nick', 'penny', 'holly', 'ivy', 'lily', 'daisy', 'amber', 'ruby', 'crystal', 'storm', 'sky',
])

interface Word {
  /** Lowercased, without a trailing possessive. */
  key: string
  startsSentence: boolean
}

const sentenceEnds = '.!?:-\n♪[]()'

/** Capitalised words only: names are proper nouns. ALL-CAPS speaker labels ("JESSE:") count too. */
export function words(line: string): Word[] {
  const result: Word[] = []
  let sentenceStart = true
  let current = ''
  const flush = (endsSentence: boolean) => {
    const first = current[0]
    if (first) {
      if (/\p{Lu}/u.test(first)) {
        let key = current.toLowerCase()
        for (const suffix of ["'s", '’s', "s'"]) {
          if (key.endsWith(suffix)) {
            key = key.slice(0, -suffix.length)
            break
          }
        }
        if (key.length >= 3) result.push({ key, startsSentence: sentenceStart })
      }
      sentenceStart = false
    }
    current = ''
    if (endsSentence) sentenceStart = true
  }
  for (const ch of line) {
    if (/[\p{L}'’]/u.test(ch)) current += ch
    else flush(sentenceEnds.includes(ch))
  }
  flush(true)
  return result
}

interface CharacterNames {
  member: CastMember
  /** Whole names, lowercased: "walter white", "heisenberg". */
  fullNames: string[]
  /** The words that can stand for the character on their own: "walter", "white", "heisenberg". */
  tokens: Set<string>
}

function characterNames(member: CastMember): CharacterNames {
  // "Walter White / Heisenberg (voice)": every alias, without the notes in brackets.
  const cleaned = member.role.replace(/\([^)]*\)/g, ' ')
  const aliases = cleaned
    .split(/[/;|]/)
    .map((a) => a.trim())
    .filter((a) => a && !notCharacters.has(a.toLowerCase()) && !/\p{N}/u.test(a))
  const fullNames: string[] = []
  const tokens = new Set<string>()
  for (const alias of aliases) {
    const parts = alias
      .toLowerCase()
      .split(/[^\p{L}']+/u)
      .filter(Boolean)
    const meaningful = parts.filter((w) => w.length >= 3 && !titles.has(w) && !roleWords.has(w))
    // "Police Officer", "Man in Bar": a description, not a name anyone says.
    if (meaningful.length === 0) continue
    fullNames.push(parts.join(' '))
    for (const w of meaningful) tokens.add(w)
  }
  return { member, fullNames, tokens }
}

/** Whether a credit names a character anyone could be called, rather than "Himself" or "Police Officer #2". */
export const namesACharacter = (member: CastMember): boolean => characterNames(member).tokens.size > 0

/** How many times `needle` is found in `text`, without overlaps. */
const occurrences = (text: string, needle: string) => text.split(needle).length - 1

/** The cast members whose characters were named in `lines`, most-mentioned first (ties keep billing order, which is
 *  the order of `cast`). */
export function mentioned(lines: string[], cast: CastMember[]): CastMember[] {
  const names = cast.map(characterNames)
  // A word two characters share ("White" for Walter and Skyler) says nothing about which one.
  const owners = new Map<string, Set<number>>()
  for (const name of names) {
    for (const token of name.tokens) {
      const set = owners.get(token) ?? new Set<number>()
      set.add(name.member.id)
      owners.set(token, set)
    }
  }
  const all = lines.flatMap(words)
  // Punctuation as spaces, so " walter white " is found in "Walter White."
  const lowered = ` ${[...lines.join(' ').toLowerCase().replace(/’/g, "'")].map((c) => (/[\p{L}']/u.test(c) ? c : ' ')).join('')} `

  const scores = new Map<number, number>()
  for (const name of names) {
    let score = 0
    // A full name ("Walter White") is the strongest sign.
    for (const full of name.fullNames) {
      if (full.includes(' ')) score += 2 * occurrences(lowered, ` ${full} `)
    }
    for (const word of all) {
      if (!name.tokens.has(word.key) || owners.get(word.key)?.size !== 1) continue
      // An everyday word ("Will", "Hope") counts only mid-sentence, where its capital means a name.
      if (everydayWords.has(word.key) && word.startsSentence) continue
      score += 1
    }
    if (score > 0) scores.set(name.member.id, (scores.get(name.member.id) ?? 0) + score)
  }
  const seen = new Set<number>()
  return cast
    .map((member, order) => ({ member, order }))
    .filter(({ member }) => scores.has(member.id) && (seen.has(member.id) ? false : (seen.add(member.id), true)))
    .sort((a, b) => scores.get(b.member.id)! - scores.get(a.member.id)! || a.order - b.order)
    .map(({ member }) => member)
}

/** The text of every cue that started between `from` and `to` (playback time), with the subtitle delay applied as the
 *  overlay does: a cue shown `delay` seconds late started that much earlier. `cues` is in the order a text track keeps
 *  them, by start time. Markup is dropped, except a voice tag, whose name is a speaker label. */
export function dialogueLines(cues: ArrayLike<DialogueCue>, from: number, to: number, delay = 0): string[] {
  const start = from - delay
  const end = to - delay
  let low = 0
  let high = cues.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (cues[mid]!.startTime < start) low = mid + 1
    else high = mid
  }
  const lines: string[] = []
  for (let i = low; i < cues.length && cues[i]!.startTime <= end; i++) lines.push(plainLine(cues[i]!.text))
  return lines
}

function plainLine(text: string): string {
  return text.replace(/<v[.\w]*\s+([^>]*)>/gi, '$1: ').replace(/<[^>]*>/g, '')
}

/** Who is named in the last `dialogueWindow` seconds before `time`, at most `limit` of them. */
export function inScene(cues: ArrayLike<DialogueCue>, time: number, cast: CastMember[], delay = 0, limit = 8): CastMember[] {
  return mentioned(dialogueLines(cues, time - dialogueWindow, time, delay), cast).slice(0, limit)
}

interface RawCredit {
  id: number
  name: string
  character?: string
  order?: number
  profile_path?: string | null
}

/** Who is in one episode, from TMDB's credits for it: the regular cast first, then that episode's guest stars. */
export function episodeCast(raw: { cast?: RawCredit[]; guest_stars?: RawCredit[] } | undefined): CastMember[] {
  const byOrder = (a: RawCredit, b: RawCredit) => (a.order ?? 999) - (b.order ?? 999)
  const seen = new Set<number>()
  return [...(raw?.cast ?? []).sort(byOrder), ...(raw?.guest_stars ?? []).sort(byOrder)]
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map((c) => ({ id: c.id, name: c.name, role: c.character ?? '', profile: c.profile_path ?? undefined }))
}

/** The crew X-Ray lists: who directed it, or created it. */
export const crewOf = (crew: CastMember[]): CastMember[] => crew.filter((c) => c.role === 'Director' || c.role === 'Creator')

export interface PauseState {
  enabled: boolean
  paused: boolean
  ended: boolean
  scrubbing: boolean
  seeking: boolean
  hidden: boolean
  /** Something else wants the viewer's attention: the still-watching question, the source picker. */
  blocked: boolean
  /** The panel already open, if any: a viewer who opened Options isn't interrupted by X-Ray. */
  panel: string | null
}

/** Whether a pause should bring X-Ray up by itself: it's on, the picture is really stopped (not scrubbing, not a seek
 *  that paused for a moment, not the end of the film or a hidden page) and nothing else holds the viewer's attention. */
export function pauseOpensXRay(s: PauseState): boolean {
  return s.enabled && s.paused && !s.ended && !s.scrubbing && !s.seeking && !s.hidden && !s.blocked && s.panel === null
}
