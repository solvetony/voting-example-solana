import { createPublicKey, verify } from 'node:crypto'
import bs58 from 'bs58'
import { APP, signingText } from './signing.js'

export function fail (message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode })
}

export function publicKey (address) {
  try {
    if (typeof address !== 'string' || address.length > 44 || bs58.decode(address).length !== 32) throw new Error()
    return address
  } catch { fail('Invalid Solana address') }
}

export function identifier (value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{2,47}$/.test(value)) fail('Use 3-48 lowercase letters, numbers, or hyphens for the space ID')
  return value
}

export function cid (value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{20,128}$/.test(value)) fail('Invalid proposal ID')
  return value
}

export function text (value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Invalid ${label}`)
}

export function signedEnvelope (envelope, action, now = Date.now()) {
  const { data, address, signature } = envelope || {}
  publicKey(address)
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.app !== APP || data.action !== action) fail('Invalid signed action')
  if (!Number.isSafeInteger(data.timestamp) || Math.abs(now / 1000 - data.timestamp) > 600) fail('Signature expired; sign again')
  if (typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature)) fail('Invalid signature')
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(bs58.decode(address))]),
    format: 'der',
    type: 'spki'
  })
  if (!verify(null, Buffer.from(signingText(data)), key, Buffer.from(signature, 'hex'))) fail('Invalid signature')
  return { data, address, signature, version: '2' }
}
