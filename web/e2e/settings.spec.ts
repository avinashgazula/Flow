import { readFile, writeFile } from 'node:fs/promises'
import { test, expect } from './fixtures'

/* Settings: every page opens, search lands on a row, a change survives a reload, and a setup exported from here comes
   back after everything is cleared. */

const pages = [
  ['appearance', 'Appearance'],
  ['catalogue', 'Catalogue'],
  ['metadata', 'Metadata'],
  ['shelves', 'Shelves'],
  ['addons', 'Stream Add-ons'],
  ['servers', 'Media Servers'],
  ['requests', 'Requests'],
  ['sources', 'Sources'],
  ['livetv', 'Live TV'],
  ['playback', 'Playback'],
  ['account', 'Account'],
  ['data', 'Data'],
  ['about', 'About'],
] as const

const isPhone = () => !!test.info().project.metadata.phone

test.describe('pages', () => {
  for (const [id, title] of pages) {
    test(`${title} opens from the list and has its own address (#${id})`, async ({ boot, page }) => {
      await boot('/settings')
      const list = page.getByRole('navigation', { name: 'Settings pages' })
      // A phone's list rows carry a line about what each page holds, after the name.
      await list.getByRole('link', { name: new RegExp(`^${title}`) }).click()
      await expect(page).toHaveURL(new RegExp(`/settings#${id}$`))
      await expect(page.getByRole('region', { name: title, exact: true })).toBeVisible()
      if (isPhone()) {
        await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible()
        await page.locator('main').getByRole('link', { name: 'Settings', exact: true }).click()
        await expect(page).toHaveURL(/\/settings$/)
        await expect(page.getByRole('navigation', { name: 'Settings pages' })).toBeVisible()
      }
    })

    test(`${title} opens straight from its address`, async ({ boot, page }) => {
      await boot(`/settings#${id}`)
      await expect(page.getByRole('region', { name: title, exact: true })).toBeVisible()
    })
  }

  test('the browser’s Back button returns from a page to the list on a phone and to the last page on a desktop', async ({ boot, page }) => {
    await boot('/settings')
    await page.getByRole('navigation', { name: 'Settings pages' }).getByRole('link', { name: /^Playback/ }).click()
    await expect(page).toHaveURL(/#playback$/)
    await page.goBack()
    await expect(page).not.toHaveURL(/#playback/)
    if (isPhone()) await expect(page.getByRole('navigation', { name: 'Settings pages' })).toBeVisible()
    else await expect(page.getByRole('region', { name: 'Appearance', exact: true })).toBeVisible()
  })
})

test.describe('search', () => {
  test('finds a setting by what it does and lands on its page with the row marked', async ({ boot, page }) => {
    await boot('/settings')
    await page.getByRole('combobox', { name: 'Search Settings' }).fill('dolby')
    const results = page.getByRole('listbox', { name: 'Matching settings' })
    await expect(results.getByRole('group', { name: 'Playback' }).getByRole('option', { name: /^Never Use Dolby Vision/ })).toBeVisible()
    await results.getByRole('option', { name: /^Never Use Dolby Vision/ }).click()
    await expect(page).toHaveURL(/#playback$/)
    const row = page.getByRole('switch', { name: 'Never use Dolby Vision' })
    await expect(row).toBeVisible()
    await expect(row).toBeInViewport()
  })

  test('arrow keys and Enter pick a result', async ({ boot, page }) => {
    await boot('/settings')
    const field = page.getByRole('combobox', { name: 'Search Settings' })
    await field.fill('never use dolby')
    await expect(page.getByRole('listbox', { name: 'Matching settings' }).getByRole('option').first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#playback$/)
    await expect(page.getByRole('switch', { name: 'Never use Dolby Vision' })).toBeInViewport()
  })

  test('a search with no match says so, and clearing it brings the pages back', async ({ boot, page }) => {
    await boot('/settings')
    await page.getByRole('combobox', { name: 'Search Settings' }).fill('qqqqzzzz')
    await expect(page.getByRole('option')).toHaveCount(0)
    await expect(page.getByText('Nothing in Settings matches “qqqqzzzz”.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Clear Search' }).click()
    await expect(page.getByRole('navigation', { name: 'Settings pages' })).toBeVisible()
  })
})

test.describe('changes stick', () => {
  test('a switch changed on one visit is as it was left on the next, and does what it says', async ({ boot, page }) => {
    await boot('/settings#appearance')
    const reviews = page.getByRole('switch', { name: 'Reviews' })
    await expect(reviews).toBeChecked()
    await reviews.click()
    await expect(reviews).not.toBeChecked()
    await page.reload()
    await expect(page.getByRole('switch', { name: 'Reviews' })).not.toBeChecked()
    // Title pages follow: with Reviews off there is no Reviews section.
    await page.goto('/title/movie/693134')
    await expect(page.getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Reviews', exact: true })).toHaveCount(0)
  })

  test('a menu choice (Opening Tab) is kept and the front address then opens there', async ({ boot, page }) => {
    await boot('/settings#appearance')
    await page.getByRole('combobox', { name: 'Opening Tab' }).selectOption({ label: 'Library' })
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Opening Tab' })).toHaveValue(/library/i)
    await page.goto('/')
    await expect(page).toHaveURL(/\/library/)
  })

  test('the theme button switches between light and dark and the choice is kept', async ({ boot, page }) => {
    await boot('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'Dark mode' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    // The button now offers the other one.
    await expect(page.getByRole('button', { name: 'Light mode' })).toBeVisible()
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})

test.describe('setup file', () => {
  test('Export Setup, clear everything, then Import brings the settings back', async ({ boot, page }, testInfo) => {
    await boot('/settings#playback')
    await page.getByRole('combobox', { name: 'Audio language' }).selectOption({ label: 'Spanish' })
    await page.getByRole('combobox', { name: 'Preferred quality' }).selectOption({ label: '720p' })

    await page.goto('/settings#data')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export' }).first().click()
    const file = testInfo.outputPath('setup.json')
    await (await download).saveAs(file)
    const setup = JSON.parse(await readFile(file, 'utf8')) as unknown
    expect(JSON.stringify(setup)).toContain('720p')

    // Clear everything on this device: the confirm button asks twice.
    await page.getByRole('button', { name: 'Reset Everything' }).click()
    await page.getByRole('button', { name: 'Reset', exact: true }).last().click()
    await expect(page.getByText('Marquee is back to a fresh start.')).toBeVisible()
    await page.goto('/settings#playback')
    await expect(page.getByRole('combobox', { name: 'Preferred quality' })).toHaveValue(/1080/)

    await page.goto('/settings#data')
    await page.getByRole('button', { name: 'Import', exact: true }).first().click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Choose File' }).click()
    await (await chooser).setFiles(file)
    await expect(page.getByRole('heading', { name: 'This setup contains' })).toBeVisible()
    await page.getByRole('button', { name: 'Import and Replace My Setup' }).click()

    await page.goto('/settings#playback')
    await expect(page.getByRole('combobox', { name: 'Audio language' })).toHaveValue(/es|spanish/i)
    await expect(page.getByRole('combobox', { name: 'Preferred quality' })).toHaveValue(/720/)
  })

  test('a file that isn’t a setup is refused with what to do next', async ({ boot, page }, testInfo) => {
    await boot('/settings#data')
    const file = testInfo.outputPath('not-a-setup.json')
    await writeFile(file, '{"hello":"world"}')
    await page.getByRole('button', { name: 'Import', exact: true }).first().click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Choose File' }).click()
    await (await chooser).setFiles(file)
    await expect(page.getByRole('alert')).toContainText(/setup/i)
    await expect(page.getByRole('heading', { name: 'This setup contains' })).toHaveCount(0)
  })
})
