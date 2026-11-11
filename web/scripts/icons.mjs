/* Draws the PNG icons from public/icon.svg, the mark: a blue square, a white condensed M and one red bulb.
   Run when the mark changes (node scripts/icons.mjs); the PNGs are committed, so a build needs nothing of this.
   It uses Playwright's Chromium only to rasterise, so Playwright isn't a dependency of the site.
   The maskable icons keep the mark inside the central 80% circle launchers leave visible, on a full-bleed blue field. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const here = new URL('../public/', import.meta.url)
const svg = readFileSync(new URL('icon.svg', here), 'utf8')
const mark = svg.replace(/^[\s\S]*?<rect[^>]*\/>\s*/, '').replace(/<\/svg>\s*$/, '')

/** `scale` shrinks the mark about the centre: the maskable art sits well inside the safe zone. */
const art = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#1a3dff"/><g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${mark}</g></svg>`

const sizes = [
  ['icon-180.png', 180, 1],
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-192.png', 192, 0.8],
  ['icon-maskable-512.png', 512, 0.8],
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [file, size, scale] of sizes) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${art(scale)}`)
  writeFileSync(new URL(file, here), await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } }))
}
await browser.close()
