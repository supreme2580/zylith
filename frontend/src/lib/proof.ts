import { poseidon2 } from "poseidon-lite";

// Helper to ensure hex string
// Helper to ensure 64-char padded hex
const toHex64 = (v: bigint | string) => {
  const hex = typeof v === 'string' ? BigInt(v).toString(16) : v.toString(16);
  return '0x' + hex.padStart(64, '0');
};

const safeHex = (v: any) => {
  if (typeof v === 'string' && v.startsWith('0x')) return v;
  return toHex64(BigInt(v));
};

const FELT_PRIME = BigInt("0x800000000000011000000000000000000000000000000000000000000000001");
const toFelt = (v: bigint | number | string) => {
  let bn = BigInt(v);
  if (bn < 0n) bn = (bn % FELT_PRIME + FELT_PRIME) % FELT_PRIME;
  return bn.toString();
};

export interface ZKProofResult {
  proof: any;
  publicInputs: string[];
}

/**
 * Generates ZK proof for private swap
 */
export async function generateZylithSwapProof(
  secret: string,
  nullifier: string,
  balance: bigint,
  outSecret: string,
  outNullifier: string,
  amountIn: bigint,
  merklePath: { path: string[], indices: number[] },
  root: string,
  amountOut: bigint,
  minAmountOut: bigint,
  sqrtPrice: bigint,
  liquidity: bigint,
  zeroForOne: boolean
): Promise<ZKProofResult> {
  if (typeof window === 'undefined') throw new Error("Browser only");
  const snarkjs = (await import('snarkjs')) as any;

  const secretBI = BigInt(safeHex(secret));
  const nullifierBI = BigInt(safeHex(nullifier));
  const balanceBI = BigInt(balance);
  const outSecretBI = BigInt(safeHex(outSecret));
  const outNullifierBI = BigInt(safeHex(outNullifier));

  // Note Hasher (Poseidon(secret, nullifier))
  const noteHash = poseidon2([secretBI, nullifierBI]);
  
  // Commitment (Poseidon(noteHash, balance))
  const commitment = poseidon2([BigInt(noteHash), balanceBI]);

  // Nullifier Hash (Poseidon(secret, commitment))
  const nullifierHash = poseidon2([secretBI, BigInt(commitment)]);

  // Output Note Commitment (Poseidon(outNoteHash, amountOut))
  const outNoteHash = poseidon2([outSecretBI, outNullifierBI]);
  const outCommitment = poseidon2([BigInt(outNoteHash), amountOut]);

  const padPath = (path: string[], targetLen: number) => {
    const padded = [...path];
    while (padded.length < targetLen) padded.push("0x0");
    return padded;
  };

  const padIndices = (indices: number[], targetLen: number) => {
    const padded = [...indices];
    while (padded.length < targetLen) padded.push(0);
    return padded;
  };

  const Q96 = 2n ** 96n;
  const amountInLessFee = (amountIn * 997000n) / 1000000n;
  let sqrtNext = 0n;
  if (zeroForOne) {
    const denom = liquidity * Q96 + amountInLessFee * sqrtPrice;
    sqrtNext = (liquidity * Q96 * sqrtPrice) / (denom === 0n ? 1n : denom);
  } else {
    sqrtNext = sqrtPrice + (amountInLessFee * Q96) / (liquidity === 0n ? 1n : liquidity);
  }

  const Q96_SQ = Q96 * Q96;
  const lhs0 = amountOut * Q96;
  const rhs0 = liquidity * (sqrtPrice > sqrtNext ? sqrtPrice - sqrtNext : 0n);
  const check0_v = (rhs0 >= lhs0) ? 1n : 0n;

  const lhs1 = amountOut * sqrtNext * sqrtPrice;
  const rhs1 = amountInLessFee * Q96_SQ;
  const check1_v = (rhs1 >= lhs1) ? 1n : 0n;

  const inputs = {
    secret: secretBI.toString(),
    nullifier: nullifierBI.toString(),
    balance: balanceBI.toString(),
    amount_in: amountIn.toString(),
    path_elements: padPath(merklePath.path, 25).map(p => BigInt(safeHex(p)).toString()),
    path_indices: padIndices(merklePath.indices, 25).map(i => i.toString()),
    root: BigInt(safeHex(root || "0x0")).toString(),
    nullifier_hash: nullifierHash.toString(),
    amount_out: amountOut.toString(),
    min_amount_out: minAmountOut.toString(),
    out_secret: outSecretBI.toString(),
    out_nullifier: outNullifierBI.toString(),
    change_commitment: outCommitment.toString(),
    sqrt_price: sqrtPrice.toString(),
    liquidity: liquidity.toString(),
    zero_for_one: zeroForOne ? "1" : "0",
    sqrt_next_v: sqrtNext.toString(),
    out_sqrt_next_v: (amountOut * sqrtNext).toString(),
    check0_v: check0_v.toString(),
    check1_v: check1_v.toString()
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs,
    "/circuits/swap.wasm",
    "/circuits/swap.zkey"
  );

  return { proof, publicInputs: publicSignals };
}

