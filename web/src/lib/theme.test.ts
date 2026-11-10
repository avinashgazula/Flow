import { describe, expect, it } from 'vitest'
import { resolveTheme, themeColour } from './theme'

describe('resolveTheme', () => {
  it('uses the saved choice over the system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the system when nothing valid is saved', () => {
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(undefined, false)).toBe('light')
    expect(resolveTheme('sepia', true)).toBe('dark')
  })

  it('has a browser colour for both, matching the page background', () => {
    expect(themeColour).toEqual({ light: '#ffffff', dark: '#0a0a0a' })
  })
})
