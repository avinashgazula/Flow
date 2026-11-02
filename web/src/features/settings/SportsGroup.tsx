import { useEffect, useState } from 'react'
import { updateSports, useSportsSettings } from '../../lib/sports/settings'
import { defaultSports } from '../../lib/sports/types'
import { Group, Row, Switch } from './controls'

/** Settings → Live TV → Sports: TheSportsDB's key, whether scores show, and what tapping a game does (the apps' Sports
 *  group). The teams themselves are followed on the Sports page. */
export function SportsGroup() {
  const { apiKey, showScoreSpoilers, chooseChannelOnTap } = useSportsSettings()
  const [key, setKey] = useState(apiKey)
  // A key that arrives from a backup shows here at once.
  useEffect(() => {
    setKey(apiKey)
  }, [apiKey])
  const save = () => {
    const next = key.trim() || defaultSports.apiKey
    if (next !== apiKey) updateSports({ apiKey: next })
    setKey(next)
  }

  return (
    <Group
      title="Sports"
      footer={
        <>
          Library → Sports shows the teams you follow, from TheSportsDB. The free key, 123, works for everyone; a supporter’s key from{' '}
          <a href="https://www.thesportsdb.com/pricing" target="_blank" rel="noreferrer">
            thesportsdb.com
          </a>{' '}
          raises its limits. Choose Channel on Tap opens a game’s channel list when you tap it; off, a tap plays the best match.
        </>
      }
    >
      <Row label="TheSportsDB Key" htmlFor="sports-key">
        <input
          id="sports-key"
          className="field"
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder={defaultSports.apiKey}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </Row>
      <Row label="Show Score Spoilers">
        <Switch checked={showScoreSpoilers} onChange={(on) => updateSports({ showScoreSpoilers: on })} label="Show score spoilers" />
      </Row>
      <Row label="Choose Channel on Tap">
        <Switch checked={chooseChannelOnTap} onChange={(on) => updateSports({ chooseChannelOnTap: on })} label="Choose channel on tap" />
      </Row>
    </Group>
  )
}
