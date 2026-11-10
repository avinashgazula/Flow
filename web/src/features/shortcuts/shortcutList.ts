import { orderTabs, type Tab } from '../../lib/tabs'

/* What the shortcuts sheet lists, with the player's and Live TV's keys beside the Go shortcuts. It is only needed once the
   sheet opens, so it is kept apart from the keys themselves (shortcuts.ts), which every page carries. */

export interface Combo {
  keys: string[]
  /** One key after another (G, then H), rather than together (Ctrl and K). */
  then?: boolean
}
export interface ShortcutRow {
  combos: Combo[]
  label: string
}
export interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

const one = (key: string): Combo => ({ keys: [key] })

/** Everything the sheet lists. `mac` puts Command where other systems have Ctrl. */
export function shortcutGroups(mac: boolean, tabs: readonly Tab[] = orderTabs([])): ShortcutGroup[] {
  const mod = mac ? '⌘' : 'Ctrl'
  const go = (key: string): Combo => ({ keys: ['G', key], then: true })
  return [
    {
      title: 'Go',
      rows: [
        { combos: [go('H')], label: 'Home' },
        { combos: [go('E')], label: 'Explore' },
        { combos: [go('L')], label: 'Library' },
        { combos: [go('T')], label: 'Live TV' },
        { combos: [go('U')], label: 'Upcoming' },
        { combos: [go('C')], label: 'Continue Watching' },
        { combos: [go('S')], label: 'Settings' },
        { combos: [{ keys: ['G', `1 to ${tabs.length}`], then: true }], label: 'The tabs, in your order' },
      ],
    },
    {
      title: 'Anywhere',
      rows: [
        { combos: [one('/'), { keys: [mod, 'K'] }], label: 'Search' },
        { combos: [one('?')], label: 'This list of shortcuts' },
        { combos: [one('Esc')], label: 'Close a menu, sheet or the player' },
      ],
    },
    {
      title: 'Posters',
      rows: [
        { combos: [one('Tab')], label: 'Move to a poster’s More button' },
        { combos: [one('Shift F10'), one('Menu')], label: 'Open a poster’s menu from the keyboard' },
        { combos: [{ keys: ['Alt', '← →'] }], label: 'Move a poster in a custom-ordered Watchlist' },
      ],
    },
    {
      title: 'Sources',
      rows: [
        { combos: [one('↑ ↓'), one('Home'), one('End')], label: 'Move through the sources' },
        { combos: [one('Enter')], label: 'Play the selected source' },
        { combos: [one('Shift F10'), one('Menu')], label: 'Open the selected source’s menu: Play, Copy File Name' },
      ],
    },
    {
      title: 'Player',
      rows: [
        { combos: [one('Space'), one('K')], label: 'Play or pause' },
        { combos: [one('←'), one('J')], label: 'Skip back' },
        { combos: [one('→'), one('L')], label: 'Skip forward' },
        { combos: [one('↑ ↓')], label: 'Volume' },
        { combos: [one('M')], label: 'Mute' },
        { combos: [one('F')], label: 'Full screen' },
        { combos: [one('C')], label: 'Subtitles on or off' },
        { combos: [one('W')], label: 'What Did They Say?' },
        { combos: [one('X')], label: 'X-Ray (hold for 2× speed)' },
        { combos: [one('I')], label: 'Playback Info' },
        { combos: [one('S'), one('Enter')], label: 'Skip intro, credits or to the next episode' },
        { combos: [one('0 to 9')], label: 'Jump to that tenth of the film' },
        { combos: [one(','), one('.')], label: 'One frame back or forward, when paused' },
      ],
    },
    {
      title: 'Live TV',
      rows: [
        { combos: [one('↑ ↓')], label: 'Previous or next channel' },
        { combos: [one('L')], label: 'Channel list' },
        { combos: [one('F'), one('M'), one('P')], label: 'Full screen, mute, Picture in Picture' },
      ],
    },
  ]
}

/** Whether this is a Mac, for ⌘ over Ctrl. */
export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
