import { describe, expect, it } from 'vitest'
import { base64url, decrypt, derive, deriveKeys, encodeKey, encrypt, fromBase64url, groupKey, incompleteKey, makeKeyBytes, parseKey, sha256hex } from './crypto'

// The test vector in docs/SYNC.md.
const keyBytes = Uint8Array.from({ length: 16 }, (_, i) => i)
const nonce = Uint8Array.from({ length: 12 }, (_, i) => i)
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const vector = {
  text: '000G40R40M30E209185GR38E1W',
  grouped: '000G-40R4-0M30-E209-185G-R38E-1W',
  id: '625ee37823f4fad87a1591ef9038d5c6',
  auth: 'MF8YRcz1DFlJqMdCJgMOrexYxSLXV50cYLJsfg2ts50',
  enc: '7216fa3c9cdb9f4f1cd4b5a76c3aa5414ec5d741e8eb1b5f1f8b242fbad13eca',
  plaintext: '{"v":1,"sections":{}}',
  blob: 'AAECAwQFBgcICQoLGAP4YCx3YYoDIGnxPMRrrawbsS-rAxRzm-9OU5yZM8MHg9rlLg',
  authHash: '4c921fbf5d2aa65f33ff2423208ef4628a74ddb6f96196e2ff212c073cbd02b0',
}

describe('the sync key', () => {
  it('is written in Crockford base32 and shown in groups of four', () => {
    expect(encodeKey(keyBytes)).toBe(vector.text)
    expect(groupKey(vector.text)).toBe(vector.grouped)
  })

  it('makes 26 characters from fresh random bytes, and reads them back', () => {
    const bytes = makeKeyBytes()
    const text = encodeKey(bytes)
    expect(text).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(parseKey(text)).toEqual(bytes)
    expect(makeKeyBytes()).not.toEqual(bytes)
  })

  it('reads the grouped form, lowercase, spaces and stray dashes', () => {
    for (const typed of [vector.text, vector.grouped, vector.grouped.toLowerCase(), ` ${vector.grouped.replace(/-/g, ' ')} `, vector.text.toLowerCase().replace(/(.{5})/g, '$1-'), `${vector.grouped}\n`]) {
      expect(parseKey(typed), typed).toEqual(keyBytes)
    }
  })

  it('reads O as 0 and I and L as 1', () => {
    // 000G has zeros; the vector has no 1 until "1W", so swap those the way a person misreads them.
    expect(parseKey('OOOG-40R4-OM30-E2O9-185G-R38E-IW')).toEqual(keyBytes)
    expect(parseKey('000G-40R4-0M30-E209-185G-R38E-LW')).toEqual(keyBytes)
    expect(parseKey('000g-40r4-0m3o-e209-i85g-r38e-1w')).toEqual(keyBytes)
  })

  it('refuses anything that is not 26 valid characters', () => {
    expect(parseKey('')).toBeNull()
    expect(parseKey(vector.text.slice(1))).toBeNull()
    expect(parseKey(`${vector.text}0`)).toBeNull()
    expect(parseKey(vector.grouped.replace('R', 'U'))).toBeNull() // U isn't in the alphabet
    expect(parseKey(vector.grouped.replace('G', '#'))).toBeNull()
    expect(parseKey('hello there')).toBeNull()
    expect(incompleteKey).toBe('That sync key isn’t complete. Check it against the one on your other device.')
  })
})

describe('what is derived from the key', () => {
  it('matches the vector: id, auth and enc', async () => {
    expect(hex(await derive(keyBytes, 'id', 16))).toBe(vector.id)
    expect(base64url(await derive(keyBytes, 'auth', 32))).toBe(vector.auth)
    expect(hex(await derive(keyBytes, 'enc', 32))).toBe(vector.enc)
    const keys = await deriveKeys(keyBytes)
    expect(keys.id).toBe(vector.id)
    expect(keys.auth).toBe(vector.auth)
  })

  it('hashes the auth text the way the Worker does', async () => {
    expect(await sha256hex(vector.auth)).toBe(vector.authHash)
  })
})

describe('the blob', () => {
  it('reproduces the vector exactly', async () => {
    const keys = await deriveKeys(keyBytes)
    expect(await encrypt(keys, vector.plaintext, nonce)).toBe(vector.blob)
  })

  it('opens the vector', async () => {
    expect(await decrypt(await deriveKeys(keyBytes), vector.blob)).toBe(vector.plaintext)
  })

  it('uses a new nonce each time, and round-trips text with non-ASCII characters', async () => {
    const keys = await deriveKeys(keyBytes)
    const text = JSON.stringify({ name: 'Café “Flow” 映画' })
    const a = await encrypt(keys, text)
    const b = await encrypt(keys, text)
    expect(a).not.toBe(b)
    expect(await decrypt(keys, a)).toBe(text)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('refuses a blob under another key, under another record name, or changed', async () => {
    const keys = await deriveKeys(keyBytes)
    const other = await deriveKeys(makeKeyBytes())
    await expect(decrypt(other, vector.blob)).rejects.toThrow()
    await expect(decrypt({ ...keys, id: 'f'.repeat(32) }, vector.blob)).rejects.toThrow()
    const bytes = fromBase64url(vector.blob)
    bytes[20] = bytes[20]! ^ 1
    await expect(decrypt(keys, base64url(bytes))).rejects.toThrow()
    await expect(decrypt(keys, 'AAAA')).rejects.toThrow()
  })

  it('round-trips base64url of every length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 250) & 255)
      const text = base64url(bytes)
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/)
      expect(fromBase64url(text)).toEqual(bytes)
    }
  })
})
