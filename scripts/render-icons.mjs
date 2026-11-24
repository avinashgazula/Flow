#!/usr/bin/env node
/* Renders every icon Marquee ships from one drawing, design/icon/admit-one.svg ("Admit One": a red cinema ticket on paper).

   Usage:  node scripts/render-icons.mjs [--sheet path/to/contact-sheet.png]
   Needs Playwright's Chromium (only to rasterise; nothing here is a dependency of the app or the site). Run it from anywhere.
   Add `--only ios|tvos|mac|web|sheet` to redo one family.

   What it writes (same file names and pixel sizes as the icons it replaced, so every Contents.json stays valid):
     Flow/Resources/Assets.xcassets
       AppIcon.appiconset            icon-1024 (paper), icon-1024-dark (ink), icon-1024-tinted (grayscale): full bleed,
                                     square, no alpha, because iOS masks it. Also the Mac sizes, drawn as macOS wants them:
                                     an 824pt rounded body on a 1024 canvas with a soft shadow.
       AppIcon-Light.appiconset      the alternate icon, Ink
       IconPreviewPaper / IconPreviewInk, FlowMark.imageset   the same two icons as plain images for Settings, and the small mark
       App Icon & Top Shelf Image.brandassets   tvOS layers (400x240, 800x480, 1280x768): paper back, the ticket with its shadow
                                     in the middle, the M and the stub ring in front, so parallax lifts the print off the
                                     ticket; Top Shelf 1920x720 and wide 2320x720, each at 2x: the ticket well inside the
                                     edges, because tvOS crops them
     web/public                      icon.svg, icon-180/192/512 and the maskable 192/512 (ticket inside the 80% safe circle)
   Small sizes drop the perforation (it would turn to grey mush at 16 to 64px); the M and the ring stay.
   PNGs that iOS and the stores read are saved without an alpha channel. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, inflateSync, deflateSync } from 'node:zlib'

const { chromium } = createRequire(import.meta.url)('playwright')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG = join(ROOT, 'Flow/Resources/Assets.xcassets')
const BRAND = join(CATALOG, 'App Icon & Top Shelf Image.brandassets')
const WEB = join(ROOT, 'web/public')
const args = process.argv.slice(2)
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const only = arg('--only')
const sheetPath = arg('--sheet') ?? join(ROOT, 'shots/icon-contact-sheet.png')

const master = readFileSync(join(ROOT, 'design/icon/admit-one.svg'), 'utf8')
const inner = master.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

// --- Looks: the colours each version gives the ids in the master -------------------------------------------------
const PAPER = { ground: '#f3f3f0', shadow: 0.16, ticket: '#c9120a', mark: '#ffffff', ring: '#ffffff', core: '#0a0a0a' }
const INK = { ...PAPER, ground: '#0a0a0a', shadow: 0 }
// The tinted icon is grayscale (iOS colours it): the ticket is the light shape on dark, the print is cut out of it.
const TINTED = { ground: '#0d0d0d', shadow: 0, ticket: '#ececec', mark: '#0d0d0d', ring: '#0d0d0d', core: '#ececec' }

// --- Geometry ------------------------------------------------------------------------------------------------------
// The tilted ticket spans about 785 x 558 units of the 1024 square. A tvOS layer shows it `fill` of its height.
const TICKET_H = 570

/** The viewBox that centres the art in a w x h canvas with the ticket `fill` of the height. */
function frame(w, h, fill) {
  const vh = TICKET_H / fill
  const vw = (vh * w) / h
  return `${512 - vw / 2} ${512 - vh / 2} ${vw} ${vh}`
}

