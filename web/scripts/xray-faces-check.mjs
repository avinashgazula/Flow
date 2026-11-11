// End-to-end check of X-Ray's face recognition, in headless Chromium, against a built site (npm run build, then
// `npx vite preview --port N`). Run: node scripts/xray-faces-check.mjs http://localhost:N [captures-folder]
//
// Nothing here needs a TMDB key, an add-on or a network: TMDB's API, its image host and a Stremio add-on are answered by
// this script. The cast's profile photos are public-domain portraits, and the film is a webm that shows one still
// photograph (also public domain; see scripts/fixtures/xray-faces/README.txt), so the frame X-Ray looks at has known faces.
//
//   A  a family photograph, played from the site's own address: Michelle Obama and Barack Obama are named, left to right.
//   B  a group of 23 people: Obama, Biden and Clinton are named, and nobody else is.
//   C  the same film from another address that sends no CORS headers: the picture can't be read, so X-Ray says so and
//      names who the dialogue mentions instead (the sample dialogue names no one here, so it says that plainly).
//   D  Recognise Faces off: nothing is downloaded and the panel reads as it always did.
//   E  a second visit (same browser profile): the cast's prints are already stored, so only the frame is worked out.
//
// Playwright isn't a dependency of the site: this needs it installed where Node can find it, and ffmpeg for the clip.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const site = (process.argv[2] ?? 'http://localhost:4173').replace(/\/$/, '')
const out = process.argv[3] ?? join(tmpdir(), 'xray-faces-check')
const fixtures = fileURLToPath(new URL('./fixtures/xray-faces/', import.meta.url))
mkdirSync(out, { recursive: true })

