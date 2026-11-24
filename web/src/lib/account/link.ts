/* The link that logs an app in to this account (docs/SYNC.md, The account link): `flow://account?n=<digits>&s=<server>`.
   Pure text handling, so it is tested without a browser and against the same vectors as the apps' reader
   (testdata/contracts/account-link.json). The number is the account's key: whoever holds the link can open the account. */

import { normaliseServer } from '../sync/pairing'
import { parseNumber } from './number'

export interface AccountLink {
  /** The 16 digits, no spaces. */
  number: string
  /** The account server's origin. */
  server: string
}

/** What the person is told when a link can't be read. */
export const unreadableLink = 'That link isn’t a Marquee account link. Open it again from Settings → Account on the website.'

/** The link the apps open. Null when the number isn't 16 digits or the server isn't an address, so a link that
 *  couldn't log anyone in is never shown. */
export function accountLink(number: string, server: string): string | null {
  const digits = parseNumber(number)
  const origin = normaliseServer(server)
  return digits && origin ? `flow://account?n=${digits}&s=${encodeURIComponent(origin)}` : null
}

/** Reads an account link, or null when it isn't one, has no readable number or has no readable server. The first of a
 *  repeated parameter counts, and a plus is a plus (the apps read it the same way). */
export function parseAccountLink(input: string): AccountLink | null {
  const text = input.trim()
  if (!/^flow:\/\/account\?/i.test(text)) return null
  const query = text.slice(text.indexOf('?') + 1).split('#')[0]!
  const params = new URLSearchParams(query.replace(/\+/g, '%2B'))
  const number = parseNumber(params.get('n') ?? '')
  const server = normaliseServer(params.get('s') ?? '')
  return number && server ? { number, server } : null
}