/** macOS's rounded body (an 824 superellipse centred on a 1024 canvas) as a path. */
function squircle(half = 412, n = 5, steps = 720) {
  const pts = []
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const c = Math.cos(t), s = Math.sin(t)
    const x = Math.sign(c) * Math.abs(c) ** (2 / n) * half
    const y = Math.sign(s) * Math.abs(s) ** (2 / n) * half
    pts.push(`${(512 + x).toFixed(2)},${(512 + y).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}

/** A full page for one render. `layers` picks which of ground/shadow/ticket/print show. */
function page({ w, h, viewBox, look, layers = ['ground', 'shadow', 'ticket', 'print'], perf = true, mac = false }) {
  const hide = ['ground', 'shadow', 'ticket', 'print'].filter((l) => !layers.includes(l))
  const css = [
    ...hide.map((l) => `#${l}{display:none}`),
    perf ? '' : '#dots{display:none}',
    `#ground{fill:${look.ground}}#shadow{opacity:${look.shadow}}#ticket{fill:${look.ticket}}`,
    `#mark{fill:${look.mark}}#ring{fill:${look.ring}}#core{fill:${look.core}}`,
  ].join('')
  const art = mac
    ? `<defs><clipPath id="body"><path d="${squircle()}"/></clipPath><filter id="drop" x="-10%" y="-10%" width="120%" height="125%"><feGaussianBlur stdDeviation="16"/></filter></defs>
       <path d="${squircle()}" fill="#000" opacity="0.5" transform="translate(0 14)" filter="url(#drop)"/>
       <g clip-path="url(#body)"><g transform="translate(512 512) scale(${824 / 1024}) translate(-512 -512)">${inner}</g></g>`
    : inner
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block}${css}</style>
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox ?? '0 0 1024 1024'}">${art}</svg>`
}

// --- PNG without alpha: Chromium writes RGBA, and the App Store refuses an icon that has an alpha channel ----------
function stripAlpha(png) {
  let pos = 8, w = 0, h = 0
  const idat = []
  while (pos < png.length) {
    const len = png.readUInt32BE(pos), type = png.toString('latin1', pos + 4, pos + 8)
    if (type === 'IHDR') { w = png.readUInt32BE(pos + 8); h = png.readUInt32BE(pos + 12); if (png[pos + 17] !== 6 || png[pos + 16] !== 8) return png }
    if (type === 'IDAT') idat.push(png.subarray(pos + 8, pos + 8 + len))
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * 4
  const px = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? px[dst + i - 4] : 0, b = y ? px[dst - stride + i] : 0, c = i >= 4 && y ? px[dst - stride + i - 4] : 0
      const x = raw[src + i]
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      px[dst + i] = (x + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
    }
  }
  const out = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[y * (w * 3 + 1) + 1 + x * 3 + k] = px[y * stride + x * 4 + k]
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length)
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8)
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length)
    return b
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// --- Rendering --------------------------------------------------------------------------------------------------------
const browser = await chromium.launch()
const written = []

async function render(file, spec, { alpha = false } = {}) {
  const { w, h } = spec
  let shot
  // A fresh page per image, and a retry: Chromium's software renderer now and then drops a page on a large masked SVG.
  for (let attempt = 1; !shot; attempt++) {
    const tab = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: w, height: h } })
    try {
      await tab.setContent(page(spec))
      shot = await tab.screenshot({ type: 'png', omitBackground: alpha })
    } catch (e) {
      if (attempt >= 4) throw e
    } finally {
      await tab.close().catch(() => {})
    }
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, alpha ? shot : stripAlpha(shot))
  written.push(file)
  console.log(`  ${relative(ROOT, file)}  ${w}x${h}${alpha ? ' (alpha)' : ''}`)
}

const square = (size, look, extra = {}) => ({ w: size, h: size, look, ...extra })
const wants = (family) => !only || only === family

if (wants('ios')) {
  console.log('iOS')
  const set = join(CATALOG, 'AppIcon.appiconset')
  await render(join(set, 'icon-1024.png'), square(1024, PAPER))
  await render(join(set, 'icon-1024-dark.png'), square(1024, INK))
  await render(join(set, 'icon-1024-tinted.png'), square(1024, TINTED))
  await render(join(CATALOG, 'AppIcon-Light.appiconset/icon-1024.png'), square(1024, INK))
  await render(join(CATALOG, 'IconPreviewPaper.imageset/icon.png'), square(1024, PAPER))
  await render(join(CATALOG, 'IconPreviewInk.imageset/icon.png'), square(1024, INK))
  await render(join(CATALOG, 'FlowMark.imageset/flowmark.png'), square(360, PAPER, { perf: false }))
}

