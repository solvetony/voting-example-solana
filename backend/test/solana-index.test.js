import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSolanaIndex } from '../lib/solana-index.js'

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
