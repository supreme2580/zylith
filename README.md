# Zylith Protocol

Zylith is a shielded Concentrated Liquidity Market Maker (CLMM) on Starknet/Ztarknet. The MVP is a fully functional but minimal private AMM where all core swap and LP actions are proved in zero knowledge while the CLMM math and tick behavior closely follow Ekubo.

This README documents the system architecture, what is in scope for the MVP, and the exact build/deploy flow.

## System Architecture Summary

### CLMM Core (Cairo)

- Core pool mechanics: sqrt price, active tick, liquidity, fee growth, protocol fees.
- Tick structures: liquidity net/delta, fee growth outside, initialized tick bitmap, Ekubo‑style tick navigation.
- Swap engine: `swap_step` loop, tick crossing, protocol fee accounting, 128.128 sqrt‑price math and u128 liquidity/fee arithmetic.
- Liquidity management: add/remove liquidity across tick ranges with positions keyed by cryptographic commitments instead of addresses.

### Shielded Pool

- Commitments represent private balances with Privacy Pools–style structure: `Poseidon(Poseidon(secret, nullifier), amount)`.
- Merkle tree roots are tracked on‑chain; nullifiers prevent double spends; historical roots are accepted via the Merkle component.

### Private Swap & LP Layer

- Private swaps: user proves note ownership, sufficient balance, and correct CLMM price transition; the circuit enforces new price/output commitment consistency.
- Private LP: liquidity positions are bound to commitments; mint/burn verify available balance via membership and nullifier checks while tick bounds stay public in the MVP.

### Association Set Provider (ASP)

- Rust (Axum) server maintains an off‑chain Merkle tree replica from `Deposit` events, aligned with the on‑chain tree (height 25 → 2^24 leaves, 24 path elements).
- Serves Merkle paths and associated metadata for the Circom prover and frontend.

### Verifier Layer

- Groth16 proofs verified via **Garaga‑generated** Cairo contracts.
- Swap and LP verifier contracts live under `contracts/swap_verifier` and `contracts/lp_verifier` and are wired into `ZylithPool`.

## Project Structure

- `contracts/`: Cairo contracts (core CLMM + privacy + verifiers).
- `circom_circuits/`: Circom swap/LP circuits and VKs.
- `asp_server/`: Rust ASP for Merkle paths.
- `frontend/`: Next.js app (wallet, proofs, swaps, LP, withdrawals).

## MVP Scope and Design Choices

### CLMM Functionality Included

- Swap engine with Ekubo‑like semantics (`swap_step`, tick crossing, fee flows).
- Pool state: sqrt price, current tick, active liquidity, fee growth, protocol fees.
- Liquidity management over public tick ranges with positions keyed by commitments.
- Fee growth inside range and LP rewards accounting, with public fee collection.

### Privacy Features Included

- Shielded deposits and withdrawals via commitments and a Merkle tree.
- Private swaps (note ownership + swap math + output commitment verified in ZK).
- Private LP mint/burn bound to commitments instead of addresses.
- Nullifier checks for double‑spend protection.
- Tick ranges remain public in the MVP (range privacy is deferred).

### Privacy Features Not in MVP (Intentional)

- Private multi‑hop routing and private route selection.
- Private range selection and private limit orders.
- Private oracle integration and private TWAMM/long‑range orders.
- Private fee collection, private pool initialization, and proof aggregation.

These are part of the long‑term design but explicitly out of scope for this MVP.

### Additional Design Notes

- Full‑spend notes: private swap/LP proofs consume a full note and emit a fresh output note.
- Output commitments: circuits bind `change_commitment` to the new note’s commitment.
- Reserve safety: withdrawals and fee collection use safe subtraction to avoid underflow.
- Tokens are set in the pool constructor (no post‑deployment init).
- Token prices: We intentionally did not include live token prices for the MVP. We assume token1 and token2 are the same price (STRK and USDC on Sepolia). Both can be obtained from the Ekubo testnet.

## Gas Costs (MVP Reality)

Shielded actions are more expensive than public swaps/LP because each transaction does **more work**:
- proof verification (Groth16 via Garaga),
- merkle root/path checks,
- nullifier tracking,
- and extra calldata for proof inputs.

This is expected for privacy‑preserving flows and will be optimized in later versions.

## Build & Deploy (Exact Flow)

### 1) Circuits (Groth16)

From `circom_circuits`:

