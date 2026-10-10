import fp from 'fastify-plugin'
import { createBondChain } from '../lib/bond-chain.js'
import { fail } from '../lib/validation.js'

export default fp(async function (app, options) {
  const chain = options.bondChain || createBondChain()
  if (chain.ready && ['mainnet-beta', 'devnet'].includes(chain.network) && chain.network !== app.indexNetwork) fail('Bond RPC and Solana Index must use the same network')
  if (chain.verifyNetwork) await chain.verifyNetwork()
  app.decorate('bondChain', chain)
  app.decorate('bondQuery', options.bondQuery || (async path => {
    if (!['mainnet-beta', 'devnet'].includes(chain.network)) fail('Local snapshots require explicit Solana Index fixtures', 503)
    return app.query(path)
  }))
}, { name: 'bonds', dependencies: ['solana-index'] })
