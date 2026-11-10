import { describe, expect, it } from 'vitest'
import { fitsQR, qrLimit } from './setupQr'

describe('fitsQR', () => {
  it('draws a link up to the apps’ limit and no longer', () => {
    expect(fitsQR('flow://setup?d=' + 'a'.repeat(100))).toBe(true)
    expect(fitsQR('x'.repeat(qrLimit - 1))).toBe(true)
    expect(fitsQR('x'.repeat(qrLimit))).toBe(false)
  })

  it('has nothing to draw for an empty link', () => {
    expect(fitsQR('')).toBe(false)
  })
})
