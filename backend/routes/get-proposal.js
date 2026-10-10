import { identifier, cid } from '../lib/validation.js'
import { tallyVotes } from '../lib/vote-tally.js'

export default async function (app) {
  const { required, receipt, storage } = app
  app.get('/voting-api/spaces/:space/proposals/:proposal', async request => {
    const space = await required(`spaces/${identifier(request.params.space)}.json`)
    const proposal = await required(`proposals/${space.data.id}/${cid(request.params.proposal)}.json`)
    const { voteCount, results } = await tallyVotes(storage, space.data.id, proposal, space.tokenInfo.decimals)
    return {
      ...receipt(proposal),
      voteCount,
      results
    }
  })
}
