import { readFileSync } from 'node:fs'
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor'
import { Connection, PublicKey, Transaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, getAccount, getMint, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from '@solana/spl-token'
import bs58 from 'bs58'
import { fail, publicKey } from './validation.js'
import { actionId, hash, units } from './bond-snapshot.js'

export function chainJSON (value) {
  if (value instanceof PublicKey) return value.toBase58()
  if (BN.isBN(value)) return value.toString()
  if (Array.isArray(value)) return value.map(chainJSON)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, chainJSON(item)]))
  return value
}

export function matchesBondTransaction (expected, signed) {
  if (signed.serializeMessage().equals(expected.serializeMessage())) return true
  const budget = instruction => instruction.programId.equals(ComputeBudgetProgram.programId)
  const price = instruction => budget(instruction) && instruction.keys.length === 0 && instruction.data.length === 9 && instruction.data[0] === 3
  const prices = signed.instructions.filter(price)
  const limits = expected.instructions.filter(instruction => budget(instruction) && instruction.keys.length === 0 && instruction.data.length === 5 && instruction.data[0] === 2)
  if (prices.length !== 1 || limits.length !== 1 || expected.instructions.some(price)) return false
  const priceIndex = signed.instructions.indexOf(prices[0])
  if (signed.instructions.slice(0, priceIndex).some(instruction => !budget(instruction))) return false
  if (prices[0].data.readBigUInt64LE(1) * BigInt(limits[0].data.readUInt32LE(1)) > 100000n * 1000000n) return false
  const normalized = Transaction.from(signed.serialize({ requireAllSignatures: false, verifySignatures: false }))
  normalized.instructions.splice(priceIndex, 1)
  return normalized.serializeMessage().equals(expected.serializeMessage())
}
export function createBondChain (env = process.env) {
  if (!env.BOND_RPC_URL || !env.BOND_PROGRAM_ID) return { ready: false, network: 'unconfigured' }
  const network = env.BOND_NETWORK || 'mainnet-beta'
  if (!['localnet', 'devnet', 'mainnet-beta'].includes(network)) fail('Invalid bond network')
  const connection = new Connection(env.BOND_RPC_URL, 'confirmed')
  async function verifyNetwork () {
    if (network === 'localnet') return
    const expected = network === 'devnet' ? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' : '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
    if (await connection.getGenesisHash() !== expected) fail('Bond RPC does not belong to the configured Solana network', 503)
  }
  const idl = JSON.parse(readFileSync(new URL('../idl/kase_bond.json', import.meta.url)))
  idl.address = publicKey(env.BOND_PROGRAM_ID)
  const program = new Program(idl, new AnchorProvider(connection, { publicKey: SystemProgram.programId, async signTransaction () { throw new Error('Wallet signature required') }, async signAllTransactions () { throw new Error('Wallet signature required') } }, { commitment: 'confirmed' }))
  const pk = value => new PublicKey(publicKey(value))
  const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds.map(value => typeof value === 'string' ? Buffer.from(value) : value instanceof PublicKey ? value.toBuffer() : value), program.programId)[0]
  const bondAddress = mint => pda('bond', pk(mint))
  const redemptionAddress = mint => pda('redemption', bondAddress(mint))
  const couponAddress = (mint, id) => pda('coupon', bondAddress(mint), actionId(mint, id))
  const hex = value => Array.from(Buffer.from(value, 'hex'))
  const integer = value => new BN(units(value).toString())
  function timestamp (value) {
    if (!Number.isSafeInteger(value) || value < 1) fail('Invalid timestamp')
    return new BN(value)
  }
  async function tokenAmount (address) {
    if (!await connection.getAccountInfo(address)) return '0'
    return (await getAccount(connection, address, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount.toString()
  }
  async function readBond (mint) {
    const account = await program.account.bondConfig.fetchNullable(bondAddress(mint))
    if (!account) fail('On-chain bond is not initialized', 404)
    const value = chainJSON(account)
    return { ...value, mint: value.bondMint, faceValue: value.faceValue, outstanding: value.outstanding, couponBps: value.couponBps, frequency: value.frequency, maturity: Number(value.maturity), programId: program.programId.toBase58(), network }
  }
  async function status (mint, investor) {
    const bond = await readBond(mint)
    const token = await getMint(connection, pk(mint), 'confirmed', TOKEN_2022_PROGRAM_ID)
    const redemptionKey = redemptionAddress(mint)
    const state = await program.account.redemptionState.fetchNullable(redemptionKey)
    const position = investor ? await program.account.escrowPosition.fetchNullable(pda('position', bondAddress(mint), pk(investor))) : null
    const locked = state?.locked.toString() || '0'
    const redeemed = state?.redeemed.toString() || '0'
    const unredeemed = (BigInt(locked) - BigInt(redeemed)).toString()
    let currentBalance = '0'
    if (investor) {
      const accounts = await connection.getParsedTokenAccountsByOwner(pk(investor), { mint: pk(mint) })
      currentBalance = accounts.value.reduce((sum, item) => sum + BigInt(item.account.data.parsed.info.tokenAmount.amount), 0n).toString()
    }
    return { bond, supply: token.supply.toString(), issuanceSealed: token.mintAuthority === null, currentBalance, redemption: state ? { ...chainJSON(state), cutoff: Number(state.cutoff), escrow: pda('escrow', redemptionKey).toBase58(), vault: pda('principal-vault', redemptionKey).toBase58(), escrowBalance: await tokenAmount(pda('escrow', redemptionKey)), vaultBalance: await tokenAmount(pda('principal-vault', redemptionKey)), unredeemed, unlocked: (token.supply - BigInt(unredeemed)).toString(), remainingLiability: (BigInt(state.liability.toString()) - BigInt(state.settled.toString())).toString() } : null, position: position ? chainJSON(position) : null }
  }
  async function couponStatus (mint, id, investor) {
    const actionKey = couponAddress(mint, id)
    const action = await program.account.corporateAction.fetchNullable(actionKey)
    const claim = investor ? await program.account.couponClaim.fetchNullable(pda('claim', actionKey, pk(investor))) : null
    return { address: actionKey.toBase58(), vault: pda('coupon-vault', actionKey).toBase58(), vaultBalance: await tokenAmount(pda('coupon-vault', actionKey)), action: action ? { ...chainJSON(action), root: Buffer.from(action.root).toString('hex'), manifestHash: Buffer.from(action.manifestHash).toString('hex') } : null, claim: claim ? chainJSON(claim) : null }
  }
  async function prepare (mint, signer, operation, args = {}, evidence) {
    const investor = pk(signer)
    const bondKey = bondAddress(mint)
    const tokenProgram = TOKEN_2022_PROGRAM_ID
    const systemProgram = SystemProgram.programId
    const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })]
    let method
    let accounts
    if (operation === 'initialize-bond') {
      if (!Number.isInteger(args.couponBps) || args.couponBps < 1 || args.couponBps > 10000 || !Number.isInteger(args.frequency) || args.frequency < 1 || args.frequency > 65535) fail('Invalid coupon parameters')
      method = program.methods.initializeBond(integer(args.faceValue), args.couponBps, args.frequency, timestamp(args.maturity), integer(args.outstanding))
      accounts = { issuer: investor, bond: bondKey, bondMint: pk(mint), settlementMint: pk(args.settlementMint), tokenProgram, systemProgram }
    } else {
      const bond = await readBond(mint)
      const issuerOperation = ['initialize-coupon', 'finalize-coupon', 'fund-coupon', 'open-redemption', 'fund-redemption', 'finalize-redemption', 'commit-vote'].includes(operation)
      if (issuerOperation && bond.issuer !== signer) fail('Only the issuer may perform this action', 403)
      const settlementMint = pk(bond.settlementMint)
      const redemption = redemptionAddress(mint)
      const escrow = pda('escrow', redemption)
      const vault = pda('principal-vault', redemption)
      const position = pda('position', bondKey, investor)
      const destination = getAssociatedTokenAddressSync(settlementMint, investor, false, tokenProgram)
      const source = getAssociatedTokenAddressSync(pk(mint), investor, false, tokenProgram)
      if (['claim-coupon', 'redeem'].includes(operation)) instructions.push(createAssociatedTokenAccountIdempotentInstruction(investor, destination, investor, settlementMint, tokenProgram))
      if (['initialize-coupon', 'finalize-coupon', 'claim-coupon', 'fund-coupon'].includes(operation)) {
        const action = couponAddress(mint, args.id)
        const couponVault = pda('coupon-vault', action)
        if (operation === 'initialize-coupon') {
          method = program.methods.initializeCouponAction(Array.from(actionId(mint, args.id)), integer(String(evidence.manifest.recordSlot)))
          accounts = { issuer: investor, bond: bondKey, action, vault: couponVault, settlementMint, tokenProgram, systemProgram }
        } else if (operation === 'finalize-coupon') {
          const existing = await program.account.corporateAction.fetch(action)
          if (existing.recordSlot.toString() !== String(evidence.manifest.recordSlot)) fail('Coupon record slot does not match the prepared snapshot', 409)
          method = program.methods.finalizeCouponSnapshot(hex(evidence.manifest.merkleRoot), hex(evidence.manifestHash), integer(evidence.manifest.totalQuantity), integer(evidence.manifest.totalLiability))
          accounts = { issuer: investor, bond: bondKey, action, vault: couponVault, bondMint: pk(mint), tokenProgram }
        } else if (operation === 'claim-coupon') {
          const holder = evidence.manifest.holders.find(holder => holder.investor === signer)
          if (!holder || holder.quantity === '0') fail('No historical coupon entitlement', 403)
          method = program.methods.claimCoupon(integer(holder.quantity), integer(holder.entitlement), evidence.proofs[signer].map(hex))
          accounts = { investor, bond: bondKey, action, claim: pda('claim', action, investor), vault: couponVault, destination, settlementMint, tokenProgram, systemProgram }
        } else instructions.push(createTransferCheckedInstruction(getAssociatedTokenAddressSync(settlementMint, investor, false, tokenProgram), settlementMint, couponVault, investor, units(args.amount), 6, [], tokenProgram))
      } else if (operation === 'open-redemption') {
        method = program.methods.initializeRedemption(timestamp(args.cutoff))
        accounts = { issuer: investor, bond: bondKey, redemption, escrow, vault, bondMint: pk(mint), settlementMint, tokenProgram, systemProgram }
      } else if (operation === 'deposit') {
        method = program.methods.depositForRedemption(integer(args.quantity))
        accounts = { investor, bond: bondKey, redemption, position, escrow, source, bondMint: pk(mint), tokenProgram, systemProgram }
      } else if (operation === 'fund-redemption') instructions.push(createTransferCheckedInstruction(getAssociatedTokenAddressSync(settlementMint, investor, false, tokenProgram), settlementMint, vault, investor, units(args.amount), 6, [], tokenProgram))
      else if (operation === 'finalize-redemption') {
        method = program.methods.finalizeRedemption()
        accounts = { issuer: investor, bond: bondKey, redemption, escrow, vault, bondMint: pk(mint), tokenProgram }
      } else if (operation === 'redeem') {
        method = program.methods.redeemBonds()
        accounts = { investor, bond: bondKey, redemption, position, escrow, vault, destination, bondMint: pk(mint), settlementMint, tokenProgram }
      } else if (operation === 'commit-vote') {
        const proposal = hash(args.proposal)
        method = program.methods.recordVoteResult(Array.from(proposal), integer(String(evidence.manifest.recordSlot)), timestamp(evidence.manifest.votingEnd), hex(evidence.manifestHash), hex(evidence.evidenceHash))
        accounts = { issuer: investor, bond: bondKey, result: pda('vote', bondKey, proposal), systemProgram }
      } else fail('Unknown bond transaction')
    }
    if (method) instructions.push(await method.accountsStrict(accounts).instruction())
    const latest = await connection.getLatestBlockhash('confirmed')
    const transaction = new Transaction({ feePayer: investor, ...latest }).add(...instructions)
    return { transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, operation, mint, signer }
  }
  async function confirm (intent, signature) {
    if (typeof signature !== 'string') fail('Invalid transaction signature')
    try { if (bs58.decode(signature).length !== 64) fail('Invalid transaction signature') } catch { fail('Invalid transaction signature') }
    const response = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
    if (!response) fail('Transaction is not confirmed yet', 409)
    if (!response.meta || response.meta.err) fail('On-chain transaction failed', 409)
    const expected = Transaction.from(Buffer.from(intent.transaction, 'base64'))
    if (response.transaction.message.version !== 'legacy' || !matchesBondTransaction(expected, Transaction.populate(response.transaction.message))) fail('Transaction does not match the signed request', 403)
    return { signature, slot: response.slot, status: await status(intent.mint, intent.signer) }
  }
  async function submit (intent, encoded) {
    if (typeof encoded !== 'string' || encoded.length > 4000) fail('Invalid signed transaction')
    let transaction
    try { transaction = Transaction.from(Buffer.from(encoded, 'base64')) } catch { fail('Invalid signed transaction') }
    const expected = Transaction.from(Buffer.from(intent.transaction, 'base64'))
    if (!matchesBondTransaction(expected, transaction) || !transaction.verifySignatures()) fail('Signed transaction does not match the prepared request', 403)
    const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false })
    const result = await connection.confirmTransaction({ signature, blockhash: intent.blockhash, lastValidBlockHeight: intent.lastValidBlockHeight }, 'confirmed')
    if (result.value.err) fail('On-chain transaction failed', 409)
    return confirm(intent, signature)
  }
  async function voteStatus (mint, proposal) {
    const value = await program.account.voteResultCommitment.fetchNullable(pda('vote', bondAddress(mint), hash(proposal)))
    return value ? { ...chainJSON(value), resultHash: Buffer.from(value.resultHash).toString('hex'), evidenceHash: Buffer.from(value.evidenceHash).toString('hex') } : null
  }
  return { ready: true, network, programId: program.programId.toBase58(), connection, program, verifyNetwork, readBond, status, couponStatus, prepare, confirm, submit, voteStatus, finalizedSlot: () => connection.getSlot('finalized') }
}
