// CLMM Math Constants
export const Q96 = 1n << 96n;
export const Q128 = 1n << 128n;
export const MAX_U256 = (1n << 256n) - 1n;
export const FELT_PRIME = BigInt("0x800000000000011000000000000000000000000000000000000000000000001");

// Fee constants
export const SWAP_FEE_RATE = 997000n; // 0.3% fee
export const FEE_DENOMINATOR = 1000000n;
export const LP_APPROVAL_BUFFER = 1005n; // 0.5% buffer
export const LP_BUFFER_DENOMINATOR = 1000n;
