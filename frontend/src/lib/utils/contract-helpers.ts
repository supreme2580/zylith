import { PoolState, Reserves } from '../types';

/**
 * Parse u256 value from contract response
 */
const getU256Value = (val: any): bigint => {
  if (val === undefined || val === null) return 0n;
  if (typeof val === 'bigint') return val;
  if (typeof val === 'object' && val.low !== undefined) {
    return (BigInt(val.high || 0) << 128n) + BigInt(val.low);
  }
  return BigInt(val.toString());
};

/**
 * Parse pool state from contract response
 */
export const parsePoolState = (data: any): PoolState => {
  if (!data) return { sqrtPrice: 0n, tick: 0, liquidity: 0n };
  
  const raw = data as any;
  const state = raw.state || raw;
  
  const sqrtPrice = state.sqrt_price 
    ? getU256Value(state.sqrt_price) 
    : (Array.isArray(state) ? getU256Value(state[0]) : 0n);
    
  const tick = state.tick !== undefined 
    ? Number(state.tick) 
    : (Array.isArray(state) ? Number(state[1] || 0) : 0);
    
  const liquidity = state.liquidity 
    ? getU256Value(state.liquidity) 
    : (Array.isArray(state) ? getU256Value(state[2]) : 0n);

  return { sqrtPrice, tick, liquidity };
};

/**
 * Parse reserves from contract response
 */
export const parseReserves = (data: any): Reserves => {
  if (!data) return { res0: 0n, res1: 0n };
  
  const raw = data as any;
  const reserves = raw.reserves || raw;
  
  const res0 = reserves.res0 !== undefined 
    ? getU256Value(reserves.res0) 
    : getU256Value(reserves[0]);
    
  const res1 = reserves.res1 !== undefined 
    ? getU256Value(reserves.res1) 
    : getU256Value(reserves[1]);

  return { res0, res1 };
};

/**
 * Parse u256 balance from contract response
 */
export const parseBalance = (data: any): bigint => {
  if (!data) return BigInt(0);
  if (typeof data === 'bigint') return data;
  const d = data as any;
  return (BigInt(d.high || 0) << 128n) + BigInt(d.low || 0);
};
