import { derive, deriveKeys, encodeKey, parseKey, sha256hex } from '../lib/sync/crypto'
import { appLink, joinTarget, normaliseServer, parsePairing, webLink } from '../lib/sync/pairing'
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
      // A link with no server in it is the next op's.
      if (!parsed.ok || !parsed.pairing.server) return null
      return { key: hex(parsed.pairing.key), server: parsed.pairing.server, token: parsed.pairing.token ?? '' }
    }
    case 'parseWithDefault': {
      // A key with no server in it joins this build's own server; null when there is none either.
      const parsed = parsePairing(input.link)
      if (!parsed.ok) return null
      const server = input.defaultServer ? normaliseServer(input.defaultServer) : null
      const own = server ? { server, token: '' } : null
      const target = joinTarget(parsed.pairing, own)
      return target ? { key: hex(parsed.pairing.key), server: target.server, token: target.token } : null
    }
    case 'normalizeServer':
      return normaliseServer(input)
    default:
      throw new Error(`unknown op ${op}`)
  }
})
