# Architecture and reuse

| Existing component | Reuse or minimal extension |
| --- | --- |
| Fastify autoload, validation, Ed25519 signed envelopes | Existing authentication for every new mutation; one bonds plugin and grouped routes |
| `backend/lib/solana-index.js` | Server-side historical queries with existing API key, no custom indexer |
| S3 `get`, conditional `put`, paginated `list`, IPFS `pin` | Bond metadata, issuer-managed registry, immutable snapshots, transaction intents, result evidence |
| Space/proposal/vote routes and receipts | Unchanged voting flow, bond mint used as space token |
| Weighted aggregation | Shared `vote-tally.js`, also used for result manifests |
| Preact, Privy, signing protocol, existing stylesheet | Additional Bonds route, wallet transaction signing, themed issuer/investor panels |
| Deployment | Existing frontend/static host and independent Fastify backend, optional bond RPC configuration |

New code is limited to the single program in `contracts/`, snapshot arithmetic
and Merkle construction, a read/transaction client, bonds routes, a Bonds
component, and reproducible setup/demo scripts. There is no worker, database,
custom indexer, alternate authentication system, or replacement voting engine.

## Ownership and settlement

Coupon record dates use a finalized historical Solana slot. The issuer's
registered addresses are queried through Solana Index's
`token-balance/{address}/{mint}/{slot}` interface. Each response must match the
requested address, mint, slot, zero bond decimals, and supported integer range.
Registered quantities must sum to immutable expected issuance. Zero holders
remain in evidence but receive no claim leaf. Failed queries or incomplete
totals prevent snapshot creation. Timestamp evidence preserves exact versus
previous-block resolution rather than inventing an exact timestamp.

The canonical manifest includes mint/action/slot, timestamp resolution,
addresses, raw historical quantities, entitlements, totals, and Merkle root.
Its canonical SHA-256 hash accompanies the manifest, avoiding a self-referential
hash field. The signed request and hash/CID are stored using existing records.
IPFS publication uses the same 4EVERLAND helper.

The issuer signs initialization, funding, and immutable finalization. Coupon
vaults are action-specific PDA-controlled Token-2022 accounts. Finalization
checks sealed issuance, expected quantity, recomputed total liability, and
adequate funding. Claims recompute entitlement, verify the proof and investor,
transfer DEMOUSD, and initialize a deterministic claim PDA. Present ownership
does not participate in a coupon claim.

Redemption uses a separate bond escrow and principal vault, controlled by the
redemption PDA. Deposits transfer actual Token-2022 bonds and update each
investor's position and total locked quantity in the same transaction. Deposits
stop at cutoff and cannot be withdrawn. After maturity and cutoff, the issuer
finalizes only if escrow balances reconcile and principal funding is sufficient.
Full-position redemption burns the remaining locked bonds and transfers exact
principal in one instruction/transaction. All CPI/state effects roll back on
failure. Final coupons remain a separate action.

Voting continues as signed off-chain votes with historical weights and IPFS
receipts. After closing, the backend reads the existing tally, includes signed
vote receipt references in canonical evidence, publishes it, and prepares an
issuer transaction committing proposal hash, snapshot slot, result hash,
evidence hash, and voting end. A deterministic result PDA prevents replacement.
The program does not verify the tally itself.

## Encoding and integer rules

All quantities/amounts are decimal integer strings off-chain and `u64` on-chain,
with BigInt / checked `u128` intermediates. Face value is expressed in six-decimal
DEMOUSD base units. Initialization permits only an exact integral coupon amount
per bond; the general arithmetic helper floors division. Thus aggregate and
per-investor coupon totals agree for all accepted configurations. Overflow is
rejected rather than coerced to JavaScript numbers.

Action ID is SHA-256 of UTF-8 `KASE_ACTION_V1`, 32-byte bond mint, and UTF-8
action label. Coupon leaves hash UTF-8 `KASE_COUPON_V1`, mint bytes, action-ID
bytes, investor bytes, eligible quantity as eight-byte little endian, and
entitlement as eight-byte little endian. Inner nodes hash byte `1` followed by
lexicographically sorted children; odd nodes duplicate the last child. Proofs
have at most 32 siblings. Voting snapshots use a different leaf domain.
Canonical JSON sorts object keys recursively, preserves array order, and accepts
only safe integer JSON numbers. Investors are sorted before tree construction.
Rust and JavaScript share a checked test vector.

## Accounts and authority

BondConfig fixes issuer, both mints, economics, maturity, and expected issuance.
CorporateAction fixes record slot, root/hash, liability, and amount settled.
CouponClaim is unique per action/investor. RedemptionState fixes cutoff and
tracks locked/redeemed quantities, principal liability and paid amount.
EscrowPosition binds bond/investor and deposited/redeemed quantities.
VoteResultCommitment fixes proposal/snapshot/result/evidence references.

Every token operation constrains the Token-2022 program, PDA seeds, token-account
mint and authority, investor signer, and configured mints. Plain mints only,
without freeze authority/extensions, are accepted at initialization. Only bond
mint authority may initialize the bond; issuance must be revoked before economic
finalization. There are no issuer vault withdrawals or escrow-spending APIs.

Transactions are prepared without keys on the backend, signed through the
existing Privy wallet, and submitted through Fastify. The backend checks exact
transaction-message equality, signatures, RPC confirmation, execution success,
and reads on-chain status before saving a confirmed receipt. A supplied signature
alone is never treated as proof of settlement.
