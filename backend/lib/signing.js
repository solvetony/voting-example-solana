export const APP = 'solana-token-voting'

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
