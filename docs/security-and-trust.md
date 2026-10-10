# Security and trust

This is a demonstration, not audited securities or production custody software.
DEMOUSD is a six-decimal mock token, not actual fiat or regulated stablecoin
issuance. Possessing these tokens does not establish legal debt rights.

The holder registry is issuer-managed. Solana Index answers historical balances
for specified wallets and does not enumerate every holder. All registry queries
must succeed, addresses must be unique, and totals must reconcile to immutable
expected issuance. Bond issuance must be sealed before snapshots/settlement.
These checks refuse the deterministic demo's missing-holder cases; they do not
replace issuer processes or independently enumerate unknown wallets. Transfers
to new wallets require registry maintenance before selecting later record dates.

Solana Index and backend evidence generation remain trusted for historical data,
completeness, and canonical evidence. The API key stays server-side. Finalized
slot selection is checked by the backend RPC; the program does not prove RPC
finality or verify the Solana Index response. Previous-block timestamp resolution
is explicitly disclosed. An issuer cannot mutate an already finalized root, but
an authorized issuer can initially commit inaccurate evidence. A root proves
membership in the committed data, not the correctness of that data source.

Coupons depend on record-date ownership. Transferring afterward does not erase
the historical holder's entitlement. Leaf domains bind mint, action, investor,
quantity, and amount; the program recalculates amounts, caps total settlement,
checks funding, and rejects duplicate claim accounts. Coupons and principal use
separate PDA vaults. Neither has issuer withdrawal instructions. The issuer
cannot cancel or drain reserved claims through this program.

Principal depends on actual program-held escrow quantities. Deposits and
accounting are atomic. Cutoff and maturity use the Solana Clock. Full-position
redemption burns escrowed bonds and pays configured principal atomically;
failure reverts both and accounting. There are no escrow withdrawals or
cancellations. Investors must understand that depositing locks assets and a
non-funding issuer can leave them locked. Production requires an explicitly
reviewed failure-recovery and funding policy.
Direct token transfers into the escrow bypass position accounting and can block
its strict finalization reconciliation. Use only the deposit instruction. This
MVP has no recovery instruction for unsolicited escrow deposits or externally
burned outstanding tokens; controlled distribution is part of the demo model.

Plain Token-2022 mints, fixed economics, strict signer/PDA/mint/account authority
checks and checked integer arithmetic constrain settlement. Bond issuance is
revoked after the controlled distribution. The settlement issuer can still mint
mock DEMOUSD, so the token has no credible cash-value guarantee.

Permanent Delegate and transfer hooks are not used. Bonds outside escrow cannot
be forcibly burned or retired. Unlocked supply and unredeemed positions remain
visible; settlement completion requires all required bonds accounted for.
Production mandatory redemption needs additional issuance controls, custody
arrangements, or token restrictions.

Voting is **off-chain signed voting with historical on-chain token ownership
and an on-chain final-result commitment**. Existing signatures prove choices,
while backend/S3 availability and vote inclusion remain trusted. The program
checks issuer authorization, close time, and immutable commitment identity. It
does not independently verify the tally or determine the proposal outcome.

Transaction intents do not authorize backend custody: wallets sign transactions.
Submission and confirmation require the original signer and exact prepared
message, confirmed successful execution, and fresh on-chain reads. Clients cannot
create a successful receipt by submitting an arbitrary transaction signature.

The deployer's upgrade authority can replace program logic. Immutable accounts
are only immutable under the deployed code and an appropriate upgrade policy.
Production requires independent contract review, authority governance, legal
issuance/KYC/AML and transfer controls, cash-settlement infrastructure, registry
operations, recovery rules, monitoring, availability controls, and explicit
data-source assurances. Those systems are outside this MVP.
