import { test, expect } from '@playwright/test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { transformWithOxc } from 'vite'
import { ConnectedStandardSolanaWallet } from '@privy-io/js-sdk-core'
import bs58 from 'bs58'
import { signingText, verifyReceipt } from '../src/signing.js'

const mint = 'FLUXBmPhT3Fd1EDVFdg46YREqHBeNypn1h4EbnTzWERX'

for (const walletName of ['Phantom', 'Solflare']) {
  test(`${walletName} account changes reconnect and produce a valid vote signature`, async ({ page }) => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const newAddress = bs58.encode(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32))
    const account = { address: newAddress, publicKey: bs58.decode(newAddress), chains: ['solana:mainnet'], features: ['solana:signMessage'] }
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
    let submitted
    await page.route('**/voting-api/**/votes', async route => {
      submitted = route.request().postDataJSON()
      expect(submitted.address).toBe(newAddress)
      expect(submitted.data.realVoter).toBe(newAddress)
      expect(await verifyReceipt(submitted)).toBe(true)
      await route.fulfill({ json: { ...submitted, cid: proposalId } })
    })
    const main = await page.request.get('/src/main.jsx').then(response => response.text())
    const wallet = await readFile(new URL('../src/wallet.jsx', import.meta.url), 'utf8')
    const transformed = await transformWithOxc(wallet.replace('import.meta.env.VITE_PRIVY_APP_ID', "'test-app'"), 'wallet.jsx', { jsx: { runtime: 'classic', pragma: 'h', pragmaFrag: 'Fragment' } })
    const walletModule = "import { h, Fragment } from '/node_modules/.vite/deps/preact.js'\n" + transformed.code.replaceAll('"preact"', '"/node_modules/.vite/deps/preact.js"').replaceAll('"preact/hooks"', '"/node_modules/.vite/deps/preact_hooks.js"').replaceAll('"@privy-io/react-auth"', '"/test-privy.jsx"').replaceAll('"@privy-io/react-auth/solana"', '"/test-solana.jsx"')
    await page.route('**/src/main.jsx', route => route.fulfill({ contentType: 'text/javascript', body: main.replace(/const Provider = .*;/, 'const Provider = WalletProvider;') }))
    await page.route('**/src/wallet.jsx', route => route.fulfill({ contentType: 'text/javascript', body: walletModule }))
    await page.route('**/test-privy.jsx', route => route.fulfill({
      contentType: 'text/javascript',
      body: `import { createContext, h } from '/node_modules/.vite/deps/preact.js'
      import { useContext, useState } from '/node_modules/.vite/deps/preact_hooks.js'
      const context = createContext({})
      export const usePrivy = () => useContext(context)
      export function PrivyProvider ({children}) {
        const [authenticated, setAuthenticated] = useState(true)
        return h(context.Provider, {value: { ready: true, authenticated, login () { if (authenticated) throw new Error('Already logged in'); setAuthenticated(true) }, connectWallet () { window.reconnectWallet() }, async logout () { window.privyLoggedOut = true; setAuthenticated(false) } }}, children)
      }`
    }))
    await page.route('**/test-solana.jsx', route => route.fulfill({
      contentType: 'text/javascript',
      body: `import { useState } from '/node_modules/.vite/deps/preact_hooks.js'
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
      export const toSolanaWalletConnectors = () => []`
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
