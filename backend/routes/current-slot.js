export default async function (app) {
  app.get('/voting-api/solana/slot', async () => app.query('slot'))
}
