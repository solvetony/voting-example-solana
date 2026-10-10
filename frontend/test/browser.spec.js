import { test, expect } from '@playwright/test'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { transformWithOxc } from 'vite'
import { ConnectedStandardSolanaWallet } from '@privy-io/js-sdk-core'
import bs58 from 'bs58'
import { getCompiledTransactionMessageDecoder, getTransactionDecoder, getTransactionEncoder } from '@solana/kit'
import { signingText, verifyReceipt } from '../src/signing.js'

const mint = 'FLUXBmPhT3Fd1EDVFdg46YREqHBeNypn1h4EbnTzWERX'

test('devnet is disclosed and token and historical block links use devnet explorers', async ({ page }) => {
  await page.route('**/voting-api/status', route => route.fulfill({ json: { storageReady: true, indexReady: true, solanaNetwork: 'devnet' } }))
  await page.route(`**/voting-api/spaces/${space.data.id}`, route => route.fulfill({ json: { ...space, solanaNetwork: 'devnet' } }))
  await page.route('**/voting-api/solana/slot-timestamp/*', route => route.fulfill({ json: { slot: proposal.data.snapshotHeights.solana, timestamp: '2026-10-10T00:00:00.000Z', timestampSlot: proposal.data.snapshotHeights.solana, resolution: 'exact', solanaNetwork: 'devnet' } }))
  await page.goto(`/#/spaces/${space.data.id}`)
  await expect(page.getByText('Devnet demonstration. Tokens and settlement have no real monetary value.')).toBeVisible()
  await expect(page.locator('.space-facts a').first()).toHaveAttribute('href', `https://solscan.io/token/${mint}?cluster=devnet`)
  await page.goto(`/#/spaces/${space.data.id}/proposals/${proposalId}`)
  await expect(page.locator('.snapshot-time a')).toHaveAttribute('href', `https://solscan.io/block/${proposal.data.snapshotHeights.solana}?cluster=devnet`)
})

