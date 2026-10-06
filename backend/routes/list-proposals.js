import { identifier } from '../lib/validation.js'

export default async function (app) {
  const { storage } = app
  app.get('/voting-api/spaces/:space/proposals', async request => storage.list(`proposals/${identifier(request.params.space)}/`, request.query.cursor))
}
