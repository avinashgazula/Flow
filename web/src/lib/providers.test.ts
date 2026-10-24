import { describe, expect, it } from 'vitest'
import { normalizeProviders, providerLogo } from './providers'

describe('normalizeProviders', () => {
  const raw = {
    results: [
      { provider_id: 337, provider_name: 'Disney Plus', logo_path: '/d.jpg', display_priority: 3 },
      { provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg', display_priority: 1, display_priorities: { GB: 0, US: 1 } },
      { provider_id: 350, provider_name: 'Apple TV+', logo_path: null, display_priority: 2 },
      { provider_id: 8, provider_name: 'Netflix (again)', display_priority: 9 },
      { provider_id: 0, provider_name: 'Broken', display_priority: 0 },
      { provider_id: 77, provider_name: '  ', display_priority: 0 },
    ],
  }

  it('orders by the region’s display priority and numbers the ranks', () => {
    const list = normalizeProviders(raw, 'US')
    expect(list.map((p) => p.name)).toEqual(['Netflix', 'Apple TV+', 'Disney+'])
    expect(list.map((p) => p.rank)).toEqual([0, 1, 2])
  })

  it('prefers the priority listed for the asked region', () => {
    const list = normalizeProviders({ results: [{ provider_id: 1, provider_name: 'A', display_priority: 1, display_priorities: { GB: 9 } }, { provider_id: 2, provider_name: 'B', display_priority: 5, display_priorities: { GB: 2 } }] }, 'GB')
    expect(list.map((p) => p.id)).toEqual([2, 1])
  })

  it('drops unnamed, id-less and repeated services, and maps the logo', () => {
    const list = normalizeProviders(raw, 'US')
    expect(list.find((p) => p.id === 8)).toEqual({ id: 8, name: 'Netflix', logo: '/n.jpg', rank: 0 })
    expect(list.find((p) => p.id === 350)?.logo).toBeUndefined()
    expect(list.some((p) => p.id === 0 || p.id === 77)).toBe(false)
  })

  it('keeps arrival order for services TMDB doesn’t rank', () => {
    const list = normalizeProviders({ results: [{ provider_id: 5, provider_name: 'Five' }, { provider_id: 4, provider_name: 'Four' }] }, 'US')
    expect(list.map((p) => p.id)).toEqual([5, 4])
  })

  it('survives an answer with no results', () => {
    expect(normalizeProviders({}, 'US')).toEqual([])
    expect(normalizeProviders(null, 'US')).toEqual([])
  })
})

describe('providerLogo', () => {
  it('serves the 92-wide logo, and 185 for dense screens', () => {
    expect(providerLogo('/n.jpg')).toEqual({ src: 'https://image.tmdb.org/t/p/w92/n.jpg', srcSet: 'https://image.tmdb.org/t/p/w92/n.jpg 1x, https://image.tmdb.org/t/p/w185/n.jpg 2x' })
  })

  it('has none without a path', () => {
    expect(providerLogo(undefined)).toBeUndefined()
  })
})
