/* Marquee Accounts' cryptography, as docs/SYNC.md defines it. The 16-digit number is run through PBKDF2-HMAC-SHA256
   (600,000 rounds, deliberately slow: 16 digits are only about 53 bits, so a leaked record must be expensive to
   guess at offline), and HKDF-SHA256 turns the result into the account's name, its proof and its encryption key.
   Each section is sealed with AES-256-GCM, bound to its own name. The Worker never sees the number or the contents.
   The apps do the same with CryptoKit; the test vector is in keys.test.ts. */

import { base64url, fromBase64url } from '../sync/crypto'

export const pbkdf2Salt = 'marquee-account-v1'
export const hkdfSalt = 'marquee-account-hkdf-v1'
/** Chosen so a mid-range phone's browser takes about half a second to a second. */
export const iterations = 600_000

const text = (value: string) => new TextEncoder().encode(value)
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

export interface AccountKeys {
  /** The account's name on the server: 32 lowercase hex characters. */
  id: string
  /** Proves this device knows the number; sent as the bearer token. */
  auth: string
  /** The AES-256-GCM key. */
  enc: CryptoKey
}

/** The 32-byte master key from the 16 digits. The slow step: about half a second on a phone. */
export async function masterKey(digits: string, rounds = iterations): Promise<Uint8Array<ArrayBuffer>> {
  const password = await crypto.subtle.importKey('raw', text(digits), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: text(pbkdf2Salt), iterations: rounds }, password, 256))
}

/** `id`, `auth` and the encryption key from a master key, by HKDF-SHA256. */
export async function expandKeys(master: Uint8Array<ArrayBuffer>): Promise<AccountKeys & { encBytes: Uint8Array<ArrayBuffer> }> {
  const base = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits'])
  const derive = async (info: string, length: number) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: text(hkdfSalt), info: text(info) }, base, length * 8))
  const [id, auth, encBytes] = await Promise.all([derive('id', 16), derive('auth', 32), derive('enc', 32)])
  return { id: hex(id), auth: base64url(auth), enc: await crypto.subtle.importKey('raw', encBytes, 'AES-GCM', false, ['encrypt', 'decrypt']), encBytes }
}

export async function deriveAccount(digits: string): Promise<AccountKeys> {
  const { id, auth, enc } = await expandKeys(await masterKey(digits))
  return { id, auth, enc }
}

/** The additional authenticated data of a section: its account and its name, so a value moved to another section or
 *  account doesn't open. */
const aad = (keys: AccountKeys, section: string) => text(`${keys.id}/${section}`)

/** `nonce || ciphertext || tag`, base64url without padding, with a fresh random 12-byte nonce unless a test passes one. */
export async function seal(keys: AccountKeys, section: string, plaintext: string, nonce: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12))): Promise<string> {
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(keys, section) }, keys.enc, text(plaintext)))
  const out = new Uint8Array(nonce.length + sealed.length)
  out.set(nonce)
  out.set(sealed, nonce.length)
  return base64url(out)
}

/** The plaintext of a value, or a thrown error when the key is wrong or the value was changed. */
export async function open(keys: AccountKeys, section: string, blob: string): Promise<string> {
  const data = fromBase64url(blob)
  if (data.length < 12 + 16) throw new Error('value too short')
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: aad(keys, section) }, keys.enc, data.subarray(12)))
}
