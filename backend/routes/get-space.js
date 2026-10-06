import { identifier } from '../lib/validation.js'

export default async function (app) {
  const { receipt, required } = app
  app.get('/voting-api/spaces/:space', async request => receipt(await required(`spaces/${identifier(request.params.space)}.json`)))
}
