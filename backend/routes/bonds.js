import { signedEnvelope, publicKey, identifier, cid, text, fail } from '../lib/validation.js'
import { buildSnapshot, canonical, hash, manifestHash } from '../lib/bond-snapshot.js'
import { tallyVotes } from '../lib/vote-tally.js'

export default async function (app) {
  const { storage, required, save, receipt, bondChain: chain } = app
  function configured () { if (!chain.ready) fail('Bond program is not configured', 503) }
  const mintOf = request => publicKey(request.params.mint)
  async function all (prefix, max = 100) {
    const items = []
    let cursor
    do {
      const page = await storage.list(prefix, cursor)
      items.push(...page.items)
      cursor = page.cursor
      if (items.length > max) fail(`Demo supports at most ${max} records`, 409)
    } while (cursor)
    return items
  }
  async function issuer (mint, envelope) {
    configured()
    const bond = await chain.readBond(mint)
    if (bond.issuer !== envelope.address || envelope.data.mint !== mint) fail('Only the bond issuer may perform this action', 403)
    return bond
  }
  async function holders (mint) {
    return (await all(`bond-holders/${mint}/`)).map(record => ({ investor: record.data.investor, label: record.data.label || '', registered: true, registeredAt: record.data.timestamp, registeredBy: record.address }))
  }
  async function coupon (mint, id) { return required(`bond-coupons/${mint}/${identifier(id)}.json`) }
  async function voteResult (mint, proposal) { return required(`bond-vote-results/${mint}/${cid(proposal)}.json`) }

  app.get('/voting-api/bonds/config', async () => ({ ready: chain.ready, network: chain.network, programId: chain.programId || null, demoSettlement: true }))
  app.get('/voting-api/bonds', async () => ({ items: (await all('bond-metadata/')).map(receipt) }))
  app.post('/voting-api/bonds', async request => {
    const envelope = signedEnvelope(request.body, 'bond:create')
    const mint = publicKey(envelope.data.mint)
    const bond = await issuer(mint, envelope)
    text(envelope.data.name, 'bond name', 100)
    text(envelope.data.symbol, 'bond symbol', 20)
    return save(`bond-metadata/${mint}.json`, envelope, { bond })
  })
  app.get('/voting-api/bonds/:mint', async request => {
    configured()
    const mint = mintOf(request)
    const record = await required(`bond-metadata/${mint}.json`)
    const investor = request.query.investor ? publicKey(request.query.investor) : undefined
    const status = await chain.status(mint, investor)
    return { ...receipt(record), ...status, holders: await holders(mint), coupons: (await all(`bond-coupons/${mint}/`)).map(receipt), votingSpace: await storage.get(`bond-spaces/${mint}.json`), voteResults: (await all(`bond-vote-results/${mint}/`)).map(receipt), transactions: await all(`bond-transactions/${mint}/`, 1000) }
  })
  app.get('/voting-api/bonds/:mint/holders', async request => ({ items: await holders(mintOf(request)) }))
  app.post('/voting-api/bonds/:mint/holders', async request => {
    const mint = mintOf(request)
    const envelope = signedEnvelope(request.body, 'bond:holder')
    await issuer(mint, envelope)
    publicKey(envelope.data.investor)
    if (envelope.data.label !== undefined && (typeof envelope.data.label !== 'string' || envelope.data.label.length > 100)) fail('Invalid investor label')
    return save(`bond-holders/${mint}/${envelope.data.investor}.json`, envelope)
  })
  app.post('/voting-api/bonds/:mint/coupons', async request => {
    const mint = mintOf(request)
    const envelope = signedEnvelope(request.body, 'bond:coupon')
    const bond = await issuer(mint, envelope)
    const id = identifier(envelope.data.id)
    const status = await chain.status(mint)
    if (!status.issuanceSealed || status.supply !== bond.outstanding) fail('Seal issuance and reconcile outstanding supply first', 409)
    const snapshot = await buildSnapshot({ bond, id, slot: envelope.data.recordSlot, holders: await holders(mint), query: app.bondQuery, finalizedSlot: await chain.finalizedSlot() })
    const manifestCid = await storage.pin(JSON.parse(canonical(snapshot.manifest)))
    return save(`bond-coupons/${mint}/${id}.json`, envelope, { ...snapshot, manifestCid })
  })
  app.get('/voting-api/bonds/:mint/coupons/:id', async request => {
    configured()
    const mint = mintOf(request)
    const record = await coupon(mint, request.params.id)
    const investor = request.query.investor ? publicKey(request.query.investor) : undefined
    const status = await chain.couponStatus(mint, request.params.id, investor)
    if (status.action && String(status.action.recordSlot) !== String(record.manifest.recordSlot)) fail('Coupon record slot does not match the stored snapshot', 409)
    if (status.action?.finalized && (status.action.root !== record.manifest.merkleRoot || status.action.manifestHash !== record.manifestHash)) fail('Stored manifest does not match the on-chain commitment', 409)
    return { ...receipt(record), ...status, manifestUrl: receipt({ cid: record.manifestCid }).ipfsUrl, entitlement: investor ? record.manifest.holders.find(value => value.investor === investor) || { investor, quantity: '0', entitlement: '0' } : null, proof: investor ? record.proofs[investor] || [] : [] }
  })
  app.post('/voting-api/bonds/:mint/voting-space', async request => {
    const mint = mintOf(request)
    const envelope = signedEnvelope(request.body, 'bond:space')
    await issuer(mint, envelope)
    const space = await required(`spaces/${identifier(envelope.data.space)}.json`)
    if (space.data.token !== mint || space.address !== envelope.address) fail('Voting space must belong to the issuer and use the bond mint')
    return save(`bond-spaces/${mint}.json`, envelope)
  })
  app.post('/voting-api/bonds/:mint/vote-results', async request => {
    const mint = mintOf(request)
    const envelope = signedEnvelope(request.body, 'bond:vote-result')
    const bond = await issuer(mint, envelope)
    const space = await required(`spaces/${identifier(envelope.data.space)}.json`)
    const proposal = await required(`proposals/${space.data.id}/${cid(envelope.data.proposal)}.json`)
    if (space.data.token !== mint || space.address !== envelope.address || proposal.data.endDate > Date.now() / 1000) fail('Bond vote must be issuer-owned and closed', 409)
    const snapshot = await buildSnapshot({ bond, id: proposal.cid, slot: proposal.data.snapshotHeights.solana, holders: await holders(mint), query: app.bondQuery, finalizedSlot: await chain.finalizedSlot(), type: 'vote' })
    const tally = await tallyVotes(storage, space.data.id, proposal, 0)
    const votes = tally.votes.map(vote => ({ investor: vote.address, receiptCid: vote.cid, choice: vote.data.choices[0], weightRaw: vote.weightRaw })).sort((a, b) => a.investor < b.investor ? -1 : a.investor > b.investor ? 1 : 0)
    const evidenceHash = manifestHash(votes)
    const manifest = { ...snapshot.manifest, proposal: proposal.cid, space: space.data.id, votingEnd: proposal.data.endDate, results: tally.results, voteCount: tally.voteCount, signedVotes: votes, evidenceHash, trust: 'Off-chain signed voting with historical on-chain token ownership and an on-chain final-result commitment.' }
    const manifestCid = await storage.pin(JSON.parse(canonical(manifest)))
    return save(`bond-vote-results/${mint}/${proposal.cid}.json`, envelope, { manifest, manifestHash: manifestHash(manifest), manifestCid, evidenceHash })
  })
  app.get('/voting-api/bonds/:mint/vote-results/:proposal', async request => {
    configured()
    const mint = mintOf(request)
    const record = await voteResult(mint, request.params.proposal)
    const commitment = await chain.voteStatus(mint, request.params.proposal)
    if (commitment && (commitment.resultHash !== record.manifestHash || commitment.evidenceHash !== record.evidenceHash)) fail('Voting evidence does not match the on-chain commitment', 409)
    return { ...receipt(record), manifestUrl: receipt({ cid: record.manifestCid }).ipfsUrl, commitment }
  })
  app.post('/voting-api/bonds/transactions', async request => {
    configured()
    const envelope = signedEnvelope(request.body, 'bond:transaction')
    const { mint, operation, args = {} } = envelope.data
    publicKey(mint)
    if (typeof operation !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) fail('Invalid transaction operation or arguments')
    let evidence
    if (['initialize-coupon', 'finalize-coupon', 'claim-coupon', 'fund-coupon'].includes(operation)) evidence = await coupon(mint, args.id)
    if (operation === 'commit-vote') evidence = await voteResult(mint, args.proposal)
    const intent = await chain.prepare(mint, envelope.address, operation, args, evidence)
    const id = hash(intent.transaction).toString('hex')
    await storage.put(`bond-intents/${id}.json`, { ...intent, createdAt: envelope.data.timestamp })
    return { ...intent, intent: id, network: chain.network }
  })
  async function settle (request, submit) {
    configured()
    const envelope = signedEnvelope(request.body, submit ? 'bond:submit' : 'bond:confirm')
    if (typeof envelope.data.intent !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.data.intent)) fail('Invalid transaction intent')
    const intent = await required(`bond-intents/${envelope.data.intent}.json`)
    if (intent.signer !== envelope.address) fail('Transaction signer mismatch', 403)
    const confirmed = submit ? await chain.submit(intent, envelope.data.transaction) : await chain.confirm(intent, envelope.data.signature)
    const key = `bond-transactions/${intent.mint}/${confirmed.signature}.json`
    const record = { signature: confirmed.signature, operation: intent.operation, investor: envelope.address, slot: confirmed.slot, confirmedAt: Math.floor(Date.now() / 1000) }
    if (!await storage.get(key)) await storage.put(key, record)
    return { ...record, status: confirmed.status }
  }
  app.post('/voting-api/bonds/confirm', request => settle(request, false))
  app.post('/voting-api/bonds/submit', request => settle(request, true))
}
