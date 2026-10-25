import { describe, expect, it } from 'vitest'
import { fixedCapabilities } from '../../lib/sources/capabilities'
import { parseStream } from '../../lib/sources/parser'
import { buildSource } from '../../lib/sources/rank'
import { defaultSourceAppearance, type SourceAppearance } from '../../lib/sources/sourceSettings'
import { rowText, spokenLabel } from './labels'

const text = 'AIOStreams\n✨ 4K 🎫\nWEB-DL\nDV HDR10\n🔊 TrueHD Atmos 7.1\n📦 18.2 GB\n🌎 English • Spanish'
const filename = 'Dune.2024.2160p.WEB-DL.DV.HDR10.TrueHD.Atmos.7.1.HEVC-FLUX.mkv'
const caps = fixedCapabilities({ video: ['H264', 'HEVC'] })
const source = buildSource(
  { id: 'a', origin: 'addon', provider: 'AIOStreams', providerId: 'aio', title: filename, filename, detail: text, url: 'https://cdn.example/a.mkv', traits: parseStream(text, filename) },
  caps,
)
const look = (patch: Partial<SourceAppearance> = {}) => ({ ...defaultSourceAppearance, ...patch })

describe('rowText', () => {
  it('leads with the release type when a heading names the provider, with the facts below', () => {
    const t = rowText(source, look(), true)
    expect(t.title).toBe('WEB-DL')
    expect(t.formats).toBe('Dolby Vision · HDR10 · TrueHD Atmos · HEVC · 7.1')
    expect(t.meta).toBe('18.20 GB · English, Spanish · FLUX')
    expect(t.raw).toEqual([])
  })

  it('names the provider in the row itself when no heading does, and prints the release type', () => {
    const t = rowText(source, look(), false)
    expect(t.title).toBe('AIOStreams')
    expect(t.formats).toMatch(/· WEB-DL$/)
    expect(t.meta).toBe('18.20 GB · English, Spanish · FLUX')
  })

  it('titles the row by file name or by the add-on’s first line, and says the provider beside them', () => {
    expect(rowText(source, look({ titleDisplay: 'filename' }), false)).toMatchObject({ title: filename, meta: '18.20 GB · AIOStreams · English, Spanish · FLUX' })
    expect(rowText(source, look({ titleDisplay: 'addonName' }), false).title).toBe('AIOStreams')
    const bare = { ...source, detail: undefined, filename: undefined }
    expect(rowText(bare, look({ titleDisplay: 'addonName' }), false).title).toBe('AIOStreams')
    expect(rowText(bare, look({ titleDisplay: 'filename' }), false).title).toBe(filename)
  })

  it('falls back to the file name when a provider-led row has no release type', () => {
    const plain = { ...source, quality: undefined }
    expect(rowText(plain, look(), true).title).toBe(filename)
    expect(rowText({ ...plain, filename: undefined, title: 'Stream' }, look(), true).title).toBe('Stream')
  })

  it('leaves the size off when Show File Size is off', () => {
    expect(rowText(source, look({ showSize: false }), true).meta).toBe('English, Spanish · FLUX')
    expect(spokenLabel(source, false, { size: false })).not.toMatch(/GB/)
    expect(spokenLabel(source, false)).toMatch(/18\.20 GB/)
  })

  it('prints the formats in full, in two, or not at all', () => {
    expect(rowText(source, look({ badges: 'minimal' }), true).formats).toBe('Dolby Vision · HDR10')
    expect(rowText(source, look({ badges: 'none' }), true).formats).toBeUndefined()
  })

  it('shows the add-on’s own lines instead of the parsed ones, without repeating its name', () => {
    const t = rowText(source, look({ showRawText: true }), true)
    expect(t.formats).toBeUndefined()
    expect(t.raw).toEqual(['✨ 4K 🎫', 'WEB-DL', 'DV HDR10', '🔊 TrueHD Atmos 7.1', '📦 18.2 GB', '🌎 English • Spanish'])
    expect(rowText({ ...source, detail: undefined }, look({ showRawText: true }), true).raw).toEqual([])
  })
})
