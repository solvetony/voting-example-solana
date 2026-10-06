# Solana Vote

A small Preact + StandardJS voting example, with lucide-preact icons and
Privy Solana-wallet login. It uses Solana Index for token information,
current slots, and historical balances. There is no voting database or
local Solana RPC/indexer.

## Run

Use Node 24. Backend and frontend install and deploy independently, with
their own package files, lockfiles, and environment configuration. Copy
each directory's `.env.example` to `.env` and fill the settings below.

```sh
cd backend
npm ci
npm run dev
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. The backend listens on `127.0.0.1:3101`.
Vite proxies `/voting-api`, including Solana Index lookups, to the backend.

```sh
npm --prefix backend run lint
npm --prefix backend test
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix backend start
```

Deploy `frontend/dist` to your static host. Run the backend separately and
proxy `/voting-api/*` from the frontend origin to the backend. Other browser
paths should serve the frontend's `index.html` for SPA navigation. Set
backend `APP_ORIGIN` to that exact browser origin. `HOST` defaults to loopback.
The backend never serves frontend assets. `frontend`'s `npm start` is a
local build preview, not a production hosting service.

## Backend structure

`backend/app.js` autoloads `plugins/` followed by `routes/`, matching
solana-token-api's Fastify structure. Plugins provide storage, Solana Index,
record helpers, and HTTP policy. Each route has its own file.
`backend/lib/` holds signing, validation, and storage/API clients.

The signing protocol helper is included in each project so neither needs
files or dependencies from the other. Preserve its message format in both
copies when changing the protocol.

## Configuration

- `VITE_PRIVY_APP_ID`: public Privy app ID. Enable Solana wallet login and
  register your localhost/production origins in Privy. No Ethereum wallets
  or embedded wallets are created by this example.
- `SOLANA_INDEX_API_KEY`: **server-only** API key for independent voting
  power verification and token/snapshot validation. Provision enough
  Solana Index requests for your community.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`:
  private S3-compatible space/proposal/vote storage. The provider must
  support `PutObject` with `If-None-Match: *`. No public bucket is needed.
- `EVERLAND_ACCESS_KEY`, `EVERLAND_SECRET_KEY`, `EVERLAND_BUCKET_NAME`:
  an IPFS-enabled 4EVERLAND Bucket. The endpoint and region follow the
  existing collaboration backend: `https://endpoint.4everland.co`,
  `4EVERLAND`. Its `HeadObject` response must contain `ipfs-hash` metadata.
- `IPFS_ENDPOINT`: public receipt gateway, defaults to
  `https://ipfs.4everland.io/ipfs/`.

Do not put storage secrets or the operator's API key in `VITE_*` variables.
All token, current-slot, and voting-power lookups use the backend's
`SOLANA_INDEX_API_KEY`. The key is never sent to browsers or stored in
browser storage. No Solana Index CORS configuration is needed.
Lookup routes validate addresses and slots and use the existing backend
rate limit. Public lookups consume the operator's quota; apply additional
edge limits if exposing this example to heavy public traffic.

## Workflow

1. Connect a Solana wallet through Privy.
2. Create a space with a token address. The server independently obtains
   its decimal precision from Solana Index.
3. The space owner creates a single-choice proposal, choosing a historical
   snapshot slot, voting dates, and 2-10 options. Future slots are rejected.
4. Token holders sign votes. The backend checks their historical balance
   at the proposal's fixed snapshot. Client-supplied weights are ignored.
5. One wallet can vote once per proposal. Conditional S3 writes prevent
   concurrent duplicate votes. Tallies use `BigInt`, not floating-point
   token amounts. Snapshot holdings determine power, not present holdings.
6. Spaces, proposals, and votes have public signed IPFS receipts.

## Signature compatibility

The frontend preserves the source projects' envelope:

```json
{
  "data": { "voterNetwork": "solana", "timestamp": 123, "...": "..." },
  "address": "SOLANA_PUBLIC_KEY",
  "signature": "128_HEX_CHARACTERS",
  "version": "2"
}
```

The exact message is UTF-8 `JSON.stringify(data)` after removing the
top-level `logo` field, preserving insertion order. Signatures are
Ed25519 bytes encoded as hex, not Base58 or Base64. Space/proposal data
includes `networksConfig.networks[0].network = "solana"`; vote data
includes `voterNetwork = "solana"`. These match
`projects/ipfs-signed-message-validator/components/IpfsLoader.tsx`.

`app`, `action`, and a ten-minute timestamp window bind signatures to
this application's mutations. Ownership and proposal IDs are checked
independently. IPFS stores the signed envelope, not a rewritten version
of `data`. Server-computed weight and CID live in the S3 record, outside
the signed envelope. A receipt proves who signed the vote and its choice;
the API-derived weight can be independently checked with Solana Index.

## Storage and limits

- `spaces/{id}.json`: immutable signed space and authoritative token info.
- `proposals/{space}/{cid}.json`: immutable signed proposal.
- `votes/{space}/{proposalCid}/{wallet}.json`: immutable vote and verified
  raw weight.
- 4EVERLAND `solana-voting/{sha256}.json`: content-addressed signed envelopes.

Lists paginate in batches of 50. Proposal results scan stored votes and
are capped at 10,000 votes per proposal; add a durable aggregate if you
outgrow this example. No worker, Redis, Postgres, or MongoDB is required.
Creating spaces/proposals and voting consumes the operator's Solana Index
quota. Reading lists/results does not. Frontend previews also consume the
operator's quota through the backend.

S3 storage is the application's read source; IPFS receipts make actions
independently inspectable but do not guarantee the server cannot omit
votes. Backend storage administrators remain trusted for availability.
The server does not custody wallets or keys. There are no on-chain voting
transactions, fees, transfers, delegation, comments, or ownership editing.

## Checks

`npm --prefix backend test` covers signature compatibility, tampering, timestamp expiry,
owner restrictions, snapshots, exact tallies, duplicate/concurrent votes,
closed voting, zero balances, upstream failures, and input/origin limits.
Tests use mocked S3/IPFS and Solana Index, without spending requests or
uploading files. Real Privy login and storage need your configuration.

Desktop/mobile browser checks use mocked read responses:

```sh
cd frontend
npx playwright install chromium
npm run test:browser
```

The Privy React SDK runs through Preact's compatibility layer. References:
[Preact compatibility](https://preactjs.com/guide/v10/getting-started/),
[Privy Solana signing](https://docs.privy.io/wallets/using-wallets/solana/sign-a-message).
