import { readFileSync } from 'node:fs'

/* The website's side of the themes contract: each theme and side is a block of styles/tokens.css that opens with a
   `/* palette: <theme> <side> *\/` comment. */

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')

/** Which custom property carries which token. */
export const tokenVars: Record<string, string> = {
  bg: '--bg', fg: '--fg', mark: '--red', spot: '--blue', spotPressed: '--blue-pressed', onSpot: '--onblue',
  muted: '--muted', faint: '--faint', tint1: '--tint-1', tint2: '--tint-2', tint3: '--tint-3', warn: '--warn',
}

/** The twelve values of a theme's side, read from the stylesheet. */
export function cssPalette(theme: string, side: string): Record<string, string> {
  const at = css.indexOf(`/* palette: ${theme} ${side} */`)
  if (at < 0) throw new Error(`tokens.css has no "palette: ${theme} ${side}" block`)
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
  const out: Record<string, string> = {}
  for (const [token, name] of Object.entries(tokenVars)) {
    const found = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`).exec(body)
    if (!found) throw new Error(`${theme} ${side} has no ${name}`)
    out[token] = found[1]!.toLowerCase()
  }
  return out
}

