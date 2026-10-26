import { describe, expect, it } from 'vitest'
import { animeRule, audioLanguagesFor, decideSubtitle, isAnime, isCommentary, isSDH, mergeChoice, pickAudio, pickSubtitle, releaseLanguage, resolveAudioLanguages, trackLanguage, type TrackInfo } from './languages'

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
const prefs = (subtitleMode: 'off' | 'foreign' | 'always' | 'forced', subtitleLanguages = ['en'], subtitleType?: 'standard' | 'sdh') => ({ subtitleMode, subtitleLanguages, subtitleType })

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

describe('Forced Only', () => {
  const forcedFile = [track('f0', 'English', 'eng'), track('f1', 'English (Forced)', 'eng'), track('f2', 'Spanish (Forced)', 'spa'), track('f3', 'Korean', 'kor')]

  it('takes a forced track in my language and never a full one', () => {
    expect(pickSubtitle(forcedFile, { audioLanguage: 'ko', preferences: prefs('forced') })?.id).toBe('f1')
    expect(pickSubtitle([forcedFile[0]!, forcedFile[3]!], { audioLanguage: 'ko', preferences: prefs('forced') })).toBeNull()
  })

  it('goes down my languages in order, then the forced track for the audio’s own language', () => {
    expect(pickSubtitle(forcedFile, { audioLanguage: 'ko', preferences: prefs('forced', ['de', 'es']) })?.id).toBe('f2')
    expect(pickSubtitle(forcedFile, { audioLanguage: 'es', preferences: prefs('forced', ['de']) })?.id).toBe('f2')
    expect(pickSubtitle(forcedFile, { audioLanguage: 'ko', preferences: prefs('forced', []) })).toBeNull()
  })

  it('does not ask for a search, whatever the file lacks', () => {
    expect(decideSubtitle([forcedFile[0]!], { audioLanguage: 'ko', preferences: prefs('forced') })).toEqual({ kind: 'off' })
  })

  it('ignores a forced track that came from a search: those are timed to a different cut', () => {
    const online = { ...track('dl:1', 'English (Forced)', 'eng'), online: true }
    expect(pickSubtitle([online], { audioLanguage: 'ko', preferences: prefs('forced') })).toBeNull()
  })

  it('still yields to what was picked by hand for the title', () => {
    expect(pickSubtitle([...forcedFile, track('f4', 'Spanish', 'spa')], { audioLanguage: 'ko', preferences: prefs('forced'), choice: { subtitle: 'es' } })?.id).toBe('f4')
    expect(pickSubtitle(forcedFile, { audioLanguage: 'ko', preferences: prefs('forced'), choice: { subtitle: null } })).toBeNull()
  })
})

describe('SDH or standard', () => {
  const both = [track('a', 'English (SDH)', 'eng'), track('b', 'English', 'eng'), track('c', 'Spanish', 'spa'), track('d', 'Spanish (SDH)', 'spa')]

  it('reads SDH from the name, or from the track when it says so', () => {
    expect(isSDH(track('0', 'English (SDH)'))).toBe(true)
    expect(isSDH(track('0', 'English · Hearing Impaired'))).toBe(true)
    expect(isSDH(track('0', 'English CC'))).toBe(true)
    expect(isSDH(track('0', 'English'))).toBe(false)
    expect(isSDH(track('0', 'Swedish'))).toBe(false)
    expect(isSDH({ ...track('0', 'English'), hearingImpaired: true })).toBe(true)
    expect(isSDH({ ...track('0', 'English (SDH)'), hearingImpaired: false })).toBe(false)
  })

  it('takes standard subtitles unless SDH is chosen, and the other kind when a language has only one', () => {
    expect(pickSubtitle(both, { audioLanguage: 'ko', preferences: prefs('always') })?.id).toBe('b')
    expect(pickSubtitle(both, { audioLanguage: 'ko', preferences: prefs('always', ['en'], 'standard') })?.id).toBe('b')
    expect(pickSubtitle(both, { audioLanguage: 'ko', preferences: prefs('always', ['en'], 'sdh') })?.id).toBe('a')
    expect(pickSubtitle([both[0]!], { audioLanguage: 'ko', preferences: prefs('always', ['en'], 'standard') })?.id).toBe('a')
    expect(pickSubtitle([both[1]!], { audioLanguage: 'ko', preferences: prefs('always', ['en'], 'sdh') })?.id).toBe('b')
  })

  it('chooses the language before the kind', () => {
    expect(pickSubtitle(both, { audioLanguage: 'ko', preferences: prefs('always', ['es', 'en'], 'sdh') })?.id).toBe('d')
    expect(pickSubtitle([both[1]!, both[3]!], { audioLanguage: 'ko', preferences: prefs('always', ['en', 'es'], 'sdh') })?.id).toBe('b')
  })

  it('applies to forced tracks too', () => {
    const forced = [track('f', 'English (Forced)', 'eng'), track('g', 'English (Forced, SDH)', 'eng')]
    expect(pickSubtitle(forced, { audioLanguage: 'ko', preferences: prefs('forced', ['en'], 'sdh') })?.id).toBe('g')
    expect(pickSubtitle(forced, { audioLanguage: 'ko', preferences: prefs('forced', ['en'], 'standard') })?.id).toBe('f')
  })
})

