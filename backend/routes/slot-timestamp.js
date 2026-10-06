import { fail } from '../lib/validation.js'

export default async function (app) {
  app.get('/voting-api/solana/slot-timestamp/:slot', async request => {
    const slot = request.params.slot
    if (!/^\d+$/.test(slot) || !Number.isSafeInteger(Number(slot)) || Number(slot) < 1) fail('Invalid snapshot slot')
    const result = await app.query(`slot-timestamp/${Number(slot)}`)
    const timestampSlot = result.timestampSlot ?? result.slot
    const resolution = result.resolution || 'exact'
    if (result.slot !== Number(slot) || !Number.isFinite(Date.parse(result.timestamp)) || !Number.isSafeInteger(timestampSlot) || timestampSlot < 0 || timestampSlot > result.slot || !['exact', 'previous-block'].includes(resolution) || (resolution === 'exact') !== (timestampSlot === result.slot)) fail('Invalid snapshot timestamp response', 502)
    return { ...result, timestampSlot, resolution }
  })
}
