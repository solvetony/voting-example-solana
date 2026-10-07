import { useEffect, useRef, useState } from 'preact/hooks'
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, CheckCircle2, ChevronRight, Clock, Copy, ExternalLink, LoaderCircle, LogOut, Moon, Plus, RefreshCw, Search, Sun, Trash2, Vote, Wallet, X } from 'lucide-preact'
import { useWallet } from './wallet.jsx'
import { request, solanaIndex } from './api.js'
import { formatAmount, signingText, verifyReceipt } from './signing.js'
import { useTheme } from './theme.js'

function short (value) { return value ? `${value.slice(0, 5)}...${value.slice(-5)}` : '' }
function date (seconds) { return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }
function localDate (date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
function phase (proposal) {
  const now = Date.now() / 1000
  return now < proposal.startDate ? 'Upcoming' : now >= proposal.endDate ? 'Closed' : 'Active'
}
function useResource (path, revision = 0) {
  const [state, setState] = useState({ loading: true, value: null, error: '' })
  useEffect(() => {
    const controller = new AbortController()
    setState(previous => ({ ...previous, loading: true, error: '' }))
    request(path, null, controller.signal).then(value => setState({ loading: false, value, error: '' })).catch(error => {
      if (!controller.signal.aborted) setState({ loading: false, value: null, error: error.message })
    })
    return () => controller.abort()
  }, [path, revision])
  return state
}

function SnapshotTime ({ slot }) {
  const time = useResource(`/voting-api/solana/slot-timestamp/${slot}`)
  return <div className='snapshot-time'>{time.loading ? <small role='status'>Loading snapshot time…</small> : time.value ? <small>{new Date(time.value.timestamp).toISOString()} · <a href={`https://solscan.io/block/${time.value.timestampSlot}`} target='_blank' rel='noreferrer'>{time.value.resolution === 'previous-block' ? 'Previous block' : 'Block'} #{time.value.timestampSlot.toLocaleString()}</a></small> : <Notice error={time.error} />}</div>
}

function Notice ({ error }) { return error ? <p className='notice' role='alert'><AlertTriangle size={16} aria-hidden='true' /><span>{error}</span></p> : null }
function Loading () { return <div className='empty-state' role='status'><LoaderCircle className='spin' size={22} /><p>Loading</p></div> }
function Receipt ({ record }) {
  const [open, setOpen] = useState(false)
  return <><button className='receipt' type='button' onClick={() => setOpen(true)}><CheckCircle2 size={15} /> Validate signed receipt</button>{open && <ReceiptDialog record={record} close={() => setOpen(false)} />}</>
}
function ReceiptDialog ({ record, close }) {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const url = record.ipfsUrl || `https://ipfs.4everland.io/ipfs/${record.cid}`
  useEffect(() => {
    const controller = new AbortController()
    async function validate () {
      try {
        const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
        if (!response.ok) throw new Error('Failed to load IPFS receipt')
        const envelope = await response.json()
        const valid = await verifyReceipt(envelope)
        if (!controller.signal.aborted) setResult({ ...envelope, valid })
      } catch (error) {
        if (!controller.signal.aborted) setError(error.message)
      }
    }
    validate()
    return () => controller.abort()
  }, [url])
  return (
    <Modal title='Receipt validation' close={close}>
      <div className='receipt-validation'>
        {!result && !error && <p role='status'><LoaderCircle className='spin' size={18} /> Validating Solana signature…</p>}
        <Notice error={error} />
        {result && <><p className={result.valid ? 'signature-valid' : 'notice'} role='status'>{result.valid ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}{result.valid ? 'Signature is valid' : 'Signature is invalid'}</p><p>This checks the signed message, not voting power or proposal results.</p><ReceiptValue label='Message' value={signingText(result.data)} /><ReceiptValue label='Signature' value={result.signature} signer={result.address} /></>}
        <div><p>IPFS receipt</p><a className='receipt-url' href={url} target='_blank' rel='noreferrer' aria-label='Open IPFS receipt'><span>{url}</span><ArrowUpRight size={16} /></a></div>
      </div>
    </Modal>
  )
}
function ReceiptValue ({ label, value, signer }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  async function copy () {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setError('')
    } catch { setError('Clipboard unavailable') }
  }
  return <div className='receipt-value'><div><strong>{label}</strong><button className='text-button' type='button' onClick={copy} aria-label={`Copy ${label}`}><Copy size={15} />{copied ? 'Copied' : 'Copy'}</button></div>{signer && <p>Signer <code>{signer}</code></p>}<pre>{value}</pre><Notice error={error} /></div>
}
function Modal ({ title, close, children }) {
  const ref = useRef()
  useEffect(() => { ref.current.showModal() }, [])
  return (
    <dialog ref={ref} onCancel={event => { event.preventDefault(); close() }} onClose={close} aria-labelledby='dialog-title'>
      <div className='dialog-head'><h2 id='dialog-title'>{title}</h2><button className='icon-button' type='button' aria-label='Close dialog' onClick={close}><X size={20} /></button></div>
      {children}
    </dialog>
  )
}

export default function App () {
  const wallet = useWallet()
  const { theme, toggleTheme } = useTheme()
  const [route, setRoute] = useState(location.hash)
  const [dialog, setDialog] = useState('')
  const [revision, setRevision] = useState(0)
  const status = useResource('/voting-api/status')
  useEffect(() => {
    const update = () => { setRoute(location.hash); setDialog('') }
    addEventListener('hashchange', update)
    return () => removeEventListener('hashchange', update)
  }, [])
  const parts = route.replace(/^#\/?/, '').split('/')
  const space = parts[0] === 'spaces' ? parts[1] : ''
  const proposal = parts[2] === 'proposals' ? parts[3] : ''
  function refresh () { setRevision(value => value + 1) }

  return (
    <>
      <header className='site-header'>
        <a className='brand' href='#/'><img src='/icon.png' alt='' width='32' height='32' /><span>Solana Vote</span></a>
        <nav aria-label='Main navigation'><a className='nav-active' href='#/'>Spaces</a><a href='https://solanaindex.top/api-reference' target='_blank' rel='noreferrer'>Solana Index <ExternalLink size={13} /></a></nav>
        <div className='header-actions'>
          <button className='icon-button' type='button' onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button>
          {wallet.address
            ? <><select aria-label='Selected Solana wallet' value={wallet.address} onChange={event => wallet.select(event.target.value)}>{wallet.wallets.map(item => <option key={item.address} value={item.address}>{short(item.address)}</option>)}</select><button className='icon-button' onClick={() => wallet.logout()} aria-label='Disconnect wallet' title='Disconnect wallet'><LogOut size={18} /></button></>
            : <button className='primary wallet-connect' aria-label='Connect wallet' title='Connect wallet' disabled={!wallet.ready} onClick={() => wallet.login()}><Wallet size={17} /><span>Connect wallet</span></button>}
        </div>
      </header>
      <main>
        {!import.meta.env.VITE_PRIVY_APP_ID && <Notice error='Wallet login is not configured yet.' />}
        {status.value && !status.value.storageReady && <Notice error='Space storage is not configured yet.' />}
        {status.value && !status.value.indexReady && <Notice error='Voting power verification is not configured yet.' />}
        {proposal && space
          ? <ProposalPage key={`${space}/${proposal}`} spaceId={space} proposalId={proposal} revision={revision} refresh={refresh} />
          : space
            ? <SpacePage spaceId={space} revision={revision} openProposal={() => setDialog('proposal')} />
            : <SpacesPage revision={revision} openCreate={() => setDialog('space')} />}
      </main>
      <footer><span>Solana Vote</span><a href='https://solanaindex.top' target='_blank' rel='noreferrer'>Snapshot balances by Solana Index <ArrowUpRight size={13} /></a></footer>
      {dialog === 'space' && <SpaceDialog close={() => setDialog('')} saved={refresh} />}
      {dialog === 'proposal' && space && <ProposalDialog spaceId={space} close={() => setDialog('')} saved={refresh} />}
    </>
  )
}

function SpacesPage ({ revision, openCreate }) {
  const wallet = useWallet()
  const spaces = useResource('/voting-api/spaces', revision)
  const [search, setSearch] = useState('')
  const [more, setMore] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setMore([]); setCursor(spaces.value?.cursor || null) }, [spaces.value])
  async function loadMore () {
    setLoadingMore(true)
    try {
      const page = await request(`/voting-api/spaces?cursor=${encodeURIComponent(cursor)}`)
      setMore(items => [...items, ...page.items])
      setCursor(page.cursor)
    } catch (error) { setError(error.message) } finally { setLoadingMore(false) }
  }
  const items = [...(spaces.value?.items || []), ...more].filter(space => `${space.data.name} ${space.tokenInfo.symbol || ''} ${space.data.token}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <div className='page-heading'><div><p className='eyebrow'>Community governance</p><h1>Spaces</h1><p>Make decisions with the people who hold your token.</p></div><button className='primary' disabled={!wallet.address} onClick={openCreate}><Plus size={18} />Create space</button></div>
      <div className='list-toolbar'><div className='toolbar-controls'><label className='search'><Search size={17} aria-hidden='true' /><input aria-label='Search spaces' placeholder='Search spaces or tokens' value={search} onInput={event => setSearch(event.target.value)} />{search && <button className='icon-button' type='button' aria-label='Clear search' onClick={() => setSearch('')}><X size={16} /></button>}</label><span className='filter-current'>All</span></div><span>{items.length} {items.length === 1 ? 'space' : 'spaces'}{cursor ? ' loaded' : ''}</span></div>
      <Notice error={spaces.error || error} />
      {spaces.loading
        ? <Loading />
        : (
          <section className='space-grid' aria-label='Voting spaces'>
            {items.map(space => <a className='space-card' key={space.data.id} href={`#/spaces/${space.data.id}`}><div className='space-card-head'><span className='token-mark'><Vote size={22} /></span><h2>{space.data.name}</h2><span className='tag'>{space.tokenInfo.symbol || 'SPL token'}</span></div><p>{space.data.description}</p><div className='space-card-bottom'><code title={space.data.token}>{short(space.data.token)}</code><span>View space <ArrowRight size={15} /></span></div></a>)}
            {!items.length && <div className='empty-state'><Vote size={26} /><h2>{search ? 'No matching spaces' : 'No spaces yet'}</h2><p>{search ? 'Try another space name or token symbol.' : 'Create the first governance space for your token community.'}</p>{!search && wallet.address && <button className='primary' onClick={openCreate}><Plus size={17} />Create space</button>}</div>}
          </section>
          )}
      {cursor && <button className='secondary' disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading' : 'Load more'}</button>}
    </>
  )
}

