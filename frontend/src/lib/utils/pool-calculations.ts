import { getSqrtPriceAtTick, getLiquidityFromAmount0, getLiquidityFromAmount1, getAmount0Delta, getAmount1Delta, calculateSwapOutput } from './clmm-math';
import { PoolRangeStatus, PoolState, TokenMeta, SwapDirection, Mode } from '../types';
import { formatAmount, parseAmount } from './formatting';
import { Q96 } from './constants';

/**
 * Calculate pool range status for a given tick range
 */
export const calculatePoolRange = (
  poolState: PoolState,
  tickLower: string,
  tickUpper: string
): PoolRangeStatus => {
  if (poolState.sqrtPrice === 0n) {
    return { status: 'unknown', error: 'Pool price not initialized' };
  }
  
  const sqrtPLower = getSqrtPriceAtTick(parseInt(tickLower));
  const sqrtPUpper = getSqrtPriceAtTick(parseInt(tickUpper));
  
  if (sqrtPLower >= sqrtPUpper) {
    return { status: 'invalid', error: 'Invalid tick range' };
  }
  
  if (poolState.sqrtPrice < sqrtPLower) {
    return { status: 'below', error: null };
  }
  
  if (poolState.sqrtPrice > sqrtPUpper) {
    return { status: 'above', error: null };
  }
  
  return { status: 'in', error: null };
};

/**
 * Calculate price ratio from sqrt price
 */
export const calculatePriceRatio = (
  sqrtPrice: bigint,
  token0Decimals = 18,
  token1Decimals = 6
): string => {
  if (sqrtPrice === 0n) return '0.00';
  const p = Number(sqrtPrice) / Number(Q96);
  const rawPrice = p * p; // token1 raw units per token0 raw units
  const decimalAdjust = 10 ** (token0Decimals - token1Decimals);
  const humanPrice = rawPrice * decimalAdjust;
  return humanPrice.toFixed(2);
};

/**
 * Calculate estimated output for swap or LP
 */
export const calculateEstimatedOutput = (
  amount: string,
  mode: Mode,
  swapDirection: SwapDirection,
  poolState: PoolState,
  poolRange: PoolRangeStatus,
  tickLower: string,
  tickUpper: string,
  token0Meta: TokenMeta | undefined,
  token1Meta: TokenMeta | undefined,
  currentShieldedBalance: bigint,
  currentPublicBalance: bigint
): string => {
  if (!amount || isNaN(parseFloat(amount))) return '0.00';
  
  const inputDecimals = swapDirection === '0to1'
    ? (token0Meta?.decimals ?? 18)
    : (token1Meta?.decimals ?? 6);
  const amountBI = parseAmount(amount, inputDecimals);

  if (mode === 'pool') {
    if (poolRange.status === 'unknown' || poolRange.status === 'invalid') return '0.00';

    const sqrtPCurrent = poolState.sqrtPrice;
    const sqrtPLower = getSqrtPriceAtTick(parseInt(tickLower));
    const sqrtPUpper = getSqrtPriceAtTick(parseInt(tickUpper));

    if (poolRange.status === 'below' || poolRange.status === 'above') {
      return '0.00';
    }

    const dec0 = token0Meta?.decimals ?? 18;
    const dec1 = token1Meta?.decimals ?? 6;
    const tickLowerNum = parseInt(tickLower);
    const tickUpperNum = parseInt(tickUpper);
    const isWideRange = Math.abs(tickLowerNum) > 500000 && Math.abs(tickUpperNum) > 500000;

    const priceRatio = (sqrtPCurrent * sqrtPCurrent) / (Q96 * Q96); // token1 per token0
    const scaleAmount = (value: bigint, fromDec: number, toDec: number) => {
      if (fromDec === toDec) return value;
      const factor = 10n ** BigInt(Math.abs(fromDec - toDec));
      return fromDec > toDec ? value / factor : value * factor;
    };
    const amount1FromPrice = scaleAmount(amountBI * priceRatio, dec0, dec1);
    const amount0FromPrice = priceRatio > 0n
      ? scaleAmount(amountBI / priceRatio, dec1, dec0)
      : 0n;

    const capByPrice = (computed: bigint, fallback: bigint) => {
      if (fallback === 0n) return computed;
      if (computed === 0n) return fallback;
      if (isWideRange && computed > fallback * 1000n) return fallback;
      if (isWideRange && computed < fallback / 1000n) return fallback;
      return computed;
    };

    // In-range: compute other side amount
    if (swapDirection === '0to1') {
      const liq = getLiquidityFromAmount0(sqrtPCurrent, sqrtPUpper, amountBI);
      const a1 = getAmount1Delta(sqrtPLower, sqrtPCurrent, liq);
      const result = capByPrice(a1, amount1FromPrice);
      return formatAmount(result, dec1, 6);
    } else {
      const liq = getLiquidityFromAmount1(sqrtPLower, sqrtPCurrent, amountBI);
      const a0 = getAmount0Delta(sqrtPCurrent, sqrtPUpper, liq);
      const result = capByPrice(a0, amount0FromPrice);
      return formatAmount(result, dec0, 6);
    }
  }

  // Swap mode
  if (poolState.sqrtPrice === 0n || poolState.liquidity === 0n) {
    return 'Insufficient Liquidity';
  }

  if (amountBI > currentShieldedBalance && amountBI > currentPublicBalance) {
    return 'Insufficient Balance';
  }

  const amountOut = calculateSwapOutput(
    amountBI,
    poolState.sqrtPrice,
    poolState.liquidity,
    swapDirection === '0to1'
  );

  const outDecimals = swapDirection === '0to1'
    ? (token1Meta?.decimals ?? 6)
    : (token0Meta?.decimals ?? 18);
  
  return formatAmount(amountOut, outDecimals, 6);
};
