"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { 
  Shield, 
  Zap, 
  ArrowDownLeft, 
  Plus, 
  Loader2, 
  Lock, 
  EyeOff, 
  Settings, 
  History, 
  TrendingUp,
  ArrowRightLeft,
  RotateCw,
  Coins
} from "lucide-react";
import ConnectWallet from "../components/ConnectWallet";
import { useAccount, useSendTransaction, useReadContract, useProvider, Abi } from "@starknet-react/core";
import { poseidon2 } from "poseidon-lite";
import { generateZylithSwapProof, generateZylithLPProof, formatGroth16ProofForStarknet } from "../lib/proof";
import { createShieldedNote, saveNote, getNotes, ShieldedNote, computeNullifierHash, removeNote, markSpent, isSpent, updateNoteStatus } from "../lib/notes";
import { TOKEN0_ABI } from "../lib/abis";

const POOL_ADDRESS = process.env.NEXT_PUBLIC_ZYLITH_POOL_ADDRESS || "0x0";
const ENV_TOKEN0_ADDRESS = process.env.NEXT_PUBLIC_TOKEN0_ADDRESS || "0x0";
const ENV_TOKEN1_ADDRESS = process.env.NEXT_PUBLIC_TOKEN1_ADDRESS || "0x0";

const toU256 = (v: bigint | string) => {
  const bn = BigInt(v);
  const low = bn & ((1n << 128n) - 1n);
  const high = bn >> 128n;
  return [low.toString(), high.toString()];
};

const FELT_PRIME = BigInt("0x800000000000011000000000000000000000000000000000000000000000001");
const toFelt = (v: bigint | number | string) => {
  let bn = BigInt(v);
  if (bn < 0n) bn = (bn % FELT_PRIME + FELT_PRIME) % FELT_PRIME;
  return bn.toString();
};

// --- CLMM MATH HELPERS (Exact TickMath, Q96) ---
const Q96 = 1n << 96n;
const Q128 = 1n << 128n;
const MAX_U256 = (1n << 256n) - 1n;

