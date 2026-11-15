import { test } from './fixtures'
import { routes } from './sitemap'

/* Every address the site answers draws its real content, with the fixture's gate on console errors, page errors,
   unhandled rejections and failed requests to the site itself. */

for (const route of routes) {
  test(`${route.name} draws its content (${route.path})`, async ({ boot, page }) => {
    await boot(route.path)
    await route.ready(page)
  })
}
