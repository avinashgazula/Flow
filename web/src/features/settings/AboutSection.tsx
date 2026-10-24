import { useEffect, useState } from 'react'
import { promptInstall, useInstallMode } from '../../lib/pwa/install'
import { Group, Row } from './controls'

const size = (bytes: number) => (bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`)

export function AboutSection() {
  const [used, setUsed] = useState<string>()
  const install = useInstallMode()
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => e.usage !== undefined && setUsed(size(e.usage)))
  }, [])

  return (
    <Group footer="This product uses the TMDB API but is not endorsed or certified by TMDB. Flow hosts no content: it plays what your own sources provide.">
      <Row label="Flow for the Web" detail="The same Flow, in your browser" />
      {/* Only where there is something to do: a browser that can install it, or Safari on iPhone and iPad,
          which can't be asked and has to be told. Nothing otherwise, and nothing once it is installed. */}
      {install === 'prompt' && (
        <Row label="Install Flow" detail="Opens in a window of its own, like an app.">
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => void promptInstall()}>
            Install
          </button>
        </Row>
      )}
      {install === 'ios' && <Row label="Install Flow" detail="Tap Share, then Add to Home Screen, and Flow opens from your Home Screen like an app." />}
      {used && <Row label="Stored in This Browser" detail="Cache, library and settings">{used}</Row>}
      <Row label="Metadata">
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
          TMDB
        </a>
      </Row>
    </Group>
  )
}
