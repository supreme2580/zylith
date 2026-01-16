export type TokenMeta = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logo: string;
};

export type SwapDirection = '0to1' | '1to0';
export type Mode = 'swap' | 'pool';

export type PoolRangeStatus = 
  | { status: 'unknown'; error: string }
  | { status: 'invalid'; error: string }
  | { status: 'below'; error: null }
  | { status: 'above'; error: null }
  | { status: 'in'; error: null };

export type PoolState = {
  sqrtPrice: bigint;
  tick: number;
  liquidity: bigint;
};

export type Reserves = {
  res0: bigint;
  res1: bigint;
};
