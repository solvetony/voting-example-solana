import { fail } from './validation.js'

export function createSolanaIndex (key = process.env.SOLANA_INDEX_API_KEY) {
  return async function query (path) {
    if (!key) fail('Solana Index API key is not configured', 503)
    const response = await fetch(`https://solanaindex.top/api/v1/solana/${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
      redirect: 'error'
    })
    let size = 0
    const chunks = []
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 256 * 1024) fail('Solana Index response too large', 502)
      chunks.push(chunk)
    }
    let data
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('Invalid Solana Index response', 502) }
    if (!response.ok) fail(data.message || data.error || 'Solana Index unavailable', response.status === 429 ? 429 : 502)
    return data
  }
}
