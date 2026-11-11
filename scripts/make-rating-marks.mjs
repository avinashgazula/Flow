#!/usr/bin/env node
// Builds the rating marks in Flow/Resources/Assets.xcassets/RatingMarks from the simple-icons package (CC0), with the
// same crops and the same generic popcorn bucket as web/src/components/RatingMark.tsx, so the apps and the website show
// the same marks. Each is a template vector image: it takes the text colour.
//   node scripts/make-rating-marks.mjs [path/to/simple-icons]     (default: web/node_modules/simple-icons)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const icons = join(process.argv[2] ?? join(root, 'web/node_modules/simple-icons'), 'icons')
const out = join(root, 'Flow/Resources/Assets.xcassets/RatingMarks')

const pathOf = (file) => /<path d="([^"]+)"/.exec(readFileSync(join(icons, file), 'utf8'))[1]

// name, simple-icons file, viewBox cropped to the drawing (the wide TMDB and Letterboxd marks would be tiny in a square)
const marks = [
  ['imdb', 'imdb.svg', '0 0 24 24'],
  ['tomatometer', 'rottentomatoes.svg', '0 0 24 24'],
  ['metacritic', 'metacritic.svg', '0 0 24 24'],
  ['tmdb', 'themoviedatabase.svg', '0 3.35 24 17.3'],
  ['letterboxd', 'letterboxd.svg', '0 7.56 24 8.89'],
  ['trakt', 'trakt.svg', '0 0 24 24'],
].map(([name, file, box]) => ({ name, box, body: `<path d="${pathOf(file)}"/>` }))

// Popcornmeter has no Simple Icons mark: a generic bucket, as on the website.
marks.push({
  name: 'popcornmeter',
  box: '0 0 24 24',
  body:
    '<path d="M7 9.5a2.6 2.6 0 0 1 2.2-4.2 2.9 2.9 0 0 1 5.6 0A2.6 2.6 0 0 1 17 9.5Z"/>' +
    '<path fill-rule="evenodd" d="M4.5 10.5h15L17.8 22H6.2Zm4.1 2.2L9.3 20h1.4l-.5-7.3Zm4.7 0 -.5 7.3h1.4l.7-7.3Z"/>',
})

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 }, properties: { 'provides-namespace': false } }, null, 2) + '\n')
for (const { name, box, body } of marks) {
  const dir = join(out, `Rating-${name}.imageset`)
  mkdirSync(dir, { recursive: true })
  const [, , w, h] = box.split(' ')
  writeFileSync(join(dir, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="${w}" height="${h}"><g fill="#000">${body}</g></svg>\n`)
  writeFileSync(join(dir, 'Contents.json'), JSON.stringify({
    images: [{ filename: `${name}.svg`, idiom: 'universal' }],
    info: { author: 'xcode', version: 1 },
    properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' },
  }, null, 2) + '\n')
}
console.log(`wrote ${marks.length} marks to ${out}`)
