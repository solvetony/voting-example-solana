import { signedEnvelope, identifier, text, fail } from '../lib/validation.js'

export default async function (app) {
  const { required, query, save } = app
  app.post('/voting-api/spaces/:space/proposals', async request => {
    const space = await required(`spaces/${identifier(request.params.space)}.json`)
    const envelope = signedEnvelope(request.body, 'proposal:create')
    const { data, address } = envelope
    if (address !== space.address) fail('Only the space owner can create proposals', 403)
    if (data.space !== space.data.id || data.proposerNetwork !== 'solana' || data.realProposer !== address || JSON.stringify(data.networksConfig) !== JSON.stringify(space.data.networksConfig)) fail('Proposal does not match this space')
    text(data.title, 'title', 160)
    text(data.content, 'content', 12000)
    if (data.choiceType !== 'single' || data.contentType !== 'markdown' || !Array.isArray(data.choices) || data.choices.length < 2 || data.choices.length > 10) fail('Choose 2-10 single-choice options')
    for (const choice of data.choices) text(choice, 'choice', 100)
    if (new Set(data.choices.map(choice => choice.trim().toLowerCase())).size !== data.choices.length) fail('Choices must be unique')
    const now = Math.floor(Date.now() / 1000)
    if (!Number.isSafeInteger(data.startDate) || !Number.isSafeInteger(data.endDate) || data.startDate < now - 60 || data.endDate <= Math.max(now, data.startDate) || data.endDate > now + 180 * 86400) fail('Invalid voting dates')
    const slot = data.snapshotHeights?.solana
    if (!Number.isSafeInteger(slot) || slot < 1) fail('Invalid snapshot slot')
    const current = await query('slot')
    if (!Number.isSafeInteger(current.slot) || current.slot < 1) fail('Invalid current slot response', 502)
    if (slot > current.slot) fail('Snapshot slot cannot be in the future')
    return save(hash => `proposals/${space.data.id}/${hash}.json`, envelope)
  })
}
