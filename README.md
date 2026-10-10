# KASE Bond Corporate Actions on Solana

A prototype for automating tokenized bond coupon payments, maturity redemption,
and bondholder voting, built for the **KASE × Superteam Kazakhstan challenge**.
The application identifies eligible investors, calculates their entitlements,
settles demonstration tokens, and records the outcome on Solana.

Kazakhstan Stock Exchange (KASE) supports trading in equities, bonds, foreign
currencies, derivatives, and money market instruments. This prototype explores
how blockchain could automate corporate actions for tokenized instruments.

## What the prototype does

| Corporate action | Who is eligible? | Settlement and on-chain record |
| --- | --- | --- |
| Coupon payment | Investors who held bonds at a historical record-date slot, queried through Solana Index | A committed snapshot authorizes DEMOUSD payments; claims are recorded on Solana and cannot be repeated. |
| Maturity redemption | Investors who deposited bonds into program-controlled escrow before the cutoff | Principal payment and bond burning happen atomically; redeemed positions are recorded on Solana. |
| Bondholder voting | Investors with bond ownership at the proposal's historical snapshot | Signed votes are weighted and counted off-chain; the issuer commits the final result hash on Solana. |

The demo instrument is **KDB26**, a Token-2022 bond with a face value of
**1,000 DEMOUSD**, a **10% annual coupon**, and **two coupon payments per year**.
An investor holding 10 bonds at the record date is eligible for a **500 DEMOUSD
coupon**. Locking those 10 bonds in escrow entitles that investor to **10,000
DEMOUSD principal** at maturity. The final coupon is handled separately.

**DEMOUSD is a mock token, not fiat or a regulated stablecoin.** The hosted
prototype uses devnet. Local tests mock historical queries and external storage;
see [implementation status](docs/implementation-status.md) for the distinction
between local verification and public-network integration.

The project extends the existing voting application. It reuses Privy wallet
login, signed messages, historical Solana Index balances, and S3/IPFS evidence.
A single Anchor program enforces coupon claims, escrow custody, and redemption.
The backend uses Fastify and the frontend uses Preact; no new database or indexer
is required. Contracts live in [`contracts/`](contracts/README.md).

Start with the reviewer guides below. For technical details, read the
[architecture](docs/architecture.md), [demo sequence](docs/demo-script.md),
[security and trust assumptions](docs/security-and-trust.md), or
[devnet deployment instructions](docs/devnet-deployment.md).

## Reviewer guide: live devnet website

Open **https://kase-voting-example.solanaindex.top/**. No backend, API key,
Privy configuration, or contract deployment is needed to use this hosted demo.
Use Phantom or Solflare with **Devnet** selected. DEMOUSD is a mock settlement
asset; all addresses below are devnet demo addresses.

### 1. Get the demo wallets and private keys

Clone the repository and install the contracts dependencies (Node 24):

```sh
git clone https://github.com/solvetony/voting-example-solana.git
cd voting-example-solana/contracts
npm ci
```

The intentionally public demo keypairs are linked below. Never use these wallets
on mainnet, deposit real assets, or reuse them for personal accounts. Anyone can
use them, consume their demo funds, or settle their positions. The issuer is also
the recorded program upgrade authority, so publishing its key exposes control of
the demo program as well as its wallet. This is a shared, mutable demonstration.

| Role | Keypair | Wallet address | Initial bonds | Coupon | Principal |
| --- | --- | --- | ---: | ---: | ---: |
| Issuer | [issuer.json](contracts/.devnet/issuer.json) | `7iwXno1JbFUWHnBBjG875e8WhbDv2eHkt6GmkNLNjVkm` | 0 | n/a | n/a |
| Investor A | [investor-1.json](contracts/.devnet/investor-1.json) | `GJVZamtUgpacvJzei5EKFjRNgpixghhN54o5rsmBx2ry` | 10 | 500 DEMOUSD | 10,000 DEMOUSD |
| Investor B | [investor-2.json](contracts/.devnet/investor-2.json) | `BAmKDwU4tFmmaxicuW6yMb1aPR4xdgBE9nrZ8t6pTmPR` | 5 | 250 DEMOUSD | 5,000 DEMOUSD |
| Investor C | [investor-3.json](contracts/.devnet/investor-3.json) | `CXttYuTve1oQNWA9sU43vUoBCxBJjgDGxm8mHVqjiZpJ` | 2 | 100 DEMOUSD | 2,000 DEMOUSD |

These are initial allocations, not a promise of current balances. From the
`contracts/` directory, run the matching one-liner to print the Base58 private
key accepted by wallet import. Run these locally, not in a shared terminal:

