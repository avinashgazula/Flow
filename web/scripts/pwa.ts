/* The build's part of "install Flow as an app": after the site is written, work out which files the service
   worker keeps, build src/sw/sw.ts with that list in it, and write the OpenSearch descriptor beside it.
   Hand-written on purpose: the worker is a hundred lines, and a library for it would be bigger than the
   code it replaces. Build only; `vite dev` has no worker and nothing to register. */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build, type Plugin } from 'vite'
import { openSearchDescriptor, siteAddress } from '../src/sw/openSearch.ts'
import { assetsIn, precacheList, type BuiltFile } from '../src/sw/rules.ts'

/** Files with no hash in their name that the app needs offline: the page itself (an empty path is the site's
 *  root), the page shown when even that is missing, the manifest, the icon and the edge-print font that
 *  Home's strips are set in. Other typefaces are saved the first time they are chosen. */
const shellFiles = ['', 'offline.html', 'manifest.webmanifest', 'icon-192.png', 'fonts/barlow-condensed-latin-600-normal.woff2']

export function pwa(): Plugin {
  let root = ''
  let outDir = ''
  let base = '/'
  return {
    name: 'flow-pwa',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = resolve(config.root, config.build.outDir)
      base = config.base
    },
    transformIndexHtml() {
      return [{ tag: 'link', attrs: { rel: 'search', type: 'application/opensearchdescription+xml', title: 'Flow', href: `${base}opensearch.xml` }, injectTo: 'head' }]
    },
    async closeBundle() {
      // The first pass (a nested build for the worker, below) has no plugins, so this runs once.
      if (!existsSync(join(outDir, 'index.html'))) return
      writeFileSync(join(outDir, 'opensearch.xml'), openSearchDescriptor(siteAddress(base, process.env)))

      const built: BuiltFile[] = []
      const assets = join(outDir, 'assets')
      for (const name of readdirSync(assets)) built.push({ path: `assets/${name}`, bytes: statSync(join(assets, name)).size })
      const precache = precacheList(built, [...shellFiles, ...assetsIn(readFileSync(join(outDir, 'index.html'), 'utf8'))])

      // The cache's name is a fingerprint of what's in it, so a deploy that changes any file changes the name,
      // and the worker's own code counts too.
      const hash = createHash('sha256')
      for (const path of precache) hash.update(path).update(readFileSync(join(outDir, path || 'index.html')))
      for (const name of ['sw.ts', 'rules.ts']) hash.update(readFileSync(resolve(root, 'src/sw', name)))
      const version = hash.digest('hex').slice(0, 10)

      await build({
        configFile: false,
        root,
        publicDir: false,
        logLevel: 'warn',
        define: { __FLOW_SW__: JSON.stringify({ version, precache }) },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          sourcemap: false,
          target: 'es2022',
          lib: { entry: resolve(root, 'src/sw/sw.ts'), formats: ['iife'], name: 'FlowSW', fileName: () => 'sw.js' },
        },
      })
    },
  }
}
