import type { CastMember } from '../../../lib/tmdb/types'
import { namesACharacter, type DialogueCue } from './xray'

/* Sample data has no subtitle services to fetch a real file from, so X-Ray reads these: a line every twenty
   seconds that names someone in the title's cast, by first name or full, so who is "in the scene" moves as
   the film plays. They are never shown; they only stand in for the dialogue. */

const lines: ((first: string, full: string) => string)[] = [
  (first) => `${first}, look at me.`,
  (first) => `Where's ${first}? He said he'd be here.`,
  (_, full) => `Have you met ${full}?`,
  (first) => `I told ${first} we'd be there by dark.`,
  (first) => `Wait. ${first}, listen.`,
  (_, full) => `They say ${full} was never there.`,
]

/** "Walter White / Heisenberg (voice)" is Walter; "Dr. House" is House; "Lady Jessica" is Jessica. */
function firstName(role: string): string | undefined {
  const name = role.replace(/\([^)]*\)/g, ' ').split(/[/;|]/)[0] ?? ''
  const skip = new Set(['dr.', 'dr', 'mr.', 'mr', 'mrs.', 'mrs', 'lady', 'lord', 'king', 'queen', 'the', 'young', 'professor', 'captain', 'agent', 'lieutenant'])
  return name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}'’-]/gu, ''))
    .find((w) => w.length >= 3 && !skip.has(w.toLowerCase()) && /^\p{Lu}/u.test(w))
}

/** Cues for the first half hour, a line every twenty seconds, naming up to eight of the cast in turn. */
export function demoDialogue(cast: CastMember[]): DialogueCue[] {
  const people = cast
    .filter(namesACharacter)
    .map((m) => ({ first: firstName(m.role), full: m.role.replace(/\([^)]*\)/g, '').split(/[/;|]/)[0]!.trim() }))
    .filter((p): p is { first: string; full: string } => !!p.first)
    .slice(0, 8)
  if (people.length === 0) return []
  return Array.from({ length: 90 }, (_, i) => {
    // A scene of nine lines (three minutes) names three people, and the next scene moves on by two.
    const who = people[(Math.floor(i / 9) * 2 + (i % 3)) % people.length]!
    return { startTime: 8 + i * 20, text: lines[i % lines.length]!(who.first, who.full) }
  })
}