```bash
npm install

# Create PoT for 2^16 (swap/lp circuits require this size)
npx snarkjs powersoftau new bn128 16 pot16_0000.ptau -v
npx snarkjs powersoftau contribute pot16_0000.ptau pot16_0001.ptau --name="zylith" -v -e="zylith"
npx snarkjs powersoftau prepare phase2 pot16_0001.ptau pot16_final.ptau -v

mkdir -p build
circom swap.circom --wasm --r1cs -o ./build -l node_modules
circom lp.circom --wasm --r1cs -o ./build -l node_modules

npx snarkjs groth16 setup build/swap.r1cs pot16_final.ptau swap_0000.zkey
npx snarkjs zkey contribute swap_0000.zkey swap_final.zkey --name="zylith" -v -e="zylith"
npx snarkjs zkey export verificationkey swap_final.zkey swap_vk.json

npx snarkjs groth16 setup build/lp.r1cs pot16_final.ptau lp_0000.zkey
npx snarkjs zkey contribute lp_0000.zkey lp_final.zkey --name="zylith" -v -e="zylith"
npx snarkjs zkey export verificationkey lp_final.zkey lp_vk.json
```

### 2) Generate Garaga Verifiers

```bash
garaga gen --system groth16 --vk swap_vk.json --project-name swap_verifier
garaga gen --system groth16 --vk lp_vk.json --project-name lp_verifier
```

### 3) Copy Verifiers into Contracts

```bash
cp swap_verifier/src/groth16_verifier.cairo ../contracts/swap_verifier/src/swap_verifier.cairo
cp swap_verifier/src/groth16_verifier_constants.cairo ../contracts/swap_verifier/src/swap_verifier_constants.cairo
cp lp_verifier/src/groth16_verifier.cairo ../contracts/lp_verifier/src/lp_verifier.cairo
cp lp_verifier/src/groth16_verifier_constants.cairo ../contracts/lp_verifier/src/lp_verifier_constants.cairo
```

**Rename modules/traits to match pool imports**:

- `swap_verifier.cairo`: `ISwapVerifier` + `SwapVerifier`
- `lp_verifier.cairo`: `ILPVerifier` + `LPVerifier`

### 4) Copy Circuit Artifacts to Frontend

```bash
mkdir -p ../frontend/public/circuits
cp build/swap_js/swap.wasm ../frontend/public/circuits/swap.wasm
cp swap_final.zkey ../frontend/public/circuits/swap.zkey
cp swap_vk.json ../frontend/public/circuits/swap_vk.json
cp build/lp_js/lp.wasm ../frontend/public/circuits/lp.wasm
cp lp_final.zkey ../frontend/public/circuits/lp.zkey
cp lp_vk.json ../frontend/public/circuits/lp_vk.json
```

### 5) Deploy (Sepolia)

```bash
cd ../contracts
sncast --account <ACCOUNT> declare --package swap_verifier --contract-name SwapVerifier --network sepolia
sncast --account <ACCOUNT> deploy --class-hash <SWAP_CLASS_HASH> --network sepolia

sncast --account <ACCOUNT> declare --package lp_verifier --contract-name LPVerifier --network sepolia
sncast --account <ACCOUNT> deploy --class-hash <LP_CLASS_HASH> --network sepolia

sncast --account <ACCOUNT> declare --package zylith_core --contract-name ZylithPool --network sepolia
sncast --account <ACCOUNT> deploy --class-hash <POOL_CLASS_HASH> --network sepolia --constructor-calldata \
  <SWAP_VERIFIER_ADDR> \
  <LP_VERIFIER_ADDR> \
  <TOKEN0_ADDR> \
  <TOKEN1_ADDR> \
  79228162514264337593544 0 0 3000
```

## Public Inputs (MVP Circuits)

- **swap.circom**:  
  `root, nullifier_hash, amount_in, amount_out, min_amount_out, change_commitment, sqrt_price, liquidity, zero_for_one`
- **lp.circom**:  
  `root, nullifier_hash, liquidity_delta, tick_lower, tick_upper, change_commitment, sqrt_price, sqrt_lower, sqrt_upper`

## ASP Server Setup

```bash
cd asp_server
cp env.example .env
# set ZYLITH_POOL_ADDRESS
cargo run
```

## Frontend App

```bash
cd frontend
cp env.example .env.local
# set all contract addresses
npm install
npm run dev
```

## Latest Mainnet Deployment

- **ZylithPool**: `0x049b1ddef5dfc31480b0b91eb109380f56e82efca3c25026b7661c5ac9529d2f`
- **SwapVerifier**: `0x02af54902e4b804e5e0c61f7a74e5cdc7dea059bac8ac21760d2d8042f46c842`
- **LPVerifier**: `0x00d70e44af2219cea0a9045cf3254cb99f6e66b2b3ab70a27a68b7250a162f95`
- **Token0 (STRK)**: `0x04718f5a0Fc34cC1AF16A1cdee98fFB20C31f5cD61D6Ab07201858f4287c938D`
- **Token1 (USDC)**: `0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb`

## What’s Not in MVP (Intentional)

- TWAMM
- Limit orders
- Oracle extension
- Private routing and multi‑hop swaps
- Private range selection and private fee collection

These are deferred to the full protocol, while the MVP focuses on proof‑backed private swaps and LP on a working CLMM core.
