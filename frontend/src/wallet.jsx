import { createContext } from 'preact'
import { useContext, useRef, useState } from 'preact/hooks'
import { PrivyProvider, useConnectWallet, useLoginWithSiws, usePrivy } from '@privy-io/react-auth'
import { toSolanaWalletConnectors, useSignMessage, useSignTransaction, useWallets } from '@privy-io/react-auth/solana'
import { APP, signingText, signatureHex } from './signing.js'
import { request } from './api.js'
import { loginSignature, loginTransaction } from './login-transaction.js'

const WalletContext = createContext({ ready: false, wallets: [], address: '', login () {}, logout () {} })
export const useWallet = () => useContext(WalletContext)

function WalletBridge ({ children }) {
  const { ready, authenticated, login: privyLogin, connectWallet, logout: privyLogout } = usePrivy()
  const { wallets } = useWallets()
  const { signMessage } = useSignMessage()
  const { signTransaction: signSolanaTransaction } = useSignTransaction()
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const network = useRef('mainnet-beta')
  const { generateSiwsMessage, loginWithSiws } = useLoginWithSiws()
  const { connectWallet: connectForLogin } = useConnectWallet({
    async onSuccess ({ wallet }) {
      if (authenticated || network.current !== 'devnet') return
      try {
        if (wallet.type !== 'solana') throw new Error('Connect a Solana wallet')
        const message = await generateSiwsMessage({ address: wallet.address })
        const transaction = loginTransaction(message, wallet.address)
        const { signedTransaction } = await wallet.provider.signTransaction({ transaction, chain: 'solana:devnet' })
        await loginWithSiws({ message: btoa(String.fromCharCode(...signedTransaction)), signature: loginSignature(signedTransaction, wallet.address), walletClientType: wallet.walletClientType, connectorType: wallet.connectorType, messageType: 'transaction' })
        setSelected(wallet.address)
      } catch (error) { setError(error.message || 'Wallet login failed') }
    },
    onError (error) { setError(String(error)) }
  })
  const wallet = authenticated ? wallets.find(wallet => wallet.address === selected) || wallets[0] : undefined

  async function login () {
    setError('')
    if (authenticated) return connectWallet()
    try {
      const status = await request('/voting-api/status', null, AbortSignal.timeout(15000))
      network.current = status.solanaNetwork
      if (status.solanaNetwork === 'devnet') connectForLogin()
      else privyLogin()
    } catch (error) { setError(error.message || 'Wallet login failed') }
  }

  async function logout () {
    setError('')
    const results = await Promise.allSettled(wallets.map(wallet => wallet.disconnect()))
    try {
      await privyLogout()
      setSelected('')
      if (results.some(result => result.status === 'rejected')) setError('Wallet disconnect failed. Disconnect this site in your wallet extension.')
    } catch { setError('Logout failed. Please try again.') }
  }

  async function sign (value) {
    if (!wallet || !authenticated) throw new Error('Connect your Solana wallet first')
    const data = { ...value, app: APP, timestamp: Math.floor(Date.now() / 1000) }
    const signed = await signMessage({ message: new TextEncoder().encode(signingText(data)), wallet })
    return { data, address: wallet.address, signature: signatureHex(signed.signature) }
  }
  async function signTransaction (encoded, network) {
    if (!wallet || !authenticated) throw new Error('Connect your Solana wallet first')
    const transaction = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const chain = network === 'mainnet-beta' ? 'solana:mainnet' : network === 'devnet' ? 'solana:devnet' : undefined
    const result = await signSolanaTransaction({ transaction, wallet, ...(chain ? { chain } : {}) })
    return btoa(String.fromCharCode(...result.signedTransaction))
  }
  return (
    <WalletContext.Provider value={{ ready, authenticated, wallets, address: wallet?.address || '', error, select: setSelected, login, logout, sign, signTransaction }}>
      {children}
    </WalletContext.Provider>
  )
}

export default function WalletProvider ({ children }) {
  return (
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID}
      config={{
        loginMethods: ['wallet'],
        appearance: { theme: 'light', accentColor: '#00647c', walletChainType: 'solana-only' },
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
        embeddedWallets: { solana: { createOnLogin: 'off' } },
        loginMessage: 'Connect your Solana wallet to create proposals and vote.'
      }}
    >
      <WalletBridge>{children}</WalletBridge>
    </PrivyProvider>
  )
}

export function DisconnectedProvider ({ children }) {
  return <WalletContext.Provider value={{ ready: false, wallets: [], address: '', login () {}, logout () {} }}>{children}</WalletContext.Provider>
}