// The film: a few seconds of one still photograph, in a format headless Chromium plays.
const clips = {}
for (const name of ['family', 'cabinet']) {
  const file = join(out, `${name}.webm`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', '5', '-i', join(fixtures, `${name}.jpg`), '-t', '20', '-vf', 'scale=1920:-2', '-c:v', 'libvpx-vp9', '-b:v', '3M', '-pix_fmt', 'yuv420p', '-an', file])
  clips[name] = readFileSync(file)
}

const people = [
  { id: 1001, name: 'Barack Obama', role: 'Himself', profile: '/obama.jpg' },
  { id: 1002, name: 'Michelle Obama', role: 'Herself', profile: '/michelle.jpg' },
  { id: 1003, name: 'Joe Biden', role: 'Himself', profile: '/biden.jpg' },
  { id: 1004, name: 'Hillary Clinton', role: 'Herself', profile: '/clinton.jpg' },
]
const filmId = 4242
const film = {
  id: filmId, title: 'Test Film', release_date: '2009-10-09', overview: 'A still photograph, played as a film.', imdb_id: 'tt0000001', runtime: 1, genres: [], vote_average: 7,
  credits: { cast: people.map((p, order) => ({ id: p.id, name: p.name, character: p.role, profile_path: p.profile, order })), crew: [] },
}
const addon = 'https://addon.test'
const manifest = { id: 'test.addon', name: 'Test Add-on', version: '1.0.0', types: ['movie'], resources: ['stream'], idPrefixes: ['tt'] }

/** Answers a media request the way a server does, with ranges, so the browser can seek. */
const serve = (route, body, extra = {}) => {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '')
  const headers = { 'content-type': 'video/webm', 'accept-ranges': 'bytes', ...extra }
  if (!range) return route.fulfill({ status: 200, headers, body })
  const start = Number(range[1])
  const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
  return route.fulfill({ status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` }, body: body.subarray(start, end + 1) })
}

async function visit(browser, { clip, origin, settings = {}, context: existing, label, viewport = { width: 1280, height: 720 } }) {
  const context = existing ?? (await browser.newContext({ viewport }))
  const stream = origin === 'cross' ? 'https://media.test/film.webm' : `${site}/__test/film.webm`
  await context.addInitScript(
    ([s, base, extra]) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      const key = 'flow.settings.v1'
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), demo: false, onboarded: true, tmdbKey: '0123456789abcdef0123456789abcdef', addons: [{ url: `${base}/manifest.json`, name: 'Test Add-on', enabled: true }], ...extra }))
    },
    [null, addon, settings],
  )
  const page = await context.newPage()
  const requested = []
  page.on('request', (r) => requested.push(r.url()))
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => (m.text().startsWith('DBG') || process.env.ALLLOG ? console.log(m.type(), m.text()) : m.type() === 'error' && problems.push(`console: ${m.text()}`)))
  await page.route('https://api.themoviedb.org/3/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const json = path === `/3/movie/${filmId}` ? film : {}
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(json) })
  })
  await page.route('https://image.tmdb.org/**', (route) => {
    const file = new URL(route.request().url()).pathname.split('/').pop()
    const body = (() => {
      try { return readFileSync(join(fixtures, file)) } catch { return undefined }
    })()
    return body ? route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' }, body }) : route.fulfill({ status: 404 })
  })
  await page.route(`${addon}/**`, (route) => {
    const path = new URL(route.request().url()).pathname
    const json = path === '/manifest.json' ? manifest : { streams: [{ name: 'Test', title: 'Test Film 1080p WEB-DL VP9 Opus', url: stream, behaviorHints: { filename: 'Test.Film.2009.1080p.WEB-DL.VP9.webm' } }] }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(json) })
  })
  await page.route(`${site}/__test/film.webm`, (route) => serve(route, clips[clip]))
  // No CORS headers at all: playing it is fine, reading its pixels is not.
  await page.route('https://media.test/film.webm', (route) => serve(route, clips[clip]))

  await page.goto(`${site}/watch/movie/${filmId}`)
  // The source picker lists the one source; Enter plays the best match.
  // A title played before starts by itself (the app remembers its source); a new one asks.
  const first = await Promise.race([
    page.getByText('Best Match').waitFor({ timeout: 20000 }).then(() => 'picker'),
    page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, null, { timeout: 20000 }).then(() => 'playing'),
  ])
  if (first === 'picker') await page.keyboard.press('Enter')
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && v.videoWidth > 0 }, null, { timeout: 40000 }).catch(async (error) => {
    await page.screenshot({ path: join(out, `stuck-${label}.png`) })
    console.log(`${label} never started playing. Page text: ${(await page.locator('body').innerText()).slice(0, 600).replace(/\n+/g, ' / ')}\n${problems.join('\n')}`)
    throw error
  })
  await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 3 })
  await page.waitForTimeout(600)
  const started = Date.now()
  await page.evaluate(() => document.querySelector('video').pause())
  await page.waitForSelector('section[aria-label="X-Ray"]', { timeout: 10000 })
  await page.getByRole('tab', { name: 'In Scene' }).click()
  return { page, context, started, requested, problems, label }
}

/** What In Scene shows once it has settled: the names, in order, and the line under them. */
async function readScene(visitor, { settle = /Recognised in this frame|Matched from dialogue\.|matched the cast|No faces found|doesn’t let Marquee|Data Saver|couldn’t load/i, timeout = 90000 } = {}) {
  const { page } = visitor
  const panel = page.locator('section[aria-label="X-Ray"]')
  await panel.locator('p', { hasText: settle }).first().waitFor({ timeout }).catch(async (error) => {
    await page.screenshot({ path: join(out, `waiting-${visitor.label}.png`) })
    console.log(await page.evaluate(() => JSON.stringify({ conn: navigator.connection && { t: navigator.connection.type, e: navigator.connection.effectiveType, s: navigator.connection.saveData }, off: typeof OffscreenCanvas, w: typeof Worker, ib: typeof createImageBitmap, rf: JSON.parse(localStorage.getItem('flow.settings.v1')).recogniseFaces })))
    console.log(`${visitor.label} In Scene never settled. Panel: ${(await panel.innerText()).replace(/\n+/g, ' / ').slice(0, 400)}\n${visitor.problems.join('\n')}\nrequests: ${visitor.requested.filter((u) => /onnx|wasm|h632|worker|XRay/.test(u)).join(' ')}`)
    throw error
  })
  const ms = Date.now() - visitor.started
  const names = await panel.locator('[role="tabpanel"] button[aria-label*=" as "]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').split(' as ')[0]))
  const note = (await panel.locator('[role="tabpanel"] p').allInnerTexts()).join(' | ')
  const measures = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('measure').filter((m) => m.name.startsWith('xray-faces')).map((m) => [m.name, Math.round(m.duration)])))
  return { names, note, ms, measures }
}

