import { groupNumber, formatTyped, makeNumber, parseNumber } from '../lib/account/number'
import { expandKeys, hkdfSalt, iterations, masterKey, pbkdf2Salt, seal } from '../lib/account/keys'
import { at, canonical, emptyState, historyId, isHistorySection, isItemsSection, isLibrarySection, iso, itemsShard, mergeState, progressId, readState, removedKey, splitHistory, writeState } from '../lib/account/wire'
import type { WireState } from '../lib/account/wire'
import { contract } from './support'

contract('account-number', ({ op, input }) => {
  switch (op) {
    case 'parse':
      return parseNumber(input)
    case 'formatTyped':
      return formatTyped(input)
    case 'group':
      return groupNumber(input)
    case 'generate': {
      const blocks = [...input.blocks] as { fill?: number; bytes?: number[] }[]
      return makeNumber((bytes) => {
        const block = blocks.shift()
        if (!block) throw new Error('drew more random bytes than the vector provides')
        bytes.set(block.bytes ?? new Array<number>(bytes.length).fill(block.fill ?? 0))
      })
    }
    default:
      throw new Error(`unknown op ${op}`)
  }
})

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (h) => parseInt(h, 16))

contract('account-crypto', async ({ op, input }) => {
  if (op === 'constants') return { iterations, pbkdf2Salt, hkdfSalt }
  const master = await masterKey(input.number, input.iterations)
  const keys = await expandKeys(master)
  if (op === 'derive') {
    const hashed = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keys.auth)))
    return { master: hex(master), id: keys.id, auth: keys.auth, enc: hex(keys.encBytes), authHash: hex(hashed) }
  }
  if (op === 'seal') return seal(keys, input.section, input.plaintext, bytesOf(input.nonce) as Uint8Array<ArrayBuffer>)
  throw new Error(`unknown op ${op}`)
})

const state = (partial: Partial<WireState>): WireState => ({ ...emptyState(), ...partial })
/** A state without its empty fields, as the vectors write it. */
const sparse = (s: WireState) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)))

contract('account-wire', ({ op, input }) => {
  switch (op) {
    case 'canonical':
      return canonical(input)
    case 'time':
      return iso(input)
    case 'parseTime':
      return at(input)
    case 'id': {
      if (input.kind === 'progress') return progressId(input.entry)
      if (input.kind === 'history') return historyId(input.entry)
      return removedKey(input.list, input.id)
    }
    case 'section': {
      // The website doesn't export its key check; a shuffle entry survives reading exactly when its key is a wire key.
      if ('isKey' in input) return readState({ lists: JSON.stringify({ v: 1, shuffle: [{ key: input.isKey, played: [] }] }) }).state.shuffle.length === 1
      if ('isHistory' in input) return isHistorySection(input.isHistory)
      if ('isItems' in input) return isItemsSection(input.isItems)
      if ('isLibrary' in input) return isLibrarySection(input.isLibrary)
      return itemsShard(input.shard)
    }
    case 'read': {
      const { state: read, unreadable, newer } = readState(input)
      // The apps read sections in name order and the website in the order it is given; which are unreadable is what counts.
      return { state: sparse(read), unreadable: [...unreadable].sort(), newer: [...newer].sort() }
    }
    case 'splitHistory':
      return splitHistory(input.entries, input.removed, input.limit)
    case 'write':
      return writeState(state(input.state), at(input.now))
    case 'merge':
      return sparse(mergeState(state(input.local), state(input.remote), at(input.now)))
    default:
      throw new Error(`unknown op ${op}`)
  }
})
