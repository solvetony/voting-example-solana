import fp from 'fastify-plugin'
import { fail } from '../lib/validation.js'

export default fp(async function (fastify) {
  const gateway = process.env.IPFS_ENDPOINT || 'https://ipfs.4everland.io/ipfs/'
  fastify.decorate('required', async key => {
    const record = await fastify.storage.get(key)
    if (!record) fail('Not found', 404)
    return record
  })
  fastify.decorate('receipt', record => ({ ...record, ipfsUrl: `${gateway.replace(/\/$/, '')}/${record.cid}` }))
  fastify.decorate('save', async (key, envelope, extra = {}) => {
    const hash = await fastify.storage.pin(envelope)
    const record = { ...envelope, cid: hash, ...extra }
    await fastify.storage.put(typeof key === 'function' ? key(hash) : key, record)
    return fastify.receipt(record)
  })
}, { name: 'records', dependencies: ['storage'] })
