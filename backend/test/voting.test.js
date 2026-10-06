import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import bs58 from 'bs58'
import { APP, signingText, formatAmount } from '../lib/signing.js'
import { signedEnvelope, fail } from '../lib/validation.js'
import { buildApp } from './helper.js'

function wallet () {
  const keys = generateKeyPairSync('ed25519')
  const address = bs58.encode(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32))
  return {
    address,
    sign (value) {
      const data = { ...value, app: APP, timestamp: Math.floor(Date.now() / 1000) }
      return { data, address, signature: sign(null, Buffer.from(signingText(data)), keys.privateKey).toString('hex') }
    }
  }
}

async function fixture (t) {
  const owner = wallet()
  const voter = wallet()
  const token = wallet().address
  const records = new Map()
  const pins = []
  const queries = []
  let weight = '900719925474099300000'
  let upstreamError = null
  const storage = {
    ready: true,
    async get (key) { return structuredClone(records.get(key) || null) },
    async put (key, value) {
      if (records.has(key)) fail('This record already exists', 409)
      records.set(key, structuredClone(value))
    },
    async list (prefix) { return { items: [...records].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value)), cursor: null } },
    async pin (value) {
      pins.push(structuredClone(value))
      return 'bafy' + createHash('sha256').update(JSON.stringify(value)).digest('hex')
    }
  }
  const app = await buildApp({
    storage,
    origin: 'http://localhost:5173',
    query: async path => {
      queries.push(path)
      if (upstreamError) throw upstreamError
      if (path === 'slot') return { slot: 100 }
      if (path.startsWith('slot-timestamp/')) return { slot: Number(path.split('/')[1]), timestamp: '2020-11-21T01:26:24.000Z', timestampSlot: 95, resolution: 'previous-block' }
      if (path.startsWith('token-info/')) return { symbol: 'TOKEN', decimals: 5, name: 'Token', uri: null, description: null, image: null }
      const [, address, token, slot] = path.split('/')
      return { balanceRaw: weight, balance: 'ignored', decimals: 5, address, token, slot: Number(slot) }
    }
  })
  t.after(() => app.close())
  async function post (url, payload) { return app.inject({ method: 'POST', url, payload }) }
  const network = { networks: [{ network: 'solana', assets: [{ type: 'spl', contract: token }] }] }
  const spaceEnvelope = owner.sign({ action: 'space:create', id: 'example-space', name: 'Example', description: 'Token community', token, networksConfig: network })
  async function createSpace () { return post('/voting-api/spaces', spaceEnvelope) }
  async function createProposal (changes = {}, signer = owner) {
    const now = Math.floor(Date.now() / 1000)
    const envelope = signer.sign({ action: 'proposal:create', space: 'example-space', networksConfig: network, title: 'Fund the next release?', content: 'Community proposal.', contentType: 'markdown', choiceType: 'single', choices: ['For', 'Against'], startDate: now - 1, endDate: now + 3600, snapshotHeights: { solana: 99 }, realProposer: signer.address, proposerNetwork: 'solana', version: '4', ...changes })
    return post('/voting-api/spaces/example-space/proposals', envelope)
  }
  function voteEnvelope (proposalCid, changes = {}, signer = voter) {
    return signer.sign({ action: 'vote:create', space: 'example-space', proposalCid, choices: [0], remark: '', realVoter: signer.address, voterNetwork: 'solana', version: '4', ...changes })
  }
  return { app, storage, records, pins, queries, owner, voter, spaceEnvelope, createSpace, createProposal, voteEnvelope, post, setWeight: value => { weight = value }, setError: value => { upstreamError = value } }
}