for (const role of ['issuer', 'investor']) {
  test(`Bonds ${role} controls distinguish historical coupons from escrow principal`, async ({ page }, testInfo) => {
    const issuer = '11111111111111111111111111111111'
    const address = role === 'issuer' ? issuer : mint
    let claimed = false
    let couponFunded = role === 'investor'
    let submittedOperation
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/src/wallet.jsx', route => route.fulfill({
      contentType: 'text/javascript',
      body: `import { createContext, h } from '/node_modules/.vite/deps/preact.js'
        import { useContext } from '/node_modules/.vite/deps/preact_hooks.js'
        const value = { ready: true, address: '${address}', wallets: [{ address: '${address}' }], select () {}, login () {}, logout () {}, async sign (data) { return { address: '${address}', data } }, async signTransaction (encoded) { window.preparedBondTransaction = encoded; return 'signed-by-wallet' } }
        const context = createContext(value)
        export const useWallet = () => useContext(context)
        export default function Provider ({ children }) { return h(context.Provider, { value }, children) }
        export const DisconnectedProvider = Provider`
    }))
    await page.route('**/voting-api/bonds**', async route => {
      const path = new URL(route.request().url()).pathname
      let data
      if (path.endsWith('/config')) data = { ready: true, network: 'localnet', demoSettlement: true }
      else if (path.endsWith('/transactions')) {
        const envelope = route.request().postDataJSON()
        expect(envelope.address).toBe(address)
        expect(envelope.data.operation).toBe(role === 'issuer' ? 'fund-coupon' : 'claim-coupon')
        if (role === 'issuer') expect(envelope.data.args.amount).toBe('750000000')
        submittedOperation = envelope.data.operation
        data = { intent: 'intent', transaction: 'unsigned-by-server', network: 'localnet' }
      } else if (path.endsWith('/submit')) {
        const envelope = route.request().postDataJSON()
        expect(envelope.data.transaction).toBe('signed-by-wallet')
        expect(envelope.data.intent).toBe('intent')
        if (role === 'issuer') couponFunded = true
        else claimed = true
        data = { signature: 'confirmed-demo-signature', operation: submittedOperation }
      } else if (path.includes('/coupons/')) data = { manifest: { recordSlot: 100, recordTimestamp: '2026-10-09T00:00:00Z', timestampSlot: 99, slotResolution: 'previous-block', totalLiability: '850000000' }, manifestCid: proposalId, manifestUrl: 'https://ipfs.4everland.io/ipfs/' + proposalId, action: { finalized: role === 'investor' }, vaultBalance: couponFunded ? '850000000' : '100000000', entitlement: { quantity: '10', entitlement: '500000000' }, claim: claimed ? { amount: '500000000' } : null }
      else data = { data: { name: 'Kazakhstan Demo Bond', symbol: 'KDB26' }, bond: { issuer, mint, faceValue: '1000000000', couponBps: 1000, frequency: 2, maturity: Math.floor(Date.now() / 1000) + 3600, network: 'localnet' }, supply: '17', issuanceSealed: true, currentBalance: '9', holders: [{ investor: mint, label: 'A' }], coupons: [{ data: { id: 'coupon-001' } }], votingSpace: null, voteResults: [], transactions: [], position: { locked: '10', redeemed: '0' }, redemption: { cutoff: Math.floor(Date.now() / 1000) + 1800, locked: '17', escrowBalance: '17', redeemed: '0', unredeemed: '17', unlocked: '0', settled: '0', remainingLiability: '17000000000', vaultBalance: '17000000000', finalized: false } }
      await route.fulfill({ json: data })
    })
    await page.goto(`/#/bonds/${mint}`)
    await expect(page.getByRole('heading', { name: 'Kazakhstan Demo Bond' })).toBeVisible()
    await expect(page.getByText('Coupon entitlement is determined by historical record-date ownership', { exact: false })).toBeVisible()
    await expect(page.getByText('Principal entitlement is determined by bonds actually locked in escrow', { exact: false })).toBeVisible()
    await expect(page.locator('dt').filter({ hasText: 'Your current bond balance' }).locator('+ dd')).toHaveText('9')
    await expect(page.locator('dt').filter({ hasText: 'Your historical bond quantity' }).locator('+ dd')).toHaveText('10')
    await expect(page.locator('dt').filter({ hasText: 'Your coupon' }).locator('+ dd')).toHaveText('500 DEMOUSD')
    await expect(page.locator('dt').filter({ hasText: 'Your unredeemed principal' }).locator('+ dd')).toHaveText('10000 DEMOUSD')
    await expect(page.getByRole('button', { name: 'Register holder' })).toHaveCount(role === 'issuer' ? 1 : 0)
    if (role === 'investor') {
      await page.getByRole('button', { name: 'Claim historical coupon' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Confirmed: claim-coupon' })).toBeVisible()
      expect(await page.evaluate(() => window.preparedBondTransaction)).toBe('unsigned-by-server')
      await expect(page.getByRole('button', { name: 'Claim historical coupon' })).toBeDisabled()
    } else {
      await expect(page.getByRole('button', { name: 'Fund principal liability' })).toBeDisabled()
      await page.getByRole('button', { name: 'Fund coupon liability' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Confirmed: fund-coupon' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Fund coupon liability' })).toBeDisabled()
    }
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark mode' }).click()
      await page.screenshot({ path: testInfo.outputPath(`bonds-${role}-${theme}.png`), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    expect(errors).toEqual([])
  })
}

