import { Q96, Q128, MAX_U256, SWAP_FEE_RATE, FEE_DENOMINATOR } from './constants';

/**
 * Get sqrt price at a given tick (Q96 fixed point)
 */
export const getSqrtPriceAtTick = (tick: number): bigint => {
  const absTick = Math.abs(tick);
  let ratio = Q128;

  const mulDivQ128 = (value: bigint, mul: bigint) => (value * mul) / Q128;

  if ((absTick & 0x1) !== 0) ratio = mulDivQ128(ratio, 0xfffcb933bd6fad37aa2d162d1a594001n);
  if ((absTick & 0x2) !== 0) ratio = mulDivQ128(ratio, 0xfff97272373d413259a46990580e213an);
  if ((absTick & 0x4) !== 0) ratio = mulDivQ128(ratio, 0xfff2e50f5f656932ef12357cf3c7fdccn);
  if ((absTick & 0x8) !== 0) ratio = mulDivQ128(ratio, 0xffe5caca7e10e4e61c3624eaa0941cd0n);
  if ((absTick & 0x10) !== 0) ratio = mulDivQ128(ratio, 0xffcb9843d60f6159c9db58835c926644n);
  if ((absTick & 0x20) !== 0) ratio = mulDivQ128(ratio, 0xff973b41fa98c081472e6896dfb254c0n);
  if ((absTick & 0x40) !== 0) ratio = mulDivQ128(ratio, 0xff2ea16466c96a3843ec78b326b52861n);
  if ((absTick & 0x80) !== 0) ratio = mulDivQ128(ratio, 0xfe5dee046a99a2a811c461f1969c3053n);
  if ((absTick & 0x100) !== 0) ratio = mulDivQ128(ratio, 0xfcbe86c7900a88aedcffc83b479aa3a4n);
  if ((absTick & 0x200) !== 0) ratio = mulDivQ128(ratio, 0xf987a7253ac413176f2b074cf7815e54n);
  if ((absTick & 0x400) !== 0) ratio = mulDivQ128(ratio, 0xf3392b0822b70005940c7a398e4b70f3n);
  if ((absTick & 0x800) !== 0) ratio = mulDivQ128(ratio, 0xe7159475a2c29b7443b29c7fa6e889d9n);
  if ((absTick & 0x1000) !== 0) ratio = mulDivQ128(ratio, 0xd097f3bdfd2022b8845ad8f792aa5825n);
  if ((absTick & 0x2000) !== 0) ratio = mulDivQ128(ratio, 0xa9f746462d870fdf8a65dc1f90e061e5n);
  if ((absTick & 0x4000) !== 0) ratio = mulDivQ128(ratio, 0x70d869a156d2a1b890bb3df62baf32f7n);
  if ((absTick & 0x8000) !== 0) ratio = mulDivQ128(ratio, 0x31be135f97d08fd981231505542fcfa6n);
  if ((absTick & 0x10000) !== 0) ratio = mulDivQ128(ratio, 0x9aa508b5b7a84e1c677de54f3e99bc9n);
  if ((absTick & 0x20000) !== 0) ratio = mulDivQ128(ratio, 0x5d6af8dedb81196699c329225ee604n);
  if ((absTick & 0x40000) !== 0) ratio = mulDivQ128(ratio, 0x2216e584f5fa1ea926041bedfe98n);
  if ((absTick & 0x80000) !== 0) ratio = mulDivQ128(ratio, 0x48a170391f7dc42444e8fa2n);

  if (tick > 0) ratio = MAX_U256 / ratio;

  const remainder = ratio & 0xffffffffn;
  let sqrtPriceX96 = ratio >> 32n;
  if (remainder > 0n) sqrtPriceX96 += 1n;
  return sqrtPriceX96;
};

/**
 * Calculate liquidity from amount0 (token0)
 */
export const getLiquidityFromAmount0 = (sqrtPA: bigint, sqrtPB: bigint, amount0: bigint): bigint => {
  if (sqrtPA === sqrtPB || amount0 === 0n) return 0n;
  const [sqrtPLow, sqrtPUpper] = sqrtPA < sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  const diff = sqrtPUpper - sqrtPLow;
  if (diff === 0n) return 0n;
  const intermediate = (sqrtPUpper * sqrtPLow) / Q96;
  return (amount0 * intermediate) / diff;
};

/**
 * Calculate liquidity from amount1 (token1)
 */
export const getLiquidityFromAmount1 = (sqrtPA: bigint, sqrtPB: bigint, amount1: bigint): bigint => {
  if (sqrtPA === sqrtPB || amount1 === 0n) return 0n;
  const [sqrtPLow, sqrtPUpper] = sqrtPA < sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  const diff = sqrtPUpper - sqrtPLow;
  if (diff === 0n) return 0n;
  return (amount1 * Q96) / diff;
};

/**
 * Calculate amount0 delta from liquidity
 */
export const getAmount0Delta = (sqrtPA: bigint, sqrtPB: bigint, liquidity: bigint): bigint => {
  const [sqrtPLow, sqrtPUpper] = sqrtPA < sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  if (sqrtPLow === sqrtPUpper || liquidity === 0n) return 0n;
  const diff = sqrtPUpper - sqrtPLow;
  // Formula: L * diff * Q96 / (sqrtPUpper * sqrtPLow)
  const numerator = liquidity * diff * Q96;
  const denominator = sqrtPUpper * sqrtPLow;
  return numerator / denominator;
};

/**
 * Calculate amount1 delta from liquidity
 */
export const getAmount1Delta = (sqrtPA: bigint, sqrtPB: bigint, liquidity: bigint): bigint => {
  const [sqrtPLow, sqrtPUpper] = sqrtPA < sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  if (sqrtPLow === sqrtPUpper || liquidity === 0n) return 0n;
  const diff = sqrtPUpper - sqrtPLow;
  return (liquidity * diff) / Q96;
};

/**
 * Calculate swap output amount (single-step CLMM)
 */
export const calculateSwapOutput = (
  amountIn: bigint,
  sqrtPrice: bigint,
  liquidity: bigint,
  zeroToOne: boolean
): bigint => {
  const amountInLessFee = (amountIn * SWAP_FEE_RATE) / FEE_DENOMINATOR;
  if (amountInLessFee === 0n) return 0n;

  if (zeroToOne) {
    const denom = liquidity * Q96 + amountInLessFee * sqrtPrice;
    if (denom === 0n) return 0n;
    const sqrtNext = (liquidity * Q96 * sqrtPrice) / denom;
    return (liquidity * (sqrtPrice - sqrtNext)) / Q96;
  } else {
    const sqrtNext = sqrtPrice + (amountInLessFee * Q96) / liquidity;
    const diff = sqrtNext - sqrtPrice;
    const numerator = liquidity * Q96 * diff;
    return (numerator / sqrtNext) / sqrtPrice;
  }
};
