import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runDemo } from '../scripts/demo.js'
import { setup } from '../scripts/setup.js'

test('public demo fails before transactions when network or issuer credentials are missing', async () => {
  await assert.rejects(runDemo(() => {}, { network: 'mainnet-beta' }), /only localnet or devnet/)
  await assert.rejects(runDemo(() => {}, { network: 'devnet' }), /requires SOLANA_INDEX_API_KEY and ISSUER_KEYPAIR/)
  await assert.rejects(setup({ network: 'devnet' }), /explicitly supplied issuer/)
  await assert.rejects(setup({ maturitySeconds: 59 }), /at least 60 seconds/)
})