const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const browser = await chromium.launch()
try {
  // A: first visit ever, so the models and the cast's photos are all fetched and worked on.
  const a = await visit(browser, { clip: 'family', origin: 'same', label: 'A' })
  // The first look is still working: the card says so.
  await a.page.screenshot({ path: join(out, 'a0-recognising.png') })
  const ra = await readScene(a)
  await a.page.screenshot({ path: join(out, 'a-family.png') })
  console.log('A', JSON.stringify(ra))
  check('A the family photograph names Michelle Obama then Barack Obama, left to right', same(ra.names, ['Michelle Obama', 'Barack Obama']), ra.names.join(', '))
  check('A says it recognised them in the frame, on this device', /Recognised in this frame/.test(ra.note) && /on this device/.test(ra.note))
  check('A fetched the models and the runtime from the site itself', a.requested.some((u) => u.endsWith('.onnx') && u.startsWith(site)) && a.requested.some((u) => u.endsWith('.wasm') && u.startsWith(site)))
  const outside = a.requested.filter((u) => !u.startsWith(site) && !/addon\.test|api\.themoviedb\.org|image\.tmdb\.org|media\.test/.test(u))
  check('A asked no third-party host for anything', outside.length === 0, outside.join(' '))
  check('A sent nothing about the picture anywhere', a.requested.every((u) => !/^https?:\/\/(?!localhost)/.test(u) || !/frame|face|print/i.test(u)))
  check('A logged no errors', a.problems.length === 0, a.problems.join(' | '))

  // B: another frame in the same browser profile (the cast's prints are kept now), with 23 faces in it.
  await a.page.close()
  const b = await visit(browser, { clip: 'cabinet', origin: 'same', context: a.context, label: 'B' })
  const rb = await readScene(b)
  await b.page.screenshot({ path: join(out, 'b-cabinet.png') })
  console.log('B', JSON.stringify(rb))
  check('B the cabinet photograph names Obama, Biden and Clinton, and no one else', same(rb.names, ['Barack Obama', 'Joe Biden', 'Hillary Clinton']), rb.names.join(', '))
  check('B worked from the stored prints (no cast photo was fetched again)', !b.requested.some((u) => u.includes('image.tmdb.org/t/p/h632')))
  await b.page.close()
  await a.context.close()

  // C: a stream the page can't read.
  const c = await visit(browser, { clip: 'family', origin: 'cross', label: 'C' })
  const rc = await readScene(c, { settle: /doesn’t let Marquee read its picture/ })
  await c.page.screenshot({ path: join(out, 'c-unreadable.png') })
  console.log('C', JSON.stringify(rc))
  check('C says the stream’s picture can’t be read, and lists no one from faces', /doesn’t let Marquee read its picture/.test(rc.note) && rc.names.length === 0)
  await c.context.close()

  // D: Recognise Faces off.
  const d = await visit(browser, { clip: 'family', origin: 'same', settings: { recogniseFaces: false }, label: 'D' })
  await d.page.waitForTimeout(4000)
  const panel = d.page.locator('section[aria-label="X-Ray"]')
  const noteD = (await panel.locator('[role="tabpanel"] p').allInnerTexts()).join(' | ')
  await d.page.screenshot({ path: join(out, 'd-off.png') })
  console.log('D', noteD)
  check('D with Recognise Faces off nothing of face recognition is fetched', !d.requested.some((u) => /\.onnx|ort-wasm|h632/.test(u)))
  check('D reads the dialogue as before', /subtitle|dialogue/i.test(noteD) && !/Recognis/.test(noteD))
  await d.context.close()

  // F: a phone, held upright and sideways.
  for (const [label, viewport] of [['phone-portrait', { width: 390, height: 844 }], ['phone-landscape', { width: 844, height: 390 }]]) {
    const f = await visit(browser, { clip: 'family', origin: 'same', viewport, label })
    const rf = await readScene(f)
    await f.page.screenshot({ path: join(out, `f-${label}.png`) })
    check(`F ${label}: names the two in the family photograph`, same(rf.names, ['Michelle Obama', 'Barack Obama']), rf.names.join(', '))
    check(`F ${label}: nothing scrolls sideways`, await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await f.context.close()
  }
} finally {
  await browser.close()
}
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed. Pictures are in ${out}`)
process.exit(failed.length ? 1 : 0)
