# Reproduce the demonstration

Build and start the local validator using [contracts instructions](../contracts/README.md).
Then run `npm --prefix contracts run test:chain` or `npm --prefix contracts run demo`.
The script drives existing Fastify routes in-process and real signed transactions
against the local validator. It generates three investors and never logs keys.
Solana Index responses, S3, and IPFS are explicitly mocked locally; actual token
transfers, PDA state, coupon proofs, vote commitments, burns, and rollback are not.

| Investor | Bonds | Semiannual coupon | Principal |
| --- | ---: | ---: | ---: |
| A | 10 | 500 DEMOUSD | 10,000 DEMOUSD |
| B | 5 | 250 DEMOUSD | 5,000 DEMOUSD |
| C | 2 | 100 DEMOUSD | 2,000 DEMOUSD |
| Total | 17 | 850 DEMOUSD | 17,000 DEMOUSD |

## Automated local sequence

1. Create plain Token-2022 bond (zero decimals) and DEMOUSD (six decimals) mints.
2. Initialize immutable 1,000 DEMOUSD face value, 10% annual coupon, two periods,
   expected issuance 17, and maturity approximately three minutes away.
3. Mint and distribute 10/5/2 bonds, revoke bond mint authority, and provision SOL
   and mock DEMOUSD. Register all three investors through signed Fastify requests.
4. Wait for finalized record slot. Query explicitly configured historical fixtures,
   generate canonical snapshot, Merkle proofs, and evidence through storage helpers.
5. Initialize coupon, reject insufficient funding and unauthorized finalization,
   fund 850 DEMOUSD, and finalize the immutable commitment.
6. Transfer one bond A to B after record date. A still claims 500 DEMOUSD using
   historical quantity 10. Verify all three payouts, invalid proofs/amounts/mints/
   investors/vaults and duplicate claim rejection. Return the bond for the original
   principal distribution.
7. Use existing signed space/proposal/vote routes for Approve/Reject/Abstain.
   Verify 10/5/2 historical vote weights. Wait for close, publish canonical result,
   commit it on-chain, and reject unauthorized commitment/replacement.
8. Open escrow with a future cutoff before maturity. A deposits 4 then 6 bonds,
   B deposits 5, C deposits 2. Verify escrow and position totals equal 17.
9. Reject wrong mint/source, issuer escrow withdrawal, early finalization, and
   deposits after cutoff. Wait for configured maturity without bypassing the
   program's clock checks.
10. Reject insufficient funding; fund 17,000 DEMOUSD and finalize redemption.
    Reject wrong investor/escrow/mint/destination. Submit a deliberately failing
    transaction after the redemption instruction and verify rollback of burn,
    payment, vault balances, and position accounting.
11. Redeem all three full positions, reject duplicate redemption, and verify
    zero bond supply, 17 redeemed/burned bonds, 17,000 DEMOUSD principal paid,
    and no remaining locked liability or unlocked bonds.

Public identifiers, actual local transaction signatures and final reconciliation
are saved in ignored `contracts/.demo/result.json`. Private keys are isolated in
ignored `.demo/` files. The accelerated demo selects an earlier legitimate
maturity; it does not add a privileged time bypass to the contract.

## Website and public integration

The deterministic local script's in-memory evidence is not persisted to the
website's real S3. For a browser demonstration, configure the existing S3/IPFS,
Privy app/origins and a deployed program as documented in the contract deployment
guide. For the hackathon use [devnet](devnet-deployment.md), including real
Solana Index devnet history. Register the setup script's
bond metadata in **Bonds**, register every investor, and retain issuer/investor
wallets for subsequent actions.

Before choosing a record slot, verify that the existing server-side Solana Index
endpoint returns the exact public bond mint/address/slot with `balanceRaw` and
decimals `0`. Wait for finalization and history availability. Do not use local
validator slots with the public API. Select devnet consistently using
`BOND_NETWORK=devnet` and `SOLANA_INDEX_NETWORK=devnet`.

Use issuer controls to generate a coupon, initialize its vault, fund it, and
finalize. Switch to each investor wallet to claim. Transfer after record date to
show unchanged historical eligibility. Create/bind a bondholder space, create
the amendment proposal, cast votes using the original voting UI, then publish
and commit its closed result. Open escrow sufficiently before maturity; every
investor locks all bonds before cutoff. Fund/finalize principal after maturity,
then redeem each full position. Use confirmed transaction explorer links and
compare live mint supply, escrow balance, paid totals, and remaining liability.

Partial deposits leave visible unlocked outstanding supply; never call the bond
fully retired while it is nonzero. Final coupon claims and principal are separate.

## Checks

```sh
pnpm --dir backend run lint
pnpm --dir backend test
pnpm --dir frontend run lint
pnpm --dir frontend run build
pnpm --dir frontend test
npm --prefix contracts run lint
cargo test --manifest-path contracts/Cargo.toml --lib
npm --prefix contracts run test:chain
```

Frontend tests use browser mocks, not actual wallet extensions. Public deployment,
real Privy transaction approvals, real historical bond lookups, and durable
S3/IPFS publication require operator configuration and separate verification.
