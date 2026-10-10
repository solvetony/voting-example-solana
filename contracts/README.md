# KASE bond contracts

One Anchor program, separate from the existing web application. Its compiled
IDL is checked into `backend/idl/kase_bond.json` so deployment does not require
Rust on the backend host. Build output and all local keys are ignored.

## Tools and build

Use Node 24, Rust, Anchor CLI **0.32.1**, and Agave/Solana CLI **2.3.0**.
Ensure `anchor`, `solana`, `solana-test-validator`, and `cargo-build-sbf` are
on PATH. Linux builds need `pkg-config`, `libssl-dev`, and `libudev-dev`.
The build pins SBF platform tools **v1.57** because the locked dependencies
need the newer Rust compiler. The initial download needs network access.

```sh
cargo install anchor-cli --version 0.32.1 --locked
pnpm --dir backend install --frozen-lockfile
cd contracts
npm ci
npm run build
```

`anchor keys sync` creates a fresh ignored deployment key when necessary,
synchronizes `declare_id!` and `Anchor.toml`, and the build updates the backend
IDL. Keep those public identifiers and IDL together. Never commit the program
keypair. Preserve it securely if you need to redeploy to the same address.

## Local deployment

From `contracts/`, start a fresh validator in one terminal:

```sh
solana-test-validator --reset --ledger test-ledger \
  --bpf-program "$(solana address -k target/deploy/kase_bond-keypair.json)" \
  target/deploy/kase_bond.so
```

In another terminal, from `contracts/`:

```sh
npm run test:chain
```

This runs the complete real Token-2022/program settlement demonstration,
including negative cases. It takes approximately three minutes because it
waits for finalized slots and the configured accelerated maturity. Each run
creates fresh mints and investors. It writes ignored `.demo/config.json`,
`.demo/result.json`, and private local wallet files. `npm run demo` runs the
same flow without the Node test runner. See [demo instructions](../docs/demo-script.md).

## Public deployment

The hackathon target is **devnet**, including live Solana Index devnet history.
Follow [devnet deployment](../docs/devnet-deployment.md) for free devnet funding,
program deployment, and the full public-network demo. Mainnet deployment below
spends real SOL. Always match the RPC and Solana Index networks.

With an explicitly selected issuer/deployer wallet and funded SOL balance:

```sh
solana config set --url YOUR_RPC_URL --keypair /secure/issuer.json
solana program deploy --url YOUR_RPC_URL --keypair /secure/issuer.json \
  --program-id target/deploy/kase_bond-keypair.json target/deploy/kase_bond.so
solana program show --url YOUR_RPC_URL \
  "$(solana address -k target/deploy/kase_bond-keypair.json)"
```

Configure backend `BOND_RPC_URL`, `BOND_PROGRAM_ID` (the displayed address),
`BOND_NETWORK`, and its existing S3, 4EVERLAND, and Solana Index settings.
Restart the backend and rebuild/deploy the frontend as described in the root
README. No server-held signing key or new database is needed.

To issue the controlled demo distribution using your issuer key:
Back up and move any existing `contracts/.demo/` directory first. Public setup
refuses to overwrite it. Wallet keys are saved before any transactions so a
failed setup does not discard investor keys.

```sh
BOND_RPC_URL=YOUR_RPC_URL BOND_NETWORK=mainnet-beta \
  ISSUER_KEYPAIR=/secure/issuer.json DEMO_MATURITY_SECONDS=86400 \
  npm run setup -- --public
```

This creates plain Token-2022 mints with explicit issuer mint authorities,
initializes the bond, distributes 10/5/2 bonds, revokes bond mint authority,
and mints 20,000 mock DEMOUSD to the issuer. It never uses Permanent Delegate
or transfer hooks. Fund each generated investor with SOL for its own claims,
deposits, and redemption. Import only demonstration keys into a test wallet.
Register metadata and all three investors in the Bonds page, then follow the
public sequence in the demo guide. Choose cutoff and maturity with sufficient
time for history availability and transaction confirmation.

The program's upgrade authority remains a trusted deployer. Production
settlement requires an explicit upgrade-authority policy and review; this
prototype has not been deployed or audited for production.
