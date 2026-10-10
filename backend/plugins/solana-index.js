import fp from 'fastify-plugin'
import { createSolanaIndex, solanaIndexNetwork } from '../lib/solana-index.js'

export default fp(async function (fastify, options) {
  const network = options.indexNetwork || solanaIndexNetwork()
  fastify.decorate('indexNetwork', network)
  fastify.decorate('query', options.query || createSolanaIndex(process.env.SOLANA_INDEX_API_KEY, network))
}, { name: 'solana-index' })
