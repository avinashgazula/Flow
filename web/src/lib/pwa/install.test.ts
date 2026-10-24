import { describe, expect, it } from 'vitest'
import { installMode, type InstallEnvironment } from './install'

const safariIPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ipadAsMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const chromeDesktop = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const env = (over: Partial<InstallEnvironment>): InstallEnvironment => ({ standalone: false, canPrompt: false, userAgent: chromeDesktop, maxTouchPoints: 0, ...over })

describe('what Settings offers for installing Flow', () => {
  it('offers the browser’s own dialog when the browser says it can', () => {
    expect(installMode(env({ canPrompt: true }))).toBe('prompt')
  })

  it('says how to Add to Home Screen on an iPhone and an iPad, where there is no event', () => {
    expect(installMode(env({ userAgent: safariIPhone, maxTouchPoints: 5 }))).toBe('ios')
    expect(installMode(env({ userAgent: ipadAsMac, maxTouchPoints: 5 }))).toBe('ios')
  })

  it('says nothing on a Mac, which has the same user agent as an iPad but no touch screen', () => {
    expect(installMode(env({ userAgent: ipadAsMac, maxTouchPoints: 0 }))).toBe('none')
  })

  it('says nothing where it can’t help: a browser with no install, or Flow already installed', () => {
    expect(installMode(env({ userAgent: firefox }))).toBe('none')
    expect(installMode(env({ standalone: true, canPrompt: true }))).toBe('none')
    expect(installMode(env({ standalone: true, userAgent: safariIPhone, maxTouchPoints: 5 }))).toBe('none')
  })
})
