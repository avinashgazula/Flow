import { describe, expect, it } from 'vitest'
import { parseBackup, backupFormat } from '../features/settings/backup'
import { defaultSettings } from './store/settings'
import { defaultTabOrder, isDefaultOrder, isTabOrder, moveTab, orderTabs, tabs, type Tab } from './tabs'

const ids = (list: readonly Tab[]) => list.map((t) => t.id)
// A fifth section, as another change adds with Live TV: slotted in the middle by its default position.
const withLive: Tab[] = [...tabs.slice(0, 3), { id: 'live', to: '/search', label: 'Live TV', icon: 'live' }, tabs[3]!]

describe('tab order', () => {
  it('is Home, Explore, Library, Search by default, and saved that way', () => {
    expect(ids(orderTabs(defaultTabOrder))).toEqual(['home', 'explore', 'library', 'search'])
    expect(defaultSettings.tabOrder).toEqual(['home', 'explore', 'library', 'search'])
    expect(ids(orderTabs([]))).toEqual(['home', 'explore', 'library', 'search'])
  })

  it('follows the saved order', () => {
    expect(ids(orderTabs(['search', 'library', 'home', 'explore']))).toEqual(['search', 'library', 'home', 'explore'])
  })

  it('puts a tab the saved order has never heard of at its default position', () => {
    expect(ids(orderTabs(['home', 'explore', 'library', 'search'], withLive))).toEqual(['home', 'explore', 'library', 'live', 'search'])
    // The person had moved things about: the new tab still lands at index 3, among what they chose.
    expect(ids(orderTabs(['search', 'library', 'explore', 'home'], withLive))).toEqual(['search', 'library', 'explore', 'live', 'home'])
    // A short saved list: each missing tab goes to its default position, or to the end when that is past it.
    expect(ids(orderTabs(['search'], withLive))).toEqual(['home', 'explore', 'library', 'live', 'search'])
    expect(ids(orderTabs(['live'], withLive))).toEqual(['home', 'explore', 'library', 'live', 'search'])
  })

  it('ignores ids that don’t exist and counts a repeated one once', () => {
    expect(ids(orderTabs(['nope', 'search', 'search', 'home', '']))).toEqual(['search', 'explore', 'library', 'home'])
  })

  it('moves a tab up or down one place, and stops at the ends', () => {
    expect(moveTab(defaultTabOrder, 'library', -1)).toEqual(['home', 'library', 'explore', 'search'])
    expect(moveTab(defaultTabOrder, 'home', 1)).toEqual(['explore', 'home', 'library', 'search'])
    expect(moveTab(defaultTabOrder, 'home', -1)).toEqual(defaultTabOrder)
    expect(moveTab(defaultTabOrder, 'search', 1)).toEqual(defaultTabOrder)
    expect(moveTab(defaultTabOrder, 'unknown', 1)).toEqual(defaultTabOrder)
  })

  it('moves within the order a person sees, including a tab they were never asked about', () => {
    expect(moveTab(['home', 'explore', 'library', 'search'], 'live', -1, withLive)).toEqual(['home', 'explore', 'live', 'library', 'search'])
  })

  it('knows when the order is the default', () => {
    expect(isDefaultOrder(defaultTabOrder)).toBe(true)
    expect(isDefaultOrder([])).toBe(true)
    expect(isDefaultOrder(['search', 'home', 'explore', 'library'])).toBe(false)
  })

  it('has one entry per id', () => {
    expect(new Set(ids(tabs)).size).toBe(tabs.length)
  })
})

describe('tab order in a backup', () => {
  const parse = (tabOrder: unknown) => parseBackup(JSON.stringify({ format: backupFormat, version: 1, settings: { autoplayNext: true, tabOrder } }))

  it('keeps a valid order, including names a newer build may use', () => {
    const r = parse(['search', 'home', 'live'])
    expect(r.ok && r.settings.tabOrder).toEqual(['search', 'home', 'live'])
    expect(r.ok && r.skipped).toEqual([])
  })

  it('skips an order that makes no sense, and keeps the rest of the file', () => {
    for (const bad of ['home', [1, 2], ['home', 'home'], [''], null, Array.from({ length: 30 }, (_, i) => `t${i}`), [{}]]) {
      const r = parse(bad)
      expect(r.ok && r.skipped, JSON.stringify(bad)).toEqual(['tabOrder'])
      expect(r.ok && r.settings.autoplayNext).toBe(true)
    }
  })

  it('validates the same way as the settings', () => {
    expect(isTabOrder(['a', 'b'])).toBe(true)
    expect(isTabOrder([])).toBe(true)
    expect(isTabOrder(['a', 'a'])).toBe(false)
  })
})
