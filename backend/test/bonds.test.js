import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { Keypair, Transaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js'
import bs58 from 'bs58'
import { buildApp } from './helper.js'
import { APP, signingText } from '../lib/signing.js'
import { createBondChain, matchesBondTransaction } from '../lib/bond-chain.js'
import { fail } from '../lib/validation.js'

function wallet () {
  const keys = generateKeyPairSync('ed25519')
  const address = bs58.encode(keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32))
  return { address, sign (value) { const data = { ...value, app: APP, timestamp: Math.floor(Date.now() / 1000) }; return { address, data, signature: sign(null, Buffer.from(signingText(data)), keys.privateKey).toString('hex') } } }
}

async function fixture (t) {
  const issuer = wallet()
  const investors = [wallet(), wallet(), wallet()]
  const mint = wallet().address
  const records = new Map()
  let action = null
  const bond = { mint, issuer: issuer.address, outstanding: '17', faceValue: '1000000000', couponBps: 1000, frequency: 2 }
  const storage = {
    ready: true,
    async get (key) { return structuredClone(records.get(key) || null) },
    async put (key, record) { if (records.has(key)) fail('Already exists', 409); records.set(key, structuredClone(record)) },
    async list (prefix) { return { items: [...records].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value)), cursor: null } },
    async pin (record) { return 'bafy' + createHash('sha256').update(JSON.stringify(record)).digest('hex') }
  }
  const chain = {
    ready: true,
    network: 'localnet',
    async readBond () { return bond },
    async status () { return { bond, supply: '17', issuanceSealed: true } },
    async finalizedSlot () { return 100 },
    async couponStatus () { return { action, claim: null, vaultBalance: '0' } },
    async prepare (mint, signer, operation) { return { mint, signer, operation, transaction: 'fixture-unsigned-transaction' } },
    async confirm () { fail('Transaction does not match the signed request', 403) },
    async submit () { fail('Signed transaction does not match the prepared request', 403) }
  }
  const app = await buildApp({
    storage,
    bondChain: chain,
    bondQuery: async path => {
      if (path.startsWith('slot-timestamp/')) return { slot: 99, timestampSlot: 98, timestamp: '2026-10-09T00:00:00.000Z', resolution: 'previous-block' }
      const [, address, token, slot] = path.split('/')
      return { address, token, slot: Number(slot), decimals: 0, balanceRaw: ['10', '5', '2'][investors.findIndex(investor => investor.address === address)] }
    }
  })
  t.after(() => app.close())
  const post = (path, signer, action, fields) => app.inject({ method: 'POST', url: path, payload: signer.sign({ action, mint, ...fields }) })
  return { app, post, mint, issuer, investors, records, setAction: value => { action = value } }
}

test('bond metadata and registry require issuer signatures and remain immutable', async t => {
  const f = await fixture(t)
  assert.equal((await f.post('/voting-api/bonds', f.investors[0], 'bond:create', { name: 'Demo', symbol: 'KDB26' })).statusCode, 403)
  assert.equal((await f.post('/voting-api/bonds', f.issuer, 'bond:create', { name: 'Demo', symbol: 'KDB26' })).statusCode, 200)
  assert.equal((await f.post('/voting-api/bonds', f.issuer, 'bond:create', { name: 'Changed', symbol: 'OTHER' })).statusCode, 409)
  const path = `/voting-api/bonds/${f.mint}/holders`
  assert.equal((await f.post(path, f.investors[0], 'bond:holder', { investor: f.investors[0].address })).statusCode, 403)
  assert.equal((await f.post(path, f.issuer, 'bond:holder', { investor: f.investors[0].address, label: 'A' })).statusCode, 200)
  assert.equal((await f.app.inject(path)).json().items.length, 1)
})

