import { describe, expect, it } from 'vitest'
import { sha256hex } from '../sync/crypto'
import { deriveAccount, expandKeys, iterations, masterKey, open, seal } from './keys'

// The test vector in docs/SYNC.md: account number 0123 4567 8901 2345.
const digits = '0123456789012345'
const vector = {
  master: '6344acd683acbcc2b39499f864630805f207854c02340dce85af69dbc225a1a2',
  id: '6b91a0a5eaaedba1be38e16c44719d9d',
  auth: 'krsalCjaziq29vmpL5N-9mFSKKxHw9Gh6kBIXzMtEVs',
  enc: '6f9e0979236f1e7d4b238729e10b8a035b738a56df8a0c4b77e9094d62a2862f',
  blob: 'AAECAwQFBgcICQoL-YJfmbY_Yl_9mwPbJ5J_OFZ4fU5zMJZ57StJ4zawwoqNrv-vcg',
  authHash: '7f8e801ad50486dc6ae701363fceaa06c36f4a2eacb469cecddee05a82bf9a59',
}
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const nonce = Uint8Array.from({ length: 12 }, (_, i) => i)

describe('Marquee Accounts: key derivation', () => {
  it('runs 600,000 rounds', () => {
    expect(iterations).toBe(600_000)
  })

  it('reproduces the document’s test vector', async () => {
    const master = await masterKey(digits)
    expect(hex(master)).toBe(vector.master)
    const keys = await expandKeys(master)
    expect(keys.id).toBe(vector.id)
    expect(keys.auth).toBe(vector.auth)
    expect(hex(keys.encBytes)).toBe(vector.enc)
    expect(await sha256hex(keys.auth)).toBe(vector.authHash)
    expect(await seal(keys, 'settings', '{"v":1,"sections":{}}', nonce)).toBe(vector.blob)
  })

  it('gives another account number another name, proof and key', async () => {
    const other = await deriveAccount('0123456789012346')
    expect(other.id).not.toBe(vector.id)
    expect(other.auth).not.toBe(vector.auth)
  })

  it('opens what it sealed, and nothing sealed for another section, account or with a changed byte', async () => {
    const keys = await deriveAccount(digits)
    const blob = await seal(keys, 'lists', 'hello')
    expect(await open(keys, 'lists', blob)).toBe('hello')
    await expect(open(keys, 'progress', blob)).rejects.toThrow()
    await expect(open({ ...keys, id: '0'.repeat(32) }, 'lists', blob)).rejects.toThrow()
    const damaged = blob.slice(0, -3) + (blob.endsWith('AAA') ? 'BBB' : 'AAA')
    await expect(open(keys, 'lists', damaged)).rejects.toThrow()
    await expect(open(keys, 'lists', 'AAAA')).rejects.toThrow()
  })

  it('uses a fresh nonce each time', async () => {
    const keys = await deriveAccount(digits)
    expect(await seal(keys, 'lists', 'same')).not.toBe(await seal(keys, 'lists', 'same'))
  })
})
