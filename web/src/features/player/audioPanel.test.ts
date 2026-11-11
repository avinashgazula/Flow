import { describe, expect, it } from 'vitest'
import { audioPanel, audioSummary } from './audioPanel'

const langs = ['English', 'Spanish', 'French']

describe('audioPanel', () => {
  it('lists tracks whenever the browser can see some', () => {
    expect(audioPanel({ tracks: 2, blocked: false, cannotSwitch: false, languages: langs })).toEqual({ kind: 'tracks' })
    expect(audioPanel({ tracks: 1, blocked: true, cannotSwitch: true, languages: langs })).toEqual({ kind: 'tracks' })
  })
  it('says plainly that a browser without the tracks API cannot switch, and keeps the languages as information', () => {
    expect(audioPanel({ tracks: 0, blocked: false, cannotSwitch: true, languages: langs })).toEqual({ kind: 'fixed', why: 'browser', languages: 'English · Spanish · French' })
  })
  it('tells a blocked host apart', () => {
    expect(audioPanel({ tracks: 0, blocked: true, cannotSwitch: true, languages: undefined })).toEqual({ kind: 'fixed', why: 'blocked', languages: undefined })
  })
  it('falls back to the default for a stream with no named tracks', () => {
    expect(audioPanel({ tracks: 0, blocked: false, cannotSwitch: false, languages: [] })).toEqual({ kind: 'default', languages: undefined })
  })
  it('summarises for the Options row', () => {
    expect(audioSummary({ kind: 'fixed', why: 'browser' })).toBe('Chosen by the Browser')
    expect(audioSummary({ kind: 'default' })).toBe('Default')
  })
})