test('coupon routes refuse incomplete registry and detect altered on-chain evidence', async t => {
  const f = await fixture(t)
  const path = `/voting-api/bonds/${f.mint}/coupons`
  const fields = { id: 'coupon-001', recordSlot: 99 }
  assert.equal((await f.post(path, f.investors[0], 'bond:coupon', fields)).statusCode, 403)
  for (const investor of f.investors.slice(0, 2)) await f.post(`/voting-api/bonds/${f.mint}/holders`, f.issuer, 'bond:holder', { investor: investor.address })
  assert.equal((await f.post(path, f.issuer, 'bond:coupon', fields)).statusCode, 409)
  await f.post(`/voting-api/bonds/${f.mint}/holders`, f.issuer, 'bond:holder', { investor: f.investors[2].address })
  const response = await f.post(path, f.issuer, 'bond:coupon', fields)
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().manifest.totalLiability, '850000000')
  assert.equal((await f.post(path, f.issuer, 'bond:coupon', fields)).statusCode, 409)
  const entitlement = await f.app.inject(`${path}/coupon-001?investor=${f.investors[0].address}`)
  assert.equal(entitlement.json().entitlement.entitlement, '500000000')
  assert.ok(entitlement.json().manifestUrl.endsWith(response.json().manifestCid))
  f.setAction({ finalized: true, recordSlot: '99', root: 'altered', manifestHash: response.json().manifestHash })
  assert.equal((await f.app.inject(`${path}/coupon-001`)).statusCode, 409)
  f.setAction({ finalized: false, recordSlot: '98' })
  assert.equal((await f.app.inject(`${path}/coupon-001`)).statusCode, 409)
})

test('transaction receipts require original signer and successful chain verification', async t => {
  const f = await fixture(t)
  assert.equal((await f.post('/voting-api/bonds/transactions', f.investors[0], 'bond:transaction', { operation: 'deposit', args: null })).statusCode, 400)
  const prepared = await f.post('/voting-api/bonds/transactions', f.investors[0], 'bond:transaction', { operation: 'deposit', args: { quantity: '1' } })
  assert.equal(prepared.statusCode, 200)
  const intent = prepared.json().intent
  assert.equal((await f.post('/voting-api/bonds/confirm', f.investors[1], 'bond:confirm', { intent, signature: 'forged' })).statusCode, 403)
  assert.equal((await f.post('/voting-api/bonds/confirm', f.investors[0], 'bond:confirm', { intent, signature: 'forged' })).statusCode, 403)
  assert.equal((await f.post('/voting-api/bonds/submit', f.investors[0], 'bond:submit', { intent, transaction: 'altered' })).statusCode, 403)
  assert.equal([...f.records.keys()].filter(key => key.startsWith('bond-transactions/')).length, 0)
})

test('RPC confirmation rejects missing, failed or unrelated transactions; submission rejects tampering', async () => {
  const chain = createBondChain({ BOND_RPC_URL: 'http://127.0.0.1:8899', BOND_PROGRAM_ID: Keypair.generate().publicKey.toBase58(), BOND_NETWORK: 'localnet' })
  const signer = Keypair.generate()
  const recipient = Keypair.generate().publicKey
  const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: recipient, lamports: 1 }))
  const intent = { transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64') }
  const signature = bs58.encode(new Uint8Array(64).fill(1))
  chain.connection.getTransaction = async () => null
  await assert.rejects(chain.confirm(intent, signature), /not confirmed/)
  chain.connection.getTransaction = async () => ({ meta: null })
  await assert.rejects(chain.confirm(intent, signature), /failed/)
  chain.connection.getTransaction = async () => ({ meta: { err: { InstructionError: [0, 'failure'] } } })
  await assert.rejects(chain.confirm(intent, signature), /failed/)
  transaction.instructions[0] = SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: recipient, lamports: 2 })
  chain.connection.getTransaction = async () => ({ meta: { err: null }, transaction: { message: transaction.compileMessage() } })
  await assert.rejects(chain.confirm(intent, signature), /does not match/)
  transaction.sign(signer)
  await assert.rejects(chain.submit(intent, transaction.serialize().toString('base64')), /does not match/)
  const unsigned = Transaction.from(Buffer.from(intent.transaction, 'base64'))
  await assert.rejects(chain.submit(intent, unsigned.serialize({ requireAllSignatures: false }).toString('base64')), /does not match/)
  chain.program.account.bondConfig.fetchNullable = async () => ({ issuer: signer.publicKey, bondMint: recipient, settlementMint: signer.publicKey, maturity: 0 })
  chain.program.account.corporateAction.fetch = async () => ({ recordSlot: 99n })
  await assert.rejects(chain.prepare(recipient.toBase58(), signer.publicKey.toBase58(), 'finalize-coupon', { id: 'coupon-001' }, { manifest: { recordSlot: 100 } }), /record slot does not match/)
})

