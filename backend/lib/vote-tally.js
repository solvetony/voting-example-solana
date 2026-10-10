import { fail } from './validation.js'
import { formatAmount } from './signing.js'

export async function tallyVotes (storage, space, proposal, decimals) {
  const totals = proposal.data.choices.map(() => 0n)
  const votes = []
  let cursor
  do {
    const page = await storage.list(`votes/${space}/${proposal.cid}/`, cursor)
    for (const vote of page.items) {
      totals[vote.data.choices[0]] += BigInt(vote.weightRaw)
      votes.push(vote)
    }
    cursor = page.cursor
    if (votes.length > 10000) fail('This example supports up to 10,000 votes per proposal', 503)
  } while (cursor)
  return { voteCount: votes.length, results: totals.map((raw, index) => ({ choice: proposal.data.choices[index], weightRaw: raw.toString(), weight: formatAmount(raw, decimals) })), votes }
}
