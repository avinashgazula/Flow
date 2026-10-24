/* Flow Sync's cryptography, as docs/SYNC.md defines it: a 16-byte key written in Crockford base32, three
   values derived from it with HKDF-SHA256, and AES-256-GCM for the blob. The Worker never sees the key
   or the plaintext. The apps do the same with CryptoKit; the test vector in the document is in
   crypto.test.ts. */

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** 128 bits written 5 at a time, zero-padded: 26 characters. */
export const keyLength = 26
const salt = new TextEncoder().encode('flow-sync-v1')

/** Why a typed key was refused, in the words the apps use too. */
export const incompleteKey = 'That sync key isn’t complete. Check it against the one on your other device.'

/** Fresh random key bytes: the only secret in Flow Sync. */
export const makeKeyBytes = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(16))

/** The 26-character written form (no dashes). */
export function encodeKey(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    value &= (1 << bits) - 1
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31]
  return out
}

/** Groups of four joined by dashes, for showing and typing: 000G-40R4-0M30-E209-185G-R38E-1W. */
export const groupKey = (text: string) => text.match(/.{1,4}/g)?.join('-') ?? ''

/** Reads what a person typed or pasted: case, dashes and spaces don't matter, O reads as 0, and I and L
 *  as 1. Null unless it is exactly 26 valid characters. */
export function parseKey(input: string): Uint8Array<ArrayBuffer> | null {
  const text = input.toUpperCase().replace(/[-\s]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (text.length !== keyLength) return null
  const bytes = new Uint8Array(16)
  let bits = 0
  let value = 0
  let at = 0
  for (const char of text) {
    const digit = alphabet.indexOf(char)
    if (digit < 0) return null
    value = (value << 5) | digit
    bits += 5
    if (bits >= 8) {
      if (at < 16) bytes[at++] = (value >>> (bits - 8)) & 255
      bits -= 8
      value &= (1 << bits) - 1
    }
  }
  return at === 16 ? bytes : null
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export async function sha256hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

/** HKDF-SHA256 over the key bytes with the document's salt. */
export async function derive(keyBytes: Uint8Array<ArrayBuffer>, info: string, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info) }, base, length * 8)
  return new Uint8Array(bits)
}

export interface SyncKeys {
  /** The record's name on the server: 32 lowercase hex characters. */
  id: string
  /** Proves this device holds the key; sent as the bearer token. */
  auth: string
  /** The AES-256-GCM key. */
  enc: CryptoKey
}

export async function deriveKeys(keyBytes: Uint8Array<ArrayBuffer>): Promise<SyncKeys> {
  const [id, auth, enc] = await Promise.all([derive(keyBytes, 'id', 16), derive(keyBytes, 'auth', 32), derive(keyBytes, 'enc', 32)])
  return { id: hex(id), auth: base64url(auth), enc: await crypto.subtle.importKey('raw', enc, 'AES-GCM', false, ['encrypt', 'decrypt']) }
}

/** `nonce || ciphertext || tag`, base64url without padding. The record's name is the additional data, so a
 *  blob copied to another record doesn't open. A fresh random nonce every time unless a test passes one. */
export async function encrypt(keys: SyncKeys, plaintext: string, nonce: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12))): Promise<string> {
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(keys.id) }, keys.enc, new TextEncoder().encode(plaintext)))
  const out = new Uint8Array(nonce.length + sealed.length)
  out.set(nonce)
  out.set(sealed, nonce.length)
  return base64url(out)
}

/** The plaintext of a blob, or a thrown error when the key is wrong or the blob was changed. */
export async function decrypt(keys: SyncKeys, blob: string): Promise<string> {
  const data = fromBase64url(blob)
  if (data.length < 12 + 16) throw new Error('blob too short')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: new TextEncoder().encode(keys.id) }, keys.enc, data.subarray(12))
  return new TextDecoder().decode(plain)
}