/**
 * Generates ZK proof for private liquidity operations
 */
export async function generateZylithLPProof(
  secret: string,
  nullifier: string,
  balance: bigint,
  outSecret: string,
  outNullifier: string,
  liquidityDelta: bigint,
  tickLower: number,
  tickUpper: number,
  merklePath: { path: string[], indices: number[] },
  root: string,
  sqrtPrice: bigint,
  sqrtLower: bigint,
  sqrtUpper: bigint
): Promise<ZKProofResult> {
  if (typeof window === 'undefined') throw new Error("Browser only");
  const snarkjs = (await import('snarkjs')) as any;

  const secretBI = BigInt(safeHex(secret));
  const nullifierBI = BigInt(safeHex(nullifier));
  const balanceBI = BigInt(balance);
  const outSecretBI = BigInt(safeHex(outSecret));
  const outNullifierBI = BigInt(safeHex(outNullifier));

  const noteHash = poseidon2([secretBI, nullifierBI]);
  const commitment = poseidon2([BigInt(noteHash), balanceBI]);
  const nullifierHash = poseidon2([secretBI, BigInt(commitment)]);
  const outNoteHash = poseidon2([outSecretBI, outNullifierBI]);
  const outCommitment = poseidon2([BigInt(outNoteHash), liquidityDelta]);

  const padPath = (path: string[], targetLen: number) => {
    const padded = [...path];
    while (padded.length < targetLen) padded.push("0x0");
    return padded;
  };

  const padIndices = (indices: number[], targetLen: number) => {
    const padded = [...indices];
    while (padded.length < targetLen) padded.push(0);
    return padded;
  };

  const inputs = {
    secret: secretBI.toString(),
    nullifier: nullifierBI.toString(),
    balance: balanceBI.toString(),
    amount_in: liquidityDelta.toString(),
    out_secret: outSecretBI.toString(),
    out_nullifier: outNullifierBI.toString(),
    tick_lower: toFelt(tickLower),
    tick_upper: toFelt(tickUpper),
    path_elements: padPath(merklePath.path, 25).map(p => BigInt(safeHex(p)).toString()),
    path_indices: padIndices(merklePath.indices, 25).map(i => i.toString()),
    root: BigInt(safeHex(root || "0x0")).toString(),
    nullifier_hash: nullifierHash.toString(),
    change_commitment: outCommitment.toString(),
    sqrt_price: sqrtPrice.toString(),
    sqrt_lower: sqrtLower.toString(),
    sqrt_upper: sqrtUpper.toString()
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs,
    "/circuits/lp.wasm",
    "/circuits/lp.zkey"
  );

  return { proof, publicInputs: publicSignals };
}

/**
 * Formats Groth16 proof for Starknet using Garaga
 */
export async function formatGroth16ProofForStarknet(
  proof: any, 
  publicInputs: string[], 
  vkPath: string
): Promise<string[]> {
  const { getGroth16CallData, CurveId, init } = (await import('garaga')) as any;
  await init();

  const vk = await fetch(vkPath).then(res => res.json());

  const curveId = CurveId.BN254;
  const g1 = (p: string[]) => ({ x: BigInt(p[0]), y: BigInt(p[1]), curveId });
  const g2 = (p: string[][]) => ({ 
    x: [BigInt(p[0][0]), BigInt(p[0][1])], 
    y: [BigInt(p[1][0]), BigInt(p[1][1])], 
    curveId 
  });

  const garagaProof = {
    a: g1(proof.pi_a),
    b: g2(proof.pi_b),
    c: g1(proof.pi_c),
    publicInputs: publicInputs.map(i => BigInt(i)),
  };

  const garagaVk = {
    alpha: g1(vk.vk_alpha_1),
    beta: g2(vk.vk_beta_2),
    gamma: g2(vk.vk_gamma_2),
    delta: g2(vk.vk_delta_2),
    ic: vk.IC.map((p: string[]) => g1(p)),
  };

  const fullCalldata = getGroth16CallData(garagaProof, garagaVk, curveId);
  return fullCalldata.map((c: bigint) => safeHex(c));
}
