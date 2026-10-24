import { describe, expect, it } from 'vitest'
import { StillWatching } from './stillWatching'

/* The first six are FlowKit's StillWatchingTests, case for case. */
describe('StillWatching', () => {
  it('asks after the limit of untouched episodes', () => {
    const watch = new StillWatching()
    expect(watch.shouldAsk(2)).toBe(false)
    watch.noteAutomaticAdvance()
    expect(watch.shouldAsk(2)).toBe(false)
    watch.noteAutomaticAdvance()
    expect(watch.shouldAsk(2)).toBe(true)
  })

  it('never asks when the limit is zero', () => {
    const watch = new StillWatching()
    for (let i = 0; i < 10; i++) watch.noteAutomaticAdvance()
    expect(watch.shouldAsk(0)).toBe(false)
  })

  it('starts again after an interaction', () => {
    const watch = new StillWatching()
    watch.noteAutomaticAdvance()
    watch.noteAutomaticAdvance()
    watch.noteInteraction()
    expect(watch.shouldAsk(2)).toBe(false)
  })

  it('takes a pause mid-episode to mean someone is there', () => {
    const watch = new StillWatching()
    watch.noteAutomaticAdvance()
    watch.noteAutomaticAdvance()
    watch.notePause(600, 2700)
    expect(watch.unattendedEpisodes).toBe(0)
  })

  it('does not count the episode ending on its own', () => {
    // A browser pauses an element as it plays to its end, just before the ended event.
    const watch = new StillWatching()
    watch.noteAutomaticAdvance()
    watch.noteAutomaticAdvance()
    watch.notePause(2699.2, 2700)
    expect(watch.shouldAsk(2)).toBe(true)
  })

  it('counts a pause before the length is known', () => {
    const watch = new StillWatching()
    watch.noteAutomaticAdvance()
    watch.notePause(0, 0)
    expect(watch.unattendedEpisodes).toBe(0)
  })

  it('counts a pause just outside the last three seconds, and not one inside them', () => {
    const watch = new StillWatching()
    watch.noteAutomaticAdvance()
    watch.notePause(2696.9, 2700)
    expect(watch.unattendedEpisodes).toBe(0)
    watch.noteAutomaticAdvance()
    watch.notePause(2697, 2700)
    expect(watch.unattendedEpisodes).toBe(1)
  })

  it('keeps counting across episodes played untouched, and asks before the one after the limit', () => {
    const watch = new StillWatching()
    const limit = 3
    const asked: boolean[] = []
    for (let episode = 0; episode < 4; episode++) {
      // Each ends on its own: a pause in the last second, then the next starts by itself unless asked.
      watch.notePause(2699.5, 2700)
      const ask = watch.shouldAsk(limit)
      asked.push(ask)
      if (!ask) watch.noteAutomaticAdvance()
    }
    expect(asked).toEqual([false, false, false, true])
  })
})
