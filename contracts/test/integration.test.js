import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import { createBondChain } from '../../backend/lib/bond-chain.js'
import { runDemo } from '../scripts/demo.js'

test('Token-2022 coupon, voting commitment, escrow and atomic redemption', async () => {
  const config = await runDemo()
  const chain = createBondChain({ BOND_RPC_URL: config.rpc, BOND_PROGRAM_ID: config.programId, BOND_NETWORK: 'localnet' })
  const issuer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(new URL('../.demo/issuer.json', import.meta.url)))))
  const investor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(new URL('../.demo/investor-1.json', import.meta.url)))))
  const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds.map(seed => typeof seed === 'string' ? Buffer.from(seed) : seed instanceof PublicKey ? seed.toBuffer() : seed), chain.program.programId)[0]
  const bondMint = new PublicKey(config.bondMint)
  const bond = pda('bond', bondMint)
  const redemption = pda('redemption', bond)
  async function rejected (method, accounts, signer, code) {
    const ix = await method.accountsStrict(accounts).instruction()
    const latest = await chain.connection.getLatestBlockhash()
    await assert.rejects(sendAndConfirmTransaction(chain.connection, new Transaction({ feePayer: signer.publicKey, ...latest }).add(ix), [signer]), error => error.logs?.some(line => line.includes(code)))
  }
  await rejected(chain.program.methods.finalizeRedemption(), { issuer: investor.publicKey, bond, redemption, escrow: pda('escrow', redemption), vault: pda('principal-vault', redemption), bondMint, tokenProgram: TOKEN_2022_PROGRAM_ID }, investor, 'ConstraintHasOne')
  const proposal = Array(32).fill(7)
  const accounts = { issuer: investor.publicKey, bond, result: pda('vote', bond, Buffer.from(proposal)), systemProgram: SystemProgram.programId }
  const vote = end => chain.program.methods.recordVoteResult(proposal, new BN(config.recordSlot), new BN(end), Array(32).fill(8), Array(32).fill(9))
  await rejected(vote(Math.floor(Date.now() / 1000) - 1), accounts, investor, 'ConstraintHasOne')
  await rejected(vote(Math.floor(Date.now() / 1000) + 3600), { ...accounts, issuer: issuer.publicKey }, issuer, 'TooEarly')
})
