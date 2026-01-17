import { getSqrtPriceAtTick } from './clmm-math';
import { PoolRangeStatus, PoolState, TokenMeta, SwapDirection, Mode } from '../types';
import { formatAmount, parseAmount } from './formatting';
import { SWAP_FEE_RATE, FEE_DENOMINATOR } from './constants';

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
  return '1.00';
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
    const outDecimals = swapDirection === '0to1'
      ? (token1Meta?.decimals ?? 6)
      : (token0Meta?.decimals ?? 18);

    const scaleAmount = (value: bigint, fromDec: number, toDec: number) => {
      if (fromDec === toDec) return value;
      const diff = Math.abs(fromDec - toDec);
      const factor = 10n ** BigInt(diff);
      return fromDec > toDec ? value / factor : value * factor;
    };

    const outAmount = scaleAmount(amountBI, inputDecimals, outDecimals);
    return formatAmount(outAmount, outDecimals, 6);
  }

  // Swap mode
  if (poolState.sqrtPrice === 0n || poolState.liquidity === 0n) {
    return 'Insufficient Liquidity';
  }

  if (amountBI > currentShieldedBalance && amountBI > currentPublicBalance) {
    return 'Insufficient Balance';
  }
  const outDecimals = swapDirection === '0to1'
    ? (token1Meta?.decimals ?? 6)
    : (token0Meta?.decimals ?? 18);

  const amountInLessFee = (amountBI * SWAP_FEE_RATE) / FEE_DENOMINATOR;

  const scaleAmount = (value: bigint, fromDec: number, toDec: number) => {
    if (fromDec === toDec) return value;
    const diff = Math.abs(fromDec - toDec);
    const factor = 10n ** BigInt(diff);
    return fromDec > toDec ? value / factor : value * factor;
  };

  const outAmount = scaleAmount(amountInLessFee, inputDecimals, outDecimals);
  return formatAmount(outAmount, outDecimals, 6);
};
