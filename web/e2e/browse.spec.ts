import { test, expect } from './fixtures'
import { expectPlaying } from './helpers'

/* Search, Explore, Library, Upcoming, Live TV, a person and a collection: the places you look for something. */

test.describe('search', () => {
  test('typing finds titles and people, and Enter opens the top result', async ({ boot, page }) => {
    await boot('/search')
    await page.getByRole('searchbox', { name: 'Search' }).fill('dune')
    const top = page.getByRole('region', { name: 'Top Result' })
    await expect(top.getByRole('link', { name: 'Dune: Part Two', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Movies' }).getByRole('link', { name: /^Dune, film, 2021/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/title\/movie\/693134/)
  })

  test('a person’s name finds the person', async ({ boot, page }) => {
    await boot('/search')
    await page.getByRole('searchbox', { name: 'Search' }).fill('zendaya')
    await page.getByRole('link', { name: /Zendaya/ }).first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Zendaya' })).toBeVisible()
  })

  test('nothing matching says so', async ({ boot, page }) => {
    await boot('/search')
    await page.getByRole('searchbox', { name: 'Search' }).fill('zzzzqqqq')
    await expect(page.getByText(/No results|Nothing|couldn’t find/i).first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Top Result' })).toHaveCount(0)
  })

  test('Clear Search empties the field and brings back the suggestions', async ({ boot, page }) => {
    await boot('/search')
    const field = page.getByRole('searchbox', { name: 'Search' })
    await field.fill('dune')
    await expect(page.getByRole('region', { name: 'Top Result' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear Search' }).click()
    await expect(field).toHaveValue('')
    await expect(page.getByRole('region', { name: 'Browse by Genre' })).toBeVisible()
  })

  test('a Try suggestion runs that search', async ({ boot, page }) => {
    await boot('/search')
    await page.getByRole('button', { name: 'Oppenheimer' }).first().click()
    await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('Oppenheimer')
    await expect(page.getByRole('region', { name: 'Top Result' }).getByRole('link', { name: 'Oppenheimer', exact: true })).toBeVisible()
  })

  test('a search that was run is remembered under Recent', async ({ boot, page }) => {
    await boot('/search')
    await page.getByRole('searchbox', { name: 'Search' }).fill('inception')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/title\/movie\/27205/)
    await page.goto('/search')
    await expect(page.getByText('Recent')).toBeVisible()
    await expect(page.getByRole('button', { name: 'inception', exact: true })).toBeVisible()
  })

  test('the slash key focuses search from any page', async ({ boot, page }) => {
    await boot('/library')
    // The keys load just after the first paint, so press until they answer.
    await expect(async () => {
      await page.keyboard.press('/')
      await expect(page).toHaveURL(/\/search/, { timeout: 500 })
    }).toPass()
    await expect(page.getByRole('searchbox', { name: 'Search' })).toBeFocused()
  })
})

test.describe('explore', () => {
  test('switches between films and series', async ({ boot, page }) => {
    await boot('/explore')
    await expect(page.getByRole('list', { name: 'Movies' }).getByRole('link', { name: /^Dune: Part Two/ })).toBeVisible()
    await page.getByRole('radio', { name: 'TV Shows' }).click()
    await expect(page.getByRole('radio', { name: 'TV Shows' })).toBeChecked()
    await expect(page).toHaveURL(/type=show/)
    await expect(page.getByRole('list', { name: 'TV Shows' }).getByRole('link', { name: /^Breaking Bad, series/ })).toBeVisible()
  })

  test('a genre chip narrows the list and All widens it again', async ({ boot, page }) => {
    await boot('/explore')
    const list = page.getByRole('list', { name: 'Movies' })
    await expect(list.getByRole('link', { name: /^Parasite, film/ })).toBeVisible()
    await page.getByRole('button', { name: 'Action', exact: true }).click()
    await expect(page).toHaveURL(/genre=28/)
    await expect(list.getByRole('link', { name: /^The Dark Knight, film/ })).toBeVisible()
    await expect(list.getByRole('link', { name: /^Parasite, film/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(page).not.toHaveURL(/genre=/)
    await expect(list.getByRole('link', { name: /^Parasite, film/ })).toBeVisible()
  })

  test('sorting by Top Rated puts the best rated first', async ({ boot, page }) => {
    await boot('/explore')
    // A phone folds the four sorts into a menu.
    if (test.info().project.metadata.phone) await page.getByRole('combobox', { name: 'Sort by' }).selectOption({ label: 'Top Rated' })
    else await page.getByRole('radio', { name: 'Top Rated' }).click()
    await expect(page).toHaveURL(/sort=top/)
    await expect(page.getByRole('list', { name: 'Movies' }).getByRole('listitem').first().getByRole('link')).toHaveAccessibleName(/^The Godfather, film/)
  })

  test('the Filters sheet opens and Escape closes it', async ({ boot, page }) => {
    await boot('/explore')
    await page.getByRole('button', { name: 'Filters' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('a poster opens its title page', async ({ boot, page }) => {
    await boot('/explore')
    await page.getByRole('link', { name: /^Oppenheimer, film/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Oppenheimer' })).toBeVisible()
  })
})

test.describe('library', () => {
  test('the overview counts what is saved, and each list opens', async ({ boot, page }) => {
    await boot('/library')
    await expect(page.getByRole('region', { name: 'Watchlist' }).getByRole('link')).not.toHaveCount(0)
    await page.getByRole('region', { name: 'Watchlist' }).getByRole('link', { name: 'See all' }).click()
    await expect(page).toHaveURL(/list=watchlist/)
    await expect(page.getByText('6 titles')).toBeVisible()
  })

  test('the Watchlist can be filtered to films and to shows', async ({ boot, page }) => {
    await boot('/library?list=watchlist')
    const list = page.getByRole('list', { name: 'Watchlist' })
    await page.getByRole('radio', { name: 'Movies' }).click()
    await expect(page.getByRole('radio', { name: 'Movies' })).toBeChecked()
    await expect(list.getByRole('link', { name: /, series,/ })).toHaveCount(0)
    await expect(list.getByRole('link', { name: /^Interstellar/ })).toBeVisible()
    await page.getByRole('radio', { name: 'Shows' }).click()
    await expect(page.getByRole('radio', { name: 'Shows' })).toBeChecked()
    await expect(list.getByRole('link', { name: /, film,/ })).toHaveCount(0)
    await expect(list.getByRole('link', { name: /^Arcane/ })).toBeVisible()
  })

  test('sorting by Title orders the Watchlist A to Z', async ({ boot, page }) => {
    await boot('/library?list=watchlist')
    await page.getByRole('combobox', { name: 'Sort by' }).selectOption({ label: 'Title' })
    const first = page.getByRole('list', { name: 'Watchlist' }).getByRole('listitem').first().getByRole('link')
    await expect(first).toHaveAccessibleName(/^Arcane/)
  })

  test('Custom order moves a poster with Alt and the arrow keys, and the order is kept', async ({ boot, page }) => {
    await boot('/library?list=watchlist')
    await page.getByRole('combobox', { name: 'Sort by' }).selectOption({ label: 'Custom' })
    const names = () => page.getByRole('list', { name: 'Watchlist' }).getByRole('listitem').evaluateAll((items) => items.map((li) => li.querySelector('a')?.getAttribute('aria-label')?.split(',')[0]))
    const before = await names()
    await page.getByRole('list', { name: 'Watchlist' }).getByRole('link').first().focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect.poll(names).toEqual([before[1], before[0], ...before.slice(2)])
    await page.reload()
    expect(await names()).toEqual([before[1], before[0], ...before.slice(2)])
  })

  test('History lists what was watched, newest first, and a row opens its title', async ({ boot, page }) => {
    await boot('/library?list=history')
    await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible()
    await expect(page.getByRole('link').filter({ hasText: /Stranger Things|Oppenheimer|Inception/ }).first()).toBeVisible()
  })

  test('Remove from Continue Watching drops the card', async ({ boot, page }) => {
    await boot('/library')
    const shelf = page.getByRole('region', { name: 'Continue Watching' })
    await expect(shelf.getByRole('link', { name: /^Dune: Part Two/ })).toBeVisible()
    const before = await shelf.getByRole('link').count()
    await shelf.getByRole('button', { name: 'Remove Dune: Part Two from Continue Watching' }).click()
    await expect(shelf.getByRole('link', { name: /^Dune: Part Two/ })).toHaveCount(0)
    await expect(shelf.getByRole('link')).toHaveCount(before - 1)
  })
})

test.describe('upcoming', () => {
  test('shows the next two weeks, what just aired and what is next', async ({ boot, page }) => {
    await boot('/library?list=upcoming')
    await expect(page.getByRole('heading', { level: 1, name: 'Upcoming' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Next two weeks' }).getByRole('img', { name: /Monday, June 15, today/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Just Aired' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tomorrow' })).toBeVisible()
  })

  test('a day with something coming up can be opened', async ({ boot, page }) => {
    await boot('/library?list=upcoming')
    const day = page.getByRole('group', { name: 'Next two weeks' }).getByRole('button', { name: /has something coming up/ }).last()
    const date = /^(.*?), has something coming up/.exec((await day.getAttribute('aria-label')) ?? '')![1]!
    await day.click()
    // The page scrolls to that day's section, which is headed by its date.
    await expect(page.getByText(date, { exact: true }).last()).toBeInViewport()
  })

  test('Add All to Calendar offers a calendar file', async ({ boot, page }) => {
    await boot('/library?list=upcoming')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Add All to Calendar' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.ics$/)
    const text = (await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8'))
    expect(text).toContain('BEGIN:VCALENDAR')
    expect(text).toContain('BEGIN:VEVENT')
  })
})

test.describe('live tv', () => {
  test('the guide lists channels, a group narrows them, and search finds one', async ({ boot, page }) => {
    await boot('/live')
    await expect(page.getByText('12 channels')).toBeVisible()
    await page.getByRole('button', { name: 'Sports', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Watch Sport HD' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Watch Flow News' })).toHaveCount(0)
    await page.getByRole('button', { name: 'All', exact: true }).click()
    // A phone keeps the field folded behind a button.
    if (test.info().project.metadata.phone) await page.getByRole('button', { name: 'Search channels' }).click()
    await page.getByRole('searchbox', { name: 'Search channels' }).fill('cinema')
    await expect(page.getByRole('button', { name: 'Watch Cinema One' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Watch Flow News' })).toHaveCount(0)
  })

  test('choosing a channel plays it and Back returns to the guide', async ({ boot, page }) => {
    await boot('/live')
    await page.getByRole('button', { name: 'Watch Flow News' }).click()
    await expect(page.getByRole('region', { name: 'Live: Flow News' })).toBeVisible()
    await expectPlaying(page)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('region', { name: 'Live: Flow News' })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Live TV' })).toBeVisible()
  })

  test('the Channels view lists them as a list', async ({ boot, page }) => {
    await boot('/live')
    await page.getByRole('radio', { name: 'Channels' }).click()
    await expect(page.getByRole('radio', { name: 'Channels' })).toBeChecked()
    await expect(page.getByRole('button', { name: /Flow News/ }).first()).toBeVisible()
  })
})

test.describe('person and collection', () => {
  test('a person’s page lists their films', async ({ boot, page }) => {
    await boot('/person/1190668')
    await expect(page.getByRole('heading', { level: 1, name: 'Timothée Chalamet' })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Dune: Part Two, film/ })).toBeVisible()
    await page.getByRole('link', { name: /^Dune, film/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Dune' })).toBeVisible()
  })

  test('a collection lists its films in release order', async ({ boot, page }) => {
    await boot('/collection/726871')
    await expect(page.getByRole('heading', { name: 'Films in Release Order' })).toBeVisible()
    const links = page.getByRole('link', { name: /, film, / })
    await expect(links.first()).toHaveAccessibleName(/^Dune, film, 2021/)
    await expect(links.nth(1)).toHaveAccessibleName(/^Dune: Part Two, film, 2024/)
  })

  test('a person that isn’t found says what to do', async ({ boot, page }) => {
    await boot('/person/1')
    await expect(page.getByRole('heading', { name: 'Couldn’t Load This Person' })).toBeVisible()
  })
})
