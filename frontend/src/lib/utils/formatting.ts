import { FELT_PRIME } from './constants';

/**
 * Convert a bigint or string to u256 format (low, high)
 */
export const toU256 = (v: bigint | string): [string, string] => {
  const bn = BigInt(v);
  const low = bn & ((1n << 128n) - 1n);
  const high = bn >> 128n;
  return [low.toString(), high.toString()];
};

/**
 * Convert a value to a felt252 (Starknet field element)
 */
export const toFelt = (v: bigint | number | string): string => {
  let bn = BigInt(v);
  if (bn < 0n) bn = (bn % FELT_PRIME + FELT_PRIME) % FELT_PRIME;
  return bn.toString();
};

/**
 * Calculate 10^decimals
 */
export const pow10 = (decimals: number): bigint => 10n ** BigInt(decimals);

/**
 * Parse a decimal string amount to bigint based on token decimals
 */
export const parseAmount = (val: string, decimals: number): bigint => {
  const trimmed = val.trim();
  if (!trimmed) return 0n;
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const base = pow10(decimals);
  return BigInt(whole || "0") * base + BigInt(fracPadded || "0");
};

/**
 * Format a bigint amount as a decimal string
 */
export const formatAmount = (amount: bigint, decimals: number, precision = 4): string => {
  const base = pow10(decimals);
  const whole = amount / base;
  const frac = amount % base;
  if (precision <= 0) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, precision);
  return `${whole.toString()}.${fracStr}`;
};

/**
 * Convert a bigint or string to 64-character padded hex string
 */
export const toHex64 = (v: bigint | string): string => {
  const hex = typeof v === 'string' ? BigInt(v).toString(16) : v.toString(16);
  return '0x' + hex.padStart(64, '0');
};
