import { useEffect, useState } from 'react'
import { Group, Row } from './controls'

const size = (bytes: number) => (bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`)

export function AboutSection() {
  const [used, setUsed] = useState<string>()
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => e.usage !== undefined && setUsed(size(e.usage)))
  }, [])

  return (
    <Group footer="This product uses the TMDB API but is not endorsed or certified by TMDB. Flow hosts no content: it plays what your own sources provide.">
      <Row label="Flow for the Web" detail="The same Flow, in your browser" />
      {used && <Row label="Stored in This Browser" detail="Cache, library and settings">{used}</Row>}
      <Row label="Metadata">
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
          TMDB
        </a>
      </Row>
    </Group>
  )
}