test('devnet deployment rejects a mainnet RPC even when labelled devnet in configuration', async () => {
  const chain = createBondChain({ BOND_RPC_URL: 'http://127.0.0.1:8899', BOND_PROGRAM_ID: Keypair.generate().publicKey.toBase58(), BOND_NETWORK: 'devnet' })
  chain.connection.getGenesisHash = async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
  await assert.rejects(chain.verifyNetwork(), /does not belong/)
  chain.connection.getGenesisHash = async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
  await chain.verifyNetwork()
})

test('wallet priority fees preserve the exact intent and are capped at 0.0001 SOL', async () => {
  const signer = Keypair.generate()
  const recipient = Keypair.generate().publicKey
  const expected = new Transaction({ feePayer: signer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: recipient, lamports: 1 }))
  const priced = microLamports => {
    const transaction = Transaction.from(expected.serialize({ requireAllSignatures: false }))
    transaction.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }))
    transaction.sign(signer)
    return transaction
  }
  const valid = priced(187500)
  assert.equal(matchesBondTransaction(expected, valid), true)
  assert.equal(valid.verifySignatures(), true)
  assert.equal(matchesBondTransaction(expected, priced(250000)), true)
  assert.equal(matchesBondTransaction(expected, priced(250001)), false)
  const altered = instruction => {
    const transaction = priced(187500)
    transaction.instructions[2] = instruction
    transaction.sign(signer)
    return transaction
  }
  assert.equal(matchesBondTransaction(expected, altered(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: recipient, lamports: 2 }))), false)
  const changedLimit = priced(187500)
  changedLimit.instructions[1] = ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 })
  assert.equal(matchesBondTransaction(expected, changedLimit), false)
  const duplicate = priced(187500)
  duplicate.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }))
  assert.equal(matchesBondTransaction(expected, duplicate), false)
  const extra = priced(187500)
  extra.add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: recipient, lamports: 1 }))
  assert.equal(matchesBondTransaction(expected, extra), false)
  const changedBlockhash = priced(187500)
  changedBlockhash.recentBlockhash = Keypair.generate().publicKey.toBase58()
  assert.equal(matchesBondTransaction(expected, changedBlockhash), false)
  const chain = createBondChain({ BOND_RPC_URL: 'http://127.0.0.1:8899', BOND_PROGRAM_ID: Keypair.generate().publicKey.toBase58(), BOND_NETWORK: 'localnet' })
  chain.connection.getTransaction = async () => ({ meta: { err: null }, transaction: { message: valid.compileMessage() }, slot: 1 })
  chain.program.account.bondConfig.fetchNullable = async () => null
  const intent = { transaction: expected.serialize({ requireAllSignatures: false }).toString('base64'), mint: recipient.toBase58(), signer: signer.publicKey.toBase58() }
  await assert.rejects(chain.confirm(intent, bs58.encode(valid.signature)), /On-chain bond is not initialized/)
  let sent = false
  chain.connection.sendRawTransaction = async bytes => {
    sent = true
    assert.equal(Transaction.from(bytes).serializeMessage().equals(valid.serializeMessage()), true)
    return bs58.encode(valid.signature)
  }
  chain.connection.confirmTransaction = async () => ({ value: { err: null } })
  await assert.rejects(chain.submit(intent, valid.serialize().toString('base64')), /On-chain bond is not initialized/)
  assert.equal(sent, true)
  const unsigned = priced(187500)
  unsigned.signatures[0].signature = null
  sent = false
  await assert.rejects(chain.submit(intent, unsigned.serialize({ requireAllSignatures: false }).toString('base64')), /does not match/)
  assert.equal(sent, false)
})
