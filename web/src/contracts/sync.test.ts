import { derive, deriveKeys, encodeKey, parseKey, sha256hex } from '../lib/sync/crypto'
import { appLink, normaliseServer, parsePairing, webLink } from '../lib/sync/pairing'
import { contract } from './support'

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (h) => parseInt(h, 16)) as Uint8Array<ArrayBuffer>

contract('sync-key', async ({ op, input }) => {
  switch (op) {
    case 'encode':
      return encodeKey(bytesOf(input))
    case 'parse': {
      const key = parseKey(input)
      return key ? hex(key) : null
    }
    case 'derive': {
      const key = bytesOf(input)
      const keys = await deriveKeys(key)
      return { id: keys.id, auth: keys.auth, enc: hex(await derive(key, 'enc', 32)), authHash: await sha256hex(keys.auth) }
    }
    default:
      throw new Error(`unknown op ${op}`)
  }
})

contract('sync-link', ({ op, input }) => {
  switch (op) {
    case 'appLink':
      return appLink(bytesOf(input.key), input.server, input.token)
    case 'webLink':
      return webLink(bytesOf(input.key), input.server, input.token, input.site)
    case 'parse': {
      const parsed = parsePairing(input)
      // The website also accepts a bare key with no server (Join a Sync can then use the server it already has); the apps
      // need the server in the link. Only links that carry one are compared, and none of the vectors is a bare key.
      if (!parsed.ok) return null
      return { key: hex(parsed.pairing.key), server: parsed.pairing.server ?? null, token: parsed.pairing.token ?? '' }
    }
    case 'normalizeServer':
      return normaliseServer(input)
    default:
      throw new Error(`unknown op ${op}`)
  }
})
