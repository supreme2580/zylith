# Zylith Protocol

Zylith is a shielded Concentrated Liquidity Market Maker (CLMM) on Starknet/Ztarknet. The MVP demonstrates a privacy-preserving AMM where swap/LP operations are proved in zero knowledge while matching Ekubo‑style CLMM math and tick behavior.

This README documents what we implemented for the bounty, the architecture choices, and the exact build/deploy flow used.

## Bounty Summary (What We Built)

### CLMM Core (Cairo)

- Ekubo‑like swap loop and `swap_step` math in 128.128 fixed‑point.
- Tick management, initialized tick bitmap, fee growth, and protocol fees.
- Liquidity positions keyed by **commitments** rather than addresses.
- Precision‑safe math for price transitions and liquidity deltas.

### Shielded Layer (Privacy MVP)

- Notes follow Privacy Pools: `commitment = Poseidon(Poseidon(secret, nullifier), amount)`.
- Merkle tree root tracking + nullifiers for double‑spend protection.
- **Private swaps**: proof asserts ownership + correct price transition + output commitment.
- **Private LP**: proof asserts ownership + liquidity delta + output commitment.
- Bounds/tick ranges are public in the MVP (range privacy deferred).

### ASP Server

- Rust (Axum) Association Set Provider recreates Merkle paths from on‑chain `Deposit` events.
- Tree height 25, 2^24 leaves, 24 path elements.
- Handles private operations that emit `amount = 0` by treating `note_hash` as a commitment.

### Verifier

- Groth16 via **Garaga** for swap + LP membership and math constraints.
- Verifier contracts embedded in `contracts/swap_verifier` and `contracts/lp_verifier`.

## Project Structure

- `contracts/`: Cairo contracts (core CLMM + privacy + verifiers).
- `circom_circuits/`: Circom swap/LP circuits and VKs.
- `asp_server/`: Rust ASP for Merkle paths.
- `frontend/`: Next.js app (wallet, proofs, swaps, LP, withdrawals).

## MVP Notes (Important Design Choices)

- **Full‑spend notes**: private swap/LP proofs consume a full note and produce a fresh output note.
- **Output commitments**: the circuits bind `change_commitment` to the output note commitment.
- **Reserve safety**: withdrawals/fee collection use safe subtraction to avoid underflow.
- **Tokens set at constructor**: pool is deployed with token0/token1 set (no post‑init step).
- **CLMM position composition**: LP positions **shift between token0/token1 as price moves** within the tick range. The UI shows the **current expected withdrawal amounts** based on live pool price, not the initial deposit ratio.

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
  79228162514264337593543950336 0 100 10
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

## Latest Sepolia Deployment

- **ZylithPool**: `0x0256b4b7fb5f536934df8f6734b6a2eb475f0fa5343a18c610dcd5a44c1eda67`
- **SwapVerifier**: `0x0667c9d49abe50706f10dfdc4106b350996cc19de65cfa0cbb93c422caa835bc`
- **LPVerifier**: `0x07691f9e332381715ca5c98b6a1c9b5092d3f5b7a1e4c9e2729c5e675baf3470`

## What’s Not in MVP (Intentional)

- TWAMM
- Limit orders
- Oracle extension
- Private routing and multi‑hop swaps
- Private range selection and private fee collection

These are deferred to the full protocol, while the MVP focuses on proof‑backed private swaps and LP on a working CLMM core.
