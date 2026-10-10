import { signedEnvelope, identifier, text, publicKey, fail } from '../lib/validation.js'

export default async function (app) {
  const { storage, query, save } = app
  app.post('/voting-api/spaces', async request => {
    const envelope = signedEnvelope(request.body, 'space:create')
    const { data } = envelope
    identifier(data.id)
    text(data.name, 'space name', 100)
    text(data.description, 'description', 2000)
    publicKey(data.token)
    const expectedNetwork = { networks: [{ network: 'solana', assets: [{ type: 'spl', contract: data.token }] }] }
    if (JSON.stringify(data.networksConfig) !== JSON.stringify(expectedNetwork)) fail('Token configuration does not match this space')
    if (await storage.get(`spaces/${data.id}.json`)) fail('Space ID already exists', 409)
    const tokenInfo = await query(`token-info/${data.token}`)
    if (!Number.isInteger(tokenInfo.decimals) || tokenInfo.decimals < 0 || tokenInfo.decimals > 255) fail('Invalid token precision', 502)
    return save(`spaces/${data.id}.json`, envelope, { tokenInfo, solanaNetwork: app.indexNetwork })
  })
}
