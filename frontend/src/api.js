export async function request (path, body, signal) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Request failed')
  return data
}

export function solanaIndex (path) {
  return request(`/voting-api/solana/${path}`, null, AbortSignal.timeout(15000))
}
