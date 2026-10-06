import bs58 from 'bs58'

export const APP = 'solana-token-voting'

export async function verifyReceipt ({ data, address, signature } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof address !== 'string' || typeof signature !== 'string' || !/^(0x)?[a-f0-9]{128}$/i.test(signature)) throw new Error('Invalid IPFS receipt format')
  const bytes = bs58.decode(address)
  if (bytes.length !== 32) throw new Error('Invalid Solana address')
  const key = await crypto.subtle.importKey('raw', bytes, 'Ed25519', false, ['verify'])
  const signed = Uint8Array.from(signature.replace(/^0x/i, '').match(/../g), byte => parseInt(byte, 16))
  return crypto.subtle.verify('Ed25519', key, signed, new TextEncoder().encode(signingText(data)))
}

export function signingText (data) {
  const { logo, ...signed } = data
  return JSON.stringify(signed)
}

export function signatureHex (bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function formatAmount (raw, decimals) {
  const digits = BigInt(raw).toString().padStart(decimals + 1, '0')
  if (!decimals) return digits
  const fraction = digits.slice(-decimals).replace(/0+$/, '')
  return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : '')
}