for (const [walletName, network] of [['Phantom', 'mainnet-beta'], ['Solflare', 'mainnet-beta'], ['Phantom', 'devnet'], ['Solflare', 'devnet']]) {
  test(`${walletName} ${network} account changes reconnect and produce a valid vote signature`, async ({ page }) => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const newAddress = bs58.encode(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32))
    const account = { address: newAddress, publicKey: bs58.decode(newAddress), chains: [network === 'devnet' ? 'solana:devnet' : 'solana:mainnet'], features: ['solana:signMessage'] }
    const connected = new ConnectedStandardSolanaWallet({
      account,
      wallet: {
        name: walletName,
        accounts: [account],
        features: {
          'solana:signMessage': {
            version: '1.0.0',
            async signMessage (input) {
              expect(input.account.address).toBe(newAddress)
              return [{ signedMessage: input.message, signature: new Uint8Array(sign(null, input.message, privateKey)) }]
            }
          }
        }
      }
    })
    await page.route('**/test-sign', async route => {
      const { address, message } = route.request().postDataJSON()
      expect(address).toBe(connected.address)
      const signed = await connected.signMessage({ message: new Uint8Array(message) })
      await route.fulfill({ json: { signature: Array.from(signed.signature) } })
    })
    const originalLoginMessage = `${newAddress}\nChain ID: mainnet\nNonce: test-nonce\nURI: http://127.0.0.1:5173`
    await page.route('**/test-sign-transaction', async route => {
      const { transaction: bytes, chain } = route.request().postDataJSON()
      expect(chain).toBe('solana:devnet')
      const transaction = getTransactionDecoder().decode(new Uint8Array(bytes))
      const signed = { ...transaction, signatures: { ...transaction.signatures, [newAddress]: new Uint8Array(sign(null, transaction.messageBytes, privateKey)) } }
      await route.fulfill({ json: { signedTransaction: Array.from(getTransactionEncoder().encode(signed)) } })
    })
    let loginMessage
    await page.route('**/voting-api/status', route => route.fulfill({ json: { storageReady: true, indexReady: true, solanaNetwork: network } }))
    await page.route('**/test-login', async route => {
      const { message, signature, messageType } = route.request().postDataJSON()
      expect(messageType).toBe('transaction')
      const transaction = getTransactionDecoder().decode(Buffer.from(message, 'base64'))
      const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
      expect(compiled.instructions).toHaveLength(1)
      expect(compiled.staticAccounts[compiled.instructions[0].programAddressIndex]).toBe('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
      expect(new TextDecoder().decode(compiled.instructions[0].data)).toBe(originalLoginMessage)
      expect(compiled.lifetimeToken).toBe('GfVcyD5fWFJ6hRm8bsy7CoVPsLSoJhtJKRJYk8T2VVFN')
      expect(verify(null, transaction.messageBytes, publicKey, Buffer.from(signature, 'base64'))).toBe(true)
      expect(Buffer.from(transaction.signatures[newAddress])).toEqual(Buffer.from(signature, 'base64'))
      loginMessage = message
      await route.fulfill({ json: { success: true } })
    })
    let submitted
    await page.route('**/voting-api/**/votes', async route => {
      submitted = route.request().postDataJSON()
      expect(submitted.address).toBe(newAddress)
      expect(submitted.data.realVoter).toBe(newAddress)
      expect(await verifyReceipt(submitted)).toBe(true)
      await route.fulfill({ json: { ...submitted, cid: proposalId } })
    })
    const main = await page.request.get('/src/main.jsx').then(response => response.text())
    const dependencyVersion = main.match(/preact\.js\?v=([^"']+)/)?.[1]
    const versionModules = code => code.replace(/(\/node_modules\/\.vite\/deps\/preact(?:_hooks)?\.js)/g, `$1?v=${dependencyVersion}`)
    const wallet = await readFile(new URL('../src/wallet.jsx', import.meta.url), 'utf8')
    const transformed = await transformWithOxc(wallet.replace('import.meta.env.VITE_PRIVY_APP_ID', "'test-app'"), 'wallet.jsx', { jsx: { runtime: 'classic', pragma: 'h', pragmaFrag: 'Fragment' } })
    const walletModule = "import { h, Fragment } from '/node_modules/.vite/deps/preact.js'\n" + transformed.code.replaceAll('"preact"', '"/node_modules/.vite/deps/preact.js"').replaceAll('"preact/hooks"', '"/node_modules/.vite/deps/preact_hooks.js"').replaceAll('"@privy-io/react-auth"', '"/test-privy.jsx"').replaceAll('"@privy-io/react-auth/solana"', '"/test-solana.jsx"').replaceAll('"bs58"', '"/node_modules/.vite/deps/bs58.js"')
    await page.route('**/src/main.jsx', route => route.fulfill({ contentType: 'text/javascript', body: main.replace(/const Provider = .*;/, 'const Provider = WalletProvider;') }))
    await page.route('**/src/wallet.jsx', route => route.fulfill({ contentType: 'text/javascript', body: versionModules(walletModule) }))
    await page.route('**/test-privy.jsx', route => route.fulfill({
      contentType: 'text/javascript',
      body: versionModules(`import { createContext, h } from '/node_modules/.vite/deps/preact.js'
      import { useContext, useState } from '/node_modules/.vite/deps/preact_hooks.js'
      const context = createContext({})
      export const usePrivy = () => useContext(context)
      export function useConnectWallet (callbacks) {
        return { async connectWallet () {
          window.reconnectWallet()
          await callbacks.onSuccess({ wallet: { address: '${newAddress}', type: 'solana', walletClientType: '${walletName.toLowerCase()}', connectorType: 'solana_adapter', provider: { async signMessage () { throw new Error('Login must not use signMessage') }, async signTransaction ({ transaction, chain }) {
            const response = await fetch('/test-sign-transaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction: Array.from(transaction), chain }) })
            return { signedTransaction: new Uint8Array((await response.json()).signedTransaction) }
          } } } })
        } }
      }
      export function useLoginWithSiws () {
        const value = useContext(context)
        return { async generateSiwsMessage () { return ${JSON.stringify(originalLoginMessage)} }, async loginWithSiws (body) {
          await fetch('/test-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          value.authenticate()
        } }
      }
      export function PrivyProvider ({children}) {
        const [authenticated, setAuthenticated] = useState(true)
        return h(context.Provider, {value: { ready: true, authenticated, authenticate () { setAuthenticated(true) }, login () { if (authenticated) throw new Error('Already logged in'); setAuthenticated(true) }, connectWallet () { window.reconnectWallet() }, async logout () { window.privyLoggedOut = true; setAuthenticated(false) } }}, children)
      }`)
    }))
    await page.route('**/test-solana.jsx', route => route.fulfill({
      contentType: 'text/javascript',
      body: versionModules(`import { useState } from '/node_modules/.vite/deps/preact_hooks.js'
      const initial = [{ address: '${mint}', standardWallet: { name: '${walletName}' }, async disconnect () { window.walletDisconnected = true } }]
      export function useWallets () {
        const [wallets, setWallets] = useState(initial)
        window.switchWalletAccount = () => setWallets([])
        window.reconnectWallet = () => setWallets([{ address: '${newAddress}', standardWallet: { name: '${walletName}' }, async disconnect () {} }])
        return { wallets }
      }
      export const useSignMessage = () => ({ async signMessage ({ wallet, message }) {
        window.signedBy = wallet.address
        const response = await fetch('/test-sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: wallet.address, message: Array.from(message) }) })
        const result = await response.json()
        return { signature: new Uint8Array(result.signature) }
      } })
        export const useSignTransaction = () => ({})
      export const toSolanaWalletConnectors = () => []`)
    }))
    await page.goto('/')
    await expect(page.getByRole('combobox', { name: 'Selected Solana wallet' })).toBeVisible()
    await page.getByRole('button', { name: 'Disconnect wallet' }).click()
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Selected Solana wallet' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => window.walletDisconnected && window.privyLoggedOut)).toBe(true)
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Selected Solana wallet' })).toBeVisible()
    await page.evaluate(() => window.switchWalletAccount())
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Selected Solana wallet' })).toHaveValue(newAddress)
    await page.goto(`/#/spaces/${space.data.id}/proposals/${proposalId}`)
    await page.getByRole('radio', { name: 'For', exact: true }).check()
    await page.getByRole('button', { name: 'Sign & vote', exact: true }).click()
    await expect(page.getByText('Your vote is recorded.')).toBeVisible()
    expect(await page.evaluate(() => window.signedBy)).toBe(newAddress)
    expect(submitted).toBeDefined()
    if (network === 'devnet') expect(loginMessage).toBeDefined()
    else expect(loginMessage).toBeUndefined()
  })
}
const proposalId = 'bafy' + 'a'.repeat(60)
const space = {
  data: { id: 'fluxbot', name: 'FluxBot community', description: 'A shared space for the FluxBot community to decide what comes next.', token: mint },
  address: mint,
  tokenInfo: { symbol: 'FLUXB', decimals: 5 },
  cid: 'bafy' + 'b'.repeat(60)
}
const proposal = {
  data: {
    title: 'Fund community tooling?',
    content: 'Should the community support the next release of open-source tools?\n\nThe proposal allocates time to documentation and token-holder utilities.',
    choices: ['For', 'Against'],
    startDate: Math.floor(Date.now() / 1000) - 60,
    endDate: Math.floor(Date.now() / 1000) + 86400,
    snapshotHeights: { solana: 421609847 }
  },
  cid: proposalId,
  address: mint,
  voteCount: 12,
  results: [{ choice: 'For', weightRaw: '750000', weight: '7.5' }, { choice: 'Against', weightRaw: '250000', weight: '2.5' }]
}

for (const outcome of ['valid', 'invalid', 'unavailable']) {
  test(`receipt dialog handles ${outcome} signatures in both themes`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedReceiptValue = value } } })
    })
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const data = { app: 'solana-token-voting', action: 'proposal:create', title: 'Signed proposal', logo: 'unsigned logo' }
    const envelope = {
      data,
      address: bs58.encode(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)),
      signature: sign(null, Buffer.from(signingText(data)), privateKey).toString('hex')
    }
    if (outcome === 'invalid') data.title = 'Tampered proposal'
    await page.route(`https://ipfs.4everland.io/ipfs/${proposalId}`, route => outcome === 'unavailable' ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.fulfill({ json: envelope }))
    await page.goto(`/#/spaces/${space.data.id}/proposals/${proposalId}`)
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark mode' }).click()
      await page.getByRole('button', { name: 'Validate signed receipt' }).click()
      const dialog = page.getByRole('dialog', { name: 'Receipt validation' })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(outcome === 'unavailable' ? 'Failed to load IPFS receipt' : `Signature is ${outcome}`)
      await expect(dialog.getByRole('link', { name: 'Open IPFS receipt' })).toHaveAttribute('href', `https://ipfs.4everland.io/ipfs/${proposalId}`)
      await expect(dialog.getByRole('link', { name: 'Open IPFS receipt' })).toHaveText(`https://ipfs.4everland.io/ipfs/${proposalId}`)
      if (outcome !== 'unavailable') {
        await expect(dialog.getByRole('button', { name: /^Copy / })).toHaveCount(2)
        await expect(dialog.locator('.receipt-value').filter({ hasText: 'Signature' })).toContainText(envelope.address)
        for (const [label, value] of [['Message', signingText(data)], ['Signature', envelope.signature]]) {
          await dialog.getByRole('button', { name: `Copy ${label}`, exact: true }).click()
          expect(await page.evaluate(() => window.copiedReceiptValue)).toBe(value)
        }
      }
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
  })
}