```sh
node --input-type=module -e 'import fs from "node:fs"; import bs58 from "bs58"; console.log(bs58.encode(Uint8Array.from(JSON.parse(fs.readFileSync(".devnet/issuer.json", "utf8")))))'
node --input-type=module -e 'import fs from "node:fs"; import bs58 from "bs58"; console.log(bs58.encode(Uint8Array.from(JSON.parse(fs.readFileSync(".devnet/investor-1.json", "utf8")))))'
node --input-type=module -e 'import fs from "node:fs"; import bs58 from "bs58"; console.log(bs58.encode(Uint8Array.from(JSON.parse(fs.readFileSync(".devnet/investor-2.json", "utf8")))))'
node --input-type=module -e 'import fs from "node:fs"; import bs58 from "bs58"; console.log(bs58.encode(Uint8Array.from(JSON.parse(fs.readFileSync(".devnet/investor-3.json", "utf8")))))'
```

1. In Phantom, open **Add / Connect Wallet**, choose **Import Private Key**,
   select Solana if asked, and paste the printed key. Name the accounts Issuer,
   Investor A, Investor B, and Investor C. Use Solflare's private-key import if
   testing with Solflare. These generated keypairs do not have a recovery phrase.
2. Enable test networks in the wallet settings and select **Devnet**.
3. Select Investor A, open the website, connect the wallet, and approve login.
   Check that the website address matches the table before signing an action.
4. When changing accounts, disconnect the website, select the next wallet account,
   and reconnect. Import `.devnet` keys, not the separate local-validator `.demo`
   keys. Each account needs devnet SOL for transaction fees and account rent;
   manually top it up if necessary.

### 2. Addresses to use in the frontend

| Field | Value |
| --- | --- |
| Network | `devnet` |
| Bond mint / token when creating a space | `BbAHLdrw1TY7j3LfFJwjoBRiV8dm7UgnqkHETZmv1SEr` |
| DEMOUSD settlement mint | `BeKDLxPtE5ZKNXFjZQfT2D3J8pGgo8EWXEZNq1n2L6gt` |
| Bond program | `887VzhmU4fYt5xgkks5F83eNmjsSFwyVMaTHm72Lmdis` |

Public setup metadata is in [config.json](contracts/.devnet/config.json).
The bond has zero decimals, DEMOUSD has six, and one bond has a face value of
1,000 DEMOUSD. The configured maturity is immutable; check the date shown in
**Bonds**. Existing claims, votes, and redemption cannot be reset. If the escrow
cutoff has passed or bonds are already burned, use the fresh setup below.

### 3. Test coupons, voting, and principal in order

1. Open **Bonds** and the KDB26 bond. If it is absent, connect the **issuer**,
   expand **Register an already initialized bond**, enter the bond mint above,
   name `Kazakhstan Demo Bond 2026`, symbol `KDB26`, and select **Register bond**.
   Setup already initialized the contract; do not initialize this mint again.
   Investor wallets cannot perform issuer actions.
2. As issuer, use **Register holder** for A, B, and C from the table, unless
   already registered. All record-date holders must be included.
3. Obtain a finalized devnet record slot with the Solana CLI:

   ```sh
   solana slot --url https://api.devnet.solana.com --commitment finalized
   ```

   Use a slot after distribution, before escrow deposits or burns. Wait for
   Solana Index history availability; a failed historical query must be resolved
   before proceeding. An incomplete registry cannot finalize a snapshot.
4. Under **Coupon payments**, use an unused coupon ID such as `coupon-review-001`
   and that slot. Select **Generate historical snapshot**. With the original
   distribution, total liability must be **850 DEMOUSD**. Then select
   **Initialize coupon vault**, **Fund coupon liability**, and
   **Finalize coupon snapshot**, approving and confirming each transaction.
   Use an existing finalized coupon when available instead of funding it again.
5. Connect A, B, and C in turn. Select the coupon and use **Claim historical
   coupon**. Expected payouts for the original snapshot are **500 / 250 / 100
   DEMOUSD**. Paid claims cannot be claimed twice. Historical ownership controls
   entitlement even after a later transfer. An optional transfer demonstration
   must return bonds to their original holders before expecting 10/5/2 deposits.
6. As issuer, under **Bondholder voting**, create a unique space ID if none is
   bound. The bond mint is used automatically. For the general **Create space**
   page, use the **bond mint**, not DEMOUSD, as its token. Create a bond amendment
   proposal with a finalized snapshot slot and a future voting end time.
