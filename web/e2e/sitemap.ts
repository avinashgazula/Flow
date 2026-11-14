import { expect, type Page } from '@playwright/test'

/* Every address the site answers, and what proves each has drawn its content, not just its frame. Shared by the
   route smoke test and the accessibility audit. */

export interface Route {
  name: string
  path: string
  /** What proves the page has its content, not just its frame. */
  ready: (page: Page) => Promise<void>
}

const heading = (name: string | RegExp) => async (page: Page) => {
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
}

export const routes: Route[] = [
  {
    name: 'Home',
    path: '/',
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: 'Trending Movies' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Continue Watching' })).toBeVisible()
    },
  },
  {
    name: 'Explore',
    path: '/explore',
    ready: async (page) => {
      await heading('Explore')(page)
      await expect(page.getByRole('link', { name: /Dune: Part Two/ }).first()).toBeVisible()
    },
  },
  {
    name: 'Search',
    path: '/search',
    ready: async (page) => {
      await heading('Search')(page)
      await expect(page.getByRole('searchbox').or(page.getByRole('textbox')).first()).toBeVisible()
    },
  },
  {
    name: 'Library',
    path: '/library',
    ready: async (page) => {
      await heading('Library')(page)
      await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
    },
  },
  {
    name: 'Live TV',
    path: '/live',
    ready: async (page) => {
      await heading('Live TV')(page)
      await expect(page.getByRole('button', { name: /Flow News/ }).first()).toBeVisible()
    },
  },
  {
    name: 'Settings',
    path: '/settings',
    ready: heading('Settings'),
  },
  {
    name: 'A film',
    path: '/title/movie/693134',
    ready: async (page) => {
      await heading('Dune: Part Two')(page)
      await expect(page.getByRole('heading', { name: 'Cast' })).toBeVisible()
    },
  },
  {
    name: 'A series',
    path: '/title/show/1396',
    ready: async (page) => {
      await heading('Breaking Bad')(page)
      await expect(page.getByRole('heading', { name: 'Episodes' })).toBeVisible()
    },
  },
  {
    name: 'A person',
    path: '/person/1190668',
    ready: heading('Timothée Chalamet'),
  },
  {
    name: 'A collection',
    path: '/collection/726871',
    ready: heading('Dune Collection'),
  },
  {
    name: 'The player',
    path: '/watch/movie/693134',
    ready: async (page) => {
      await expect(page).toHaveTitle('Dune: Part Two – Marquee')
      await expect(page.locator('video').first()).toBeAttached()
    },
  },
  {
    name: 'Continue Watching (jumps to the last title played)',
    path: '/continue',
    ready: async (page) => {
      await expect(page).toHaveURL(/\/watch\/show\/1396\?season=3&episode=7/)
      await expect(page.locator('video').first()).toBeAttached()
    },
  },
  {
    name: 'An address the site doesn’t have',
    path: '/no-such-page',
    ready: heading('Not Found'),
  },
]