function SpacePage ({ spaceId, revision, openProposal }) {
  const wallet = useWallet()
  const space = useResource(`/voting-api/spaces/${encodeURIComponent(spaceId)}`, revision)
  const proposals = useResource(`/voting-api/spaces/${encodeURIComponent(spaceId)}/proposals`, revision)
  const [extra, setExtra] = useState([])
  const [cursor, setCursor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setExtra([]); setCursor(proposals.value?.cursor || null) }, [proposals.value])
  async function loadMore () {
    setBusy(true)
    try {
      const page = await request(`/voting-api/spaces/${spaceId}/proposals?cursor=${encodeURIComponent(cursor)}`)
      setExtra(items => [...items, ...page.items])
      setCursor(page.cursor)
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  if (space.loading) return <Loading />
  if (!space.value) return <Notice error={space.error} />
  const value = space.value
  const items = [...(proposals.value?.items || []), ...extra].sort((a, b) => b.data.timestamp - a.data.timestamp)
  return (
    <>
      <a className='back-link' href='#/'><ArrowLeft size={16} />All spaces</a>
      <div className='page-heading'><div><p className='eyebrow'>{value.tokenInfo.symbol || 'Solana token'}</p><h1>{value.data.name}</h1><p>{value.data.description}</p></div>{wallet.address === value.address && <button className='primary' onClick={openProposal}><Plus size={18} />New proposal</button>}</div>
      <div className='space-facts'><span><span>Token</span><a href={`https://solscan.io/token/${value.data.token}`} target='_blank' rel='noreferrer'>{short(value.data.token)} <ExternalLink size={13} /></a></span><span><span>Owner</span><code>{short(value.address)}</code></span><span><span>Receipt</span><Receipt record={value} /></span></div>
      <div className='section-heading'><h2>Proposals</h2><span>{items.length} {items.length === 1 ? 'proposal' : 'proposals'}</span></div>
      <Notice error={proposals.error || error} />
      {proposals.loading ? <Loading /> : <section className='proposal-list'>{items.map(proposal => <a className='proposal-row' href={`#/spaces/${spaceId}/proposals/${proposal.cid}`} key={proposal.cid}><div><span className={`tag ${phase(proposal.data).toLowerCase()}`}>{phase(proposal.data)}</span><h3>{proposal.data.title}</h3><p>Snapshot #{proposal.data.snapshotHeights.solana.toLocaleString()} · Ends {date(proposal.data.endDate)}</p></div><ChevronRight size={20} /></a>)}{!items.length && <div className='empty-state'><Vote size={26} /><h2>No proposals yet</h2><p>New proposals will appear here.</p></div>}</section>}
      {cursor && <button className='secondary' disabled={busy} onClick={loadMore}>{busy ? 'Loading' : 'Load more'}</button>}
    </>
  )
}

function ProposalPage ({ spaceId, proposalId, revision, refresh }) {
  const wallet = useWallet()
  const space = useResource(`/voting-api/spaces/${encodeURIComponent(spaceId)}`, revision)
  const proposal = useResource(`/voting-api/spaces/${encodeURIComponent(spaceId)}/proposals/${encodeURIComponent(proposalId)}`, revision)
  const [choice, setChoice] = useState(-1)
  const [power, setPower] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { setPower(null); setReceipt(null); setChoice(-1) }, [wallet.address, proposalId])
  async function checkPower () {
    setBusy('power'); setError('')
    try { setPower(await solanaIndex(`token-balance/${wallet.address}/${space.value.data.token}/${proposal.value.data.snapshotHeights.solana}`)) } catch (error) { setError(error.message) } finally { setBusy('') }
  }
  async function vote (event) {
    event.preventDefault()
    setBusy('vote'); setError('')
    try {
      const signed = await wallet.sign({ action: 'vote:create', space: spaceId, proposalCid: proposalId, choices: [choice], remark: '', realVoter: wallet.address, voterNetwork: 'solana', version: '4' })
      const result = await request(`/voting-api/spaces/${spaceId}/proposals/${proposalId}/votes`, signed)
      setReceipt(result)
      refresh()
    } catch (error) { setError(error.message) } finally { setBusy('') }
  }
  async function copy () {
    try { await navigator.clipboard.writeText(JSON.stringify(receipt, null, 2)); setCopied(true) } catch { setError('Clipboard unavailable') }
  }
  if ((space.loading && !space.value) || (proposal.loading && !proposal.value)) return <Loading />
  if (!space.value || !proposal.value) return <Notice error={space.error || proposal.error} />
  const value = proposal.value
  const total = value.results.reduce((sum, item) => sum + BigInt(item.weightRaw), 0n)
  const state = phase(value.data)
  return (
    <>
      <a className='back-link' href={`#/spaces/${spaceId}`}><ArrowLeft size={16} />{space.value.data.name}</a>
      <div className='proposal-layout'>
        <section className='proposal-content'><div className='proposal-heading'><div className='proposal-status'><span className={`tag ${state.toLowerCase()}`}>{state}</span><button className='icon-button' onClick={refresh} disabled={proposal.loading} aria-label='Refresh results' title='Refresh results'><RefreshCw className={proposal.loading ? 'spin' : ''} size={18} /></button></div><h1>{value.data.title}</h1><p>Proposed by <code>{short(value.address)}</code></p></div><p className='proposal-body'>{value.data.content}</p><div className='proposal-meta'><div className='date-range'><Clock size={16} /><span>{date(value.data.startDate)}</span><ArrowRight size={14} /><span>{date(value.data.endDate)}</span></div><div><span className='meta-label'>Snapshot</span><code>#{value.data.snapshotHeights.solana.toLocaleString()}</code><SnapshotTime key={value.data.snapshotHeights.solana} slot={value.data.snapshotHeights.solana} /></div><div><span className='meta-label'>Verified</span><Receipt record={value} /></div></div>
          <section className='results-section'><div className='section-heading'><h2>Results</h2><span>{value.voteCount} {value.voteCount === 1 ? 'vote' : 'votes'}</span></div>{value.results.map(result => {
            const percentage = total ? Number(BigInt(result.weightRaw) * 10000n / total) / 100 : 0
            return <div className='result-row' key={result.choice}><div><strong>{result.choice}</strong><span>{percentage}%</span></div><progress value={percentage} max='100' aria-label={`${result.choice}: ${percentage}%`} /><small>{result.weight} {space.value.tokenInfo.symbol || 'tokens'}</small></div>
          })}
          </section>
        </section>
        <aside className='vote-panel'><h2>Cast your vote</h2><p>Voting power at the proposal’s snapshot.</p>
          {wallet.address && <div className='power-row'><span>{power ? `${formatAmount(power.balanceRaw, power.decimals)} ${space.value.tokenInfo.symbol || 'tokens'}` : 'Voting power'}</span><button className='text-button' disabled={Boolean(busy)} onClick={checkPower}>{busy === 'power' ? 'Checking' : 'Check'}</button></div>}
          <form onSubmit={vote}><fieldset disabled={state !== 'Active' || Boolean(busy) || Boolean(receipt)}><legend className='sr-only'>Choose an option</legend>{value.data.choices.map((label, index) => <label className='vote-option' key={label}><input type='radio' name='choice' checked={choice === index} onChange={() => setChoice(index)} required /><span>{label}</span></label>)}</fieldset>
            {wallet.address ? <button className='primary full-width' type='submit' disabled={choice < 0 || state !== 'Active' || Boolean(busy) || Boolean(receipt)}>{busy === 'vote' ? <LoaderCircle className='spin' size={17} /> : <Vote size={17} />}{receipt ? 'Vote recorded' : busy === 'vote' ? 'Signing vote' : state === 'Active' ? 'Sign & vote' : 'Voting is ' + state.toLowerCase()}</button> : <button className='primary full-width' type='button' disabled={!wallet.ready} onClick={() => wallet.login()}><Wallet size={17} />Connect to vote</button>}
          </form><Notice error={error} />
          {receipt && <div className='vote-success' role='status'><CheckCircle2 size={20} /><p>Your vote is recorded.</p><Receipt record={receipt} /><button className='text-button' onClick={copy}><Copy size={15} />{copied ? 'Copied' : 'Copy receipt JSON'}</button></div>}
        </aside>
      </div>
    </>
  )
}

function SpaceDialog ({ close, saved }) {
  const wallet = useWallet()
  const [form, setForm] = useState({ id: '', name: '', description: '', token: '' })
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  function field (name, value) { setForm(current => ({ ...current, [name]: value })); if (name === 'token') setInfo(null) }
  async function lookup () {
    setBusy('lookup'); setError('')
    try { setInfo(await solanaIndex(`token-info/${form.token.trim()}`)) } catch (error) { setError(error.message) } finally { setBusy('') }
  }
  async function submit (event) {
    event.preventDefault(); setBusy('create'); setError('')
    try {
      const token = form.token.trim()
      const envelope = await wallet.sign({ ...form, token, action: 'space:create', networksConfig: { networks: [{ network: 'solana', assets: [{ type: 'spl', contract: token }] }] } })
      const result = await request('/voting-api/spaces', envelope)
      saved(); close(); location.hash = `/spaces/${result.data.id}`
    } catch (error) { setError(error.message) } finally { setBusy('') }
  }
  return <Modal title='Create a space' close={close}><form onSubmit={submit}><label>Space name<input value={form.name} onInput={event => field('name', event.target.value)} maxLength='100' required /></label><label>Space ID<input value={form.id} onInput={event => field('id', event.target.value)} pattern='[a-z0-9][a-z0-9-]{2,47}' placeholder='your-community' required /></label><label>Description<textarea value={form.description} onInput={event => field('description', event.target.value)} maxLength='2000' rows='3' required /></label><label>Solana token address<input value={form.token} onInput={event => field('token', event.target.value)} spellCheck={false} required /></label><div className='token-preview'><span>{info ? `${info.name || 'Token'} · ${info.symbol || '—'} · ${info.decimals} decimals` : 'SPL or Token-2022'}</span><button type='button' className='text-button' disabled={Boolean(busy) || !form.token} onClick={lookup}>{busy === 'lookup' ? 'Looking up' : 'Look up token'}</button></div><Notice error={error} /><div className='dialog-actions'><button className='secondary' type='button' onClick={close} disabled={Boolean(busy)}>Cancel</button><button className='primary' disabled={Boolean(busy)}>{busy === 'create' ? <LoaderCircle className='spin' size={17} /> : <Plus size={17} />}{busy === 'create' ? 'Creating' : 'Sign & create space'}</button></div></form></Modal>
}

function ProposalDialog ({ spaceId, close, saved }) {
  const wallet = useWallet()
  const space = useResource(`/voting-api/spaces/${spaceId}`)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [choices, setChoices] = useState(['For', 'Against'])
  const [slot, setSlot] = useState('')
  const [start, setStart] = useState(localDate(new Date(Date.now() + 60000)))
  const [end, setEnd] = useState(localDate(new Date(Date.now() + 7 * 86400000)))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  async function currentSlot () {
    setBusy('slot'); setError('')
    try { setSlot(String((await solanaIndex('slot')).slot)) } catch (error) { setError(error.message) } finally { setBusy('') }
  }
  async function submit (event) {
    event.preventDefault(); setBusy('proposal'); setError('')
    try {
      const envelope = await wallet.sign({
        action: 'proposal:create',
        space: spaceId,
        networksConfig: space.value.data.networksConfig,
        title,
        content,
        contentType: 'markdown',
        choiceType: 'single',
        choices: choices.map(choice => choice.trim()),
        startDate: Math.floor(new Date(start).getTime() / 1000),
        endDate: Math.floor(new Date(end).getTime() / 1000),
        snapshotHeights: { solana: Number(slot) },
        realProposer: wallet.address,
        proposerNetwork: 'solana',
        version: '4'
      })
      const result = await request(`/voting-api/spaces/${spaceId}/proposals`, envelope)
      saved(); close(); location.hash = `/spaces/${spaceId}/proposals/${result.cid}`
    } catch (error) { setError(error.message) } finally { setBusy('') }
  }
  return <Modal title='New proposal' close={close}><form onSubmit={submit}><label>Title<input value={title} onInput={event => setTitle(event.target.value)} maxLength='160' required /></label><label>Proposal<textarea rows='5' value={content} onInput={event => setContent(event.target.value)} maxLength='12000' required /></label><fieldset className='choice-editor'><legend>Choices</legend>{choices.map((choice, index) => <div className='choice-input' key={index}><input aria-label={`Choice ${index + 1}`} value={choice} onInput={event => setChoices(items => items.map((item, i) => i === index ? event.target.value : item))} required maxLength='100' /><button type='button' className='icon-button' aria-label={`Remove choice ${index + 1}`} disabled={choices.length <= 2} onClick={() => setChoices(items => items.filter((_, i) => i !== index))}><Trash2 size={17} /></button></div>)}<button className='text-button' type='button' disabled={choices.length >= 10} onClick={() => setChoices(items => [...items, ''])}><Plus size={16} />Add choice</button></fieldset><div className='form-columns'><label>Voting starts<input type='datetime-local' value={start} onInput={event => setStart(event.target.value)} required /></label><label>Voting ends<input type='datetime-local' value={end} onInput={event => setEnd(event.target.value)} required /></label></div><label>Snapshot slot<div className='input-action'><input type='number' min='1' step='1' value={slot} onInput={event => setSlot(event.target.value)} required /><button type='button' className='secondary' onClick={currentSlot} disabled={Boolean(busy)}>{busy === 'slot' ? 'Fetching' : 'Current slot'}</button></div></label>{Number.isSafeInteger(Number(slot)) && Number(slot) > 0 && <SnapshotTime key={slot} slot={Number(slot)} />}<Notice error={error || space.error} /><div className='dialog-actions'><button className='secondary' type='button' onClick={close} disabled={Boolean(busy)}>Cancel</button><button className='primary' disabled={Boolean(busy) || !space.value}>{busy === 'proposal' ? <LoaderCircle className='spin' size={17} /> : <Vote size={17} />}{busy === 'proposal' ? 'Creating' : 'Sign & publish'}</button></div></form></Modal>
}