7. Open the voting space and cast A/B/C votes using **Approve / Reject / Abstain**.
   At the original 10/5/2 snapshot, weights must be **10 / 5 / 2**. Inspect signed
   receipt validation and IPFS evidence. After voting ends, reconnect the issuer,
   select the closed proposal in the bond page, and submit the result commitment.
   The chain stores the result hash; it does not independently verify the tally.
8. As issuer, select a future **Deposit deadline** and **Open redemption escrow**.
   Leave time to switch all three wallets. As A/B/C, use **Lock bonds in escrow**
   with **10 / 5 / 2**, or each wallet's actual remaining balance. Deposits cannot
   be withdrawn. Confirm total locked **17**, escrow balance **17**, and bonds
   outside escrow **0** for a complete original-distribution demo.
9. Reconnect the issuer and select **Fund principal liability** (17,000 DEMOUSD
   for 17 bonds). After both the cutoff and maturity have passed, select
   **Finalize redemption**. Confirm each transaction before continuing.
10. As A/B/C, select **Redeem all locked bonds**. The original positions receive
    **10,000 / 5,000 / 2,000 DEMOUSD**. Burning and payment are atomic. Check the
    transaction explorer links, **17 redeemed / burned**, **17,000 DEMOUSD
    principal paid**, zero outstanding supply, and zero remaining liability.
    Redeemed positions cannot redeem again.

## Reviewer guide: generate a fresh devnet demo

Fresh mints and wallets avoid shared claims and expired deposit windows. You can
reuse the deployed program without Rust/Anchor or a new program deployment.
Fresh wallet keys are private by default; only the bundled demo keys above are
intentionally public. Do not commit replacement keys over the bundled files.

### 1. Install, create an issuer, and manually fund it

Use Node 24 and the Solana CLI. Starting from the repository root:

```sh
pnpm --dir backend install --frozen-lockfile
pnpm --dir frontend install --frozen-lockfile
cd contracts
npm ci
export BOND_NETWORK=devnet
export SOLANA_INDEX_NETWORK=devnet
export BOND_RPC_URL=https://api.devnet.solana.com
export BOND_PROGRAM_ID=887VzhmU4fYt5xgkks5F83eNmjsSFwyVMaTHm72Lmdis
mkdir -p "$HOME/.config/solana"
export ISSUER_KEYPAIR="$HOME/.config/solana/kase-reviewer-devnet.json"
solana-keygen new --outfile "$ISSUER_KEYPAIR"
solana address --keypair "$ISSUER_KEYPAIR"
```

Top up the displayed address yourself with **devnet SOL**, then check it:

```sh
solana balance --keypair "$ISSUER_KEYPAIR" --url "$BOND_RPC_URL"
```

There is no airdrop step. Setup pays mint/account rent and sends 0.02 devnet SOL
for fees to each investor. Using the existing program avoids its approximately
2.37 SOL deployment deposit. Keep additional devnet SOL available for account
creation and subsequent actions.

### 2. Generate the new bond and investor wallets

The checkout already contains the bundled `.devnet` directory. Preserve it before
setup, which refuses to overwrite existing keys. Run this once; use a different
backup name if it already exists:

```sh
mv .devnet .devnet-bundled-backup
export DEMO_MATURITY_SECONDS=86400
npm run setup -- --public
```

This creates fresh bond/DEMOUSD mints, initializes the bond with maturity one day
away, distributes 10/5/2 bonds, seals bond issuance, and mints 20,000 DEMOUSD to
the issuer. It saves the new wallets and public metadata under `.devnet/`.
Do not run the full automated demo before the browser test: it consumes claims,
votes, and bonds. Save setup output and keep the wallets if setup fails.

Read the fresh addresses, which replace every bundled address in the live table:

```sh
node --input-type=module -e 'import fs from "node:fs"; console.log(JSON.stringify(JSON.parse(fs.readFileSync(".devnet/config.json", "utf8")), null, 2))'
solana address --keypair .devnet/issuer.json
solana address --keypair .devnet/investor-1.json
solana address --keypair .devnet/investor-2.json
solana address --keypair .devnet/investor-3.json
```

Run the four Base58 private-key one-liners from the first guide again. They now
read the **fresh** `.devnet` files. Import those accounts into Phantom/Solflare,
select devnet, and verify their addresses match your new configuration.

### 3. Test the fresh bond in the browser

On the hosted website, connect your fresh issuer and register the initialized
bond using the **new bond mint** from `.devnet/config.json`. Register the three
new investors. Follow the coupon, voting, and redemption sequence above using
those new wallets/mints and a unique space ID. Your fresh issuer controls this
bond, but does not control the shared deployed program's upgrade authority.
With the one-day maturity, principal redemption waits until the next day.
For a shorter demonstration, choose a smaller `DEMO_MATURITY_SECONDS` before
setup, allowing enough time to complete snapshots, voting, and deposits.