if (wants('mac')) {
  console.log('macOS')
  const set = join(CATALOG, 'AppIcon.appiconset')
  for (const [point, scale] of [[16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2], [256, 1], [256, 2], [512, 1], [512, 2]]) {
    const px = point * scale
    await render(join(set, `mac-${point}@${scale}x.png`), square(px, PAPER, { mac: true, perf: px >= 128 }), { alpha: true })
  }
}

if (wants('tvos')) {
  console.log('tvOS')
  const stacks = [['App Icon.imagestack', 400, 240, '@1x'], ['App Icon.imagestack', 800, 480, '@2x'], ['App Icon - App Store.imagestack', 1280, 768, '@1x']]
  for (const [folder, w, h, suffix] of stacks) {
    const viewBox = frame(w, h, 0.66)
    const layer = (name, layers, alpha) =>
      render(join(BRAND, folder, `${name[0].toUpperCase()}${name.slice(1)}.imagestacklayer/Content.imageset/${name}${suffix}.png`), { w, h, viewBox, look: PAPER, layers }, { alpha })
    await layer('back', ['ground'], false)
    await layer('middle', ['shadow', 'ticket'], true)
    await layer('front', ['print'], true)
  }
  const shelves = [['Top Shelf Image.imageset', 1920, 720], ['Top Shelf Image Wide.imageset', 2320, 720]]
  for (const [folder, w, h] of shelves) {
    for (const k of [1, 2]) await render(join(BRAND, folder, `shelf@${k}x.png`), { w: w * k, h: h * k, viewBox: frame(w, h, 0.5), look: PAPER })
  }
}

if (wants('web')) {
  console.log('web')
  for (const size of [180, 192, 512]) await render(join(WEB, `icon-${size}.png`), square(size, PAPER, { perf: size >= 192 }))
  // Launchers cut a circle of 80% of the width out of a maskable icon: the ticket's corners (about 0.41 of the width from the
  // centre at full size) must sit inside it, so the art shrinks to 0.86 about the centre and the ground runs to every edge.
  for (const size of [192, 512]) await render(join(WEB, `icon-maskable-${size}.png`), square(size, PAPER, { viewBox: `${512 - 512 / 0.86} ${512 - 512 / 0.86} ${1024 / 0.86} ${1024 / 0.86}` }))
  // The tab icon: no perforation, a plain ground, so it holds at 16px.
  const svg = master.replace(/<g id="dots">[\s\S]*?<\/g>/, '').replace(/\n\s*<!--[\s\S]*?-->/, '')
  writeFileSync(join(WEB, 'icon.svg'), svg)
  written.push(join(WEB, 'icon.svg'))
  console.log('  web/public/icon.svg')
}

