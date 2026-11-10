import { describe, expect, it } from 'vitest'
import { backupFormat, parseBackup } from './backup'

describe('The retired typeface setting', () => {
  it('still comes back from a backup when the name is one the old picker offered', () => {
    const read = (font: unknown) => parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings: { font, autoplayNext: false } }))
    expect(read('geist')).toMatchObject({ ok: true, settings: { font: 'geist', autoplayNext: false }, skipped: [] })
    expect(read('comic-sans')).toMatchObject({ ok: true, settings: { autoplayNext: false }, skipped: ['font'] })
  })
})
