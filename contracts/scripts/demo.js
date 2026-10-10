import assert from 'node:assert/strict'
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, getAccount, getMint, transferChecked, createBurnInstruction, createTransferCheckedInstruction } from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import { setup } from './setup.js'
import { buildApp } from '../../backend/test/helper.js'
import { signingText, APP } from '../../backend/lib/signing.js'
import { canonical, hash } from '../../backend/lib/bond-snapshot.js'
import { createSolanaIndex } from '../../backend/lib/solana-index.js'
import { createStorage } from '../../backend/lib/storage.js'

export function envelope (wallet, value) {
  const data = { ...value, app: APP, timestamp: Math.floor(Date.now() / 1000) }
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(wallet.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' })
  return { data, address: wallet.publicKey.toBase58(), signature: sign(null, Buffer.from(signingText(data)), key).toString('hex') }
}

export async function runDemo (report = console.log, options = {}) {
  const live = options.network === 'devnet'
  if (options.network && !['localnet', 'devnet'].includes(options.network)) throw new Error('Demo supports only localnet or devnet')
  if (live && (!process.env.SOLANA_INDEX_API_KEY || !options.issuerFile)) throw new Error('Devnet demo requires SOLANA_INDEX_API_KEY and ISSUER_KEYPAIR')
  const persistent = live ? createStorage({ ...process.env, SOLANA_INDEX_NETWORK: 'devnet' }) : null
  if (live && !persistent.ready) throw new Error('Devnet demo requires configured S3 and 4EVERLAND storage')
  const liveQuery = live ? createSolanaIndex(process.env.SOLANA_INDEX_API_KEY, 'devnet') : null
  if (live) await liveQuery('slot')
  const idl = JSON.parse(await readFile(new URL('../../backend/idl/kase_bond.json', import.meta.url)))
  const f = await setup({ programId: live ? process.env.BOND_PROGRAM_ID || idl.address : idl.address, maturitySeconds: live ? Number(process.env.DEMO_MATURITY_SECONDS || 900) : 180, ...options })
  const { issuer, investors, connection, chain, bondMint, settlementMint, bondAccounts, settlementAccounts } = f
  const mint = bondMint.toBase58()
  const issuerAddress = issuer.publicKey.toBase58()
  const records = new Map()
  const historical = new Map()
  const storage = persistent || {
    ready: true,
    async get (key) { return structuredClone(records.get(key) || null) },
    async put (key, value) { if (records.has(key)) throw Object.assign(new Error('Already exists'), { statusCode: 409 }); records.set(key, structuredClone(value)) },
    async list (prefix) { return { items: [...records].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value)), cursor: null } },
    async pin (value) { return 'bafy' + createHash('sha256').update(JSON.stringify(value)).digest('hex') }
  }
  async function query (path) {
    if (path === 'slot') return { slot: await chain.finalizedSlot() }
    if (path.startsWith('token-info/')) return { symbol: 'KDB26', decimals: 0 }
    const [kind, address, token, slot] = path.split('/')
    if (kind === 'slot-timestamp') return { slot: Number(address), timestamp: new Date((await connection.getBlockTime(Number(address))) * 1000).toISOString(), timestampSlot: Number(address), resolution: 'exact' }
    const quantity = historical.get(`${address}/${token}/${slot}`)
    if (quantity === undefined) throw new Error('Missing explicit local Solana Index fixture')
    return { address, token, slot: Number(slot), balanceRaw: quantity, decimals: 0 }
  }
  const app = await buildApp({ storage, query: liveQuery || query, bondQuery: liveQuery || query, bondChain: chain, indexNetwork: live ? 'devnet' : 'mainnet-beta' })
  const transactions = []
  async function post (path, wallet, action, data) {
    const response = await app.inject({ method: 'POST', url: path, payload: envelope(wallet, { action, ...data }) })
    assert.equal(response.statusCode, 200, response.body)
    return response.json()
  }
  async function invoke (operation, wallet = issuer, args = {}) {
    const intent = await post('/voting-api/bonds/transactions', wallet, 'bond:transaction', { mint, operation, args })
    const transaction = Transaction.from(Buffer.from(intent.transaction, 'base64'))
    transaction.sign(wallet)
    const result = await post('/voting-api/bonds/submit', wallet, 'bond:submit', { intent: intent.intent, transaction: transaction.serialize().toString('base64') })
    transactions.push({ operation, signature: result.signature })
    return result
  }
  async function direct (builder, accounts, signer = issuer, additional = [], trailing = []) {
    const ix = await builder.accountsStrict(accounts).instruction()
    const latest = await connection.getLatestBlockhash()
    return sendAndConfirmTransaction(connection, new Transaction({ feePayer: signer.publicKey, ...latest }).add(...additional, ix, ...trailing), [signer], { skipPreflight: trailing.length > 0 })
  }
  const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds.map(value => typeof value === 'string' ? Buffer.from(value) : value instanceof PublicKey ? value.toBuffer() : value), chain.program.programId)[0]
  const bond = pda('bond', bondMint)
  const tokenProgram = TOKEN_2022_PROGRAM_ID
  const systemProgram = SystemProgram.programId
  async function reject (name, work) { await assert.rejects(work); report(`PASS: ${name}`) }
  async function waitUntil (seconds) {
    while (true) {
      const chainTime = live ? await connection.getBlockTime(await connection.getSlot('confirmed')) : seconds
      if (Date.now() / 1000 >= seconds && chainTime !== null && chainTime >= seconds) return
      await new Promise(resolve => setTimeout(resolve, live ? 3000 : 500))
    }
  }

  try {
    await post('/voting-api/bonds', issuer, 'bond:create', { mint, name: 'Kazakhstan Demo Bond 2026', symbol: 'KDB26' })
    for (const [index, investor] of investors.entries()) await post(`/voting-api/bonds/${mint}/holders`, issuer, 'bond:holder', { mint, investor: investor.publicKey.toBase58(), label: ['A', 'B', 'C'][index] })
    const recordSlot = await connection.getSlot('confirmed')
    for (const [index, investor] of investors.entries()) historical.set(`${investor.publicKey}/${mint}/${recordSlot}`, ['10', '5', '2'][index])
    while (await chain.finalizedSlot() < recordSlot) await new Promise(resolve => setTimeout(resolve, 500))
    const snapshot = await post(`/voting-api/bonds/${mint}/coupons`, issuer, 'bond:coupon', { mint, id: 'coupon-001', recordSlot })
    assert.equal(snapshot.manifest.totalLiability, '850000000')
    assert.equal(snapshot.manifestHash, hash(canonical(snapshot.manifest)).toString('hex'))
    await invoke('initialize-coupon', issuer, { id: 'coupon-001' })
    const action = new PublicKey((await chain.couponStatus(mint, 'coupon-001')).address)
    const couponVault = pda('coupon-vault', action)
    const finalizeAccounts = { issuer: issuer.publicKey, bond, action, vault: couponVault, bondMint, tokenProgram }
    const finalize = () => chain.program.methods.finalizeCouponSnapshot(Array.from(Buffer.from(snapshot.manifest.merkleRoot, 'hex')), Array.from(Buffer.from(snapshot.manifestHash, 'hex')), new BN(17), new BN(850000000))
    await reject('underfunded coupon finalization', () => direct(finalize(), finalizeAccounts))
    await invoke('fund-coupon', issuer, { id: 'coupon-001', amount: snapshot.manifest.totalLiability })
    await reject('unauthorized coupon finalization', () => direct(finalize(), { ...finalizeAccounts, issuer: investors[0].publicKey }, investors[0]))
    await invoke('finalize-coupon', issuer, { id: 'coupon-001' })
    await reject('immutable coupon root', () => direct(finalize(), finalizeAccounts))
    await transferChecked(connection, investors[0], bondAccounts[0], bondMint, bondAccounts[1], investors[0], 1n, 0, [], undefined, tokenProgram)
    assert.equal((await getAccount(connection, bondAccounts[0], undefined, tokenProgram)).amount, 9n)
    const aHolder = snapshot.manifest.holders.find(holder => holder.investor === investors[0].publicKey.toBase58())
    const claimAccounts = { investor: investors[0].publicKey, bond, action, claim: pda('claim', action, investors[0].publicKey), vault: couponVault, destination: settlementAccounts[0], settlementMint, tokenProgram, systemProgram }
    const proof = snapshot.proofs[investors[0].publicKey.toBase58()].map(value => Array.from(Buffer.from(value, 'hex')))
    const claim = (quantity = 10, amount = 500000000, selectedProof = proof) => chain.program.methods.claimCoupon(new BN(quantity), new BN(amount), selectedProof)
    await reject('invalid coupon proof', () => direct(claim(10, 500000000, [Array(32).fill(0)]), claimAccounts, investors[0]))
    await reject('altered coupon entitlement', () => direct(claim(10, 1), claimAccounts, investors[0]))
    await reject('wrong coupon investor', () => direct(claim(), { ...claimAccounts, investor: investors[1].publicKey, claim: pda('claim', action, investors[1].publicKey), destination: settlementAccounts[1] }, investors[1]))
    await reject('wrong coupon mint', () => direct(claim(), { ...claimAccounts, settlementMint: bondMint }, investors[0]))
    await reject('wrong coupon vault', () => direct(claim(), { ...claimAccounts, vault: settlementAccounts[0] }, investors[0]))
    for (const [index, investor] of investors.entries()) {
      await invoke('claim-coupon', investor, { id: 'coupon-001' })
      assert.equal((await getAccount(connection, settlementAccounts[index], undefined, tokenProgram)).amount, [500000000n, 250000000n, 100000000n][index])
    }
    assert.equal(aHolder.entitlement, '500000000')
    await reject('duplicate coupon claim', () => invoke('claim-coupon', investors[0], { id: 'coupon-001' }))
    report('PASS: 850 DEMOUSD paid using historical balances after transfer')
    await transferChecked(connection, investors[1], bondAccounts[1], bondMint, bondAccounts[0], investors[1], 1n, 0, [], undefined, tokenProgram)

    const spaceId = live ? `kdb26-${mint.slice(0, 12).toLowerCase()}` : 'kdb26-bondholders'
    const networksConfig = { networks: [{ network: 'solana', assets: [{ type: 'spl', contract: mint }] }] }
    await post('/voting-api/spaces', issuer, 'space:create', { id: spaceId, name: 'KDB26 bondholders', description: 'Demo reporting amendment', token: mint, networksConfig })
    await post(`/voting-api/bonds/${mint}/voting-space`, issuer, 'bond:space', { mint, space: spaceId })
    const now = Math.floor(Date.now() / 1000)
    const votingEnd = now + (live ? 120 : 8)
    const proposal = await post(`/voting-api/spaces/${spaceId}/proposals`, issuer, 'proposal:create', { space: spaceId, networksConfig, title: 'Approve an amendment to the bond reporting schedule.', content: 'Quarterly reporting', contentType: 'markdown', choiceType: 'single', choices: ['Approve', 'Reject', 'Abstain'], startDate: now - 1, endDate: votingEnd, snapshotHeights: { solana: recordSlot }, realProposer: issuerAddress, proposerNetwork: 'solana' })
    for (const [index, investor] of investors.entries()) await post(`/voting-api/spaces/${spaceId}/proposals/${proposal.cid}/votes`, investor, 'vote:create', { space: spaceId, proposalCid: proposal.cid, choices: [index], realVoter: investor.publicKey.toBase58(), voterNetwork: 'solana' })
    await waitUntil(votingEnd + 1)
    const result = await post(`/voting-api/bonds/${mint}/vote-results`, issuer, 'bond:vote-result', { mint, space: spaceId, proposal: proposal.cid })
    assert.deepEqual(result.manifest.results.map(value => value.weightRaw), ['10', '5', '2'])
    await reject('unauthorized vote commitment', () => invoke('commit-vote', investors[0], { proposal: proposal.cid }))
    await invoke('commit-vote', issuer, { proposal: proposal.cid })
    const commitment = await chain.voteStatus(mint, proposal.cid)
    assert.equal(commitment.resultHash, result.manifestHash)
    await reject('duplicate vote result replacement', () => invoke('commit-vote', issuer, { proposal: proposal.cid }))
    report('PASS: existing signed weighted votes committed on-chain')

    const cutoff = Math.floor(Date.now() / 1000) + (live ? 120 : 20)
    assert.ok(cutoff < f.config.maturity, 'Increase DEMO_MATURITY_SECONDS if setup is slow')
    await invoke('open-redemption', issuer, { cutoff })
    const redemption = pda('redemption', bond)
    const escrow = pda('escrow', redemption)
    const vault = pda('principal-vault', redemption)
    const depositAccounts = { investor: investors[0].publicKey, bond, redemption, position: pda('position', bond, investors[0].publicKey), escrow, source: bondAccounts[0], bondMint, tokenProgram, systemProgram }
    await reject('wrong deposit mint', () => direct(chain.program.methods.depositForRedemption(new BN(1)), { ...depositAccounts, bondMint: settlementMint }, investors[0]))
    await reject('unauthorized deposit source', () => direct(chain.program.methods.depositForRedemption(new BN(1)), { ...depositAccounts, source: bondAccounts[1] }, investors[0]))
    await invoke('deposit', investors[0], { quantity: '4' })
    await invoke('deposit', investors[0], { quantity: '6' })
    await invoke('deposit', investors[1], { quantity: '5' })
    await invoke('deposit', investors[2], { quantity: '2' })
    const locked = await chain.status(mint, investors[0].publicKey.toBase58())
    assert.equal(locked.redemption.locked, '17')
    assert.equal(locked.redemption.escrowBalance, '17')
    assert.equal(locked.position.locked, '10')
    await reject('finalize before maturity', () => invoke('finalize-redemption'))
    await reject('issuer cannot withdraw escrow', () => sendAndConfirmTransaction(connection, new Transaction().add(createTransferCheckedInstruction(escrow, bondMint, bondAccounts[0], issuer.publicKey, 1n, 0, [], tokenProgram)), [issuer]))
    await waitUntil(cutoff + 1)
    await reject('deposit after cutoff', () => invoke('deposit', investors[0], { quantity: '1' }))
    report(`Waiting for accelerated demo maturity (${new Date(f.config.maturity * 1000).toISOString()})`)
    await waitUntil(f.config.maturity + 1)
    await reject('underfunded principal finalization', () => invoke('finalize-redemption'))
    await invoke('fund-redemption', issuer, { amount: '17000000000' })
    await reject('unauthorized redemption finalization', () => invoke('finalize-redemption', investors[0]))
    await invoke('finalize-redemption')
    const redeemAccounts = { investor: investors[0].publicKey, bond, redemption, position: pda('position', bond, investors[0].publicKey), escrow, vault, destination: settlementAccounts[0], bondMint, settlementMint, tokenProgram }
    await reject('wrong redemption investor', () => direct(chain.program.methods.redeemBonds(), { ...redeemAccounts, investor: investors[1].publicKey, destination: settlementAccounts[1] }, investors[1]))
    await reject('wrong redemption escrow', () => direct(chain.program.methods.redeemBonds(), { ...redeemAccounts, escrow: bondAccounts[0] }, investors[0]))
    await reject('wrong redemption settlement mint', () => direct(chain.program.methods.redeemBonds(), { ...redeemAccounts, settlementMint: bondMint }, investors[0]))
    await reject('unauthorized redemption destination', () => direct(chain.program.methods.redeemBonds(), { ...redeemAccounts, destination: settlementAccounts[1] }, investors[0]))
    const before = await getAccount(connection, escrow, undefined, tokenProgram)
    const beforeCash = await getAccount(connection, settlementAccounts[0], undefined, tokenProgram)
    const burnBefore = createBurnInstruction(bondAccounts[0], bondMint, investors[0].publicKey, 1n, [], tokenProgram)
    await reject('failed token burn prevents settlement', () => direct(chain.program.methods.redeemBonds(), redeemAccounts, investors[0], [burnBefore]))
    assert.equal((await getAccount(connection, escrow, undefined, tokenProgram)).amount, before.amount)
    assert.equal((await getAccount(connection, settlementAccounts[0], undefined, tokenProgram)).amount, beforeCash.amount)
    const wrongTokenProgram = SystemProgram.programId
    await reject('invalid settlement token program', () => direct(chain.program.methods.redeemBonds(), { ...redeemAccounts, tokenProgram: wrongTokenProgram }, investors[0]))
    const beforeSupply = (await getMint(connection, bondMint, undefined, tokenProgram)).supply
    const beforeVault = (await getAccount(connection, vault, undefined, tokenProgram)).amount
    const failAfterSettlement = createTransferCheckedInstruction(settlementAccounts[0], settlementMint, settlementAccounts[1], investors[0].publicKey, 10500000001n, 6, [], tokenProgram)
    await reject('confirmed transaction failure rolls back burn, payment and accounting', () => direct(chain.program.methods.redeemBonds(), redeemAccounts, investors[0], [], [failAfterSettlement]))
    assert.equal((await getMint(connection, bondMint, undefined, tokenProgram)).supply, beforeSupply)
    assert.equal((await getAccount(connection, vault, undefined, tokenProgram)).amount, beforeVault)
    assert.equal((await getAccount(connection, escrow, undefined, tokenProgram)).amount, before.amount)
    assert.equal((await getAccount(connection, settlementAccounts[0], undefined, tokenProgram)).amount, beforeCash.amount)
    assert.equal((await chain.status(mint, investors[0].publicKey.toBase58())).position.redeemed, '0')
    for (const [index, investor] of investors.entries()) {
      await invoke('redeem', investor)
      assert.equal((await getAccount(connection, settlementAccounts[index], undefined, tokenProgram)).amount, [10500000000n, 5250000000n, 2100000000n][index])
    }
    await reject('duplicate principal redemption', () => invoke('redeem', investors[0]))
    const settled = await chain.status(mint)
    assert.equal((await getMint(connection, bondMint, undefined, tokenProgram)).supply, 0n)
    assert.equal(settled.redemption.redeemed, '17')
    assert.equal(settled.redemption.settled, '17000000000')
    assert.equal(settled.redemption.remainingLiability, '0')
    assert.equal(settled.redemption.unlocked, '0')
    report('PASS: all 17 bonds burned and 17,000 DEMOUSD principal paid atomically')
    const output = { ...f.config, recordSlot, manifestHash: snapshot.manifestHash, voteResultHash: result.manifestHash, transactions, status: settled, mocked: live ? [] : ['Solana Index local historical responses', 'S3 storage', 'IPFS CIDs'] }
    await writeFile(new URL(live ? '../.devnet/result.json' : '../.demo/result.json', import.meta.url), JSON.stringify(output, null, 2))
    return output
  } finally { await app.close() }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const live = process.argv.includes('--devnet')
  if (!live && process.env.BOND_NETWORK && process.env.BOND_NETWORK !== 'localnet') throw new Error('Use npm run demo:devnet for the public devnet demonstration')
  if (live && process.env.BOND_NETWORK !== 'devnet') throw new Error('Set BOND_NETWORK=devnet for the devnet demonstration')
  const result = await runDemo(console.log, live ? { network: 'devnet', rpc: process.env.BOND_RPC_URL || 'https://api.devnet.solana.com', issuerFile: process.env.ISSUER_KEYPAIR } : {})
  console.log(JSON.stringify({ bondMint: result.bondMint, transactions: result.transactions.length, mocked: result.mocked }, null, 2))
}
