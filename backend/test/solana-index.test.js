import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSolanaIndex, solanaIndexNetwork } from '../lib/solana-index.js'
import { buildApp } from './helper.js'

test('Solana Index key is used only in the backend authorization header', async t => {
  const key = 'server-only-test-key'
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://solanaindex.top/api/v1/solana/slot')
    assert.equal(options.headers.Authorization, `Bearer ${key}`)
    return new Response(JSON.stringify({ slot: 421609847 }), { status: 200 })
  })
  const result = await createSolanaIndex(key)('slot')
  assert.deepEqual(result, { slot: 421609847 })
  assert.equal(JSON.stringify(result).includes(key), false)
  await assert.rejects(createSolanaIndex('')('slot'), { statusCode: 503 })
})

test('devnet routes cover metadata, slots, timestamps and historical balances without changing mainnet defaults', async t => {
  assert.equal(solanaIndexNetwork({}), 'mainnet-beta')
  assert.equal(solanaIndexNetwork({ BOND_NETWORK: 'devnet' }), 'devnet')
  assert.throws(() => createSolanaIndex('key', 'unknown'), /Invalid Solana Index network/)
  const seen = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer devnet-test-key')
    seen.push(url)
    return new Response(JSON.stringify({ slot: 100 }), { status: 200 })
  })
  const query = createSolanaIndex('devnet-test-key', 'devnet')
  for (const path of ['slot', 'token-info/mint', 'slot-timestamp/100', 'token-balance/investor/mint/100']) await query(path)
  assert.deepEqual(seen, ['slot', 'token-info/mint', 'slot-timestamp/100', 'token-balance/investor/mint/100'].map(path => `https://solanaindex.top/api/v1/solana/devnet/${path}`))
  const app = await buildApp({ indexNetwork: 'devnet', query, storage: { ready: true }, bondChain: { ready: true, network: 'devnet' } })
  t.after(() => app.close())
  assert.equal((await app.inject('/voting-api/solana/slot')).json().slot, 100)
  assert.equal((await app.inject('/voting-api/status')).json().solanaNetwork, 'devnet')
  await assert.rejects(buildApp({ indexNetwork: 'mainnet-beta', query, storage: { ready: true }, bondChain: { ready: true, network: 'devnet' } }), /must use the same network/)
})
