import { signedEnvelope, identifier, cid, fail } from '../lib/validation.js'

export default async function (app) {
  const { required, storage, query, save } = app
  app.post('/voting-api/spaces/:space/proposals/:proposal/votes', async request => {
    const space = await required(`spaces/${identifier(request.params.space)}.json`)
    const proposal = await required(`proposals/${space.data.id}/${cid(request.params.proposal)}.json`)
    const envelope = signedEnvelope(request.body, 'vote:create')
    const { data, address } = envelope
    if (data.space !== space.data.id || data.proposalCid !== proposal.cid || data.voterNetwork !== 'solana' || data.realVoter !== address) fail('Vote does not match this proposal')
    if (!Array.isArray(data.choices) || data.choices.length !== 1 || !Number.isInteger(data.choices[0]) || data.choices[0] < 0 || data.choices[0] >= proposal.data.choices.length) fail('Invalid choice')
    if (data.remark !== undefined && (typeof data.remark !== 'string' || data.remark.length > 1000)) fail('Invalid remark')
    const now = Date.now() / 1000
    if (now < proposal.data.startDate || now >= proposal.data.endDate) fail('Voting is not open', 409)
    const key = `votes/${space.data.id}/${proposal.cid}/${address}.json`
    if (await storage.get(key)) fail('This wallet has already voted', 409)
    const slot = proposal.data.snapshotHeights.solana
    const balance = await query(`token-balance/${address}/${space.data.token}/${slot}`)
    if (balance.address !== address || balance.token !== space.data.token || balance.slot !== slot || balance.decimals !== space.tokenInfo.decimals || typeof balance.balanceRaw !== 'string' || !/^\d{1,80}$/.test(balance.balanceRaw)) fail('Invalid voting power response', 502)
    if (BigInt(balance.balanceRaw) === 0n) fail('No token balance at the snapshot slot', 403)
    if (Date.now() / 1000 >= proposal.data.endDate) fail('Voting has closed', 409)
    return save(key, envelope, { weightRaw: balance.balanceRaw, decimals: balance.decimals })
  })
}
