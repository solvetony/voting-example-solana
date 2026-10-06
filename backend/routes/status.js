export default async function (app) {
  const { storage } = app
  app.get('/voting-api/status', async () => ({ storageReady: storage.ready, indexReady: Boolean(process.env.SOLANA_INDEX_API_KEY) }))
}
