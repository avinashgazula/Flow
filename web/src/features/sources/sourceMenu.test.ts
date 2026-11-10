import { describe, expect, it } from 'vitest'
import { sourceActionLabels, sourceActions } from './sourceMenu'

describe('sourceActions', () => {
  it('offers Play and Copy File Name for a source that plays and has a file name', () => {
    expect(sourceActions({ filename: 'Dune.Part.Two.2024.2160p.WEB-DL.mkv' }).map((a) => sourceActionLabels[a])).toEqual(['Play', 'Copy File Name'])
  })

  it('leaves out Copy File Name when the source has no file name', () => {
    expect(sourceActions({})).toEqual(['play'])
    expect(sourceActions({ filename: '  ' })).toEqual(['play'])
  })

  it('does not offer Play for a source this browser cannot play', () => {
    expect(sourceActions({ unsupported: 'DTS audio', filename: 'x.mkv' })).toEqual(['copyName'])
  })

  it('never offers the link', () => {
    expect(Object.values(sourceActionLabels).join(' ')).not.toMatch(/link|url/i)
  })
})
