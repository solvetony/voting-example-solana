import { fail } from '../lib/validation.js'
import { snapshotTime } from '../lib/bond-snapshot.js'

export default async function (app) {
  app.get('/voting-api/solana/slot-timestamp/:slot', async request => {
    const slot = request.params.slot
    if (!/^\d+$/.test(slot) || !Number.isSafeInteger(Number(slot)) || Number(slot) < 1) fail('Invalid snapshot slot')
    const result = await app.query(`slot-timestamp/${Number(slot)}`)
    const { timestampSlot, resolution } = snapshotTime(result, Number(slot))
    return { ...result, timestampSlot, resolution, solanaNetwork: app.indexNetwork }
  })
}
