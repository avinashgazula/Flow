import { settingsStore, useSettings, type Settings } from '../store/settings'
import { defaultSports, type SportsSettings, type SportsTeam } from './types'

/* The viewer's Sports choices that live in this browser. They are part of Settings (so a backup carries them) but
   absent until the first change, so nothing here loads with the first page; read them through `sportsSettings`. */

export const sportsSettings = (s: Settings): SportsSettings => ({ ...defaultSports, ...s.sports })

export function updateSports(change: Partial<SportsSettings> | ((current: SportsSettings) => Partial<SportsSettings>)) {
  settingsStore.set((s) => {
    const current = sportsSettings(s)
    return { sports: { ...current, ...(typeof change === 'function' ? change(current) : change) } }
  })
}

const none: SportsTeam[] = []
export const useFollowedTeams = () => useSettings((s) => s.sports?.followedTeams ?? none)
export const useSportsSettings = (): SportsSettings => {
  const stored = useSettings((s) => s.sports)
  return { ...defaultSports, ...stored }
}

/** Follows a team, once. */
export const followTeam = (team: SportsTeam) => updateSports((c) => ({ followedTeams: c.followedTeams.some((t) => t.id === team.id) ? c.followedTeams : [...c.followedTeams, team] }))
export const unfollowTeam = (id: string) => updateSports((c) => ({ followedTeams: c.followedTeams.filter((t) => t.id !== id) }))
