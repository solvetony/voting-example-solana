export default async function (app) {
  const { storage } = app
  app.get('/voting-api/spaces', async request => storage.list('spaces/', request.query.cursor))
}
