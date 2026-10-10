# Implementation status

Validated locally: 23 backend tests, 24 desktop/mobile browser checks, two Rust
unit tests, StandardJS and Rust formatting, frontend/SBF builds, and the complete
local-validator integration test. That test includes direct program authorization
and closed-voting checks, confirmed transaction rollback, 850 DEMOUSD coupons,
17,000 DEMOUSD principal and a final bond mint supply of zero.

## Implemented and locally tested

- Existing signed voting, historical weights, receipts, ownership and duplicate
  protections, with original API behavior retained.
- Single Anchor program in a separate `contracts/` workspace, compiled for SBF.
- Plain Token-2022 demo issuance, explicit authorities, 10/5/2 distribution,
  sealed bond issuance, dedicated coupon/principal vault funding.
- Issuer-managed registry and strict historical balance parsing, completeness
  reconciliation, integer amounts, canonical manifests, deterministic Merkle
  roots/proofs, matching Rust/JavaScript hashing.
- Immutable coupon finalization, adequate funding, historical coupon claims,
  500/250/100 DEMOUSD payouts, post-record-transfer eligibility, negative
  proof/investor/mint/vault/amount tests and duplicate claim rejection.
- Actual escrow transfers and investor positions, multiple deposits, cutoff,
  maturity and funding checks, no arbitrary issuer escrow withdrawal.
- Atomic full-position redemption, 10,000/5,000/2,000 DEMOUSD principal payouts,
  bond burning, wrong-account and duplicate protections, final reconciliation.
- Existing weighted bondholder votes and immutable issuer result commitments.
- Signed Fastify bond routes, exact transaction preparation/submission/confirmation,
  state reads, evidence storage through existing S3/IPFS interfaces.
- Bonds issuer/investor page and Privy transaction-signing integration; frontend
  build and browser checks use mocks rather than installed wallet extensions.
- Reproducible accelerated local demonstration, setup and deployment instructions.
- Devnet program deployed at `887VzhmU4fYt5xgkks5F83eNmjsSFwyVMaTHm72Lmdis`,
  slot 509459931. RPC-dumped code exactly matches the local binary. Public
  identifiers, signature and binary hash are in
  [`contracts/deployments/devnet.json`](../contracts/deployments/devnet.json).

## Mocked locally

- Solana Index responses for the local validator's historical slots. The actual
  existing server-side client remains the public integration path.
- S3 persistence and IPFS CIDs in the deterministic demo/backend tests. The demo
  uses real existing helper interfaces but does not publish to external services.
- Browser API/Privy responses. Wallet SDK signing paths are exercised in existing
  message-signing tests without actual Phantom/Solflare extension sessions.

## Implemented but not verified on a public network

- Live historical queries for newly issued bonds, real S3/IPFS bond manifests,
  and the complete public settlement sequence.
- Actual Privy wallet transaction approval against the deployed bond program.
- Devnet support: explicit Solana Index devnet routes, matching network checks,
  isolated persistence, correct explorer links, and a live `demo:devnet` runner.
  Routing and isolation are covered by automated tests; an authenticated live
  end-to-end devnet run still requires funded deployment and operator credentials.

The program deployment and bytecode are verified on devnet. External publication,
bond historical lookups and public settlement still require configured operator
credentials. See the deployment and demo guides.

On 2026-10-10, live devnet RPC genesis verification succeeded. The deployed Solana
Index devnet slot endpoint returned HTTP 401 without an API key. CLI devnet
airdrops failed with the faucet's rate-limit error, and the requested wallet
remained at zero devnet SOL. A separate persistent deployment wallet was then
funded and the program successfully deployed. Its issuer keypair is stored outside
the repository; API/storage credentials remain absent, preventing live settlement
and historical integration checks.

## Out of scope

On-chain tally verification, partial redemption, escrow cancellation, transfer
hooks, Permanent Delegate, generalized issuance/multi-issuer platform, KYC/AML,
mandatory retirement of unlocked bonds, trading, real cash settlement, custody
recovery and production securities infrastructure. No contract audit has been
performed.
