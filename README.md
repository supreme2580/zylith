# Zylith Protocol

Zylith is a shielded Concentrated Liquidity Market Maker (CLMM) on Starknet/Ztarknet. It enables private trading and liquidity provision using Zero-Knowledge Proofs.

## Project Structure
- `zylith/contracts`: Cairo v2.14.0 smart contracts (Workspace: core, privacy, swap_verifier, lp_verifier).
- `zylith/circom_circuits`: Circom v2.1.6 circuits for Swap and LP verification.
- `zylith/asp_server`: Rust (Axum) Association Set Provider server for Merkle path reconstruction.
- `zylith/frontend`: Next.js 16 frontend with Starknet-React and Garaga proof formatting.

## Full Deployment Guide

### 1. Build ZK Circuits
Navigate to `zylith/circom_circuits`:

```bash
# A. Generate Powers of Tau (Required for Groth16)
snarkjs powersoftau new bn128 14 pot14_0000.ptau -v
snarkjs powersoftau contribute pot14_0000.ptau pot14_0001.ptau --name="Zylith Contribution" -v
snarkjs powersoftau prepare phase2 pot14_0001.ptau pot14_final.ptau -v

# B. Compile Circuits to R1CS and WASM
mkdir -p build
circom swap.circom --wasm --r1cs -o ./build -l node_modules
circom lp.circom --wasm --r1cs -o ./build -l node_modules

# C. Setup ZKeys & Verification Keys (VKs)
snarkjs groth16 setup build/swap.r1cs pot14_final.ptau swap_final.zkey
snarkjs zkey export verificationkey swap_final.zkey swap_vk.json

snarkjs groth16 setup build/lp.r1cs pot14_final.ptau lp_final.zkey
snarkjs zkey export verificationkey lp_final.zkey lp_vk.json
```

### 2. Generate Garaga Verifiers (Cairo)
```bash
garaga gen --system groth16 --vk swap_vk.json --project-name swap_verifier
garaga gen --system groth16 --vk lp_vk.json --project-name lp_verifier
```

### 3. Move & Tweak Verifiers
After generating the verifiers, move them to the contract directories and perform these **mandatory renames** to avoid naming collisions:

```bash
# Move Swap Verifier
mv swap_verifier/src/groth16_verifier.cairo ../contracts/swap_verifier/src/swap_verifier.cairo
mv swap_verifier/src/groth16_verifier_constants.cairo ../contracts/swap_verifier/src/swap_verifier_constants.cairo

# Move LP Verifier
mv lp_verifier/src/groth16_verifier.cairo ../contracts/lp_verifier/src/lp_verifier.cairo
mv lp_verifier/src/groth16_verifier_constants.cairo ../contracts/lp_verifier/src/lp_verifier_constants.cairo

# Copy circuit artifacts to frontend
cp build/swap_js/swap.wasm ../frontend/public/circuits/swap.wasm
cp swap_final.zkey ../frontend/public/circuits/swap.zkey
cp swap_vk.json ../frontend/public/circuits/swap_vk.json

cp build/lp_js/lp.wasm ../frontend/public/circuits/lp.wasm
cp lp_final.zkey ../frontend/public/circuits/lp.zkey
cp lp_vk.json ../frontend/public/circuits/lp_vk.json
```

**⚠️ Important Manual Tweaks:**

To avoid naming collisions and match the `ZylithPool` expectations, you must rename the traits and modules. Here is exactly what to change in `swap_verifier.cairo`:

**Before:**
```cairo
use super::groth16_verifier_constants::{...};

#[starknet::interface]
pub trait IGroth16VerifierBN254<TContractState> { ... }

#[starknet::contract]
mod Groth16VerifierBN254 {
    impl IGroth16VerifierBN254 of super::IGroth16VerifierBN254<ContractState> { ... }
}
```

**After (Correct):**
```cairo
// 1. Change import to match the local constants file
use super::swap_verifier_constants::{N_PUBLIC_INPUTS, ic, precomputed_lines, vk};

#[starknet::interface]
pub trait ISwapVerifier<TContractState> { ... } // 2. Rename Trait

#[starknet::contract]
mod SwapVerifier { // 3. Rename Module
    // 4. Update the implementation line to match the new names
    impl ISwapVerifier of super::ISwapVerifier<ContractState> { ... }
}
```

