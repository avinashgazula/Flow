import { describe, expect, it } from 'vitest'
import { isCommentary, mergeChoice, pickAudio, pickSubtitle, releaseLanguage, resolveAudioLanguages, trackLanguage, type TrackInfo } from './languages'

const track = (id: string, label: string, language?: string, unavailable?: string): TrackInfo => ({ id, label, language, unavailable })

const audio = [track('0', 'English · 5.1', 'eng'), track('1', 'Korean', 'kor'), track('2', 'Director’s Commentary', 'eng'), track('3', 'Hindi', 'hin')]

describe('resolveAudioLanguages', () => {
  it('replaces original with the title’s language, and drops it when that isn’t known', () => {
    expect(resolveAudioLanguages(['original', 'en'], 'ko')).toEqual(['ko', 'en'])
    expect(resolveAudioLanguages(['original', 'en'], undefined)).toEqual(['en'])
    expect(resolveAudioLanguages(['original', 'en'], 'en')).toEqual(['en'])
    expect(resolveAudioLanguages(['eng', 'EN-us', 'fr'])).toEqual(['en', 'fr'])
  })
})

describe('pickAudio', () => {
  it('starts on the title’s original language when Settings ask for it', () => {
    expect(pickAudio(audio, { languages: ['original', 'en'], original: 'ko' })?.id).toBe('1')
    expect(pickAudio(audio, { languages: ['original', 'en'], original: 'en' })?.id).toBe('0')
  })

  it('prefers a track that plays as it is over a converted one in the same language', () => {
    const tracks = [
      { id: 'dd', label: 'English · Dolby Digital 5.1', language: 'eng', converted: true },
      { id: 'aac', label: 'English · Stereo', language: 'eng' },
    ]
    expect(pickAudio(tracks, { languages: ['en'] })?.id).toBe('aac')
    // Only converted tracks in the language: the first of them still wins over another language.
    expect(pickAudio([tracks[0]!, { id: 'fr', label: 'French', language: 'fre' }], { languages: ['en'] })?.id).toBe('dd')
  })

  it('goes to the second choice when the first isn’t in the file', () => {
    expect(pickAudio(audio, { languages: ['ja', 'hi', 'en'] })?.id).toBe('3')
    // Original isn't known for this title, so it's skipped rather than guessed.
    expect(pickAudio(audio, { languages: ['original', 'hi'] })?.id).toBe('3')
  })

  it('leaves the stream’s own default when nothing matches', () => {
    expect(pickAudio(audio, { languages: ['ja', 'fr'] })).toBeUndefined()
    expect(pickAudio(audio, { languages: [] })).toBeUndefined()
    expect(pickAudio([], { languages: ['en'] })).toBeUndefined()
  })

  it('skips commentary, even when it’s the only track in the language', () => {
    expect(pickAudio([track('2', 'Commentary', 'en'), track('1', 'English', 'en')], { languages: ['en'] })?.id).toBe('1')
    expect(pickAudio([track('2', 'Audio Description', 'en'), track('1', 'French', 'fr')], { languages: ['en', 'fr'] })?.id).toBe('1')
  })

  it('prefers a track that plays here', () => {
    const list = [track('0', 'English · 5.1', 'eng', 'DTS can’t play in this browser'), track('1', 'English', 'eng'), track('2', 'Korean', 'kor')]
    expect(pickAudio(list, { languages: ['en'] })?.id).toBe('1')
    expect(pickAudio([list[0]!, list[2]!], { languages: ['en', 'ko'] })?.id).toBe('2')
  })

  it('reads the language from the label when the tag is missing', () => {
    expect(pickAudio([track('0', 'French'), track('1', 'English (SDH)')], { languages: ['en'] })?.id).toBe('1')
  })

  it('puts what was picked by hand for this title first', () => {
    expect(pickAudio(audio, { languages: ['original', 'en'], original: 'ko', choice: { audio: 'hi' } })?.id).toBe('3')
    // A show's next episode may not have that language: Settings apply.
    expect(pickAudio(audio, { languages: ['original', 'en'], original: 'ko', choice: { audio: 'fr' } })?.id).toBe('1')
  })
})

const subs = [track('s0', 'English', 'eng'), track('s1', 'English (Forced)', 'eng'), track('s2', 'Spanish', 'spa'), track('s3', 'Korean', 'kor'), track('s4', 'Picture subtitles', 'fre', 'Picture subtitles aren’t supported yet')]
const prefs = (subtitleMode: 'off' | 'foreign' | 'always', subtitleLanguages = ['en']) => ({ subtitleMode, subtitleLanguages })