test.beforeEach(async ({ page }) => {
  await page.route('**/voting-api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data
    if (path === '/voting-api/solana/slot') data = { slot: 421609847 }
    else if (path.includes('/solana/slot-timestamp/')) data = { slot: Number(path.split('/').at(-1)), timestamp: '2020-11-21T01:26:24.000Z', timestampSlot: 50416163, resolution: 'previous-block' }
    else if (path.includes('/solana/token-info/')) data = { ...space.tokenInfo, name: 'FluxBot' }
    else if (path.includes('/solana/token-balance/')) data = { balanceRaw: '750000', decimals: 5 }
    else if (path.endsWith('/status')) data = { storageReady: true, indexReady: true }
    else if (path === '/voting-api/spaces') data = { items: [space], cursor: null }
    else if (path.endsWith('/proposals')) data = { items: [proposal], cursor: null }
    else if (path.includes('/proposals/')) data = proposal
    else data = space
    await route.fulfill({ json: data })
  })
})

test('spaces, proposals, and results work without a browser API key', async ({ page }, testInfo) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: space.data.name })).toBeVisible()
  await expect(page.getByText('1 space', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search spaces' }).fill('not-found')
  await expect(page.getByRole('heading', { name: 'No matching spaces' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search spaces' }).fill('')
  await page.screenshot({ path: testInfo.outputPath('spaces.png'), fullPage: true })
  await page.getByRole('heading', { name: space.data.name }).click()
  await expect(page.getByRole('heading', { name: proposal.data.title })).toBeVisible()
  await page.getByRole('heading', { name: proposal.data.title }).click()
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible()
  await expect(page.getByText('75%', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Previous block #50,416,163' })).toHaveAttribute('href', 'https://solscan.io/block/50416163')
  await expect(page.locator('.snapshot-time')).toContainText('2020-11-21T01:26:24.000Z')
  await expect(page.getByRole('radio', { name: 'For', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('proposal.png'), fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
  await expect(page.getByRole('button', { name: 'Solana Index API connection' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('light defaults, dark persists, and all public views and dialogs fit', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('textbox', { name: 'Search spaces' }).fill(mint)
  await expect(page.getByRole('heading', { name: space.data.name })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.getByRole('textbox', { name: 'Search spaces' })).toHaveValue('')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: testInfo.outputPath('spaces-dark.png'), fullPage: true })
  await page.getByRole('heading', { name: space.data.name }).click()
  await page.screenshot({ path: testInfo.outputPath('space-dark.png'), fullPage: true })
  await page.getByRole('heading', { name: proposal.data.title }).click()
  await page.screenshot({ path: testInfo.outputPath('proposal-dark.png'), fullPage: true })
  await page.getByRole('button', { name: 'Refresh results' }).click()
  await expect(page.getByText('75%', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Previous block #50,416,163' })).toHaveAttribute('href', 'https://solscan.io/block/50416163')
  await expect(page.locator('.snapshot-time')).toContainText('2020-11-21T01:26:24.000Z')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('connected wallet selection, create dialogs, and long content fit both themes', async ({ page }, testInfo) => {
  const lookupHeaders = []
  page.on('request', request => {
    if (request.url().includes('/voting-api/solana/')) lookupHeaders.push(request.headers())
  })
  await page.route('**/src/wallet.jsx', route => route.fulfill({
    contentType: 'text/javascript',
    body: `import { createContext, h } from '/node_modules/.vite/deps/preact.js'
      import { useState, useContext } from '/node_modules/.vite/deps/preact_hooks.js'
      const context = createContext({})
      export function useWallet () { return useContext(context) }
      export default function Provider ({children}) {
        const [address, select] = useState('${mint}')
        return h(context.Provider, {value: { ready: true, address, select, wallets: [{address: '${mint}'}, {address: '11111111111111111111111111111111'}], login () {}, logout () {} }}, children)
      }
      export const DisconnectedProvider = Provider`
  }))
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Selected Solana wallet' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Selected Solana wallet' }).selectOption('11111111111111111111111111111111')
  await expect(page.getByRole('combobox', { name: 'Selected Solana wallet' })).toHaveValue('11111111111111111111111111111111')
  await page.getByRole('combobox', { name: 'Selected Solana wallet' }).selectOption(mint)
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark mode' }).click()
    await page.getByRole('button', { name: 'Create space', exact: true }).click()
    await page.getByLabel('Space name', { exact: true }).fill('A'.repeat(100))
    await page.getByLabel('Solana token address').fill(mint)
    await page.getByRole('button', { name: 'Look up token' }).click()
    await expect(page.getByText('FluxBot · FLUXB · 5 decimals', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`create-space-${theme}.png`) })
    expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await page.getByRole('heading', { name: space.data.name }).click()
    await page.getByRole('button', { name: 'New proposal', exact: true }).click()
    await page.getByLabel('Title', { exact: true }).fill('A'.repeat(160))
    await page.getByRole('button', { name: 'Current slot', exact: true }).click()
    await expect(page.getByRole('spinbutton')).toHaveValue('421609847')
    await page.getByRole('button', { name: 'Add choice' }).click()
    await expect(page.getByLabel('Choice 3', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`new-proposal-${theme}.png`) })
    expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await page.getByRole('link', { name: 'All spaces', exact: true }).click()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('heading', { name: space.data.name }).click()
  await page.getByRole('heading', { name: proposal.data.title }).click()
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.locator('.power-row')).toContainText('7.5 FLUXB')
  expect(lookupHeaders.length).toBeGreaterThanOrEqual(5)
  expect(lookupHeaders.every(headers => !headers.authorization)).toBe(true)
  await page.setViewportSize({ width: 320, height: 740 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('long spaces, pagination, and zero results remain readable', async ({ page }, testInfo) => {
  const longSpace = { ...space, data: { ...space.data, name: 'Community'.repeat(11), description: 'Token governance '.repeat(80) }, tokenInfo: { ...space.tokenInfo, symbol: 'TOKEN'.repeat(12) } }
  await page.route('**/voting-api/spaces**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/voting-api/spaces') {
      return route.fulfill({ json: url.search ? { items: [{ ...space, data: { ...space.data, id: 'second-space', name: 'Second space' } }], cursor: null } : { items: [longSpace], cursor: 'next' } })
    }
    if (url.pathname.includes('/proposals/')) return route.fulfill({ json: { ...proposal, data: { ...proposal.data, title: 'Proposal'.repeat(22) }, voteCount: 0, results: proposal.results.map(result => ({ ...result, weightRaw: '0', weight: '0' })) } })
    if (url.pathname.endsWith('/proposals')) return route.fulfill({ json: { items: [proposal], cursor: null } })
    return route.fulfill({ json: longSpace })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(page.getByText('2 spaces', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Second space' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('heading', { name: longSpace.data.name }).click()
  await page.getByRole('heading', { name: proposal.data.title }).click()
  await expect(page.getByText('0%', { exact: true })).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('long-proposal.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