test('signatures preserve the validator format and reject forged or stale data', () => {
  const signer = wallet()
  const envelope = signer.sign({ action: 'vote:create', voterNetwork: 'solana', choices: [0], logo: 'excluded' })
  assert.equal(signedEnvelope(envelope, 'vote:create').address, signer.address)
  assert.equal(signingText(envelope.data), JSON.stringify(Object.fromEntries(Object.entries(envelope.data).filter(([key]) => key !== 'logo'))))
  assert.throws(() => signedEnvelope({ ...envelope, data: { ...envelope.data, choices: [1] } }, 'vote:create'), /Invalid signature/)
  assert.throws(() => signedEnvelope(envelope, 'space:create'), /Invalid signed action/)
  const stale = signer.sign({ action: 'vote:create', timestamp: 1 })
  stale.data.timestamp = 1
  assert.throws(() => signedEnvelope(stale, 'vote:create'), /expired/)
  assert.throws(() => signedEnvelope({ ...envelope, address: '../unsafe' }, 'vote:create'), /Invalid Solana/)
})

test('spaces retain signed records and reject duplicate IDs and mismatched token settings', async t => {
  const f = await fixture(t)
  const created = await f.createSpace()
  assert.equal(created.statusCode, 200)
  assert.equal(created.json().tokenInfo.decimals, 5)
  assert.deepEqual(f.pins[0], { ...f.spaceEnvelope, version: '2' })
  assert.equal((await f.createSpace()).statusCode, 409)
  const response = await f.app.inject('/voting-api/spaces')
  assert.equal(response.json().items.length, 1)
  const invalid = f.owner.sign({ ...f.spaceEnvelope.data, id: 'another-space', networksConfig: { networks: [{ network: 'solana' }] } })
  assert.equal((await f.post('/voting-api/spaces', invalid)).statusCode, 400)
})

test('only the owner creates immutable proposals with valid historical snapshots and choices', async t => {
  const f = await fixture(t)
  await f.createSpace()
  assert.equal((await f.createProposal({}, f.voter)).statusCode, 403)
  assert.equal((await f.createProposal({ snapshotHeights: { solana: 101 } })).statusCode, 400)
  assert.equal((await f.createProposal({ choices: ['For', 'for'] })).statusCode, 400)
  assert.equal((await f.createProposal({ endDate: 1 })).statusCode, 400)
  const proposal = await f.createProposal()
  assert.equal(proposal.statusCode, 200)
  assert.equal(proposal.json().data.snapshotHeights.solana, 99)
  assert.equal((await f.app.inject('/voting-api/spaces/example-space/proposals')).json().items.length, 1)
})

test('votes use server-verified snapshot balance, ignore client weight, and tally exact integers', async t => {
  const f = await fixture(t)
  await f.createSpace()
  const proposal = (await f.createProposal()).json()
  const url = `/voting-api/spaces/example-space/proposals/${proposal.cid}/votes`
  const vote = f.voteEnvelope(proposal.cid, { weightRaw: '99999999999999999999999999999999' })
  const response = await f.post(url, vote)
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().weightRaw, '900719925474099300000')
  assert.ok(f.queries.includes(`token-balance/${f.voter.address}/${f.spaceEnvelope.data.token}/99`))
  const result = (await f.app.inject(`/voting-api/spaces/example-space/proposals/${proposal.cid}`)).json()
  assert.equal(result.voteCount, 1)
  assert.equal(result.results[0].weightRaw, '900719925474099300000')
  assert.equal(result.results[0].weight, '9007199254740993')
  assert.equal((await f.post(url, vote)).statusCode, 409)
  assert.equal(f.pins.at(-1).data.voterNetwork, 'solana')
  assert.equal(f.pins.at(-1).signature.length, 128)
  assert.equal((await f.app.inject(url)).json().items.length, 1)
})

test('conditional storage writes stop concurrent double votes', async t => {
  const f = await fixture(t)
  await f.createSpace()
  const proposal = (await f.createProposal()).json()
  const url = `/voting-api/spaces/example-space/proposals/${proposal.cid}/votes`
  const envelope = f.voteEnvelope(proposal.cid)
  const responses = await Promise.all([f.post(url, envelope), f.post(url, envelope)])
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409])
  const result = (await f.app.inject(`/voting-api/spaces/example-space/proposals/${proposal.cid}`)).json()
  assert.equal(result.voteCount, 1)
})

