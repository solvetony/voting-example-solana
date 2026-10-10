import { useEffect, useState } from 'preact/hooks'
import { request } from './api.js'
import { useWallet } from './wallet.jsx'
import { formatAmount } from './signing.js'
import { ArrowUpRight, RefreshCw } from 'lucide-preact'

function explorer (signature, network) {
  return `https://explorer.solana.com/tx/${signature}${network === 'mainnet-beta' ? '' : network === 'localnet' ? '?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899' : '?cluster=devnet'}`
}
function dollars (amount) {
  return `${formatAmount(amount || '0', 6)} DEMOUSD`
}
function funding (liability, balance) {
  const missing = BigInt(liability) - BigInt(balance || '0')
  return (missing > 0n ? missing : 0n).toString()
}

export default function Bonds ({ mint }) {
  const wallet = useWallet()
  const [value, setValue] = useState(null)
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [transaction, setTransaction] = useState(null)
  const [couponId, setCouponId] = useState('coupon-001')
  const [coupon, setCoupon] = useState(null)
  const [proposals, setProposals] = useState([])
  const [commitment, setCommitment] = useState(null)
  async function refresh () {
    try {
      const endpoint = mint
        ? `/voting-api/bonds/${mint}${wallet.address ? `?investor=${wallet.address}` : ''}`
        : '/voting-api/bonds'
      const [result, settings] = await Promise.all([
        request(endpoint),
        request('/voting-api/bonds/config')
      ])
      setValue(result)
      setConfig(settings)
      if (mint && result.coupons.some((item) => item.data.id === couponId)) {
        setCoupon(
          await request(
            `/voting-api/bonds/${mint}/coupons/${couponId}${wallet.address ? `?investor=${wallet.address}` : ''}`
          )
        )
      } else setCoupon(null)
      if (result.votingSpace) {
        setProposals(
          (
            await request(
              `/voting-api/spaces/${result.votingSpace.data.space}/proposals`
            )
          ).items
        )
      }
    } catch (error) {
      setError(error.message)
    }
  }
  useEffect(() => {
    setValue(null)
    setCoupon(null)
    setError('')
    refresh()
  }, [mint, wallet.address, couponId])
  async function signed (path, action, data) {
    return request(path, await wallet.sign({ action, ...data }))
  }
  async function send (operation, args, targetMint = mint) {
    const intent = await signed(
      '/voting-api/bonds/transactions',
      'bond:transaction',
      { mint: targetMint, operation, args }
    )
    const encoded = await wallet.signTransaction(intent.transaction, intent.network)
    const result = await signed('/voting-api/bonds/submit', 'bond:submit', {
      intent: intent.intent,
      transaction: encoded
    })
    setTransaction({ ...result, network: intent.network })
    return result
  }
  async function run (work) {
    setBusy(true)
    setError('')
    try {
      await work()
      await refresh()
    } catch (error) {
      setError(error.message)
    } finally {
      setBusy(false)
    }
  }
  function submit (work) {
    return (event) => {
      event.preventDefault()
      const fields = Object.fromEntries(new FormData(event.currentTarget))
      run(() => work(fields))
    }
  }
  if (!value) {
    return (
      <>
        <h1>Bonds</h1>
        <p role='status'>{error || 'Loading bonds…'}</p>
      </>
    )
  }
  const issuer = mint && wallet.address === value.bond.issuer
  const disabled = busy || !wallet.address || !config?.ready
  return (
    <>
      <div className='page-heading'>
        <div>
          <p className='eyebrow'>KASE corporate-action prototype</p>
          <h1>{mint ? value.data.name : 'Bonds'}</h1>
          <p>
            DEMOUSD is a mock token. This demonstration does not settle real
            cash.
          </p>
        </div>
        <button
          className='icon-button'
          aria-label='Refresh bond status'
          onClick={refresh}
          disabled={busy}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && (
        <p className='notice' role='alert'>
          {error}
        </p>
      )}
      {!config?.ready && (
        <p className='notice'>
          The bond program is not configured. Existing voting remains available.
        </p>
      )}
      {transaction && (
        <p className='bond-transaction' role='status'>
          Confirmed: {transaction.operation}{' '}
          <a
            href={explorer(transaction.signature, transaction.network)}
            target='_blank'
            rel='noreferrer'
          >
            <code>{transaction.signature}</code>
            <ArrowUpRight size={16} />
          </a>
        </p>
      )}
      {!mint
        ? (
          <>
            <section className='space-grid'>
              {value.items.map((record) => (
                <a
                  className='space-card'
                  href={`#/bonds/${record.data.mint}`}
                  key={record.data.mint}
                >
                  <h2>{record.data.name}</h2>
                  <span className='tag'>{record.data.symbol}</span>
                  <p>
                    Historical coupons · Escrow redemption · Bondholder voting
                  </p>
                </a>
              ))}
            </section>
            <section className='bond-panel'>
              <h2>Initialize demo bond</h2>
              <p>
                Create Token-2022 mints using the setup script first. Face value
                is 1,000 DEMOUSD; each semiannual coupon is 50 DEMOUSD per bond.
              </p>
              <form
                onSubmit={submit(async (fields) => {
                  await send(
                    'initialize-bond',
                    {
                      settlementMint: fields.settlementMint,
                      faceValue: '1000000000',
                      couponBps: 1000,
                      frequency: 2,
                      maturity: Math.floor(
                        new Date(fields.maturity).getTime() / 1000
                      ),
                      outstanding: fields.outstanding
                    },
                    fields.mint
                  )
                  await signed('/voting-api/bonds', 'bond:create', {
                    mint: fields.mint,
                    name: fields.name,
                    symbol: fields.symbol
                  })
                  location.hash = `/bonds/${fields.mint}`
                })}
              >
                <fieldset disabled={disabled}>
                  <label>
                    Bond name
                    <input
                      name='name'
                      defaultValue='Kazakhstan Demo Bond 2026'
                      required
                    />
                  </label>
                  <label>
                    Symbol
                    <input name='symbol' defaultValue='KDB26' required />
                  </label>
                  <label>
                    Bond mint
                    <input name='mint' required />
                  </label>
                  <label>
                    DEMOUSD mint
                    <input name='settlementMint' required />
                  </label>
                  <label>
                    Expected outstanding bonds
                    <input
                      name='outstanding'
                      defaultValue='17'
                      pattern='[1-9][0-9]*'
                      required
                    />
                  </label>
                  <label>
                    Maturity
                    <input name='maturity' type='datetime-local' required />
                  </label>
                  <button className='primary'>
                    Initialize and register bond
                  </button>
                </fieldset>
              </form>
              <details>
                <summary>Register an already initialized bond</summary>
                <form
                  onSubmit={submit((fields) =>
                    signed('/voting-api/bonds', 'bond:create', fields)
                  )}
                >
                  <fieldset disabled={disabled}>
                    <label>
                      Bond mint
                      <input name='mint' required />
                    </label>
                    <label>
                      Bond name
                      <input
                        name='name'
                        defaultValue='Kazakhstan Demo Bond 2026'
                        required
                      />
                    </label>
                    <label>
                      Symbol
                      <input name='symbol' defaultValue='KDB26' required />
                    </label>
                    <button className='secondary'>Register bond</button>
                  </fieldset>
                </form>
              </details>
            </section>
          </>
          )
        : (
          <>
            <a className='back-link' href='#/bonds'>
              All bonds
            </a>
            <section className='bond-panel'>
              <h2>{value.data.symbol} details</h2>
              <dl className='bond-facts'>
                <dt>Bond mint</dt>
                <dd>
                  <code>{mint}</code>
                </dd>
                <dt>Issuer</dt>
                <dd>
                  <code>{value.bond.issuer}</code>
                </dd>
                <dt>Face value</dt>
                <dd>{dollars(value.bond.faceValue)}</dd>
                <dt>Coupon schedule</dt>
                <dd>
                  {value.bond.couponBps} basis points annually,{' '}
                  {value.bond.frequency} periods per year
                </dd>
                <dt>Maturity</dt>
                <dd>{new Date(value.bond.maturity * 1000).toLocaleString()}</dd>
                <dt>Outstanding token supply</dt>
                <dd>{value.supply}</dd>
                <dt>Registered holders</dt>
                <dd>{value.holders.length}</dd>
                <dt>Your current bond balance</dt>
                <dd>
                  {wallet.address ? value.currentBalance : 'Connect your wallet'}
                </dd>
                <dt>Issuance</dt>
                <dd>
                  {value.issuanceSealed
                    ? 'Sealed'
                    : 'Mint authority must be revoked before settlement'}
                </dd>
              </dl>
            </section>
            {issuer && (
              <section className='bond-panel'>
                <h2>Holder registry</h2>
                <p>
                  Issuer-managed. Every holder at the record date must be
                  registered; registered historical balances must reconcile with
                  expected supply.
                </p>
                <ul>
                  {value.holders.map((holder) => (
                    <li key={holder.investor}>
                      {holder.label || 'Investor'}: <code>{holder.investor}</code>
                    </li>
                  ))}
                </ul>
                <form
                  onSubmit={submit((fields) =>
                    signed(`/voting-api/bonds/${mint}/holders`, 'bond:holder', {
                      mint,
                      ...fields
                    })
                  )}
                >
                  <fieldset disabled={disabled}>
                    <label>
                      Investor wallet
                      <input name='investor' required />
                    </label>
                    <label>
                      Investor label
                      <input name='label' maxLength='100' />
                    </label>
                    <button className='secondary'>Register holder</button>
                  </fieldset>
                </form>
              </section>
            )}
            <section className='bond-panel'>
              <h2>Coupon payments</h2>
              <p>
                Coupon entitlement is determined by historical record-date
                ownership, even if bonds are transferred afterward.
              </p>
              <label>
                Coupon action
                <select
                  value={couponId}
                  onChange={(event) => setCouponId(event.target.value)}
                >
                  {[
                    ...new Set([
                      'coupon-001',
                      ...value.coupons.map((item) => item.data.id)
                    ])
                  ].map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </label>
              {issuer && (
                <form
                  onSubmit={submit(async (fields) => {
                    await signed(
                    `/voting-api/bonds/${mint}/coupons`,
                    'bond:coupon',
                    { mint, id: fields.id, recordSlot: Number(fields.slot) }
                    )
                    setCouponId(fields.id)
                  })}
                >
                  <fieldset disabled={disabled}>
                    <label>
                      New coupon ID
                      <input
                        name='id'
                        defaultValue='coupon-001'
                        pattern='[a-z0-9][a-z0-9-]{2,47}'
                        required
                      />
                    </label>
                    <label>
                      Finalized record-date slot
                      <input
                        name='slot'
                        inputMode='numeric'
                        pattern='[1-9][0-9]*'
                        required
                      />
                    </label>
                    <button className='secondary'>
                      Generate historical snapshot
                    </button>
                  </fieldset>
                </form>
              )}
              {coupon && (
                <>
                  <dl className='bond-facts'>
                    <dt>Record slot</dt>
                    <dd>{coupon.manifest.recordSlot}</dd>
                    <dt>Record time</dt>
                    <dd>
                      {coupon.manifest.recordTimestamp} (
                      {coupon.manifest.slotResolution}, resolved slot{' '}
                      {coupon.manifest.timestampSlot})
                    </dd>
                    <dt>Total liability</dt>
                    <dd>{dollars(coupon.manifest.totalLiability)}</dd>
                    <dt>Vault funding</dt>
                    <dd>{dollars(coupon.vaultBalance)}</dd>
                    <dt>Status</dt>
                    <dd>
                      {coupon.action?.finalized
                        ? 'Finalized on-chain'
                        : 'Prepared, not finalized'}
                    </dd>
                    <dt>Your historical bond quantity</dt>
                    <dd>{coupon.entitlement?.quantity || '0'}</dd>
                    <dt>Your coupon</dt>
                    <dd>{dollars(coupon.entitlement?.entitlement)}</dd>
                    <dt>Claim</dt>
                    <dd>{coupon.claim ? 'Paid' : 'Not claimed'}</dd>
                  </dl>
                  <a
                    className='receipt-url'
                    href={coupon.manifestUrl}
                    target='_blank'
                    rel='noreferrer'
                  >
                    Snapshot evidence <ArrowUpRight size={16} />
                  </a>
                  {issuer && (
                    <div className='bond-actions'>
                      <button
                        className='secondary'
                        disabled={disabled || Boolean(coupon.action)}
                        onClick={() =>
                          run(() => send('initialize-coupon', { id: couponId }))}
                      >
                        Initialize coupon vault
                      </button>
                      <button
                        className='secondary'
                        disabled={
                        disabled || !coupon.action || coupon.action.finalized || funding(coupon.manifest.totalLiability, coupon.vaultBalance) === '0'
                      }
                        onClick={() =>
                          run(() =>
                            send('fund-coupon', {
                              id: couponId,
                              amount: funding(coupon.manifest.totalLiability, coupon.vaultBalance)
                            })
                          )}
                      >
                        Fund coupon liability
                      </button>
                      <button
                        className='primary'
                        disabled={
                        disabled || !coupon.action || coupon.action.finalized
                      }
                        onClick={() =>
                          run(() => send('finalize-coupon', { id: couponId }))}
                      >
                        Finalize coupon snapshot
                      </button>
                    </div>
                  )}
                  <button
                    className='primary'
                    disabled={
                    disabled ||
                    !coupon.action?.finalized ||
                    Boolean(coupon.claim) ||
                    !coupon.entitlement ||
                    coupon.entitlement.quantity === '0'
                  }
                    onClick={() =>
                      run(() => send('claim-coupon', { id: couponId }))}
                  >
                    Claim historical coupon
                  </button>
                </>
              )}
            </section>
            <section className='bond-panel'>
              <h2>Maturity redemption</h2>
              <p>
                Principal entitlement is determined by bonds actually locked in
                escrow. Deposits cannot be withdrawn. Redemption burns bonds and
                pays principal atomically.
              </p>
              {issuer && !value.redemption && (
                <form
                  onSubmit={submit((fields) =>
                    send('open-redemption', {
                      cutoff: Math.floor(
                        new Date(fields.cutoff).getTime() / 1000
                      )
                    })
                  )}
                >
                  <fieldset disabled={disabled}>
                    <label>
                      Deposit deadline
                      <input name='cutoff' type='datetime-local' required />
                    </label>
                    <button className='secondary'>Open redemption escrow</button>
                  </fieldset>
                </form>
              )}
              {value.redemption && (
                <>
                  <dl className='bond-facts'>
                    <dt>Deposit cutoff</dt>
                    <dd>
                      {new Date(value.redemption.cutoff * 1000).toLocaleString()}
                    </dd>
                    <dt>Total locked bonds</dt>
                    <dd>{value.redemption.locked}</dd>
                    <dt>Escrow token balance</dt>
                    <dd>{value.redemption.escrowBalance}</dd>
                    <dt>Total redeemed / burned</dt>
                    <dd>{value.redemption.redeemed}</dd>
                    <dt>Remaining locked bonds</dt>
                    <dd>{value.redemption.unredeemed}</dd>
                    <dt>Bonds outside escrow</dt>
                    <dd>{value.redemption.unlocked}</dd>
                    <dt>Principal paid</dt>
                    <dd>{dollars(value.redemption.settled)}</dd>
                    <dt>Total locked principal</dt>
                    <dd>{dollars((BigInt(value.redemption.locked) * BigInt(value.bond.faceValue)).toString())}</dd>
                    <dt>Remaining finalized liability</dt>
                    <dd>{dollars(value.redemption.remainingLiability)}</dd>
                    <dt>Settlement vault</dt>
                    <dd>{dollars(value.redemption.vaultBalance)}</dd>
                    <dt>Your locked quantity</dt>
                    <dd>{value.position?.locked || '0'}</dd>
                    <dt>Your unredeemed principal</dt>
                    <dd>
                      {dollars(
                        (BigInt(value.position?.locked || '0') -
                        BigInt(value.position?.redeemed || '0')) *
                        BigInt(value.bond.faceValue) +
                        ''
                      )}
                    </dd>
                  </dl>
                  <form
                    onSubmit={submit((fields) =>
                      send('deposit', { quantity: fields.quantity })
                    )}
                  >
                    <fieldset
                      disabled={
                      disabled ||
                      value.redemption.finalized ||
                      Date.now() / 1000 >= value.redemption.cutoff
                    }
                    >
                      <label>
                        Bonds to lock
                        <input
                          name='quantity'
                          pattern='[1-9][0-9]*'
                          inputMode='numeric'
                          required
                        />
                      </label>
                      <button className='secondary'>Lock bonds in escrow</button>
                    </fieldset>
                  </form>
                  {issuer && (
                    <div className='bond-actions'>
                      <button
                        className='secondary'
                        disabled={disabled || value.redemption.finalized || funding((BigInt(value.redemption.locked) * BigInt(value.bond.faceValue)).toString(), value.redemption.vaultBalance) === '0'}
                        onClick={() =>
                          run(() =>
                            send('fund-redemption', {
                              amount: funding((BigInt(value.redemption.locked) * BigInt(value.bond.faceValue)).toString(), value.redemption.vaultBalance)
                            })
                          )}
                      >
                        Fund principal liability
                      </button>
                      <button
                        className='primary'
                        disabled={
                        disabled ||
                        value.redemption.finalized ||
                        Date.now() / 1000 <
                          Math.max(value.redemption.cutoff, value.bond.maturity)
                      }
                        onClick={() => run(() => send('finalize-redemption', {}))}
                      >
                        Finalize redemption
                      </button>
                    </div>
                  )}
                  <button
                    className='primary'
                    disabled={
                    disabled ||
                    !value.redemption.finalized ||
                    !value.position ||
                    value.position.locked === value.position.redeemed
                  }
                    onClick={() => run(() => send('redeem', {}))}
                  >
                    Redeem all locked bonds
                  </button>
                  <p>
                    {value.supply === '0' && value.redemption.unredeemed === '0'
                      ? 'All demo bonds have been burned and settled.'
                      : 'Redemption is incomplete while bonds remain outstanding.'}
                  </p>
                </>
              )}
            </section>
            <section className='bond-panel'>
              <h2>Bondholder voting</h2>
              <p>
                Off-chain signed voting with historical on-chain token ownership
                and an on-chain final-result commitment.
              </p>
              {value.votingSpace && (
                <a href={`#/spaces/${value.votingSpace.data.space}`}>
                  Open existing voting space <ArrowUpRight size={16} />
                </a>
              )}
              {issuer && !value.votingSpace && (
                <form
                  onSubmit={submit(async (fields) => {
                    await signed('/voting-api/spaces', 'space:create', {
                      id: fields.space,
                      name: `${value.data.symbol} bondholders`,
                      description: 'Bond reporting amendments',
                      token: mint,
                      networksConfig: {
                        networks: [
                          {
                            network: 'solana',
                            assets: [{ type: 'spl', contract: mint }]
                          }
                        ]
                      }
                    })
                    await signed(
                    `/voting-api/bonds/${mint}/voting-space`,
                    'bond:space',
                    { mint, space: fields.space }
                    )
                  })}
                >
                  <fieldset disabled={disabled}>
                    <label>
                      Space ID
                      <input
                        name='space'
                        defaultValue='kdb26-bondholders'
                        required
                      />
                    </label>
                    <button className='secondary'>
                      Create bondholder voting space
                    </button>
                  </fieldset>
                </form>
              )}
              {issuer && value.votingSpace && (
                <>
                  <form
                    onSubmit={submit(async (fields) => {
                      const space = await request(
                      `/voting-api/spaces/${value.votingSpace.data.space}`
                      )
                      await signed(
                      `/voting-api/spaces/${space.data.id}/proposals`,
                      'proposal:create',
                      {
                        space: space.data.id,
                        networksConfig: space.data.networksConfig,
                        title:
                          'Approve an amendment to the bond reporting schedule.',
                        content: 'Change reporting from monthly to quarterly.',
                        contentType: 'markdown',
                        choiceType: 'single',
                        choices: ['Approve', 'Reject', 'Abstain'],
                        startDate: Math.floor(Date.now() / 1000) - 1,
                        endDate: Math.floor(
                          new Date(fields.end).getTime() / 1000
                        ),
                        snapshotHeights: { solana: Number(fields.slot) },
                        realProposer: wallet.address,
                        proposerNetwork: 'solana',
                        version: '4'
                      }
                      )
                    })}
                  >
                    <fieldset disabled={disabled}>
                      <label>
                        Vote snapshot slot
                        <input name='slot' pattern='[1-9][0-9]*' required />
                      </label>
                      <label>
                        Voting ends
                        <input name='end' type='datetime-local' required />
                      </label>
                      <button className='secondary'>
                        Create bond amendment proposal
                      </button>
                    </fieldset>
                  </form>
                  <form
                    onSubmit={submit(async (fields) => {
                      if (!value.voteResults.some(record => record.manifest.proposal === fields.proposal)) {
                        await signed(
                      `/voting-api/bonds/${mint}/vote-results`,
                      'bond:vote-result',
                      {
                        mint,
                        space: value.votingSpace.data.space,
                        proposal: fields.proposal
                      }
                        )
                      }
                      await send('commit-vote', { proposal: fields.proposal })
                      setCommitment(
                        await request(
                        `/voting-api/bonds/${mint}/vote-results/${fields.proposal}`
                        )
                      )
                    })}
                  >
                    <fieldset disabled={disabled || !proposals.length}>
                      <label>
                        Closed proposal
                        <select name='proposal'>
                          {proposals
                            .filter(
                              (record) =>
                                record.data.endDate <= Date.now() / 1000
                            )
                            .map((record) => (
                              <option value={record.cid} key={record.cid}>
                                {record.data.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button className='primary'>
                        Publish and commit final result
                      </button>
                    </fieldset>
                  </form>
                </>
              )}
              {value.voteResults.map((record) => (
                <p key={record.manifest.proposal}>
                  Published result: <code>{record.manifestHash}</code>{' '}
                  <button
                    className='text-button'
                    disabled={busy}
                    onClick={() =>
                      run(async () =>
                        setCommitment(
                          await request(
                          `/voting-api/bonds/${mint}/vote-results/${record.manifest.proposal}`
                          )
                        )
                      )}
                  >
                    Check on-chain commitment
                  </button>
                </p>
              ))}
              {commitment && (
                <p role='status'>
                  {commitment.commitment
                    ? 'Result commitment verified on-chain.'
                    : 'Result evidence is published, but no on-chain commitment exists.'}
                  {' '}<a href={commitment.manifestUrl} target='_blank' rel='noreferrer'>Open result evidence <ArrowUpRight size={16} /></a>
                </p>
              )}
            </section>
            <section className='bond-panel'>
              <h2>Confirmed transactions</h2>
              {value.transactions.map((item) => (
                <p key={item.signature}>
                  {item.operation}:{' '}
                  <a
                    href={explorer(item.signature, value.bond.network)}
                    target='_blank'
                    rel='noreferrer'
                  >
                    <code>{item.signature}</code>
                  </a>
                </p>
              ))}
            </section>
          </>
          )}
      {busy && (
        <p role='status'>
          Waiting for wallet approval and transaction confirmation…
        </p>
      )}
    </>
  )
}
