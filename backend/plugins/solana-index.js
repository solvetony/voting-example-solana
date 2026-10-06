import fp from 'fastify-plugin'
import { createSolanaIndex } from '../lib/solana-index.js'

export default fp(async function (fastify, options) {
  fastify.decorate('query', options.query || createSolanaIndex())
}, { name: 'solana-index' })
