import { describe, expect, it } from 'vitest'
import { sceneView, type FaceState, type SceneFacts } from './scene'
import { mayDownload, mayFollow } from './policy'

const view = (state: FaceState, over: Partial<SceneFacts> = {}) => sceneView({ state, fromFaces: 0, fromDialogue: 0, reads: true, loaded: true, ...over })

describe('what In Scene says', () => {
  it('lists the faces matched, and says they never left the device', () => {
    const v = view({ status: 'done', faces: 3, matched: 2 }, { fromFaces: 2, fromDialogue: 4 })
    expect(v.basis).toBe('faces')
    expect(v.note).toContain('Recognised in this frame')
    expect(v.note).toContain('on this device')
  })

  it('keeps the dialogue’s names while faces are being recognised, and says so', () => {
    const v = view({ status: 'loading', stage: 'models' }, { fromDialogue: 2 })
    expect(v).toEqual({ basis: 'dialogue', note: 'Matched from dialogue. Recognising faces…', busy: true })
  })

  it('falls back to the dialogue in plain words when no face matched', () => {
    expect(view({ status: 'done', faces: 2, matched: 0 }, { fromDialogue: 1 }).note).toBe('No face in this frame matched the cast. Matched from dialogue.')
    expect(view({ status: 'done', faces: 0, matched: 0 }, { fromDialogue: 1 }).note).toBe('No faces found in this frame. Matched from dialogue.')
  })

  it('says why it fell back when the picture can’t be read', () => {
    const v = view({ status: 'unavailable', reason: 'unreadable' }, { fromDialogue: 1 })
    expect(v.basis).toBe('dialogue')
    expect(v.note).toBe('This stream doesn’t let Flow read its picture. Matched from dialogue.')
  })

  it('says nobody was recognised when there is nothing else to go on', () => {
    expect(view({ status: 'done', faces: 3, matched: 0 }, { reads: false }).note).toBe('No one in this frame matched the cast.')
    expect(view({ status: 'done', faces: 0, matched: 0 }, { reads: false }).note).toBe('No faces found in this frame.')
    expect(view({ status: 'done', faces: 3, matched: 0 }).note).toBe('No one in this frame matched the cast. No one’s been named in the last few minutes of dialogue.')
  })

  it('shows progress while there is nothing yet', () => {
    expect(view({ status: 'loading', stage: 'photos' })).toEqual({ basis: null, note: 'Recognising faces…', busy: true })
  })

  it('reads as it always did with Recognise Faces off', () => {
    expect(view({ status: 'off' }, { fromDialogue: 2 })).toEqual({ basis: 'dialogue', note: 'Named in the last few minutes of dialogue.', busy: false })
    expect(view({ status: 'off' }, { reads: undefined }).note).toBe('Reading the dialogue…')
    expect(view({ status: 'off' }, { reads: false }).note).toContain('Turn on subtitles')
    expect(view({ status: 'off' }).note).toBe('No one’s been named in the last few minutes.')
  })

  it('leads with the reason when faces are out and there is no dialogue either', () => {
    expect(view({ status: 'unavailable', reason: 'metered' }, { reads: false }).note).toMatch(/^Data Saver is on/)
  })

  it('never lists faces unless some were matched', () => {
    for (const state of [{ status: 'off' }, { status: 'loading', stage: 'frame' }, { status: 'done', faces: 4, matched: 0 }, { status: 'unavailable', reason: 'failed' }] as FaceState[]) {
      expect(view(state, { fromDialogue: 3 }).basis).not.toBe('faces')
    }
  })
})

describe('when faces may use data and battery', () => {
  it('downloads the models unless the connection is metered or slow', () => {
    expect(mayDownload(undefined)).toBe(true)
    expect(mayDownload({ effectiveType: '4g' })).toBe(true)
    expect(mayDownload({ saveData: true })).toBe(false)
    expect(mayDownload({ effectiveType: '3g' })).toBe(false)
    expect(mayDownload({ type: 'cellular' })).toBe(false)
  })

  it('follows the picture only with the tab showing and Data Saver off', () => {
    expect(mayFollow(undefined, false)).toBe(true)
    expect(mayFollow(undefined, true)).toBe(false)
    expect(mayFollow({ saveData: true }, false)).toBe(false)
  })
})
