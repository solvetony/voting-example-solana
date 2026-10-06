import { identifier, cid, fail } from '../lib/validation.js'
import { formatAmount } from '../lib/signing.js'

export default async function (app) {
  const { required, receipt, storage } = app
  app.get('/voting-api/spaces/:space/proposals/:proposal', async request => {
    const space = await required(`spaces/${identifier(request.params.space)}.json`)
    const proposal = await required(`proposals/${space.data.id}/${cid(request.params.proposal)}.json`)
    const totals = proposal.data.choices.map(() => 0n)
    let cursor
    let count = 0
    do {
      const page = await storage.list(`votes/${space.data.id}/${proposal.cid}/`, cursor)
      for (const vote of page.items) {
        totals[vote.data.choices[0]] += BigInt(vote.weightRaw)
        count++
      }
      cursor = page.cursor
      if (count > 10000) fail('This example supports up to 10,000 votes per proposal', 503)
    } while (cursor)
    const decimals = space.tokenInfo.decimals
    return {
      ...receipt(proposal),
      voteCount: count,
      results: totals.map((raw, index) => ({ choice: proposal.data.choices[index], weightRaw: raw.toString(), weight: formatAmount(raw, decimals) }))
    }
  })
}
