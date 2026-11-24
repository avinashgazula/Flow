import { palettes } from '../features/settings/options'
import { cssPalette } from './themeTokens'
import { contract } from './support'

/* The colour themes (testdata/contracts/themes.json, FlowKit's ThemePalette): the website's side reads its own
   styles/tokens.css (themeTokens.ts) and the Theme rows' names and order from Settings. */

contract('themes', ({ op, input }) => {
  if (op === 'choices') return palettes.map((p) => ({ id: p.value, title: p.label }))
  if (op === 'palette') return cssPalette(input.theme, input.side)
  throw new Error(`unknown op ${op}`)
})
