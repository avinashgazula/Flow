import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { ffmpeg, libraries, models, typefaces } from './licences'

const path = (rel: string) => new URL(rel, import.meta.url)
const read = (rel: string) => JSON.parse(readFileSync(path(rel), 'utf8')) as Record<string, unknown>
const pkg = read('../../package.json') as { dependencies: Record<string, string> }

describe('open source licences', () => {
  it('lists every library the pages bundle', () => {
    expect(libraries.map((l) => l.package).sort()).toEqual(Object.keys(pkg.dependencies).sort())
  })

  it('matches the version and licence each package installs', () => {
    for (const lib of libraries) {
      const installed = read(`../../node_modules/${lib.package}/package.json`)
      expect({ name: lib.name, version: installed.version, licence: installed.license }).toEqual({ name: lib.name, version: lib.version, licence: lib.licence })
    }
  })

  it('names the FFmpeg release the build script downloads', () => {
    const script = readFileSync(path('../../scripts/build-audio-decoders.sh'), 'utf8')
    expect(script).toContain(`FFMPEG_VERSION=${ffmpeg.version}`)
    expect(ffmpeg.source).toContain(`ffmpeg-${ffmpeg.version}.tar.xz`)
  })

  it('serves the LGPL text that ships with the module', () => {
    expect(readFileSync(path('../../public/licences/COPYING.LGPLv2.1.txt'), 'utf8')).toBe(readFileSync(path('./audio/pkg/COPYING.LGPLv2.1'), 'utf8'))
  })

  it('serves the licence file of every typeface', () => {
    for (const face of typefaces) expect(existsSync(path(`../../public/fonts/${face.file}`)), face.file).toBe(true)
  })

  it('ships the face models it names, byte for byte, with their licence texts', () => {
    for (const m of models) {
      const bytes = readFileSync(path(`../features/player/xray/faces/models/${m.shipped}`))
      expect({ name: m.name, sha256: createHash('sha256').update(bytes).digest('hex') }).toEqual({ name: m.name, sha256: m.sha256 })
      expect(existsSync(path(`../../public/licences/${m.file}`)), m.file).toBe(true)
    }
    expect(existsSync(path('../../public/licences/MIT-ONNX-Runtime.txt'))).toBe(true)
    expect(existsSync(path('../../public/licences/ONNX-Runtime-ThirdPartyNotices.txt'))).toBe(true)
  })
})
