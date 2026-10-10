import { createHash } from 'node:crypto'
import bs58 from 'bs58'
import { fail, publicKey } from './validation.js'

export const MAX_U64 = (1n << 64n) - 1n
export function units (value, label = 'amount') {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || value.length > 20) fail(`Invalid ${label}`)
  const amount = BigInt(value)
  if (amount > MAX_U64) fail(`${label} exceeds u64`)
  return amount
}
export function canonical (value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('Non-integer manifest value')
  const result = JSON.stringify(value)
  if (result === undefined) fail('Unsupported manifest value')
  return result
}
export function hash (value) { return createHash('sha256').update(value).digest() }
export function manifestHash (value) { return hash(canonical(value)).toString('hex') }
export function actionId (mint, id) { return hash(Buffer.concat([Buffer.from('KASE_ACTION_V1'), bs58.decode(publicKey(mint)), Buffer.from(id)])) }
export function couponAmount (quantity, bond) {
  const value = units(quantity) * units(bond.faceValue) * BigInt(bond.couponBps)
  const denominator = 10000n * BigInt(bond.frequency)
  if (denominator < 1n) fail('Invalid coupon frequency')
  const result = value / denominator
  if (result > MAX_U64) fail('Coupon exceeds u64')
  return result
}
function u64 (value) { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(units(value)); return bytes }
export function leaf (mint, action, investor, quantity, entitlement, type = 'coupon') {
  if (!/^[a-f0-9]{64}$/.test(action)) fail('Invalid action hash')
  return hash(Buffer.concat([Buffer.from(type === 'coupon' ? 'KASE_COUPON_V1' : 'KASE_VOTE_SNAPSHOT_V1'), bs58.decode(publicKey(mint)), Buffer.from(action, 'hex'), bs58.decode(publicKey(investor)), u64(quantity), u64(entitlement)]))
}
function pair (a, b) { return hash(Buffer.concat([Buffer.from([1]), ...[a, b].sort(Buffer.compare)])) }
export function merkle (leaves) {
  if (!leaves.length) fail('Snapshot contains no eligible holders')
  const layers = [leaves]
  while (layers.at(-1).length > 1) {
    const layer = layers.at(-1)
    const next = []
    for (let i = 0; i < layer.length; i += 2) next.push(pair(layer[i], layer[i + 1] || layer[i]))
    layers.push(next)
  }
  return {
    root: layers.at(-1)[0].toString('hex'),
    proofs: leaves.map((_, index) => {
      const proof = []
      for (const layer of layers.slice(0, -1)) {
        proof.push((layer[index ^ 1] || layer[index]).toString('hex'))
        index = Math.floor(index / 2)
      }
      return proof
    })
  }
}
export function verifyProof (value, proof, root) {
  for (const sibling of proof) value = pair(value, Buffer.from(sibling, 'hex'))
  return value.toString('hex') === root
}
export function snapshotTime (response, slot) {
  const timestampSlot = response.timestampSlot ?? response.slot
  const resolution = response.resolution || 'exact'
  if (response.slot !== slot || !Number.isFinite(Date.parse(response.timestamp)) || !Number.isSafeInteger(timestampSlot) || timestampSlot < 0 || timestampSlot > slot || !['exact', 'previous-block'].includes(resolution) || (resolution === 'exact') !== (timestampSlot === slot)) fail('Invalid snapshot timestamp response', 502)
  return { timestamp: response.timestamp, timestampSlot, resolution }
}
export async function buildSnapshot ({ bond, id, slot, holders, query, finalizedSlot, type = 'coupon' }) {
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > finalizedSlot) fail('Record slot must be finalized and historical')
  if (holders.length > 100 || new Set(holders.map(holder => holder.investor)).size !== holders.length) fail('Invalid holder registry (maximum 100)')
  const action = actionId(bond.mint, id).toString('hex')
  const balances = []
  for (const holder of [...holders].sort((a, b) => a.investor < b.investor ? -1 : a.investor > b.investor ? 1 : 0)) {
    publicKey(holder.investor)
    const balance = await query(`token-balance/${holder.investor}/${bond.mint}/${slot}`)
    if (balance.address !== holder.investor || balance.token !== bond.mint || balance.slot !== slot || balance.decimals !== 0) fail('Invalid historical bond balance', 502)
    const quantity = units(balance.balanceRaw, 'historical balance')
    balances.push({ investor: holder.investor, quantity: quantity.toString(), entitlement: type === 'coupon' ? couponAmount(quantity.toString(), bond).toString() : '0' })
  }
  const quantity = balances.reduce((sum, value) => sum + BigInt(value.quantity), 0n)
  const liability = balances.reduce((sum, value) => sum + BigInt(value.entitlement), 0n)
  if (quantity !== units(bond.outstanding)) fail('Holder registry does not reconcile with expected outstanding supply', 409)
  if (liability > MAX_U64) fail('Liability exceeds u64')
  const eligible = balances.filter(value => value.quantity !== '0')
  const tree = merkle(eligible.map(value => leaf(bond.mint, action, value.investor, value.quantity, value.entitlement, type)))
  const time = snapshotTime(await query(`slot-timestamp/${slot}`), slot)
  const manifest = { version: 1, network: bond.network || 'mainnet-beta', bondMint: bond.mint, actionId: action, actionLabel: id, actionType: type, recordSlot: slot, recordTimestamp: time.timestamp, timestampSlot: time.timestampSlot, slotResolution: time.resolution, holders: balances, totalQuantity: quantity.toString(), totalLiability: liability.toString(), merkleRoot: tree.root }
  return { manifest, manifestHash: manifestHash(manifest), proofs: Object.fromEntries(eligible.map((value, index) => [value.investor, tree.proofs[index]])) }
}
