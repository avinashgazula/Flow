import { settingsStore, useSettings, type Settings } from '../store/settings'
import { defaultLiveTV, type IPTVProviderConfig, type LiveTVSettings } from './types'
import { demoProvider } from './demo'

/* The viewer's Live TV choices that live in this browser: which providers, which channels are favourites
   and which were watched last. They are part of Settings (so a backup carries them), as in the apps. */

const noIDs: string[] = []

export const liveTVSettings = (s: Settings): LiveTVSettings => ({ ...defaultLiveTV, ...s.liveTV })

export function updateLiveTV(change: Partial<LiveTVSettings> | ((current: LiveTVSettings) => Partial<LiveTVSettings>)) {
  settingsStore.set((s) => {
    const current = liveTVSettings(s)
    return { liveTV: { ...current, ...(typeof change === 'function' ? change(current) : change) } }
  })
}

/** The providers Live TV reads: the sample one while sample data is on (as the apps' demo does), else the
 *  viewer's own. */
export const activeProviders = (s: Settings): IPTVProviderConfig[] => (s.demo ? [demoProvider] : (s.liveTV?.providers ?? []))

export const useProviders = () => useSettings((s) => s.liveTV?.providers ?? [])
export const useFavouriteIDs = () => useSettings((s) => s.liveTV?.favouriteChannelIDs ?? noIDs)

export const isFavourite = (id: string) => (settingsStore.get().liveTV?.favouriteChannelIDs ?? noIDs).includes(id)

/** Adds the channel to the favourites, or takes it off. Returns whether it is a favourite now. */
export function toggleFavourite(id: string): boolean {
  const had = isFavourite(id)
  updateLiveTV((c) => ({ favouriteChannelIDs: had ? c.favouriteChannelIDs.filter((x) => x !== id) : [...c.favouriteChannelIDs, id] }))
  return !had
}

export const clearFavourites = () => updateLiveTV({ favouriteChannelIDs: [] })

/** The channel watched last goes to the front; twenty are kept. */
export function recordRecent(id: string) {
  updateLiveTV((c) => ({ recentChannelIDs: [id, ...c.recentChannelIDs.filter((x) => x !== id)].slice(0, 20) }))
}