// --- Contact sheet -----------------------------------------------------------------------------------------------------
if (wants('sheet') || !only) {
  const uri = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`
  const set = join(CATALOG, 'AppIcon.appiconset')
  const stack = (folder, s) => ['back', 'middle', 'front'].map((n) => uri(join(BRAND, `${folder}.imagestack/${n[0].toUpperCase()}${n.slice(1)}.imagestacklayer/Content.imageset/${n}${s}.png`)))
  const tv = stack('App Icon', '@2x')
  const store = stack('App Icon - App Store', '@1x')
  const tvStack = (layers, w) => `<div class="tv" style="width:${w}px;height:${w * 0.6}px;border-radius:${w * 0.03}px">${layers.map((l) => `<img src="${l}">`).join('')}</div>`
  const squircleImg = (f, size) => `<img class="ios" style="width:${size}px;height:${size}px" src="${uri(f)}">`
  const macFile = { 1024: 'mac-512@2x', 512: 'mac-512@1x', 256: 'mac-256@1x', 128: 'mac-128@1x', 64: 'mac-32@2x', 32: 'mac-16@2x', 16: 'mac-16@1x' }
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:36px;width:2428px;background:#2a2a2e;font:600 22px/1 ui-monospace,monospace;color:#bbb}
    .row{display:flex;gap:36px;align-items:flex-end;margin-bottom:44px}.col{display:flex;flex-direction:column;gap:12px;align-items:flex-start}
    .ios{border-radius:22.37%;display:block}.plate{background:#dcdce2;padding:30px;display:flex;gap:20px;align-items:flex-end}
    .tv{position:relative;overflow:hidden;background:#000}.tv img{position:absolute;inset:0;width:100%;height:100%}
    .small{display:flex;gap:16px;align-items:flex-end}.ring{position:relative}.ring i{position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 2000px rgba(0,0,0,.45);clip-path:inset(0)}
  </style>
  <div class="row">
    <div class="col">${squircleImg(join(set, 'icon-1024.png'), 520)}Paper (default)</div>
    <div class="col">${squircleImg(join(set, 'icon-1024-dark.png'), 520)}Ink / dark appearance</div>
    <div class="col">${squircleImg(join(set, 'icon-1024-tinted.png'), 520)}Tinted (grayscale)</div>
    <div class="col"><div class="plate"><img src="${uri(join(set, `${macFile[1024]}.png`))}" style="width:420px"><img src="${uri(join(set, `${macFile[512]}.png`))}" style="width:200px"><img src="${uri(join(set, `${macFile[256]}.png`))}" style="width:100px"></div>Mac, 1024 / 512 / 256 art</div>
  </div>
  <div class="row">
    <div class="col"><div class="small">${[180, 120, 87, 60, 40, 29].map((s) => squircleImg(join(set, 'icon-1024.png'), s)).join('')}</div>Paper at 180 / 120 / 87 / 60 / 40 / 29 px (browser downscale of the 1024)</div>
    <div class="col"><div class="small">${[180, 120, 87, 60, 40, 29].map((s) => squircleImg(join(set, 'icon-1024-dark.png'), s)).join('')}</div>Ink, same sizes</div>
    <div class="col"><div class="small" style="background:#dcdce2;padding:14px">${[128, 64, 32, 16].map((px) => `<img src="${uri(join(set, `${macFile[px]}.png`))}" style="width:${px}px">`).join('')}</div>Mac 128 / 64 / 32 / 16 px, as rendered</div>
    <div class="col"><div class="small">${['icon-192.png', 'icon-maskable-192.png', 'icon-180.png'].map((f) => `<img src="${uri(join(WEB, f))}" style="width:192px;${f.includes('mask') ? 'border-radius:50%' : ''}">`).join('')}</div>Web: icon-192, maskable-192 in a circle, icon-180</div>
  </div>
  <div class="row">
    <div class="col">${tvStack(tv, 800)}Apple TV icon, layered flat (800x480)</div>
    <div class="col">${tvStack(store, 768)}App Store image (1280x768)</div>
    <div class="col"><div style="display:flex;gap:12px">${tv.map((l) => `<div style="background:repeating-conic-gradient(#555 0 25%,#777 0 50%) 0 0/20px 20px"><img src="${l}" style="width:260px;display:block"></div>`).join('')}</div>Back / middle / front layers</div>
  </div>
  <div class="row">
    <div class="col"><img src="${uri(join(BRAND, 'Top Shelf Image.imageset/shelf@1x.png'))}" style="width:1120px">Top Shelf 1920x720</div>
    <div class="col"><img src="${uri(join(BRAND, 'Top Shelf Image Wide.imageset/shelf@1x.png'))}" style="width:1160px">Top Shelf Wide 2320x720</div>
  </div>`
  const sheet = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 2500, height: 1000 } })
  await sheet.setContent(html)
  mkdirSync(dirname(sheetPath), { recursive: true })
  await sheet.screenshot({ path: sheetPath, fullPage: true })
  console.log(`  contact sheet ${sheetPath}`)
}

await browser.close()
