import { settingsStore } from './settings'
import { normaliseSubtitleStyle, type SubtitleStyle } from './subtitleStyle'

/** Changes some of the subtitle style's fields, keeping the rest and holding each to its range. Settings
 *  and the player both write through here, so a change in one shows in the other at once. Its own file
 *  so the first-load code carries only the defaults, not the rules. */
export const updateSubtitleStyle = (patch: Partial<SubtitleStyle>) =>
  settingsStore.set((s) => ({ subtitleStyle: normaliseSubtitleStyle({ ...s.subtitleStyle, ...patch }) }))
