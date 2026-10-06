import { publicKey, fail } from '../lib/validation.js'

export default async function (app) {
  app.get('/voting-api/solana/token-balance/:address/:token/:slot', async request => {
    const address = publicKey(request.params.address)
    const token = publicKey(request.params.token)
    const slot = request.params.slot
    if (!/^\d+$/.test(slot) || !Number.isSafeInteger(Number(slot)) || Number(slot) < 1) fail('Invalid snapshot slot')
    return app.query(`token-balance/${address}/${token}/${Number(slot)}`)
  })
}
