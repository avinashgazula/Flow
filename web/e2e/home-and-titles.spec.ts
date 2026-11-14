import { test, expect } from './fixtures'
import { expectPlaying } from './helpers'

/* Home, a title page and the source picker, driven the way a visitor does: by clicking and pressing keys. */

test.describe('home', () => {
  test('leads with the day, the date and the title you were watching', async ({ boot, page }) => {
    await boot('/')
    // The clock is pinned to noon on 15 June 2026 (fixtures.ts), so what Home says about the day is fixed too.
    await expect(page.getByRole('heading', { level: 1, name: 'This Afternoon' })).toBeVisible()
    await expect(page.getByText('Monday, June 15')).toBeVisible()
    const hero = page.getByRole('region', { name: 'Featured titles' })
    await expect(hero.getByRole('heading', { name: 'Breaking Bad' })).toBeVisible()
    await expect(hero.getByText('Season 3, Episode 7')).toBeVisible()
    await expect(hero.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/watch/show/1396?season=3&episode=7')
  })

  test('the pager steps through the picks and wraps round', async ({ boot, page }) => {
    await boot('/')
    const hero = page.getByRole('region', { name: 'Featured titles' })
    const position = hero.getByRole('status')
    await expect(position).toHaveAccessibleName('1 of 10')
    const first = await hero.getByRole('heading', { level: 2 }).textContent()
    await hero.getByRole('button', { name: 'Next title' }).click()
    await expect(position).toHaveAccessibleName('2 of 10')
    await expect(hero.getByRole('heading', { level: 2 })).not.toHaveText(first!)
    await hero.getByRole('button', { name: 'Previous title' }).click()
    await expect(position).toHaveAccessibleName('1 of 10')
    await hero.getByRole('button', { name: 'Previous title' }).click()
    await expect(position).toHaveAccessibleName('10 of 10')
  })

  test('Continue Watching lists what has a resume point, with the time left', async ({ boot, page }) => {
    await boot('/')
    const shelf = page.getByRole('region', { name: 'Continue Watching' })
    await expect(shelf.getByRole('link')).toHaveCount(3)
    await expect(shelf.getByRole('link', { name: /^Dune: Part Two, 1 hour 44 minutes left/ })).toHaveAttribute('href', '/watch/movie/693134')
    await expect(shelf.getByRole('link', { name: /^The Last of Us, season 2 episode 3, 45 minutes left/ })).toBeVisible()
  })

  test('the watchlist shelf opens a title page from its poster', async ({ boot, page }) => {
    await boot('/')
    await page.getByRole('region', { name: 'Watchlist' }).getByRole('link', { name: /^Interstellar, film/ }).click()
    await expect(page).toHaveURL(/\/title\/movie\/157336$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Interstellar' })).toBeVisible()
  })

  test('Details on the hero opens the series page at the season being watched', async ({ boot, page }) => {
    await boot('/')
    await page.getByRole('region', { name: 'Featured titles' }).getByRole('link', { name: 'Details' }).click()
    await expect(page).toHaveURL(/\/title\/show\/1396\?season=3$/)
    await expect(page.getByRole('combobox', { name: 'Season' })).toHaveValue(/3/)
  })

  test('the Genres shelf opens Explore on that genre', async ({ boot, page }) => {
    await boot('/')
    await page.getByRole('region', { name: 'Genres' }).getByRole('link', { name: 'Horror' }).click()
    await expect(page).toHaveURL(/\/explore\?type=movie&genre=27/)
    await expect(page.getByRole('button', { name: 'Horror', pressed: true })).toBeVisible()
  })
})

test.describe('a film’s page', () => {
  test('shows the facts, the cast and where it plays from', async ({ boot, page }) => {
    await boot('/title/movie/157336')
    await expect(page.getByRole('heading', { level: 1, name: 'Interstellar' })).toBeVisible()
    await expect(page.getByText('A team of explorers travel through a wormhole')).toBeVisible()
    const howItPlays = page.getByRole('region', { name: 'How this plays' })
    await expect(howItPlays.getByText('1080p · AAC · 3.98 GB')).toBeVisible()
    await expect(howItPlays.getByText('Direct')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Christopher Nolan' }).first()).toHaveAttribute('href', /\/person\//)
    await expect(page.getByRole('region', { name: 'Cast' }).getByRole('link')).toHaveCount(6)
  })

  test('the Watchlist button toggles, and Library follows', async ({ boot, page }) => {
    await boot('/title/movie/155')
    const watchlist = page.getByRole('button', { name: 'Watchlist', exact: true })
    await expect(watchlist).toHaveAttribute('aria-pressed', 'false')
    await watchlist.click()
    await expect(watchlist).toHaveAttribute('aria-pressed', 'true')
    await page.goto('/library?list=watchlist')
    await expect(page.getByRole('link', { name: /^The Dark Knight, film/ })).toBeVisible()
    await expect(page.getByText('7 titles')).toBeVisible()
    await page.goBack()
    await page.getByRole('button', { name: 'Watchlist', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Watchlist', exact: true })).toHaveAttribute('aria-pressed', 'false')
  })

  test('Favourite keeps its state across a reload', async ({ boot, page }) => {
    await boot('/title/movie/155')
    const favourite = page.getByRole('button', { name: 'Favourite', exact: true })
    const was = await favourite.getAttribute('aria-pressed')
    const now = was === 'true' ? 'false' : 'true'
    await favourite.click()
    await expect(favourite).toHaveAttribute('aria-pressed', now)
    await page.reload()
    await expect(favourite).toHaveAttribute('aria-pressed', now)
  })

  test('a related title opens its own page', async ({ boot, page }) => {
    await boot('/title/movie/157336')
    await page.getByRole('region', { name: 'More Like This' }).getByRole('link', { name: /^The Matrix, film/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'The Matrix' })).toBeVisible()
    await expect(page).toHaveURL(/\/title\/movie\/603$/)
  })

  test('a cast member opens their page and back returns to the film', async ({ boot, page }) => {
    await boot('/title/movie/693134')
    await page.getByRole('region', { name: 'Cast' }).getByRole('link', { name: /Zendaya/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Zendaya' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeVisible()
  })

  test('the collection row opens the franchise page', async ({ boot, page }) => {
    await boot('/title/movie/693134')
    // The row loads its films once it is near the screen.
    await page.keyboard.press('End')
    await page.getByRole('link', { name: 'See every film in Dune Collection' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Dune Collection' })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Dune, film, 2021/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Dune: Part Two, film, 2024/ })).toBeVisible()
  })
})

test.describe('a series’ page', () => {
  test('lists the season’s episodes and changes season', async ({ boot, page }) => {
    await boot('/title/show/1396')
    const episodes = page.getByRole('region', { name: 'Episodes' })
    await expect(episodes.getByRole('combobox', { name: 'Season' })).toHaveValue(/3/)
    const first = episodes.getByRole('button', { name: /^Episode 1, / })
    await expect(first).toHaveAccessibleName(/^Episode 1, Signal, aired .*2010/)
    await episodes.getByRole('combobox', { name: 'Season' }).selectOption({ label: 'Season 1' })
    await expect(episodes.getByRole('combobox', { name: 'Season' })).toHaveValue(/1/)
    await expect(first).toHaveAccessibleName(/^Episode 1, Crossing Over, aired .*2008/)
  })

  test('marking an episode watched and unwatched flips its button', async ({ boot, page }) => {
    await boot('/title/show/1396')
    // Season 3's later episodes are unwatched in the sample data.
    const episodes = page.getByRole('region', { name: 'Episodes' })
    await episodes.getByRole('combobox', { name: 'Season' }).selectOption({ label: 'Season 5' })
    const mark = episodes.getByRole('button', { name: /^Mark as watched: episode 1,/ })
    await mark.click()
    await expect(episodes.getByRole('button', { name: /^Mark as unwatched: episode 1,/ })).toBeVisible()
  })

  test('an episode plays from the source the series last used', async ({ boot, page }) => {
    await boot('/title/show/1396')
    await page.getByRole('region', { name: 'Episodes' }).getByRole('button', { name: /^Episode 2, Undertow/ }).click()
    await expect(page).toHaveURL(/\/watch\/show\/1396\?season=3&episode=2/)
    await expectPlaying(page)
  })
})

test.describe('the source picker', () => {
  test('opens from the title page, lists every source, and filters by resolution', async ({ boot, page }) => {
    await boot('/title/movie/157336')
    await page.getByRole('button', { name: '5 · AIOStreams' }).click()
    const picker = page.getByRole('dialog', { name: 'Sources for Interstellar' })
    await expect(picker.getByText('5 sources')).toBeVisible()
    await expect(picker.getByRole('option')).toHaveCount(5)
    await picker.getByRole('button', { name: '2160p' }).click()
    await expect(picker.getByRole('option')).toHaveCount(1)
    await expect(picker.getByRole('option', { name: /4K WEB-DL/ })).toBeVisible()
    await picker.getByRole('button', { name: 'All' }).click()
    await expect(picker.getByRole('option')).toHaveCount(5)
  })

  test('says why a source can’t play and won’t let it be chosen', async ({ boot, page }) => {
    await boot('/title/movie/157336')
    await page.getByRole('button', { name: '5 · AIOStreams' }).click()
    const dts = page.getByRole('option', { name: /DTS-HD MA audio can’t play in a browser/ })
    await expect(dts).toBeDisabled()
    await expect(page.getByText('Can’t Play in This Browser')).toBeVisible()
  })

  test('arrow keys move through the sources and Escape closes the picker', async ({ boot, page }) => {
    await boot('/title/movie/157336')
    await page.getByRole('button', { name: '5 · AIOStreams' }).click()
    const picker = page.getByRole('dialog', { name: 'Sources for Interstellar' })
    // The list highlights the row under a resting pointer, and on a phone the sheet opens right under the tap.
    await page.mouse.move(0, 0)
    await expect(picker.getByRole('option', { selected: true })).toHaveAccessibleName(/1080p WEB-DL, AIOStreams/)
    await page.keyboard.press('ArrowDown')
    await expect(picker.getByRole('option', { selected: true })).toHaveAccessibleName(/4K WEB-DL/)
    await page.keyboard.press('End')
    await expect(picker.getByRole('option', { selected: true })).not.toHaveAccessibleName(/4K WEB-DL/)
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
  })
})
