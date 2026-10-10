import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, AuthorityType, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { createBondChain } from '../../backend/lib/bond-chain.js'

export async function setup ({ rpc = 'http://127.0.0.1:8899', network = 'localnet', programId, maturitySeconds = 180, issuerFile } = {}) {
  if (network !== 'localnet' && !issuerFile) throw new Error('Public setup requires an explicitly supplied issuer keypair')
  if (!Number.isSafeInteger(maturitySeconds) || maturitySeconds < 60) throw new Error('Maturity must be at least 60 seconds in the future')
  const chain = createBondChain({ BOND_RPC_URL: rpc, BOND_NETWORK: network, BOND_PROGRAM_ID: programId })
  if (!chain.ready) throw new Error('A deployed program ID is required')
  await chain.verifyNetwork()
  const connection = new Connection(rpc, 'confirmed')
  const issuer = issuerFile ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(issuerFile)))) : Keypair.generate()
  const investors = [Keypair.generate(), Keypair.generate(), Keypair.generate()]
  const directory = new URL(network === 'devnet' ? '../.devnet/' : '../.demo/', import.meta.url)
  try { await mkdir(directory, { recursive: network === 'localnet', mode: 0o700 }) } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Back up and move contracts/${network === 'devnet' ? '.devnet' : '.demo'} before public setup; existing wallet keys will not be overwritten`)
    throw error
  }
  for (const [index, wallet] of [issuer, ...investors].entries()) await writeFile(new URL(`${index === 0 ? 'issuer' : `investor-${index}`}.json`, directory), JSON.stringify(Array.from(wallet.secretKey)), { mode: 0o600 })
  if (network === 'localnet') {
    for (const wallet of [issuer, ...investors]) {
      const signature = await connection.requestAirdrop(wallet.publicKey, 10 * LAMPORTS_PER_SOL)
      await connection.confirmTransaction(signature, 'confirmed')
    }
  }
  if (network === 'devnet') {
    const { Transaction, SystemProgram, sendAndConfirmTransaction } = await import('@solana/web3.js')
    for (const investor of investors) await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: investor.publicKey, lamports: 20000000 })), [issuer])
  }
  const bondMint = await createMint(connection, issuer, issuer.publicKey, null, 0, undefined, undefined, TOKEN_2022_PROGRAM_ID)
  const settlementMint = await createMint(connection, issuer, issuer.publicKey, null, 6, undefined, undefined, TOKEN_2022_PROGRAM_ID)
  const maturity = Math.floor(Date.now() / 1000) + maturitySeconds
  const { Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js')
  const prepared = await chain.prepare(bondMint.toBase58(), issuer.publicKey.toBase58(), 'initialize-bond', { settlementMint: settlementMint.toBase58(), faceValue: '1000000000', couponBps: 1000, frequency: 2, maturity, outstanding: '17' })
  await sendAndConfirmTransaction(connection, Transaction.from(Buffer.from(prepared.transaction, 'base64')), [issuer])
  const quantities = [10n, 5n, 2n]
  const bondAccounts = []
  const settlementAccounts = []
  for (let index = 0; index < investors.length; index++) {
    const bondAccount = await getOrCreateAssociatedTokenAccount(connection, issuer, bondMint, investors[index].publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID)
    const settlementAccount = await getOrCreateAssociatedTokenAccount(connection, issuer, settlementMint, investors[index].publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID)
    await mintTo(connection, issuer, bondMint, bondAccount.address, issuer, quantities[index], [], undefined, TOKEN_2022_PROGRAM_ID)
    bondAccounts.push(bondAccount.address)
    settlementAccounts.push(settlementAccount.address)
  }
  await setAuthority(connection, issuer, bondMint, issuer, AuthorityType.MintTokens, null, [], undefined, TOKEN_2022_PROGRAM_ID)
  const cash = await getOrCreateAssociatedTokenAccount(connection, issuer, settlementMint, issuer.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID)
  await mintTo(connection, issuer, settlementMint, cash.address, issuer, 20000n * 1000000n, [], undefined, TOKEN_2022_PROGRAM_ID)
  const config = { rpc, network, programId, bondMint: bondMint.toBase58(), settlementMint: settlementMint.toBase58(), maturity, investors: investors.map((wallet, index) => ({ label: ['A', 'B', 'C'][index], address: wallet.publicKey.toBase58(), quantity: quantities[index].toString() })) }
  await writeFile(new URL('config.json', directory), JSON.stringify(config, null, 2))
  return { issuer, investors, connection, chain, bondMint, settlementMint, bondAccounts, settlementAccounts, config }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const idl = JSON.parse(await readFile(new URL('../../backend/idl/kase_bond.json', import.meta.url)))
  const network = process.env.BOND_NETWORK || 'localnet'
  if (network !== 'localnet' && !process.argv.includes('--public')) throw new Error('Public transactions require --public and ISSUER_KEYPAIR')
  const result = await setup({ rpc: process.env.BOND_RPC_URL, network, programId: process.env.BOND_PROGRAM_ID || new PublicKey(idl.address).toBase58(), maturitySeconds: Number(process.env.DEMO_MATURITY_SECONDS || 180), issuerFile: process.env.ISSUER_KEYPAIR })
  console.log(JSON.stringify(result.config, null, 2))
  console.log(`Demo keypairs are private files in contracts/${network === 'devnet' ? '.devnet' : '.demo'}/. Never publish or fund them with real assets.`)
}
