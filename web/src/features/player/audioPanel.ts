/* What the Audio page says. Tracks are listed when the browser can see them (hls.js, the Matroska remuxer, Safari's
   `video.audioTracks`). When it can't, the page says so in words, instead of a fake row: the languages an add-on lists
   come from its metadata, not from the file, so they are information and never a selectable, checked choice. */

export type AudioPanel =
  /** Real tracks to choose from. */
  | { kind: 'tracks' }
  /** The browser plays the file itself and can't switch tracks: because its host blocks web pages (`blocked`), or because
   *  this browser has no API for it (Chrome and Firefox on a plain MP4 or WebM). */
  | { kind: 'fixed'; why: 'blocked' | 'browser'; languages?: string }
  /** One track, or none the engine names: the default plays. */
  | { kind: 'default'; languages?: string }

export function audioPanel({ tracks, blocked, cannotSwitch, languages }: { tracks: number; blocked: boolean; cannotSwitch: boolean; languages: readonly string[] | undefined }): AudioPanel {
  if (tracks > 0) return { kind: 'tracks' }
  const listed = languages && languages.length > 0 ? languages.join(' · ') : undefined
  if (blocked) return { kind: 'fixed', why: 'blocked', languages: listed }
  if (cannotSwitch) return { kind: 'fixed', why: 'browser', languages: listed }
  return { kind: 'default', languages: listed }
}

/** The short form for the Options row: "Audio · Chosen by the Browser". */
export function audioSummary(panel: AudioPanel): string {
  return panel.kind === 'fixed' ? 'Chosen by the Browser' : 'Default'
}

/** The note about a file's languages when the add-on listed them. It is the add-on's word, not the file's. */
export const languagesNote = (languages: string) => `Languages in this file: ${languages}`
