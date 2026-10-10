import { test } from 'node:test'
import assert from 'node:assert/strict'
import bs58 from 'bs58'
import { buildSnapshot, canonical, couponAmount, leaf, manifestHash, merkle, verifyProof, units, MAX_U64 } from '../lib/bond-snapshot.js'

const address = number => bs58.encode(Buffer.alloc(32, number))
const bond = { mint: address(2), faceValue: '1000000000', couponBps: 1000, frequency: 2, outstanding: '17' }
const holders = [3, 4, 5, 6].map(number => ({ investor: address(number) }))
function fixture (changes = {}) {
  return {
    bond,
    id: 'coupon-001',
    slot: 100,
    holders,
    finalizedSlot: 100,
    query: async path => {
      if (path.startsWith('slot-timestamp/')) return { slot: 100, timestamp: '2026-10-09T10:00:00.000Z', timestampSlot: 99, resolution: 'previous-block' }
      const [, investor, mint, slot] = path.split('/')
      return { address: investor, token: mint, slot: Number(slot), decimals: 0, balanceRaw: ['10', '5', '2', '0'][holders.findIndex(holder => holder.investor === investor)] }
    },
    ...changes
  }
}

test('canonical coupon snapshot reconciles 17 bonds and 850 DEMOUSD independently of registry order', async () => {
  const a = await buildSnapshot(fixture())
  const b = await buildSnapshot(fixture({ holders: [...holders].reverse() }))
  assert.deepEqual(a, b)
  assert.equal(a.manifest.totalQuantity, '17')
  assert.equal(a.manifest.totalLiability, '850000000')
  assert.equal(a.manifest.slotResolution, 'previous-block')
  assert.equal(a.manifest.timestampSlot, 99)
  assert.equal(a.manifest.holders.length, 4)
  assert.equal(Object.keys(a.proofs).length, 3)
  for (const holder of a.manifest.holders.filter(holder => holder.quantity !== '0')) assert.ok(verifyProof(leaf(bond.mint, a.manifest.actionId, holder.investor, holder.quantity, holder.entitlement), a.proofs[holder.investor], a.manifest.merkleRoot))
  assert.equal(a.manifestHash, manifestHash(a.manifest))
  assert.equal(canonical({ b: 1, a: { d: 2, c: 1 } }), canonical({ a: { c: 1, d: 2 }, b: 1 }))
})
test('missing holders, duplicate registrations and unfinalized slots reject snapshots', async () => {
  await assert.rejects(() => buildSnapshot(fixture({ holders: holders.slice(1) })), /reconcile/)
  await assert.rejects(() => buildSnapshot(fixture({ holders: [...holders, holders[0]] })), /registry/)
  await assert.rejects(() => buildSnapshot(fixture({ slot: 101 })), /finalized/)
  await assert.rejects(() => buildSnapshot(fixture({ slot: 0 })), /finalized/)
})
test('wrong slot, mint, address, decimals, amount and upstream failure are not silently converted to zero', async () => {
  for (const changes of [{ slot: 99 }, { token: address(9) }, { address: address(9) }, { decimals: 6 }, { balanceRaw: '-1' }, { balanceRaw: '1.5' }, { balanceRaw: (MAX_U64 + 1n).toString() }]) {
    const original = fixture().query
    await assert.rejects(() => buildSnapshot(fixture({ query: async path => ({ ...await original(path), ...changes }) })))
  }
  await assert.rejects(() => buildSnapshot(fixture({ query: async () => { throw new Error('API unavailable') } })), /API unavailable/)
})
test('integer arithmetic, overflow, floor policy and Rust leaf encoding match', () => {
  assert.equal(couponAmount('10', bond), 500000000n)
  assert.equal(couponAmount('1', { ...bond, faceValue: '1' }), 0n)
  assert.throws(() => couponAmount(MAX_U64.toString(), bond), /u64/)
  for (const value of ['-1', '01', '0.1', '1e3', 17, (MAX_U64 + 1n).toString()]) assert.throws(() => units(value))
  assert.equal(leaf(address(2), Buffer.alloc(32, 1).toString('hex'), address(3), '10', '500000000').toString('hex'), '07a119d35a96f632de2cacd443365efeb653d5e0675299f3c152cfb14d7da483')
})
test('proofs bind investor, action, mint, quantity and payout; voting uses a distinct domain', () => {
  const action = Buffer.alloc(32, 1).toString('hex')
  const valid = leaf(bond.mint, action, address(3), '10', '500000000')
  const other = leaf(bond.mint, action, address(4), '5', '250000000')
  const tree = merkle([valid, other])
  assert.ok(verifyProof(valid, tree.proofs[0], tree.root))
  for (const altered of [leaf(address(9), action, address(3), '10', '500000000'), leaf(bond.mint, Buffer.alloc(32, 9).toString('hex'), address(3), '10', '500000000'), leaf(bond.mint, action, address(9), '10', '500000000'), leaf(bond.mint, action, address(3), '11', '500000000'), leaf(bond.mint, action, address(3), '10', '1'), leaf(bond.mint, action, address(3), '10', '500000000', 'vote')]) assert.equal(verifyProof(altered, tree.proofs[0], tree.root), false)
})