*(Perform the same steps for `lp_verifier.cairo`, using `lp_verifier_constants`, `ILPVerifier`, and `LPVerifier` names instead.)*

3.  **Imports**: Ensure `contracts/core/src/pool.cairo` correctly imports `ISwapVerifierDispatcher` and `ILPVerifierDispatcher`.

### 4. Deploy to Starknet (Sepolia)

#### A. Deploy Swap Verifier
```bash
cd contracts
sncast declare --package swap_verifier --contract-name SwapVerifier --network sepolia
sncast deploy --class-hash <SWAP_CLASS_HASH> --network sepolia
# SAVE: SWAP_VERIFIER_ADDRESS
```

#### B. Deploy LP Verifier
```bash
sncast declare --package lp_verifier --contract-name LPVerifier --network sepolia
sncast deploy --class-hash <LP_CLASS_HASH> --network sepolia
# SAVE: LP_VERIFIER_ADDRESS
```

#### C. Deploy ZylithPool
```bash
sncast declare --package zylith_core --contract-name ZylithPool --network sepolia
sncast deploy --package zylith_core --contract-name ZylithPool --network sepolia --constructor-calldata \
  <SWAP_VERIFIER_ADDR> \
  <LP_VERIFIER_ADDR> \
  <TOKEN0_ADDR> \
  <TOKEN1_ADDR> \
  79228162514264337593543950336 0 100 10
```

**Constructor Parameters Explained:**
1. `swap_verifier`: Address of the SwapVerifier contract.
2. `lp_verifier`: Address of the LPVerifier contract.
3. `token0`: Address of the first ERC20 token.
4. `token1`: Address of the second ERC20 token.
5. `initial_sqrt_price`: Two felts (`79228162514264337593543950336 0`) representing $2^{96}$ (Price of 1.0 in Q96 fixed-point).
6. `protocol_fee_rate`: `100` (1.00%).
7. `withdrawal_fee_rate`: `10` (0.10%).

### Updated ZK Public Inputs
After the latest MVP updates, the circuits include additional public inputs:

- **swap.circom** public inputs:
  `root, nullifier_hash, amount_in, amount_out, min_amount_out, change_commitment, sqrt_price, liquidity, zero_for_one`

- **lp.circom** public inputs:
  `root, nullifier_hash, liquidity_delta, tick_lower, tick_upper, change_commitment, sqrt_price, sqrt_lower, sqrt_upper`

## ASP Server Setup
1. Update `zylith/asp_server/env.example` $\rightarrow$ `.env` with your `ZYLITH_POOL_ADDRESS`.
2. Run with `cargo run`.

## Frontend Setup
1. Copy circuit artifacts from `zylith/circom_circuits/build/*_js/*.wasm` and the generated `.zkey`/`.json` files to `zylith/frontend/public/circuits/`.
2. Update `zylith/frontend/env.example` $\rightarrow$ `.env.local` with all contract addresses.
3. Install dependencies and run:
   ```bash
   npm install
   npm run dev
   ```

## Deployment (Jan 12, 2026)
- **ZylithPool**: `0x037fc465a0b97ef7286f33847dbba763d9dbc2b7fe5830453399d0744c3051c3`
- **SwapVerifier**: `0x03f07de4c998c91097820e20c6250f3c46d63af55dba32a75f6c95b983727406`
- **LPVerifier**: `0x0063fc1bad88254572d7acdc19bd14f80206cb37122443d6203956cde0e8dd7d`

## How to Rebuild
```bash
# 1. Compile circuits
cd circom_circuits
circom swap.circom --wasm --r1cs --output . -l node_modules
snarkjs groth16 setup swap.r1cs powersOfTau28_hez_final_14.ptau swap_0000.zkey
snarkjs zkey contribute swap_0000.zkey swap_final.zkey --name="1st" -v -e="some text"
snarkjs zkey export verificationkey swap_final.zkey swap_vk.json

# 2. Generate Cairo verifiers
garaga gen --system groth16 --vk swap_vk.json --project-name swap_verifier
cp swap_verifier/src/groth16_verifier_constants.cairo ../contracts/swap_verifier/src/swap_verifier_constants.cairo

# 3. Redeploy
cd ../contracts
sncast declare --network sepolia --contract-name SwapVerifier --package swap_verifier
sncast deploy --network sepolia --class-hash <NEW_HASH>
# ... update pool ...
```