test('no balance, bad choice, closed voting, and upstream failures do not produce votes', async t => {
  const f = await fixture(t)
  await f.createSpace()
  const proposal = (await f.createProposal()).json()
  const url = `/voting-api/spaces/example-space/proposals/${proposal.cid}/votes`
  assert.equal((await f.post(url, f.voteEnvelope(proposal.cid, { choices: [2] }))).statusCode, 400)
  f.setWeight('0')
  assert.equal((await f.post(url, f.voteEnvelope(proposal.cid))).statusCode, 403)
  f.setError(Object.assign(new Error('Quota exhausted'), { statusCode: 429 }))
  assert.equal((await f.post(url, f.voteEnvelope(proposal.cid))).statusCode, 429)
  f.setError(null)
  f.records.get(`proposals/example-space/${proposal.cid}.json`).data.endDate = 1
  assert.equal((await f.post(url, f.voteEnvelope(proposal.cid))).statusCode, 409)
  assert.equal([...f.records.keys()].some(key => key.startsWith('votes/')), false)
})

test('origin checks, record paths, and body size are enforced', async t => {
  const f = await fixture(t)
  assert.equal((await f.app.inject('/')).statusCode, 404)
  assert.equal((await f.app.inject('/index.html')).statusCode, 404)
  assert.equal((await f.app.inject('/voting-api/status')).json().storageReady, true)
  assert.equal((await f.app.inject({ method: 'POST', url: '/voting-api/spaces', payload: f.spaceEnvelope, headers: { origin: 'https://evil.example' } })).statusCode, 403)
  assert.equal((await f.app.inject('/voting-api/spaces/invalid.id')).statusCode, 400)
  const forged = { ...f.spaceEnvelope, signature: '0'.repeat(128) }
  assert.equal((await f.post('/voting-api/spaces', forged)).statusCode, 400)
  assert.equal((await f.post('/voting-api/spaces', { data: 'x'.repeat(40000) })).statusCode, 413)
  assert.equal(formatAmount('1', 5), '0.00001')
  assert.equal(formatAmount('100', 0), '100')
})

test('frontend lookups use backend Solana Index and validate parameters', async t => {
  const f = await fixture(t)
  assert.equal((await f.app.inject('/voting-api/solana/slot')).json().slot, 100)
  const token = f.spaceEnvelope.data.token
  assert.equal((await f.app.inject(`/voting-api/solana/token-info/${token}`)).json().decimals, 5)
  const balance = await f.app.inject(`/voting-api/solana/token-balance/${f.voter.address}/${token}/99`)
  assert.equal(balance.statusCode, 200)
  assert.equal(balance.json().balanceRaw, '900719925474099300000')
  const time = await f.app.inject('/voting-api/solana/slot-timestamp/99')
  assert.equal(time.statusCode, 200)
  assert.equal(time.json().slot, 99)
  assert.equal(time.json().timestampSlot, 95)
  assert.equal(time.json().resolution, 'previous-block')
  const calls = f.queries.length
  assert.equal((await f.app.inject('/voting-api/solana/token-info/invalid')).statusCode, 400)
  for (const slot of ['0', '-1', '1.5', '9007199254740992']) {
    assert.equal((await f.app.inject(`/voting-api/solana/token-balance/${f.voter.address}/${token}/${slot}`)).statusCode, 400)
    assert.equal((await f.app.inject(`/voting-api/solana/slot-timestamp/${slot}`)).statusCode, 400)
  }
  assert.equal(f.queries.length, calls)
  f.setError(Object.assign(new Error('Quota exhausted'), { statusCode: 429 }))
  assert.equal((await f.app.inject('/voting-api/solana/slot')).statusCode, 429)
})
