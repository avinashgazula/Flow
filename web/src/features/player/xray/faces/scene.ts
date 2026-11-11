/* What "In Scene" says, given what face recognition has done and what the dialogue names. Kept apart from the panel so the
   wording and the rules (never a name from a face unless it was matched, say where a list came from, fall back in plain words) are
   written down once and tested. */

export type FaceState =
  /** Recognise Faces is off, or the browser can't run it. */
  | { status: 'off' }
  | { status: 'loading'; stage: 'models' | 'photos' | 'frame' }
  /** A frame was looked at: how many faces were found in it and how many of those are a cast member. */
  | { status: 'done'; faces: number; matched: number }
  | { status: 'unavailable'; reason: Unavailable }

export type Unavailable =
  /** The stream's address doesn't let the page read its picture. */
  | 'unreadable'
  /** Data Saver is on, or the connection is slow, so the models weren't downloaded. */
  | 'metered'
  /** The models or the cast's photos couldn't be fetched, or the browser couldn't run them. */
  | 'failed'
  /** No picture yet. */
  | 'not-ready'
  /** The title has no cast photos to compare with. */
  | 'no-photos'

export type Basis = 'faces' | 'dialogue'

export interface SceneView {
  /** Which list the rows are: the faces matched in the picture, or the names found in the dialogue. */
  basis: Basis | null
  /** What to say under the rows, or in their place when there are none. */
  note: string
  /** The note is a progress line that may change by itself. */
  busy: boolean
}

export interface SceneFacts {
  state: FaceState
  /** How many were matched from faces (0 when none), and how many named by the dialogue. */
  fromFaces: number
  fromDialogue: number
  /** Whether there is any dialogue to read: true, false, or undefined while it is still being looked for. */
  reads: boolean | undefined
  /** Whether the cast has loaded. */
  loaded: boolean
}

const dialogueNote = 'Matched from dialogue.'

const why: Record<Unavailable, string> = {
  unreadable: 'This stream doesn’t let Flow read its picture.',
  metered: 'Data Saver is on, so Flow didn’t download the face models.',
  failed: 'Flow couldn’t load the face models.',
  'not-ready': 'The picture isn’t ready yet.',
  'no-photos': 'No cast photos to compare with.',
}

export function sceneView({ state, fromFaces, fromDialogue, reads, loaded }: SceneFacts): SceneView {
  // A name from a face is only ever one that was matched in the frame.
  if (fromFaces > 0) return { basis: 'faces', note: 'Recognised in this frame. Faces stay on this device.', busy: false }
  const faces = state.status === 'loading' ? 'Recognising faces…' : undefined
  if (fromDialogue > 0) {
    const tail = state.status === 'done' ? (state.faces > 0 ? 'No face in this frame matched the cast. ' : 'No faces found in this frame. ') : state.status === 'unavailable' ? `${why[state.reason]} ` : ''
    return { basis: 'dialogue', note: faces ? `${dialogueNote} ${faces}` : (state.status === 'off' ? 'Named in the last few minutes of dialogue.' : `${tail}${dialogueNote}`), busy: !!faces }
  }
  if (faces) return { basis: null, note: faces, busy: true }
  if (state.status === 'done') {
    const none = state.faces > 0 ? 'No one in this frame matched the cast.' : 'No faces found in this frame.'
    return { basis: null, note: reads === false || reads === undefined ? none : `${none} No one’s been named in the last few minutes of dialogue.`, busy: false }
  }
  // Without faces to go on, it is the dialogue's own story, as it always was.
  const lead = state.status === 'unavailable' ? `${why[state.reason]} ` : ''
  if (!loaded || reads === undefined) return { basis: null, note: lead ? `${lead}Reading the dialogue…` : 'Reading the dialogue…', busy: !lead }
  if (!reads) return { basis: null, note: `${lead}Turn on subtitles, or add a subtitle service in Settings, and X-Ray names who’s in each scene.`, busy: false }
  return { basis: null, note: `${lead}No one’s been named in the last few minutes.`, busy: false }
}
