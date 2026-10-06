import { identifier, cid } from '../lib/validation.js'

export default async function (app) {
  const { storage } = app
  app.get('/voting-api/spaces/:space/proposals/:proposal/votes', async request => storage.list(`votes/${identifier(request.params.space)}/${cid(request.params.proposal)}/`, request.query.cursor))
}