describe('a subtitle from a search', () => {
  const online = { ...track('dl:0', 'English · OpenSubtitles', 'en'), online: true }

  it('asks for a search when the file has none in my language', () => {
    expect(decideSubtitle([subs[3]!], { audioLanguage: 'ko', preferences: prefs('always') })).toEqual({ kind: 'search', languages: ['en'], fallback: null })
    expect(decideSubtitle([subs[3]!], { audioLanguage: 'ko', preferences: prefs('foreign', ['fr', 'es']) })).toEqual({ kind: 'search', languages: ['fr', 'es'], fallback: null })
  })

  it('shows a forced-only track meanwhile, when that’s all the file has', () => {
    expect(decideSubtitle([subs[1]!], { audioLanguage: 'en', preferences: prefs('always') })).toEqual({ kind: 'search', languages: ['en'], fallback: subs[1] })
  })

  it('prefers the file’s own subtitles to one from a search, in any language of mine', () => {
    expect(pickSubtitle([online, subs[2]!], { audioLanguage: 'ko', preferences: prefs('always', ['en', 'es']) })?.id).toBe('s2')
    expect(pickSubtitle([online, subs[0]!], { audioLanguage: 'ko', preferences: prefs('always') })?.id).toBe('s0')
  })

  it('takes one already downloaded rather than searching again', () => {
    expect(decideSubtitle([subs[3]!, online], { audioLanguage: 'ko', preferences: prefs('always') })).toEqual({ kind: 'track', track: online })
  })

  it('never searches when subtitles are off or only forced ones are wanted', () => {
    expect(decideSubtitle([], { audioLanguage: 'ko', preferences: prefs('off') })).toEqual({ kind: 'off' })
    expect(decideSubtitle([], { audioLanguage: 'ko', preferences: prefs('forced') })).toEqual({ kind: 'off' })
    expect(decideSubtitle([], { audioLanguage: 'en', preferences: prefs('foreign') })).toEqual({ kind: 'off' })
  })

  it('searches for the language picked by hand when the file lacks it, then falls back to Settings', () => {
    expect(decideSubtitle([subs[0]!], { audioLanguage: 'ko', preferences: prefs('foreign'), choice: { subtitle: 'de' } })).toEqual({ kind: 'track', track: subs[0] })
    expect(decideSubtitle([subs[3]!], { audioLanguage: 'ko', preferences: prefs('foreign'), choice: { subtitle: 'de' } })).toEqual({ kind: 'search', languages: ['en'], fallback: null })
  })
})

describe('anime', () => {
  const file = [track('s0', 'English', 'eng'), track('s1', 'English (Forced)', 'eng')]

  it('is Japanese animation', () => {
    expect(isAnime([16, 35], 'ja')).toBe(true)
    expect(isAnime([16], 'jpn')).toBe(true)
    expect(isAnime([16], 'en')).toBe(false)
    expect(isAnime([35], 'ja')).toBe(false)
    expect(isAnime(undefined, 'ja')).toBe(false)
    expect(isAnime([16], undefined)).toBe(false)
  })

  it('only matters for anime, and only when Sub or Dub is chosen', () => {
    expect(animeRule(true, 'sub')).toBe('sub')
    expect(animeRule(true, 'dub')).toBe('dub')
    expect(animeRule(true, 'noPreference')).toBeUndefined()
    expect(animeRule(true, undefined)).toBeUndefined()
    expect(animeRule(false, 'sub')).toBeUndefined()
  })

  it('Sub: Japanese audio first, then my own', () => {
    expect(audioLanguagesFor(['original', 'en'], 'sub')).toEqual(['ja', 'original', 'en'])
    expect(audioLanguagesFor(['ja', 'en'], 'sub')).toEqual(['ja', 'en'])
    expect(audioLanguagesFor(['original', 'en'], 'dub')).toEqual(['original', 'en'])
    expect(audioLanguagesFor(['original', 'en'], undefined)).toEqual(['original', 'en'])
    const tracks = [track('0', 'English', 'eng'), track('1', 'Japanese', 'jpn')]
    expect(pickAudio(tracks, { languages: audioLanguagesFor(['en'], 'sub') })?.id).toBe('1')
    expect(pickAudio(tracks, { languages: audioLanguagesFor(['en'], 'dub') })?.id).toBe('0')
    // Without a Japanese track, my own language still plays.
    expect(pickAudio([tracks[0]!], { languages: audioLanguagesFor(['en'], 'sub') })?.id).toBe('0')
  })

  it('Sub: subtitles always, whatever Settings say', () => {
    expect(pickSubtitle(file, { audioLanguage: 'ja', preferences: prefs('off'), anime: 'sub' })?.id).toBe('s0')
    expect(pickSubtitle(file, { audioLanguage: 'ja', preferences: prefs('forced'), anime: 'sub' })?.id).toBe('s0')
    expect(pickSubtitle(file, { audioLanguage: 'en', preferences: prefs('foreign'), anime: 'sub' })?.id).toBe('s0')
  })

  it('Dub: no subtitles at all, not even forced ones', () => {
    expect(decideSubtitle(file, { audioLanguage: 'en', preferences: prefs('always'), anime: 'dub' })).toEqual({ kind: 'off' })
    expect(decideSubtitle(file, { audioLanguage: 'en', preferences: prefs('foreign'), anime: 'dub' })).toEqual({ kind: 'off' })
  })

  it('leaves other titles alone, and yields to what was picked by hand', () => {
    expect(pickSubtitle(file, { audioLanguage: 'en', preferences: prefs('foreign') })?.id).toBe('s1')
    expect(pickSubtitle(file, { audioLanguage: 'ja', preferences: prefs('always'), anime: 'dub', choice: { subtitle: 'en' } })?.id).toBe('s0')
    expect(pickSubtitle(file, { audioLanguage: 'ja', preferences: prefs('always'), anime: 'sub', choice: { subtitle: null } })).toBeNull()
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