const getSqrtPriceAtTick = (tick: number): bigint => {
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

const getLiquidityFromAmount0 = (sqrtPA: bigint, sqrtPB: bigint, amount0: bigint) => {
  const [sqrtPLow, sqrtPUpper] = sqrtPA < sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  const intermediate = (sqrtPUpper * sqrtPLow) / Q96;
  return (amount0 * intermediate) / (sqrtPUpper - sqrtPLow);
};

const getLiquidityFromAmount1 = (sqrtPA: bigint, sqrtPB: bigint, amount1: bigint) => {
  const [sqrtPLow, sqrtPUpper] = sqrtPA < sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  return (amount1 * Q96) / (sqrtPUpper - sqrtPLow);
};

const getAmount0Delta = (sqrtPA: bigint, sqrtPB: bigint, liquidity: bigint) => {
  const [sqrtPLow, sqrtPUpper] = sqrtPA < sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  const numerator = liquidity * Q96 * (sqrtPUpper - sqrtPLow);
  const denominator = (sqrtPUpper * sqrtPLow) / Q96;
  return numerator / (denominator * Q96);
};

const getAmount1Delta = (sqrtPA: bigint, sqrtPB: bigint, liquidity: bigint) => {
  const [sqrtPLow, sqrtPUpper] = sqrtPA < sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  return (liquidity * (sqrtPUpper - sqrtPLow)) / Q96;
};

// Helper to ensure 64-char padded hex for ASP server consistency
const toHex64 = (v: bigint | string) => {
  const hex = typeof v === 'string' ? BigInt(v).toString(16) : v.toString(16);
  return '0x' + hex.padStart(64, '0');
};

export default function Home() {
  const [mode, setMode] = useState<'swap' | 'pool'>('swap');
  const [amount, setAmount] = useState('');
  const [swapDirection, setSwapDirection] = useState<'0to1' | '1to0'>('0to1');
  const [tickLower, setTickLower] = useState('-887272');
  const [tickUpper, setTickUpper] = useState('887272');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [userNotes, setUserNotes] = useState<ShieldedNote[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const { address } = useAccount();
  const { provider } = useProvider();

  // Reset amount when mode or direction changes
  useEffect(() => {
    setAmount('');
    setError(null);
    setMessage(null);
    setStatus(null);
  }, [mode, swapDirection]);

  const { data: poolStateData } = useReadContract({
    functionName: 'get_state',
    args: [],
    abi: [
      {
        name: 'get_state',
        type: 'function',
        inputs: [],
        outputs: [{ name: 'state', type: 'PoolState' }],
        state_mutability: 'view'
      },
      {
        name: 'PoolState',
        type: 'struct',
        members: [
          { name: 'sqrt_price', type: 'u256' },
          { name: 'tick', type: 'i32' },
          { name: 'liquidity', type: 'u128' },
          { name: 'fee_growth_global_0', type: 'u256' },
          { name: 'fee_growth_global_1', type: 'u256' },
          { name: 'protocol_fee_0', type: 'u128' },
          { name: 'protocol_fee_1', type: 'u128' }
        ]
      },
      {
        name: 'u256',
        type: 'struct',
        members: [
          { name: 'low', type: 'u128' },
          { name: 'high', type: 'u128' }
        ]
      }
    ] as any,
    address: POOL_ADDRESS as `0x${string}`,
    watch: true,
  });

  const poolState = useMemo(() => {
    if (!poolStateData) return { sqrtPrice: 0n, tick: 0, liquidity: 0n };
    console.log("DEBUG: Pool State raw data:", poolStateData);
    
    const raw = poolStateData as any;
    const data = raw.state || raw;
    
    const getVal = (val: any) => {
      if (val === undefined || val === null) return 0n;
      if (typeof val === 'bigint') return val;
      if (typeof val === 'object' && val.low !== undefined) {
        return (BigInt(val.high || 0) << 128n) + BigInt(val.low);
      }
      return BigInt(val.toString());
    };

    // Fail-safe mapping: tries named fields first, then fallback to positional array indices
    const sqrtPrice = data.sqrt_price ? getVal(data.sqrt_price) : (Array.isArray(data) ? getVal(data[0]) : 0n);
    const tick = data.tick !== undefined ? Number(data.tick) : (Array.isArray(data) ? Number(data[1] || 0) : 0);
    const liquidity = data.liquidity ? getVal(data.liquidity) : (Array.isArray(data) ? getVal(data[2]) : 0n);

    return { sqrtPrice, tick, liquidity };
  }, [poolStateData]);

  // Read reserves
  const { data: reservesData } = useReadContract({
    functionName: 'get_reserves',
    args: [],
    abi: [
      {
        name: 'get_reserves',
        type: 'function',
        inputs: [],
        outputs: [{ name: 'reserves', type: 'Reserves' }],
        state_mutability: 'view'
      },
      {
        name: 'Reserves',
        type: 'struct',
        members: [
          { name: 'res0', type: 'u256' },
          { name: 'res1', type: 'u256' }
        ]
      },
      {
        name: 'u256',
        type: 'struct',
        members: [
          { name: 'low', type: 'u128' },
          { name: 'high', type: 'u128' }
        ]
      }
    ] as any,
    address: POOL_ADDRESS as `0x${string}`,
    watch: true,
  });

  const { data: tokensData } = useReadContract({
    functionName: 'get_tokens',
    args: [],
    abi: [
      {
        name: 'get_tokens',
        type: 'function',
        inputs: [],
        outputs: [
          { name: 'token0', type: 'ContractAddress' },
          { name: 'token1', type: 'ContractAddress' }
        ],
        state_mutability: 'view'
      }
    ] as any,
    address: POOL_ADDRESS as `0x${string}`,
    watch: true,
  });

  const normalizeAddr = (val: any): string | null => {
    if (!val) return null;
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val[0] || null;
    if (typeof val === 'object' && (val as any).token0) return (val as any).token0;
    if (typeof val === 'object' && (val as any)[0]) return (val as any)[0];
    return null;
  };

  const token0Onchain = useMemo(() => normalizeAddr((tokensData as any)?.token0 ?? (tokensData as any)?.[0]), [tokensData]);
  const token1Onchain = useMemo(() => normalizeAddr((tokensData as any)?.token1 ?? (tokensData as any)?.[1]), [tokensData]);

  const isZeroAddr = (addr?: string | null) => !addr || addr === '0x0' || addr === '0x00';
  const token0Address = !isZeroAddr(token0Onchain) ? token0Onchain! : ENV_TOKEN0_ADDRESS;
  const token1Address = !isZeroAddr(token1Onchain) ? token1Onchain! : ENV_TOKEN1_ADDRESS;

  const reserves = useMemo(() => {
    if (!reservesData) return { res0: 0n, res1: 0n };
    console.log("DEBUG: Reserves raw data:", reservesData);
    
    const raw = reservesData as any;
    const data = raw.reserves || raw;
    const getVal = (val: any) => {
      if (val === undefined || val === null) return 0n;
      if (typeof val === 'bigint') return val;
      if (typeof val === 'object' && val.low !== undefined) {
        return (BigInt(val.high || 0) << 128n) + BigInt(val.low);
      }
      return BigInt(val.toString());
    };

    const res0 = data.res0 !== undefined ? getVal(data.res0) : getVal(data[0]);
    const res1 = data.res1 !== undefined ? getVal(data.res1) : getVal(data[1]);

    return { res0, res1 };
  }, [reservesData]);

  const { data: balanceData0 } = useReadContract({
    functionName: 'balance_of',
    args: [address || '0x0'] as `0x${string}`[],
    abi: TOKEN0_ABI as Abi,
    address: token0Address as `0x${string}`,
    watch: true,
  });

  const { data: balanceData1 } = useReadContract({
    functionName: 'balance_of',
    args: [address || '0x0'] as `0x${string}`[],
    abi: TOKEN0_ABI as Abi,
    address: token1Address as `0x${string}`,
    watch: true,
  });

  const publicBalance0 = useMemo(() => {
    if (!balanceData0) return BigInt(0);
    if (typeof balanceData0 === 'bigint') return balanceData0;
    const d = balanceData0 as any;
    return (BigInt(d.high) << 128n) + BigInt(d.low);
  }, [balanceData0]);

  const publicBalance1 = useMemo(() => {
    if (!balanceData1) return BigInt(0);
    if (typeof balanceData1 === 'bigint') return balanceData1;
    const d = balanceData1 as any;
    return (BigInt(d.high) << 128n) + BigInt(d.low);
  }, [balanceData1]);

  const currentPublicBalance = useMemo(() => {
    return swapDirection === '0to1' ? publicBalance0 : publicBalance1;
  }, [swapDirection, publicBalance0, publicBalance1]);

  // Load notes on mount
  useEffect(() => {
    setUserNotes(getNotes());
  }, []);

  const totalBalance = useMemo(() => {
    return userNotes.reduce((acc, note) => acc + note.amount, BigInt(0));
  }, [userNotes]);

  const [readyToWithdraw0, setReadyToWithdraw0] = useState(0);
  const [readyToWithdraw1, setReadyToWithdraw1] = useState(0);
  const [feesEarned0, setFeesEarned0] = useState(0);
  const [feesEarned1, setFeesEarned1] = useState(0);

  // Background polling for pending notes AND processing queue
  useEffect(() => {
    const processQueueAndPoll = async () => {
            // 1. Poll for indexing
            const currentNotes = getNotes();
            const pending = currentNotes.filter(n => n.status === 'pending');
            for (const note of pending) {
                try {
                    const response = await fetch(`${process.env.NEXT_PUBLIC_ASP_SERVER_URL || 'http://127.0.0.1:3001'}/get_path`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            commitment: note.commitment,
                            note_hash: note.noteHash 
                        }) 
                    });
                    if (response.ok) {
                        const data = await response.json();
                        if (data && data.root !== "0x0") {
                            const actualAmount = BigInt(data.amount);
                            if (actualAmount === 0n) {
                                // Commitment already indexed (private ops); keep local amount/commitment.
                                updateNoteStatus(note.commitment, 'ready');
                            } else {
                                const noteHashBI = BigInt(note.noteHash);
                                const commitmentBI = poseidon2([noteHashBI, actualAmount]);
                                const commitmentHex = '0x' + commitmentBI.toString(16).padStart(64, '0');
                                updateNoteStatus(note.commitment, 'ready', actualAmount, commitmentHex);
                            }
                        }
                    }
                } catch (e) { console.warn("Poll error:", e); }
            }

            // 2. Refresh local notes state and calculate aggregates
            const refreshedNotes = getNotes();
            setUserNotes(refreshedNotes);

            // Calculate "Ready to Withdraw" Breakdown
            const readyNotes = refreshedNotes.filter(n => (n.type === 'swap' || !n.type) && n.status === 'ready' && !isSpent(computeNullifierHash(n)));
            const totalReady0 = readyNotes.filter(n => n.token === token0Address).reduce((acc, n) => acc + Number(n.amount) / 1e8, 0);
            const totalReady1 = readyNotes.filter(n => n.token === token1Address).reduce((acc, n) => acc + Number(n.amount) / 1e8, 0);
            setReadyToWithdraw0(totalReady0);
            setReadyToWithdraw1(totalReady1);

            // Calculate "Fees Earned" Breakdown
            let totalOwed0 = 0n;
            let totalOwed1 = 0n;
            const lpNotes = refreshedNotes.filter(n => n.type === 'lp' && n.status === 'ready' && !isSpent(computeNullifierHash(n)));
            for (const note of lpNotes) {
               try {
                  const posData = await provider.callContract({
                     contractAddress: POOL_ADDRESS,
                     entrypoint: 'get_position',
                     calldata: [...toU256(note.noteHash)]
                  });
                  totalOwed0 += BigInt(posData[5] || 0);
                  totalOwed1 += BigInt(posData[6] || 0);
               } catch (e) { console.warn("Fee fetch error:", e); }
            }
            setFeesEarned0(Number(totalOwed0) / 1e8);
            setFeesEarned1(Number(totalOwed1) / 1e8);

      // 3. Process Queue
      if (queue.length > 0 && !loading) {
        const nextAction = queue[0];
        // Check if required note is ready
        const requiredNote = userNotes.find(n => n.commitment === nextAction.targetCommitment);
        if (requiredNote && requiredNote.status === 'ready') {
          setQueue(q => q.slice(1));
          executeAction(nextAction.params);
        }
      }
    };

    const interval = setInterval(processQueueAndPoll, 3000);
    return () => clearInterval(interval);
  }, [userNotes, queue, loading]);

  const priceRatio = useMemo(() => {
    if (poolState.sqrtPrice === 0n) return '0.00';
    // Price = (sqrtPrice / 2^96)^2
    const p = Number(poolState.sqrtPrice) / Number(Q96);
    return (p * p).toFixed(6);
  }, [poolState.sqrtPrice]);

  const poolRange = useMemo(() => {
    if (poolState.sqrtPrice === 0n) return { status: 'unknown', error: 'Pool price not initialized' } as const;
    const sqrtPLower = getSqrtPriceAtTick(parseInt(tickLower));
    const sqrtPUpper = getSqrtPriceAtTick(parseInt(tickUpper));
    if (sqrtPLower >= sqrtPUpper) {
      return { status: 'invalid', error: 'Invalid tick range' } as const;
    }
    if (poolState.sqrtPrice < sqrtPLower) return { status: 'below', error: null } as const;
    if (poolState.sqrtPrice > sqrtPUpper) return { status: 'above', error: null } as const;
    return { status: 'in', error: null } as const;
  }, [poolState.sqrtPrice, tickLower, tickUpper]);

  const estimatedOutput = useMemo(() => {
    if (!amount || isNaN(parseFloat(amount))) return '0.00';
    const amountBI = BigInt(Math.floor(parseFloat(amount) * 1e8));

    if (mode === 'pool') {
      if (poolRange.status === 'unknown' || poolRange.status === 'invalid') return '0.00';

      const sqrtPCurrent = poolState.sqrtPrice;
      const sqrtPLower = getSqrtPriceAtTick(parseInt(tickLower));
      const sqrtPUpper = getSqrtPriceAtTick(parseInt(tickUpper));

      if (poolRange.status === 'below') {
        // Only token0 allowed
        return '0.00';
      }
      if (poolRange.status === 'above') {
        // Only token1 allowed
        return '0.00';
      }

      // In-range: compute other side amount
      if (swapDirection === '0to1') {
        const liq = getLiquidityFromAmount0(sqrtPCurrent, sqrtPUpper, amountBI);
        const a1 = getAmount1Delta(sqrtPLower, sqrtPCurrent, liq);
        const v = Number(a1) / 1e8;
        return (v < 0 ? 0 : v).toFixed(8);
      } else {
        const liq = getLiquidityFromAmount1(sqrtPLower, sqrtPCurrent, amountBI);
        const a0 = getAmount0Delta(sqrtPCurrent, sqrtPUpper, liq);
        const v = Number(a0) / 1e8;
        return (v < 0 ? 0 : v).toFixed(8);
      }
    }

    if (poolState.sqrtPrice === 0n || poolState.liquidity === 0n) return 'Insufficient Liquidity';

    const currentShieldedBalance = userNotes
      .filter(n => n.token === (swapDirection === '0to1' ? token0Address : token1Address) && n.status === 'ready')
      .reduce((acc, n) => acc + n.amount, 0n);

    if (amountBI > currentShieldedBalance && amountBI > currentPublicBalance) {
      return 'Insufficient Balance';
    }

    // Swap quote uses the same single-step CLMM math as the circuit
    const amountInLessFee = (amountBI * 997000n) / 1000000n;
    if (amountInLessFee === 0n) return '0.00';

    let amountOut = 0n;
    if (swapDirection === '0to1') {
      const denom = poolState.liquidity * Q96 + amountInLessFee * poolState.sqrtPrice;
      if (denom === 0n) return '0.00';
      const sqrtNext = (poolState.liquidity * Q96 * poolState.sqrtPrice) / denom;
      amountOut = (poolState.liquidity * (poolState.sqrtPrice - sqrtNext)) / Q96;
    } else {
      const sqrtNext = poolState.sqrtPrice + (amountInLessFee * Q96) / poolState.liquidity;
      // Formula: L * (1/sqrt_p_cur - 1/sqrt_p_next) = L * (sqrt_p_next - sqrt_p_cur) / (sqrt_p_next * sqrt_p_cur)
      const diff = sqrtNext - poolState.sqrtPrice;
      const numerator = poolState.liquidity * Q96 * diff;
      amountOut = (numerator / sqrtNext) / poolState.sqrtPrice;
    }

    return (Number(amountOut) / 1e8).toFixed(8);
  }, [amount, poolState, poolRange.status, swapDirection, mode, tickLower, tickUpper]);

  const { sendAsync: writeTransaction } = useSendTransaction({
    calls: undefined
  });


  const executeAction = useCallback(async () => {
    if (!amount || !address) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    setStatus("Preparing transaction...");
    try {
      const amountBI = BigInt(Math.floor(parseFloat(amount) * 1e8));
      if (amountBI === 0n) throw new Error("Amount too small");

      if (mode === 'swap') {
        if (poolState.sqrtPrice === 0n || poolState.liquidity === 0n) {
          throw new Error("Insufficient liquidity for this trade");
        }
      }

      if (mode === 'pool') {
        const sqrtPCurrent = poolState.sqrtPrice;
        const sqrtPLower = getSqrtPriceAtTick(parseInt(tickLower));
        const sqrtPUpper = getSqrtPriceAtTick(parseInt(tickUpper));
        if (poolRange.status === 'invalid' || poolRange.status === 'unknown') throw new Error("Invalid pool range");
        if (sqrtPCurrent < sqrtPLower && swapDirection === '1to0') throw new Error("Range below price: only wBTC allowed");
        if (sqrtPCurrent > sqrtPUpper && swapDirection === '0to1') throw new Error("Range above price: only ETH allowed");
      }

      const tokenAddr = swapDirection === '0to1' ? token0Address : token1Address;
      const calls: any[] = [];

      // --- TOKEN-SPECIFIC NOTE SEARCH (READY ONLY) ---
      let spendNote = userNotes.find(n => {
        if (n.token !== tokenAddr || n.amount !== amountBI || n.status !== 'ready') return false;
        const nh = computeNullifierHash(n);
        return !isSpent(nh);
      });

      if (spendNote) {
        // --- 1. FULLY PRIVATE (Note -> Note) ---
        // ALWAYS APPROVE for private swaps/LP to ensure multicall consistency
        calls.push({
          contractAddress: tokenAddr,
          entrypoint: 'approve',
          calldata: [POOL_ADDRESS, ...toU256(amountBI)]
        });

        const fullCommitment = poseidon2([BigInt(spendNote.noteHash), spendNote.amount]);
        const fullCommitmentHex = toHex64(fullCommitment);
        
        // Fetch path (now simplified as we know it's ready)
        setStatus("Fetching Merkle path...");
        const response = await fetch(`${process.env.NEXT_PUBLIC_ASP_SERVER_URL || 'http://127.0.0.1:3001'}/get_path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            commitment: fullCommitmentHex,
            note_hash: spendNote.noteHash
          }) 
        });
        const merkleData = response.ok ? await response.json() : null;
        if (!merkleData || merkleData.root === "0x0") throw new Error("Indexing delay. Retrying soon...");

        setStatus("Generating ZK proof...");
        // Full spend for MVP: create a fresh output note (swap or LP)
        let outAmount = amountBI;
        if (mode === 'swap') {
          const amountInLessFee = (amountBI * 997000n) / 1000000n;
          if (swapDirection === '0to1') {
            const denom = poolState.liquidity * Q96 + amountInLessFee * poolState.sqrtPrice;
            if (denom === 0n) throw new Error("Insufficient liquidity for this trade");
            const sqrtNext = (poolState.liquidity * Q96 * poolState.sqrtPrice) / denom;
            outAmount = (poolState.liquidity * (poolState.sqrtPrice - sqrtNext)) / Q96;
          } else {
            const sqrtNext = poolState.sqrtPrice + (amountInLessFee * Q96) / poolState.liquidity;
            const diff = sqrtNext - poolState.sqrtPrice;
            const numerator = poolState.liquidity * Q96 * diff;
            outAmount = (numerator / sqrtNext) / poolState.sqrtPrice;
          }
        }

        const outTokenAddr = mode === 'swap'
          ? (swapDirection === '0to1' ? token1Address : token0Address)
          : tokenAddr;

        const outNote = createShieldedNote(
          outAmount,
          outTokenAddr,
          mode === 'swap' ? 'swap' : 'lp',
          mode === 'pool' ? parseInt(tickLower) : undefined,
          mode === 'pool' ? parseInt(tickUpper) : undefined
        );
        const nullifierHash = computeNullifierHash(spendNote);

        // On-chain spent check (guards against stale local notes)
        const spentRes = await provider.callContract({
          contractAddress: POOL_ADDRESS,
          entrypoint: 'is_nullifier_spent',
          calldata: [...toU256(nullifierHash)]
        });
        const isSpentOnchain = spentRes && spentRes[0] === '0x1';
        if (isSpentOnchain) {
          markSpent(nullifierHash);
          removeNote(spendNote);
          setUserNotes(getNotes());
          throw new Error("Shielded note already spent. Please retry.");
        }

        calls.push({
          contractAddress: POOL_ADDRESS,
          entrypoint: 'add_root_with_path',
          calldata: [
            ...toU256("0x" + fullCommitment.toString(16)),
            toFelt(merkleData.path.length),
            ...merkleData.path.flatMap((p: string) => toU256(p)),
            toFelt(merkleData.index),
            ...toU256(merkleData.root)
          ]
        });

        if (mode === 'swap') {
          const { proof, publicInputs } = await generateZylithSwapProof(
            spendNote.secret,
            spendNote.nullifier,
            spendNote.amount,
            outNote.secret,
            outNote.nullifier,
            amountBI,
            { path: merkleData.path, indices: merkleData.indices },
            merkleData.root,
            outAmount,
            0n,
            poolState.sqrtPrice,
            poolState.liquidity,
            swapDirection === '0to1'
          );
          const formattedProof = await formatGroth16ProofForStarknet(proof, publicInputs, "/circuits/swap_vk.json");
          calls.push({
            contractAddress: POOL_ADDRESS,
            entrypoint: 'private_swap',
            calldata: [
              ...formattedProof, 
              ...toU256(merkleData.root), 
              ...toU256(nullifierHash), 
              toFelt(amountBI), 
              "0", 
              ...toU256(outNote.commitment),
              swapDirection === '0to1' ? "1" : "0"
            ]
          });
        } else {
          const sqrtLower = getSqrtPriceAtTick(parseInt(tickLower));
          const sqrtUpper = getSqrtPriceAtTick(parseInt(tickUpper));
          const { proof, publicInputs } = await generateZylithLPProof(
            spendNote.secret,
            spendNote.nullifier,
            spendNote.amount,
            outNote.secret,
            outNote.nullifier,
            amountBI,
            parseInt(tickLower), parseInt(tickUpper),
            { path: merkleData.path, indices: merkleData.indices }, merkleData.root,
            poolState.sqrtPrice,
            sqrtLower,
            sqrtUpper
          );
          const formattedProof = await formatGroth16ProofForStarknet(proof, publicInputs, "/circuits/lp_vk.json");
          calls.push({
            contractAddress: POOL_ADDRESS,
            entrypoint: 'mint_liquidity',
            calldata: [
              ...formattedProof, 
              ...toU256(merkleData.root), 
              ...toU256(nullifierHash), 
              toFelt(amountBI), 
              toFelt(tickLower), 
              toFelt(tickUpper), 
              ...toU256(outNote.commitment)
            ]
          });
        }
        setStatus("Submitting private transaction...");
        console.log("Submitting Private Call:", calls);
        await writeTransaction(calls);
        // Mark spent note as consumed, keep only output note
        markSpent(nullifierHash);
        removeNote(spendNote);
        saveNote(outNote);
        setUserNotes(getNotes());
      } else {
        // --- 2. SHIELDING ACTION (Wallet -> Note) ---
        setStatus("Approving tokens...");
        const resultToken = mode === 'swap' ? (swapDirection === '0to1' ? token1Address : token0Address) : tokenAddr;
        const resultNote = createShieldedNote(0n, resultToken);
        
        calls.push({
          contractAddress: tokenAddr,
          entrypoint: 'approve',
          calldata: [POOL_ADDRESS, ...toU256(amountBI)]
        });

        if (mode === 'swap') {
          calls.push({
            contractAddress: POOL_ADDRESS,
            entrypoint: 'swap_public_to_private',
            calldata: [
              tokenAddr,
              toFelt(amountBI),
              "0", // min_amount_out
              ...toU256(resultNote.noteHash), // Use noteHash (Identity)
              swapDirection === '0to1' ? "1" : "0"
            ]
          });
        } else {
          // --- DUAL ASSET DEPOSIT FOR POOL (REAL MATH) ---
          const otherTokenAddr = swapDirection === '0to1' ? token1Address : token0Address;
          
          const sqrtPCurrent = poolState.sqrtPrice;
          const sqrtPLower = getSqrtPriceAtTick(parseInt(tickLower));
          const sqrtPUpper = getSqrtPriceAtTick(parseInt(tickUpper));
          
          let otherAmountBI = 0n;
          if (swapDirection === '0to1') {
            const liq = getLiquidityFromAmount0(sqrtPCurrent, sqrtPUpper, amountBI);
            otherAmountBI = getAmount1Delta(sqrtPLower, sqrtPCurrent, liq);
          } else {
            const liq = getLiquidityFromAmount1(sqrtPLower, sqrtPCurrent, amountBI);
            otherAmountBI = getAmount0Delta(sqrtPCurrent, sqrtPUpper, liq);
          }
          
          // Add 0.5% buffer to approval to prevent "insufficient allowance" due to contract-side rounding up
          const otherAmountWithBuffer = (otherAmountBI * 1005n) / 1000n;

          // Approve second token if needed
          if (otherAmountWithBuffer > 0n) {
            calls.push({
              contractAddress: otherTokenAddr,
              entrypoint: 'approve',
              calldata: [POOL_ADDRESS, ...toU256(otherAmountWithBuffer)]
            });
          }

          calls.push({
            contractAddress: POOL_ADDRESS,
            entrypoint: 'mint_liquidity_public_to_private',
            calldata: [
              tokenAddr,
              toFelt(amountBI),
              toFelt(tickLower),
              toFelt(tickUpper),
              ...toU256(resultNote.noteHash) 
            ]
          });
        }
        setStatus("Submitting shielding transaction...");
        console.log("Submitting Shielding Call:", calls);
        await writeTransaction(calls);
        
        // --- CALCULATE LIQUIDITY FOR NOTE ---
        let finalNoteAmount = 0n;
        if (mode === 'swap') {
          const amountInLessFee = (amountBI * 997000n) / 1000000n;
          if (swapDirection === '0to1') {
            const denom = poolState.liquidity * Q96 + amountInLessFee * poolState.sqrtPrice;
            const sqrtNext = denom === 0n ? 0n : (poolState.liquidity * Q96 * poolState.sqrtPrice) / denom;
            finalNoteAmount = (poolState.liquidity * (poolState.sqrtPrice - sqrtNext)) / Q96;
          } else {
            const sqrtNext = poolState.sqrtPrice + (amountInLessFee * Q96) / poolState.liquidity;
            const diff = sqrtNext - poolState.sqrtPrice;
            const numerator = poolState.liquidity * Q96 * diff;
            finalNoteAmount = (numerator / sqrtNext) / poolState.sqrtPrice;
          }
        } else {
          // Calculate Liquidity
          const sqrtPCurrent = poolState.sqrtPrice;
          const sqrtPLower = getSqrtPriceAtTick(parseInt(tickLower));
          const sqrtPUpper = getSqrtPriceAtTick(parseInt(tickUpper));
          
          if (sqrtPCurrent < sqrtPLower) {
            finalNoteAmount = getLiquidityFromAmount0(sqrtPLower, sqrtPUpper, amountBI);
          } else if (sqrtPCurrent < sqrtPUpper) {
            finalNoteAmount = swapDirection === '0to1' 
              ? getLiquidityFromAmount0(sqrtPCurrent, sqrtPUpper, amountBI)
              : getLiquidityFromAmount1(sqrtPLower, sqrtPCurrent, amountBI);
          } else {
            finalNoteAmount = getLiquidityFromAmount1(sqrtPLower, sqrtPUpper, amountBI);
          }
        }

        const updatedCommitment = poseidon2([BigInt(resultNote.noteHash), finalNoteAmount]);
        const savedNote: ShieldedNote = { 
          ...resultNote, 
          amount: finalNoteAmount, 
          commitment: toHex64(updatedCommitment),
          status: 'pending',
          type: mode === 'swap' ? 'swap' : 'lp',
          tickLower: mode === 'pool' ? parseInt(tickLower) : undefined,
          tickUpper: mode === 'pool' ? parseInt(tickUpper) : undefined
        };
        saveNote(savedNote);
        setUserNotes(getNotes());
      }

      setStatus(null);
      setMessage(`Private ${mode === 'swap' ? 'Swap' : 'LP'} submitted.`);
    } catch (e: any) {
      console.error(e);
      setStatus(null);
      setError(e.message || "An unexpected error occurred");
      setMessage(null);
    } finally {
      setLoading(false);
    }
  }, [amount, address, mode, swapDirection, userNotes, tickLower, tickUpper, writeTransaction]);

  const handleWithdraw = useCallback(async (note: ShieldedNote) => {
    if (!address) return;
    setLoading(true);
    setStatus("Preparing withdrawal...");
    try {
      // 1. Fetch Merkle path
      setStatus("Fetching Merkle path...");
      const response = await fetch(`${process.env.NEXT_PUBLIC_ASP_SERVER_URL || 'http://127.0.0.1:3001'}/get_path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitment: note.commitment, note_hash: note.noteHash })
      });
      const merkleData = await response.json();
      if (!merkleData || merkleData.root === "0x0") throw new Error("Merkle path not found yet.");

      const nullifierHash = computeNullifierHash(note);

      // 2. Build Call
      const calls = [
        {
          contractAddress: POOL_ADDRESS,
          entrypoint: 'add_root_with_path',
          calldata: [
            ...toU256(note.commitment),
            toFelt(merkleData.path.length),
            ...merkleData.path.flatMap((p: string) => toU256(p)),
            toFelt(merkleData.index),
            ...toU256(merkleData.root)
          ]
        },
        {
          contractAddress: POOL_ADDRESS,
          entrypoint: 'withdraw_public',
          calldata: [
            toFelt(0), // Dummy proof for now (requires Withdrawal circuit)
            ...toU256(merkleData.root),
            ...toU256(nullifierHash),
            toFelt(note.amount),
            note.token,
            address,
            ...toU256(0) // No change commitment (full withdrawal)
          ]
        }
      ];

      setStatus("Submitting withdrawal...");
      await writeTransaction(calls);
      markSpent(nullifierHash);
      removeNote(note);
      setUserNotes(getNotes());
      setMessage("Withdrawal successful! Tokens sent to your wallet.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setStatus(null);
    }
  }, [address, writeTransaction]);

  const handleCollectFees = useCallback(async (note: ShieldedNote) => {
    if (!address) return;
    setLoading(true);
    setStatus("Preparing fee collection...");
    try {
      setStatus("Fetching Merkle path...");
      const response = await fetch(`${process.env.NEXT_PUBLIC_ASP_SERVER_URL || 'http://127.0.0.1:3001'}/get_path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitment: note.commitment, note_hash: note.noteHash })
      });
      const merkleData = await response.json();
      const nullifierHash = computeNullifierHash(note);
      const newComm = poseidon2([BigInt(note.noteHash), note.amount]);

      const calls = [
        {
          contractAddress: POOL_ADDRESS,
          entrypoint: 'collect_fees_public',
          calldata: [toFelt(0), ...toU256(merkleData.root), ...toU256(note.noteHash), toFelt(note.tickLower || -887272), toFelt(note.tickUpper || 887272), address, ...toU256(toHex64(newComm))]
        }
      ];

      await writeTransaction(calls);
      setMessage("Fees collected! Check your wallet.");
    } catch (e: any) { setError(e.message); } finally { setLoading(false); setStatus(null); }
  }, [address, writeTransaction]);

  const handleWithdrawAllSwaps = useCallback(async () => {
    if (!address) return;
    const readyNotes = userNotes.filter(n => (n.type === 'swap' || !n.type) && n.status === 'ready' && !isSpent(computeNullifierHash(n)));
    if (readyNotes.length === 0) return;
    
    setLoading(true);
    setStatus("Preparing bulk withdrawal...");
    try {
      const allCalls = [];
      for (const note of readyNotes) {
        const response = await fetch(`${process.env.NEXT_PUBLIC_ASP_SERVER_URL || 'http://127.0.0.1:3001'}/get_path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commitment: note.commitment, note_hash: note.noteHash })
        });
        const merkleData = await response.json();
        const nullifierHash = computeNullifierHash(note);
        
        allCalls.push({
          contractAddress: POOL_ADDRESS,
          entrypoint: 'add_root_with_path',
          calldata: [...toU256(note.commitment), toFelt(merkleData.path.length), ...merkleData.path.flatMap((p: string) => toU256(p)), toFelt(merkleData.index), ...toU256(merkleData.root)]
        });
        allCalls.push({
          contractAddress: POOL_ADDRESS,
          entrypoint: 'withdraw_public',
          calldata: [toFelt(0), ...toU256(merkleData.root), ...toU256(nullifierHash), toFelt(note.amount), note.token, address, ...toU256(0)]
        });
      }
      
      await writeTransaction(allCalls);
      readyNotes.forEach(n => {
        markSpent(computeNullifierHash(n));
        removeNote(n);
      });
      setUserNotes(getNotes());
      setMessage("Bulk withdrawal successful!");
    } catch (e: any) { setError(e.message); } finally { setLoading(false); setStatus(null); }
  }, [address, userNotes, writeTransaction]);

  const handleCollectAllFees = useCallback(async () => {
    if (!address) return;
    const lpNotes = userNotes.filter(n => n.type === 'lp' && n.status === 'ready' && !isSpent(computeNullifierHash(n)));
    if (lpNotes.length === 0) return;

    setLoading(true);
    setStatus("Preparing bulk fee collection...");
    try {
      const allCalls = [];
      for (const note of lpNotes) {
        const response = await fetch(`${process.env.NEXT_PUBLIC_ASP_SERVER_URL || 'http://127.0.0.1:3001'}/get_path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commitment: note.commitment, note_hash: note.noteHash })
        });
        const merkleData = await response.json();
        const nullifierHash = computeNullifierHash(note);
        const newComm = poseidon2([BigInt(note.noteHash), note.amount]);

        allCalls.push({
          contractAddress: POOL_ADDRESS,
          entrypoint: 'collect_fees_public',
          calldata: [toFelt(0), ...toU256(merkleData.root), ...toU256(note.noteHash), toFelt(note.tickLower || -887272), toFelt(note.tickUpper || 887272), address, ...toU256(toHex64(newComm))]
        });
      }
      await writeTransaction(allCalls);
      setMessage("Bulk fees collected!");
    } catch (e: any) { setError(e.message); } finally { setLoading(false); setStatus(null); }
  }, [address, userNotes, writeTransaction]);

  const handleRemoveAllLP = useCallback(async () => {
    if (!address) return;
    const lpNotes = userNotes.filter(n => n.type === 'lp' && n.status === 'ready' && !isSpent(computeNullifierHash(n)));
    if (lpNotes.length === 0) return;

    setLoading(true);
    setStatus("Removing all liquidity positions...");
    try {
      const allCalls = [];
      for (const note of lpNotes) {
        const response = await fetch(`${process.env.NEXT_PUBLIC_ASP_SERVER_URL || 'http://127.0.0.1:3001'}/get_path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commitment: note.commitment, note_hash: note.noteHash })
        });
        const merkleData = await response.json();
        const nullifierHash = computeNullifierHash(note);
        
        allCalls.push({
          contractAddress: POOL_ADDRESS,
          entrypoint: 'add_root_with_path',
          calldata: [...toU256(note.commitment), toFelt(merkleData.path.length), ...merkleData.path.flatMap((p: string) => toU256(p)), toFelt(merkleData.index), ...toU256(merkleData.root)]
        });
        allCalls.push({
          contractAddress: POOL_ADDRESS,
          entrypoint: 'remove_liquidity_public',
          calldata: [
            toFelt(0), 
            ...toU256(merkleData.root), 
            ...toU256(note.noteHash), 
            toFelt(note.tickLower || -887272), 
            toFelt(note.tickUpper || 887272), 
            address
          ]
        });
      }
      await writeTransaction(allCalls);
      lpNotes.forEach(n => {
        markSpent(computeNullifierHash(n));
        removeNote(n);
      });
      setUserNotes(getNotes());
      setMessage("All liquidity removed! Principal and fees sent to wallet.");
    } catch (e: any) { setError(e.message); } finally { setLoading(false); setStatus(null); }
  }, [address, userNotes, writeTransaction]);

  return (
    <div className="min-h-screen bg-[#020202] text-white selection:bg-purple-500/30 font-sans antialiased">
      {/* Background Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-[-10%] right-[-10%] w-[70vw] h-[70vw] bg-purple-600/10 blur-[120px] rounded-full opacity-50" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[70vw] h-[70vw] bg-blue-600/10 blur-[120px] rounded-full opacity-50" />
      </div>

      {/* Navigation */}
      <nav className="px-8 py-5 flex justify-between items-center bg-black/40 backdrop-blur-xl top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 bg-gradient-to-tr from-purple-600 to-blue-500 rounded-xl flex items-center justify-center shadow-2xl shadow-purple-500/20 group hover:rotate-6 transition-transform">
            <Shield className="text-white w-6 h-6" />
          </div>
          <div>
            <span className="text-2xl font-black tracking-tightest leading-none">ZYLITH</span>
            <div className="text-[10px] font-black text-purple-400/60 tracking-[0.2em] uppercase mt-0.5">Privacy Engine</div>
          </div>
        </div>
        
        <div className="hidden md:flex bg-white/5 p-1.5 rounded-2xl border border-white/10 shadow-inner">
          <button onClick={() => setMode('swap')} className={`px-8 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${mode === 'swap' ? 'bg-white/10 text-white shadow-lg' : 'text-white/30 hover:text-white/60'}`}>Swap</button>
          <button onClick={() => setMode('pool')} className={`px-8 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${mode === 'pool' ? 'bg-white/10 text-white shadow-lg' : 'text-white/30 hover:text-white/60'}`}>Pool</button>
        </div>

        <div className="flex items-center gap-4">
          <ConnectWallet />
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-8 pt-16 pb-32">
        {/* Header Section */}
        <div className="text-center mb-16 space-y-6">
          <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-purple-500/5 border border-purple-500/20 text-purple-400 text-[10px] font-black tracking-[0.2em] uppercase">
            <Zap className="w-3.5 h-3.5 fill-purple-400" /> Starknet Shielded Pool
          </div>
          <h1 className="text-5xl md:text-7xl font-black tracking-tightest leading-[0.9]">
            Private <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">Concentrated</span> Liquidity.
          </h1>
        </div>

        <div className="flex flex-col lg:flex-row gap-12 items-start justify-center">
          {/* Main Swap Card */}
          <div className="w-full max-w-[480px] shrink-0">
            <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-blue-600 rounded-[40px] blur opacity-20 group-hover:opacity-30 transition duration-1000"></div>
            <div className="relative glass rounded-[38px] p-8 shadow-3xl border border-white/10">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-xl font-black uppercase tracking-[0.1em]">{mode === 'swap' ? 'Private Swap' : 'Private LP'}</h2>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
                  <Lock className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Shielded Mode</span>
                </div>
              </div>

              {/* In-card Stats */}
              <div className="grid grid-cols-3 gap-2 mb-6">
                <div className="bg-white/[0.03] p-3 rounded-2xl border border-white/5">
                  <div className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1">wBTC Reserve</div>
                  <div className="text-xs font-black">{(Number(reserves.res0)/1e8).toFixed(4)}</div>
                </div>
                <div className="bg-white/[0.03] p-3 rounded-2xl border border-white/5">
                  <div className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1">ETH Reserve</div>
                  <div className="text-xs font-black">{(Number(reserves.res1)/1e8).toFixed(4)}</div>
                </div>
                <div className="bg-white/[0.03] p-3 rounded-2xl border border-white/5">
                  <div className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1">Ratio</div>
                  <div className="text-xs font-black">{`1:${priceRatio}`}</div>
                </div>
              </div>

              {error && (
                <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400">
                  <EyeOff className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] font-black uppercase tracking-wider">{error}</span>
                </div>
              )}
              {message && !error && (
                <div className="mb-6 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-emerald-300">
                  <Shield className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] font-black uppercase tracking-wider">{message}</span>
                </div>
              )}
              {status && !error && !message && (
                <div className="mb-6 p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center gap-3 text-blue-400">
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                  <span className="text-[10px] font-black uppercase tracking-wider">{status}</span>
                </div>
              )}

              <div className="space-y-3">
                {/* Input Panel */}
                <div className="bg-white/[0.03] rounded-3xl p-6 border border-white/5 hover:border-white/10 transition-colors group/panel">
                  <div className="flex justify-between text-[10px] font-black text-white/20 mb-4 uppercase tracking-[0.2em]">
                    <span>{swapDirection === '0to1' ? 'wBTC' : 'ETH'} Balance</span>
                    <span>Total: {Number((currentPublicBalance + totalBalance) / 100000000n).toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between items-center gap-4">
                    <input 
                      type="number" 
                      min="0"
                      value={amount} 
                      onKeyDown={(e) => {
                        if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                          e.preventDefault();
                        }
                      }}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '' || parseFloat(val) >= 0) {
                          setAmount(val);
                        }
                      }} 
                      placeholder="0.0" 
                      className="bg-transparent text-3xl font-black outline-none w-full placeholder:text-white/5 tracking-tighter" 
                    />
                    <button className="bg-white/5 px-4 py-2.5 rounded-2xl flex items-center gap-3 border border-white/10 hover:bg-white/10 transition-all shrink-0">
                      <div className={`w-6 h-6 rounded-full shadow-lg ${swapDirection === '0to1' ? 'bg-[#F7931A]' : 'bg-[#627EEA]'}`} />
                      <span className="font-black text-sm">{swapDirection === '0to1' ? 'wBTC' : 'ETH'}</span>
                    </button>
                  </div>
                </div>

                {/* Direction Switcher */}
                <div className="flex justify-center -my-6 relative z-10">
                  <button 
                    onClick={() => setSwapDirection(d => d === '0to1' ? '1to0' : '0to1')}
                    className="bg-[#0a0a0a] p-3 rounded-2xl border border-white/10 shadow-2xl hover:border-purple-500/50 hover:scale-110 active:scale-95 transition-all cursor-pointer group/btn"
                  >
                    <RotateCw className="w-5 h-5 text-purple-400 group-hover/btn:rotate-180 transition-transform duration-500" />
                  </button>
                </div>

                {/* Output Panel */}
                <div className="bg-white/[0.03] rounded-3xl p-6 border border-white/5 mt-3 group/panel">
                  <div className="flex justify-between text-[10px] font-black text-white/20 mb-4 uppercase tracking-[0.2em]">
                    <span>{mode === 'swap' ? 'You Receive (Shielded)' : `Required ${swapDirection === '0to1' ? 'ETH' : 'wBTC'} Deposit`}</span>
                    <span className="flex items-center gap-1.5 text-purple-400/60"><Shield className="w-3.5 h-3.5" /> Private Note</span>
                  </div>
                  <div className="flex justify-between items-center gap-4">
                    <div className={`${estimatedOutput.match(/[a-z]/i) ? 'text-sm' : 'text-3xl'} font-black tracking-tighter ${amount ? 'text-white' : 'text-white/5'}`}>
                      {estimatedOutput}
                    </div>
                    <button className="bg-white/5 px-4 py-2.5 rounded-2xl flex items-center gap-3 border border-white/10 opacity-60">
                      <div className={`w-6 h-6 rounded-full shadow-lg ${swapDirection === '0to1' ? 'bg-[#627EEA]' : 'bg-[#F7931A]'}`} />
                      <span className="font-black text-sm">{swapDirection === '0to1' ? 'ETH' : 'wBTC'}</span>
                    </button>
                  </div>
                </div>

              <div className="grid grid-cols-1 gap-3 mt-8">
                <button 
                  onClick={executeAction} 
                  disabled={loading || !amount || estimatedOutput.includes('Liquidity') || estimatedOutput.includes('Indexing')} 
                  className="relative group/action overflow-hidden bg-gradient-to-r from-purple-600 to-blue-600 p-[1px] rounded-2xl transition-all active:scale-[0.98] disabled:opacity-40"
                >
                  <div className="bg-[#0a0a0a]/80 group-hover/action:bg-transparent transition-colors py-4 px-6 rounded-[15px] flex items-center justify-center gap-3 cursor-pointer">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                      <>
                        <Shield className={`w-5 h-5 text-white ${estimatedOutput.includes('Indexing') ? 'animate-pulse' : 'fill-white/20'}`} />
                        <span className="text-[11px] font-black uppercase tracking-[0.2em]">
                          {estimatedOutput.includes('Indexing') ? 'Waiting for Indexing...' : (mode === 'swap' ? 'Execute Private Swap' : 'Execute Private LP Mint')}
                        </span>
                      </>
                    )}
                  </div>
                </button>
              </div>
              </div>
            </div>
          </div>
        </div>

          {/* Portfolio Sidebar */}
          <div className="w-full max-w-[440px] space-y-6">
            <div className="flex justify-between items-center px-2">
              <div className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Portfolio</div>
              <div className="px-4 py-2 rounded-xl bg-white/[0.03] border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/40">
                Total Shielded: {Number(totalBalance / 100000000n).toFixed(4)} Assets
              </div>
            </div>

            {/* Fees Box */}
            <div className="glass rounded-[32px] p-8 border border-white/10 bg-gradient-to-br from-emerald-500/[0.02] to-transparent">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">LP Rewards</div>
                  <div className="space-y-1">
                    <div className="text-2xl font-black tracking-tightest text-white">{feesEarned0.toFixed(6)} <span className="text-[10px] text-white/20 font-medium uppercase">wBTC</span></div>
                    <div className="text-2xl font-black tracking-tightest text-white">{feesEarned1.toFixed(6)} <span className="text-[10px] text-white/20 font-medium uppercase">ETH</span></div>
                  </div>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                  <TrendingUp className="w-6 h-6" />
                </div>
              </div>
              
              <div className="space-y-3">
                {userNotes.filter(n => n.type === 'lp' && !isSpent(computeNullifierHash(n))).map((note, i) => {
                  const sqrtPCurrent = poolState.sqrtPrice;
                  const tickL = note.tickLower || -887272;
                  const tickU = note.tickUpper || 887272;
                  const sqrtPL = getSqrtPriceAtTick(tickL);
                  const sqrtPU = getSqrtPriceAtTick(tickU);
                  
                  let a0 = 0n;
                  let a1 = 0n;
                  
                  if (sqrtPCurrent > 0n) {
                    if (sqrtPCurrent < sqrtPL) {
                      a0 = getAmount0Delta(sqrtPL, sqrtPU, note.amount);
                    } else if (sqrtPCurrent < sqrtPU) {
                      a0 = getAmount0Delta(sqrtPCurrent, sqrtPU, note.amount);
                      a1 = getAmount1Delta(sqrtPL, sqrtPCurrent, note.amount);
                    } else {
                      a1 = getAmount1Delta(sqrtPL, sqrtPU, note.amount);
                    }
                  }

                  return (
                    <div key={i} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-3">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black ${note.token === token0Address ? 'bg-[#F7931A]/10 text-[#F7931A]' : 'bg-[#627EEA]/10 text-[#627EEA]'}`}>
                            LP
                          </div>
                          <div className="space-y-0.5">
                            <div className="text-[10px] font-black uppercase tracking-wider">{(Number(a0)/1e8).toFixed(4)} wBTC</div>
                            <div className="text-[10px] font-black uppercase tracking-wider">{(Number(a1)/1e8).toFixed(4)} ETH</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[8px] font-black text-white/20 uppercase tracking-widest">#{note.commitment.slice(2, 8)}</div>
                          <div className="text-[7px] font-black text-purple-400/40 uppercase tracking-widest mt-1">{(Number(note.amount)/1e8).toFixed(2)} Liq</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button 
                          onClick={() => handleCollectFees(note)}
                          disabled={loading || note.status !== 'ready'}
                          className="py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-30 transition-all"
                        >
                          Claim Fees
                        </button>
                        <button 
                          onClick={async () => {
                            if (!address) return;
                            setLoading(true);
                            setStatus("Removing liquidity...");
                            try {
                              const response = await fetch(`${process.env.NEXT_PUBLIC_ASP_SERVER_URL || 'http://127.0.0.1:3001'}/get_path`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ commitment: note.commitment, note_hash: note.noteHash })
                              });
                              const merkleData = await response.json();
                              const nullifierHash = computeNullifierHash(note);
                            const calls = [
                              {
                                contractAddress: POOL_ADDRESS,
                                entrypoint: 'add_root_with_path',
                                calldata: [...toU256(note.commitment), toFelt(merkleData.path.length), ...merkleData.path.flatMap((p: string) => toU256(p)), toFelt(merkleData.index), ...toU256(merkleData.root)]
                              },
                              {
                                contractAddress: POOL_ADDRESS,
                                entrypoint: 'remove_liquidity_public',
                                calldata: [toFelt(0), ...toU256(merkleData.root), ...toU256(note.noteHash), toFelt(note.tickLower || -887272), toFelt(note.tickUpper || 887272), address]
                              }
                            ];
                              await writeTransaction(calls);
                              markSpent(nullifierHash);
                              removeNote(note);
                              setUserNotes(getNotes());
                              setMessage("Liquidity removed! Principal and fees sent to wallet.");
                            } catch (e: any) { setError(e.message); } finally { setLoading(false); setStatus(null); }
                          }}
                          disabled={loading || note.status !== 'ready'}
                          className="py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-[9px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500/20 disabled:opacity-30 transition-all"
                        >
                          Remove LP
                        </button>
                      </div>
                    </div>
                  );
                })}
                
                {/* Global LP Actions */}
                <div className="grid grid-cols-2 gap-3 pt-4 border-t border-white/5">
                  <button 
                    onClick={handleCollectAllFees}
                    disabled={loading || userNotes.filter(n => n.type === 'lp' && n.status === 'ready').length === 0}
                    className="py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-30 transition-all"
                  >
                    Withdraw All Fees
                  </button>
                  <button 
                    onClick={handleRemoveAllLP}
                    disabled={loading || userNotes.filter(n => n.type === 'lp' && n.status === 'ready').length === 0}
                    className="py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-[10px] font-black uppercase tracking-[0.2em] text-red-400 hover:bg-red-500/30 disabled:opacity-30 transition-all"
                  >
                    Remove All LP
                  </button>
                </div>
              </div>
            </div>

            {/* Swaps/Ready Box */}
            <div className="glass rounded-[32px] p-8 border border-white/10 bg-gradient-to-br from-blue-500/[0.02] to-transparent">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Ready to Withdraw</div>
                  <div className="space-y-1">
                    <div className="text-2xl font-black tracking-tightest text-white">{readyToWithdraw0.toFixed(6)} <span className="text-[10px] text-white/20 font-medium uppercase">wBTC</span></div>
                    <div className="text-2xl font-black tracking-tightest text-white">{readyToWithdraw1.toFixed(6)} <span className="text-[10px] text-white/20 font-medium uppercase">ETH</span></div>
                  </div>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-400">
                  <ArrowDownLeft className="w-6 h-6" />
                </div>
              </div>

              <div className="space-y-3">
                {userNotes.filter(n => (n.type === 'swap' || !n.type) && !isSpent(computeNullifierHash(n))).map((note, i) => (
                  <div key={i} className="flex justify-between items-center p-4 rounded-2xl bg-white/[0.03] border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black ${note.token === token0Address ? 'bg-[#F7931A]/10 text-[#F7931A]' : 'bg-[#627EEA]/10 text-[#627EEA]'}`}>
                        {note.token === token0Address ? 'B' : 'E'}
                      </div>
                      <div className="text-[10px] font-black uppercase tracking-wider">{(Number(note.amount)/1e8).toFixed(4)} {note.token === token0Address ? 'wBTC' : 'ETH'}</div>
                    </div>
                    <button 
                      onClick={() => handleWithdraw(note)}
                      disabled={loading || note.status !== 'ready'}
                      className="px-4 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[9px] font-black uppercase tracking-widest text-blue-400 hover:bg-blue-500/20 disabled:opacity-30 transition-all"
                    >
                      Withdraw
                    </button>
                  </div>
                ))}
                
                {/* Global Swap Action */}
                <div className="pt-4 border-t border-white/5">
                  <button 
                    onClick={handleWithdrawAllSwaps}
                    disabled={loading || userNotes.filter(n => (n.type === 'swap' || !n.type) && n.status === 'ready').length === 0}
                    className="w-full py-3 rounded-xl bg-blue-500/20 border border-blue-500/30 text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 hover:bg-blue-500/30 disabled:opacity-30 transition-all"
                  >
                    Withdraw All Swapped Assets
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-auto border-t border-white/5 py-12 px-12 flex flex-col md:flex-row justify-between items-center gap-8 bg-black/60 backdrop-blur-2xl">
        <div className="flex items-center gap-3 opacity-40 hover:opacity-100 transition-opacity">
          <Shield className="w-6 h-6 text-purple-500" />
          <span className="font-black text-sm tracking-widest uppercase">Zylith Protocol</span>
        </div>
        <div className="flex gap-12">
          <a href="#" className="text-[10px] font-black text-white/20 hover:text-purple-400 transition-colors uppercase tracking-[0.3em]">Documentation</a>
          <a href="#" className="text-[10px] font-black text-white/20 hover:text-purple-400 transition-colors uppercase tracking-[0.3em]">Governance</a>
          <a href="#" className="text-[10px] font-black text-white/20 hover:text-purple-400 transition-colors uppercase tracking-[0.3em]">Security</a>
        </div>
      </footer>
    </div>
  );
}
