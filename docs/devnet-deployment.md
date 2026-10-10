# Hackathon deployment on devnet

All three actions use devnet tokens, devnet transactions and **Solana Index
devnet historical balances**. This is not a mainnet/devnet hybrid. Devnet SOL
and DEMOUSD have no real monetary value.

The program is already deployed on devnet at
`887VzhmU4fYt5xgkks5F83eNmjsSFwyVMaTHm72Lmdis`.
Deployment signature, authority and verified binary hash are recorded in
[`contracts/deployments/devnet.json`](../contracts/deployments/devnet.json).
Use that program ID to run the demo without redeploying. Issuance, snapshots and
settlement are separate subsequent steps and have not yet been verified live.

## 1. Configure and fund the issuer

Use Node 24, Anchor 0.32.1, and Solana/Agave CLI 2.3.0 as documented in
`contracts/README.md`. Select an existing private issuer keypair file:

```sh
export BOND_NETWORK=devnet
export SOLANA_INDEX_NETWORK=devnet
export BOND_RPC_URL=https://api.devnet.solana.com
export ISSUER_KEYPAIR=/secure/devnet-issuer.json
```

If you need a new dedicated wallet, create it with `solana-keygen new --outfile
/secure/devnet-issuer.json`. Keep its recovery phrase and keypair private.

```sh
solana address --keypair "$ISSUER_KEYPAIR"
solana airdrop 2 "$(solana address --keypair "$ISSUER_KEYPAIR")" --url devnet
solana balance --keypair "$ISSUER_KEYPAIR" --url devnet
```

Use the CLI airdrop, not a browser faucet. Airdrops may be rate limited; a failed
request does not fund your wallet. Deployment requires the same storage deposit
as mainnet, but in free devnet SOL. The previous deployment reported roughly
2.37 SOL plus fees, so two SOL alone may not cover deployment and demo account
creation. Obtain additional devnet SOL through permitted CLI requests or a funded
devnet wallet. Do not use mainnet funds or mainnet transfer commands.

## 2. Build and deploy

From the repository root:

```sh
pnpm --dir backend install --frozen-lockfile
cd contracts
npm ci
npm run build
export BOND_PROGRAM_ID="$(solana address -k target/deploy/kase_bond-keypair.json)"
solana program deploy --url "$BOND_RPC_URL" --keypair "$ISSUER_KEYPAIR" \
  --program-id target/deploy/kase_bond-keypair.json target/deploy/kase_bond.so
solana program show --url "$BOND_RPC_URL" --keypair "$ISSUER_KEYPAIR" "$BOND_PROGRAM_ID"
```

Back up the deployment keypair. Deploy the updated backend IDL with the backend.
The direct CLI command selects devnet even though Anchor's local-test provider
remains localnet. No Anchor program logic or settlement invariant is weakened.

## 3. Configure the existing application

Set in `backend/.env`:

```dotenv
BOND_NETWORK=devnet
SOLANA_INDEX_NETWORK=devnet
BOND_RPC_URL=https://api.devnet.solana.com
BOND_PROGRAM_ID=YOUR_DEPLOYED_PROGRAM_ID
SOLANA_INDEX_API_KEY=YOUR_SERVER_ONLY_KEY
```

Configure the existing S3, 4EVERLAND, APP_ORIGIN and frontend Privy settings.
Never put API/storage keys into frontend variables. Restart the backend and
deploy the frontend build. `/voting-api/status` identifies devnet, the website
displays a devnet notice, and token/block/transaction links select devnet.

Keep Phantom or Solflare on devnet when connecting. The frontend reads the
network from `/voting-api/status`, connects the wallet, obtains a Privy SIWS
nonce, and signs a message with `Chain ID: devnet` before submitting it to Privy.
This avoids the SDK's default mainnet login message. Mainnet deployments retain
the existing login flow. Browser tests mock Privy and wallet extensions; acceptance
by the live Privy service and an actual extension still require manual verification.

The client uses `/api/v1/solana/devnet/slot`, `token-info/{mint}`,
`slot-timestamp/{slot}`, and `token-balance/{wallet}/{mint}/{slot}` with the existing
server-side bearer key. The original mainnet endpoint paths remain unchanged.
Both networks share the same signed voting format. Devnet storage uses `devnet/`
prefixes so original mainnet spaces, votes and corporate-action records remain
untouched. Switching back to mainnet restores access to the original namespace.
An explicit RPC/Index network mismatch prevents startup. RPC genesis hash is
also checked so a mainnet RPC labelled devnet cannot silently receive transactions.

## 4. Run the complete live demo

From `contracts/`, with the issuer variable still set:

```sh
export DEMO_MATURITY_SECONDS=900
npm run demo:devnet
```

The runner loads `backend/.env`, verifies authenticated Solana Index access and
real storage configuration, creates new devnet mints and investors, and drives
the same signed Fastify APIs used by the website. It uses actual devnet history,
S3/IPFS publication, coupon claims, weighted votes/result commitments, escrow
deposits, principal settlement and burning. It does not substitute mocked data
when an upstream call fails. Default accelerated maturity is 15 minutes; allow
longer when provider or storage latency is high. Voting and deposit windows are
two minutes each. The program enforces its normal clock conditions.

The issuer transfers 0.02 devnet SOL to each generated investor for fees/rent.
Private wallets are saved before transactions in ignored `contracts/.devnet/`.
Successful final reconciliation and actual signatures are saved in
`.devnet/result.json`, with `mocked: []`. Treat the run as successful only if it
finishes and verifies 850 DEMOUSD coupon payments, 17,000 DEMOUSD principal,
17 burned bonds, and zero remaining supply/liability. On failure inspect actual
state; do not delete keys or describe a partial run as complete. Back up and move
an existing `.devnet/` directory before starting a fresh full demo.

For a manual browser demo instead, run `npm run setup -- --public` with these
same devnet variables and a longer `DEMO_MATURITY_SECONDS` (for example 86400).
Then connect the issuer, register the initialized bond and all three holders,
and follow `docs/demo-script.md`. Setup already initializes the bond and seals
issuance, so use **Register an already initialized bond**. Import only generated
demo keys into investor wallets and select devnet. Coupon snapshots and voting
must occur before principal burns change the outstanding supply.

## Verification limits

Local tests mock historical responses and external persistence. The live runner
does neither. Real devnet execution requires a funded issuer, deployed program,
valid Solana Index API key and S3/IPFS credentials. Browser tests do not establish
real Privy/Phantom/Solflare transaction approval. Escrow still has no withdrawal
or recovery instruction, so only use demonstration assets.
