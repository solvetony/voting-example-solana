import { publicKey } from '../lib/validation.js'

export default async function (app) {
  app.get('/voting-api/solana/token-info/:token', async request => {
    const token = publicKey(request.params.token)
    return app.query(`token-info/${token}`)
  })
}
