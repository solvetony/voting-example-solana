import { render } from 'preact'
import App from './app.jsx'
import WalletProvider, { DisconnectedProvider } from './wallet.jsx'
import './style.css'

const Provider = import.meta.env.VITE_PRIVY_APP_ID ? WalletProvider : DisconnectedProvider
render(<Provider><App /></Provider>, document.getElementById('app'))