describe('pickSubtitle', () => {
  it('Foreign Audio Only: subtitles when the audio isn’t in my language', () => {
    expect(pickSubtitle(subs, { audioLanguage: 'ko', preferences: prefs('foreign') })?.id).toBe('s0')
  })

  it('Foreign Audio Only: none when the audio is in my language', () => {
    expect(pickSubtitle([subs[0]!, subs[2]!], { audioLanguage: 'en-GB', preferences: prefs('foreign') })).toBeNull()
  })

  it('Foreign Audio Only: a second language when the first isn’t offered', () => {
    expect(pickSubtitle(subs, { audioLanguage: 'ja', preferences: prefs('foreign', ['fr', 'es']) })?.id).toBe('s2')
    expect(pickSubtitle(subs, { audioLanguage: 'ja', preferences: prefs('foreign', ['fr']) })).toBeNull()
  })

  it('Foreign Audio Only: audio nobody can name doesn’t count as foreign', () => {
    expect(pickSubtitle([subs[0]!], { preferences: prefs('foreign') })).toBeNull()
    expect(pickSubtitle([subs[0]!], { audioLanguage: 'und', preferences: prefs('foreign') })).toBeNull()
  })

  it('Foreign Audio Only: needs a language of my own to compare with', () => {
    expect(pickSubtitle(subs, { audioLanguage: 'ko', preferences: prefs('foreign', []) })).toBeNull()
  })

  it('Always: the preferred language whatever the audio, full subtitles before forced ones', () => {
    expect(pickSubtitle(subs, { audioLanguage: 'en', preferences: prefs('always') })?.id).toBe('s0')
    expect(pickSubtitle(subs, { audioLanguage: 'ko', preferences: prefs('always', ['es', 'en']) })?.id).toBe('s2')
    expect(pickSubtitle([subs[1]!], { audioLanguage: 'en', preferences: prefs('always') })?.id).toBe('s1')
    expect(pickSubtitle(subs, { audioLanguage: 'en', preferences: prefs('always', ['de']) })).toBeNull()
  })

  it('Off: none, but the forced track for the audio’s own language stays on', () => {
    expect(pickSubtitle(subs, { audioLanguage: 'ko', preferences: prefs('off') })).toBeNull()
    expect(pickSubtitle(subs, { audioLanguage: 'en', preferences: prefs('off') })?.id).toBe('s1')
    expect(pickSubtitle(subs, { audioLanguage: 'en', preferences: prefs('foreign') })?.id).toBe('s1')
    expect(pickSubtitle(subs, { preferences: prefs('off') })).toBeNull()
  })

  it('never picks a track that can’t be shown', () => {
    expect(pickSubtitle([subs[4]!], { audioLanguage: 'ko', preferences: prefs('always', ['fr']) })).toBeNull()
  })

  it('honours what was picked by hand for this title, over the mode', () => {
    expect(pickSubtitle(subs, { audioLanguage: 'en', preferences: prefs('off'), choice: { subtitle: 'es' } })?.id).toBe('s2')
    expect(pickSubtitle(subs, { audioLanguage: 'ko', preferences: prefs('always'), choice: { subtitle: null } })).toBeNull()
    // Not in this file: Settings apply.
    expect(pickSubtitle(subs, { audioLanguage: 'ko', preferences: prefs('foreign'), choice: { subtitle: 'de' } })?.id).toBe('s0')
  })
})

describe('track names', () => {
  it('knows commentary', () => {
    expect(isCommentary(track('0', 'Commentary with the Director'))).toBe(true)
    expect(isCommentary(track('0', 'English · 5.1'))).toBe(false)
  })
  it('names a track’s language by tag or label', () => {
    expect(trackLanguage(track('0', 'x', 'eng'))).toBe('en')
    expect(trackLanguage(track('0', 'Spanish (Latin America)'))).toBe('es')
    expect(trackLanguage(track('0', 'Track 3', 'und'))).toBeUndefined()
  })
  it('reads one language from a release, and nothing from a mix', () => {
    expect(releaseLanguage(['English'])).toBe('en')
    expect(releaseLanguage(['English', 'Hindi'])).toBeUndefined()
    expect(releaseLanguage(['Multi'])).toBeUndefined()
    expect(releaseLanguage([])).toBeUndefined()
    expect(releaseLanguage(undefined)).toBeUndefined()
  })
})

describe('mergeChoice', () => {
  it('keeps what was picked earlier for the title and adds the new pick', () => {
    const a = mergeChoice({}, 'show:1', { audio: 'ko' }, 10)
    const b = mergeChoice(a, 'show:1', { subtitle: null }, 20)
    expect(b['show:1']).toEqual({ audio: 'ko', subtitle: null, at: 20 })
  })
  it('keeps other titles apart and forgets the oldest past the limit', () => {
    let all = mergeChoice({}, 'movie:1', { audio: 'en' }, 1)
    all = mergeChoice(all, 'movie:2', { audio: 'fr' }, 2, 2)
    all = mergeChoice(all, 'movie:3', { audio: 'de' }, 3, 2)
    expect(Object.keys(all).sort()).toEqual(['movie:2', 'movie:3'])
  })
})
