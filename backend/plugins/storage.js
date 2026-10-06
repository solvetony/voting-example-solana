import fp from 'fastify-plugin'
import { createStorage } from '../lib/storage.js'

export default fp(async function (fastify, options) {
  fastify.decorate('storage', options.storage || createStorage())
}, { name: 'storage' })
