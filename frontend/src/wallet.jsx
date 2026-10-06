import { createContext } from 'preact'
import { useContext, useState } from 'preact/hooks'
import { PrivyProvider, usePrivy } from '@privy-io/react-auth'
import { toSolanaWalletConnectors, useSignMessage, useWallets } from '@privy-io/react-auth/solana'
import { APP, signingText, signatureHex } from './signing.js'

const WalletContext = createContext({ ready: false, wallets: [], address: '', login () {}, logout () {} })
export const useWallet = () => useContext(WalletContext)

function WalletBridge ({ children }) {
  const { ready, authenticated, login, logout } = usePrivy()
  const { wallets } = useWallets()
  const { signMessage } = useSignMessage()
  const [selected, setSelected] = useState('')
  const wallet = wallets.find(wallet => wallet.address === selected) || wallets[0]

  async function sign (value) {
    if (!wallet || !authenticated) throw new Error('Connect your Solana wallet first')
    const data = { ...value, app: APP, timestamp: Math.floor(Date.now() / 1000) }
    const signed = await signMessage({ message: new TextEncoder().encode(signingText(data)), wallet })
    return { data, address: wallet.address, signature: signatureHex(signed.signature) }
  }
  return (
    <WalletContext.Provider value={{ ready, authenticated, wallets, address: wallet?.address || '', select: setSelected, login, logout, sign }}>
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