If you prefer your own frontend/backend, follow **Run** and **Configuration**
below. Set backend `BOND_NETWORK=devnet`, `SOLANA_INDEX_NETWORK=devnet`,
`BOND_RPC_URL=https://api.devnet.solana.com`, and the program ID above, alongside
S3, 4EVERLAND, and Solana Index credentials. Set `APP_ORIGIN=http://localhost:5173`.
Frontend needs `VITE_PRIVY_APP_ID` and an allowed localhost origin.
`ISSUER_KEYPAIR` is for CLI scripts only, not the backend service environment.

### 4. Optional: deploy your own program as well

For an independent program, install the Rust/Anchor/Agave tools listed in
[contracts/README.md](contracts/README.md), then from `contracts/`:

```sh
npm run build
export BOND_PROGRAM_ID="$(solana address -k target/deploy/kase_bond-keypair.json)"
solana program deploy --url "$BOND_RPC_URL" --keypair "$ISSUER_KEYPAIR" --program-id target/deploy/kase_bond-keypair.json target/deploy/kase_bond.so
solana program show --url "$BOND_RPC_URL" "$BOND_PROGRAM_ID"
```

Manually fund the issuer for deployment before running this command. Configure
**your own backend** with the new program ID and generated backend IDL, restart
it, and use your own frontend. The hosted backend targets the shared program,
so it cannot prepare transactions for your independent deployment. Perform the
fresh setup and browser sequence afterward with the new program ID.

## Run

Use Node 24 and pnpm 12.6.0. Backend and frontend install and deploy independently, with
their own package files, lockfiles, and environment configuration. Copy
each directory's `.env.example` to `.env` and fill the settings below.

```sh
cd backend
pnpm install
pnpm run dev
```

In another terminal:

```sh
cd frontend
pnpm install
pnpm run dev
```

Open `http://localhost:5173`. The backend listens on `127.0.0.1:3101`.
Vite proxies `/voting-api`, including Solana Index lookups, to the backend.

```sh
pnpm --dir backend run lint
pnpm --dir backend test
pnpm --dir frontend run lint
pnpm --dir frontend test
pnpm --dir frontend run build
pnpm --dir backend start
```

Deploy `frontend/dist` to your static host. Run the backend separately and
proxy `/voting-api/*` from the frontend origin to the backend. Other browser
paths should serve the frontend's `index.html` for SPA navigation. Set
backend `APP_ORIGIN` to that exact browser origin. `HOST` defaults to loopback.
The backend never serves frontend assets. `frontend`'s `pnpm start` is a
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
- `BOND_RPC_URL`, `BOND_PROGRAM_ID`, `BOND_NETWORK`: optional confirmed
  Solana RPC, deployed Anchor program, and `localnet`, `devnet`, or
  `mainnet-beta`. Omit these to run the original voting application alone.
  The hackathon configuration uses `devnet`. Local tests explicitly inject
  historical fixtures.
- `SOLANA_INDEX_NETWORK`: `devnet` or `mainnet-beta`; defaults to devnet when
  `BOND_NETWORK=devnet`, otherwise mainnet-beta. Devnet queries use Solana
  Index `/api/v1/solana/devnet/`; mainnet paths are unchanged. Public bond
  settlement and historical queries must use the same network. Devnet S3
  records and IPFS upload objects use a separate `devnet/` prefix, preserving
  existing mainnet records without mixing balances, slots or votes.

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
The server does not custody wallets or keys. Existing votes remain off-chain.
Bond coupon claims, escrow deposits, principal settlement, and result
commitments require wallet-signed transactions and SOL for fees. The
backend prepares and submits transactions, verifies confirmation and the
exact signed transaction message, and reads the program's state.

## Checks

`pnpm --dir backend test` covers signature compatibility, tampering, timestamp expiry,
owner restrictions, snapshots, exact tallies, duplicate/concurrent votes,
closed voting, zero balances, upstream failures, and input/origin limits.
Tests use mocked S3/IPFS and Solana Index, without spending requests or
uploading files. Real Privy login and storage need your configuration.

Desktop/mobile browser checks use mocked read responses:

```sh
cd frontend
npx playwright install chromium
pnpm run test:browser
```

The Privy React SDK runs through Preact's compatibility layer. References:
[Preact compatibility](https://preactjs.com/guide/v10/getting-started/),
[Privy Solana signing](https://docs.privy.io/wallets/using-wallets/solana/sign-a-message).

## License

Licensed under the [MIT License](LICENSE).
