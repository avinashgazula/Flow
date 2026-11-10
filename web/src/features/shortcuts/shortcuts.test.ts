import { describe, expect, it } from 'vitest'
import { shortcutGroups } from './shortcutList'
import { chordMs, chordStep, goTarget, isTyping } from './shortcuts'

describe('goTarget', () => {
  it('maps the letters to the places', () => {
    expect(goTarget('h')).toEqual({ to: '/' })
    expect(goTarget('E')).toEqual({ to: '/explore' })
    expect(goTarget('t')).toEqual({ to: '/live' })
    expect(goTarget('u')).toEqual({ to: '/library', search: { list: 'upcoming' } })
    expect(goTarget('c')).toEqual({ to: '/continue' })
    expect(goTarget('s')).toEqual({ to: '/settings' })
    expect(goTarget('z')).toBeUndefined()
  })

  it('maps the digits to the tabs in the order Settings gives them, as Command-1 to 5 do in the Mac app', () => {
    expect(goTarget('1')).toEqual({ to: '/' })
    expect(goTarget('5')).toEqual({ to: '/search' })
    expect(goTarget('1', ['library', 'home'])).toEqual({ to: '/library' })
    expect(goTarget('3', ['library', 'home'])).toEqual({ to: '/' })
    expect(goTarget('6')).toBeUndefined()
  })
})

describe('chordStep', () => {
  it('arms on G and finishes with the next key', () => {
    const armed = chordStep(0, 'g', 1000)
    expect(armed).toEqual({ armedAt: 1000 })
    expect(chordStep(armed.armedAt, 'H', 1200)).toEqual({ armedAt: 0, finished: 'h' })
  })

  it('lets go of a chord that waited too long, and of one broken by nothing', () => {
    expect(chordStep(1000, 'h', 1000 + chordMs + 1)).toEqual({ armedAt: 0 })
    expect(chordStep(0, 'h', 1000)).toEqual({ armedAt: 0 })
  })

  it('starts over on a second G', () => {
    expect(chordStep(1000, 'g', 1500)).toEqual({ armedAt: 1500 })
  })
})

describe('isTyping', () => {
  it('knows fields and editable text', () => {
    expect(isTyping({ tagName: 'INPUT' })).toBe(true)
    expect(isTyping({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTyping({ tagName: 'BUTTON' })).toBe(false)
    expect(isTyping(null)).toBe(false)
  })
})

describe('shortcutGroups', () => {
  it('lists every group, the player’s included, with Command on a Mac and Ctrl elsewhere', () => {
    const titles = shortcutGroups(false).map((g) => g.title)
    expect(titles).toEqual(['Go', 'Anywhere', 'Posters', 'Sources', 'Player', 'Live TV'])
    const search = (mac: boolean) => shortcutGroups(mac).find((g) => g.title === 'Anywhere')!.rows[0]!.combos[1]!.keys
    expect(search(true)).toEqual(['⌘', 'K'])
    expect(search(false)).toEqual(['Ctrl', 'K'])
  })

  it('gives every row a label and at least one key', () => {
    for (const g of shortcutGroups(false)) for (const r of g.rows) expect(r.label && r.combos.every((c) => c.keys.length > 0) && r.combos.length > 0).toBeTruthy()
  })
})
