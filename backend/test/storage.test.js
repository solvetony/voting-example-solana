import { test } from 'node:test'
import assert from 'node:assert/strict'
import { S3Client } from '@aws-sdk/client-s3'
import { createStorage } from '../lib/storage.js'

test('S3 uses conditional immutable writes and 4EVERLAND returns the receipt CID', async t => {
  const commands = []
  let conflict = false
  let missingCid = false
  t.mock.method(S3Client.prototype, 'send', async function (command) {
    commands.push({ name: command.constructor.name, input: command.input, config: this.config })
    if (command.constructor.name === 'HeadObjectCommand') return { Metadata: missingCid ? {} : { 'ipfs-hash': 'bafy' + 'a'.repeat(60) } }
    if (command.input.Bucket === 'records' && command.constructor.name === 'PutObjectCommand' && conflict) throw Object.assign(new Error('Conflict'), { $metadata: { httpStatusCode: 412 } })
    return {}
  })
  const storage = createStorage({ S3_BUCKET: 'records', S3_ACCESS_KEY: 'test-access', S3_SECRET_KEY: 'test-secret', EVERLAND_BUCKET_NAME: 'ipfs', EVERLAND_ACCESS_KEY: 'test-ipfs-access', EVERLAND_SECRET_KEY: 'test-ipfs-secret' })
  assert.equal(storage.ready, true)
  await storage.put('votes/space/proposal/address.json', { data: { choices: [0] } })
  assert.equal(commands[0].input.IfNoneMatch, '*')
  assert.equal(commands[0].input.ContentType, 'application/json')
  conflict = true
  await assert.rejects(storage.put('votes/space/proposal/address.json', {}), { statusCode: 409 })
  const envelope = { data: { voterNetwork: 'solana', choices: [0] }, address: 'test', signature: 'test', version: '2' }
  const cid = await storage.pin(envelope)
  assert.equal(cid, 'bafy' + 'a'.repeat(60))
  const upload = commands.find(command => command.input.Bucket === 'ipfs' && command.name === 'PutObjectCommand')
  assert.deepEqual(JSON.parse(upload.input.Body), envelope)
  assert.match(upload.input.Key, /^solana-voting\/[a-f0-9]{64}\.json$/)
  assert.equal((await upload.config.endpoint()).hostname, 'endpoint.4everland.co')
  assert.equal(await upload.config.region(), '4EVERLAND')
  missingCid = true
  await assert.rejects(storage.pin(envelope), { statusCode: 502 })
})

test('devnet S3 reads, writes, paginated lists and IPFS uploads use isolated prefixes', async t => {
  const commands = []
  t.mock.method(S3Client.prototype, 'send', async command => {
    commands.push(command.input)
    if (command.constructor.name === 'ListObjectsV2Command') return { Contents: [{ Key: 'devnet/spaces/demo.json' }], NextContinuationToken: 'next' }
    if (command.constructor.name === 'GetObjectCommand') return { Body: { async transformToString () { return '{"data":{"id":"demo"}}' } } }
    if (command.constructor.name === 'HeadObjectCommand') return { Metadata: { 'ipfs-hash': 'bafy' + 'b'.repeat(60) } }
    return {}
  })
  const storage = createStorage({ SOLANA_INDEX_NETWORK: 'devnet', S3_BUCKET: 'records', S3_ACCESS_KEY: 'test', S3_SECRET_KEY: 'test', EVERLAND_BUCKET_NAME: 'ipfs', EVERLAND_ACCESS_KEY: 'test', EVERLAND_SECRET_KEY: 'test' })
  await storage.put('spaces/demo.json', {})
  await storage.get('spaces/demo.json')
  const page = await storage.list('spaces/', 'previous')
  assert.equal(page.items[0].data.id, 'demo')
  assert.equal(page.cursor, 'next')
  assert.equal(commands[0].Key, 'devnet/spaces/demo.json')
  assert.equal(commands[1].Key, 'devnet/spaces/demo.json')
  assert.equal(commands[2].Prefix, 'devnet/spaces/')
  assert.equal(commands[2].ContinuationToken, 'previous')
  assert.equal(commands[3].Key, 'devnet/spaces/demo.json')
  await storage.pin({ data: { id: 'demo' } })
  assert.match(commands[4].Key, /^devnet\/solana-voting\/[a-f0-9]{64}\.json$/)
})
