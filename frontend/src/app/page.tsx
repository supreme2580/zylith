"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { 
  Shield, 
  Zap, 
  ArrowDownLeft, 
  Loader2, 
  Lock, 
  EyeOff, 
  TrendingUp,
  RotateCw,
} from "lucide-react";
import ConnectWallet from "../components/ConnectWallet";
import { useAccount, useSendTransaction, useReadContract, useProvider, Abi } from "@starknet-react/core";
import { poseidon2 } from "poseidon-lite";
import { generateZylithSwapProof, generateZylithLPProof, generateZylithWithdrawProof, generateZylithLPOwnershipProof, formatGroth16ProofForStarknet } from "../lib/proof";
import { createShieldedNote, saveNote, getNotes, ShieldedNote, computeNullifierHash, removeNote, markSpent, isSpent, updateNoteStatus } from "../lib/notes";
import { TOKEN0_ABI } from "../lib/abis";
import { POOL_ADDRESS, ASP_SERVER_URL } from "../lib/constants";
import { TokenMeta, Mode, SwapDirection } from "../lib/types";
import {
  toU256,
  toFelt,
  parseAmount,
  formatAmount,
  toHex64,
  getSqrtPriceAtTick,
  getLiquidityFromAmount0,
  getLiquidityFromAmount1,
  getAmount0Delta,
  getAmount1Delta,
  calculateSwapOutput,
  parsePoolState,
  parseReserves,
  parseBalance,
  calculatePoolRange,
  calculatePriceRatio,
  calculateEstimatedOutput,
} from "../lib/utils";
import { Q96, LP_APPROVAL_BUFFER, LP_BUFFER_DENOMINATOR } from "../lib/utils/constants";

export default function Home() {
  const [mode, setMode] = useState<Mode>('swap');
  const [amount, setAmount] = useState('');
  const [swapDirection, setSwapDirection] = useState<SwapDirection>('0to1');
  const [tickLower, setTickLower] = useState('-887272');
  const [tickUpper, setTickUpper] = useState('887272');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [userNotes, setUserNotes] = useState<ShieldedNote[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const { address } = useAccount();
  const { provider } = useProvider();

  // Reset amount when mode or direction changes
  useEffect(() => {
    setAmount('');
    setError(null);
    setMessage(null);
    setStatus(null);
  }, [mode, swapDirection]);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    const fetchTokens = async () => {
      try {
        const resp = await fetch(`${ASP_SERVER_URL}/tokens`, { cache: 'no-store' });
        if (!resp.ok) return;
        const data = await resp.json();
        if (data?.tokens?.length) {
          setTokens(data.tokens);
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        }
      } catch {
        // keep defaults if backend is unavailable
      }
    };
    fetchTokens();
    timer = setInterval(fetchTokens, 5000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

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
    return parsePoolState(poolStateData);
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

  const token0Meta =  tokens[0];
  const token1Meta = tokens[1];
  const token0Label = token0Meta?.symbol || token0Meta?.name;
  const token1Label = token1Meta?.symbol || token1Meta?.name;

  const reserves = useMemo(() => {
    return parseReserves(reservesData);
  }, [reservesData]);

  const { data: balanceData0 } = useReadContract({
    functionName: 'balance_of',
    args: [address || '0x0'] as `0x${string}`[],
    abi: TOKEN0_ABI as Abi,
    address: token0Meta?.address as `0x${string}`,
    watch: true,
  });

  const { data: balanceData1 } = useReadContract({
    functionName: 'balance_of',
    args: [address || '0x0'] as `0x${string}`[],
    abi: TOKEN0_ABI as Abi,
    address: token1Meta?.address as `0x${string}`,
    watch: true,
  });

  const publicBalance0 = useMemo(() => parseBalance(balanceData0), [balanceData0]);
  const publicBalance1 = useMemo(() => parseBalance(balanceData1), [balanceData1]);

  const currentPublicBalance = useMemo(() => {
    return swapDirection === '0to1' ? publicBalance0 : publicBalance1;
  }, [swapDirection, publicBalance0, publicBalance1]);

  // Load notes on mount
  useEffect(() => {
    setUserNotes(getNotes());
  }, []);

  const totalBalance = useMemo(() => {
    const targetToken = swapDirection === '0to1' ? token0Meta?.address : token1Meta?.address;
    return userNotes
      .filter(n => n.token === targetToken)
      .reduce((acc, note) => acc + note.amount, BigInt(0));
  }, [userNotes, swapDirection, token0Meta?.address, token1Meta?.address]);

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
                    const response = await fetch(`${ASP_SERVER_URL}/get_path`, {
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
            const totalReady0 = readyNotes
              .filter(n => n.token === token0Meta?.address)
              .reduce((acc, n) => acc + Number(formatAmount(n.amount, token0Meta?.decimals ?? 18, 6)), 0);
            const totalReady1 = readyNotes
              .filter(n => n.token === token1Meta?.address)
              .reduce((acc, n) => acc + Number(formatAmount(n.amount, token1Meta?.decimals ?? 6, 6)), 0);
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
            setFeesEarned0(Number(formatAmount(totalOwed0, token0Meta?.decimals ?? 18, 6)));
            setFeesEarned1(Number(formatAmount(totalOwed1, token1Meta?.decimals ?? 6, 6)));

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
    return calculatePriceRatio(
      poolState.sqrtPrice,
      token0Meta?.decimals ?? 18,
      token1Meta?.decimals ?? 6
    );
  }, [poolState.sqrtPrice, token0Meta?.decimals, token1Meta?.decimals]);

  const poolRange = useMemo(() => {
    return calculatePoolRange(poolState, tickLower, tickUpper);
  }, [poolState, tickLower, tickUpper]);

  const currentShieldedBalance = useMemo(() => {
    return userNotes
      .filter(n => n.token === (swapDirection === '0to1' ? token0Meta?.address : token1Meta?.address) && n.status === 'ready')
      .reduce((acc, n) => acc + n.amount, 0n);
  }, [userNotes, swapDirection, token0Meta?.address, token1Meta?.address]);

  const estimatedOutput = useMemo(() => {
    return calculateEstimatedOutput(
      amount,
      mode,
      swapDirection,
      poolState,
      poolRange,
      tickLower,
      tickUpper,
      token0Meta,
      token1Meta,
      currentShieldedBalance,
      currentPublicBalance
    );
  }, [amount, mode, swapDirection, poolState, poolRange, tickLower, tickUpper, token0Meta, token1Meta, currentShieldedBalance, currentPublicBalance]);

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
      const inputDecimals = swapDirection === '0to1'
        ? (token0Meta?.decimals ?? 18)
        : (token1Meta?.decimals ?? 6);
      const amountBI = parseAmount(amount, inputDecimals);
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
        if (sqrtPCurrent < sqrtPLower && swapDirection === '1to0') throw new Error(`Range below price: only ${token1Label} allowed`);
        if (sqrtPCurrent > sqrtPUpper && swapDirection === '0to1') throw new Error(`Range above price: only ${token0Label} allowed`);
      }

      const tokenAddr = swapDirection === '0to1' ? token0Meta?.address : token1Meta?.address;
      const calls: any[] = [];

      // --- TOKEN-SPECIFIC NOTE SEARCH (READY ONLY) ---
      const spendNote = userNotes.find(n => {
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
        const response = await fetch(`${ASP_SERVER_URL}/get_path`, {
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
          ? (swapDirection === '0to1' ? token1Meta?.address : token0Meta?.address)
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
        // Submit private call
        await writeTransaction(calls);
        // Mark spent note as consumed, keep only output note
        markSpent(nullifierHash);
        removeNote(spendNote);
        saveNote(outNote);
        setUserNotes(getNotes());
      } else {
        // --- 2. SHIELDING ACTION (Wallet -> Note) ---
        setStatus("Approving tokens...");
        const resultToken = mode === 'swap' ? (swapDirection === '0to1' ? token1Meta?.address : token0Meta?.address) : tokenAddr;
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
          const otherTokenAddr = swapDirection === '0to1' ? token1Meta?.address : token0Meta?.address;
          
          const sqrtPCurrent = poolState.sqrtPrice;
          const sqrtPLower = getSqrtPriceAtTick(parseInt(tickLower));
          const sqrtPUpper = getSqrtPriceAtTick(parseInt(tickUpper));
          
          let otherAmountBI = 0n;

          if (swapDirection === '0to1') {
            const liq = getLiquidityFromAmount0(sqrtPCurrent, sqrtPUpper, amountBI);
            const computed = getAmount1Delta(sqrtPLower, sqrtPCurrent, liq);
            otherAmountBI = computed;
          } else {
            const liq = getLiquidityFromAmount1(sqrtPLower, sqrtPCurrent, amountBI);
            const computed = getAmount0Delta(sqrtPCurrent, sqrtPUpper, liq);
            otherAmountBI = computed;
          }
          
          // Add 0.5% buffer to approval to prevent "insufficient allowance" due to contract-side rounding up
          const otherAmountWithBuffer = (otherAmountBI * LP_APPROVAL_BUFFER) / LP_BUFFER_DENOMINATOR;

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
        // Submit shielding call
        await writeTransaction(calls);
        
        // --- CALCULATE LIQUIDITY FOR NOTE ---
        let finalNoteAmount = 0n;
        if (mode === 'swap') {
          finalNoteAmount = calculateSwapOutput(
            amountBI,
            poolState.sqrtPrice,
            poolState.liquidity,
            swapDirection === '0to1'
          );
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
      const response = await fetch(`${ASP_SERVER_URL}/get_path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitment: note.commitment, note_hash: note.noteHash })
      });
      const merkleData = await response.json();
      if (!merkleData || merkleData.root === "0x0") throw new Error("Merkle path not found yet.");

      const nullifierHash = computeNullifierHash(note);

      // 2. Generate withdrawal proof
      setStatus("Generating withdrawal proof...");
      const { proof, publicInputs } = await generateZylithWithdrawProof(
        note.secret,
        note.nullifier,
        note.amount,
        note.amount, // Full withdrawal
        { path: merkleData.path, indices: merkleData.indices },
        merkleData.root,
        0n // No change commitment (full withdrawal)
      );
      const formattedProof = await formatGroth16ProofForStarknet(proof, publicInputs, "/circuits/withdraw_vk.json");

      // 3. Build Call
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
            ...formattedProof,
            ...toU256(merkleData.root),
            ...toU256(nullifierHash),
            toFelt(note.amount),
            note.token,
            address,
            ...toU256("0") // No change commitment (full withdrawal)
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
      const response = await fetch(`${ASP_SERVER_URL}/get_path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitment: note.commitment, note_hash: note.noteHash })
      });
      const merkleData = await response.json();
      if (!merkleData || merkleData.root === "0x0") throw new Error("Merkle path not found yet.");

      const sqrtLower = getSqrtPriceAtTick(note.tickLower || -887272);
      const sqrtUpper = getSqrtPriceAtTick(note.tickUpper || 887272);

      setStatus("Generating ownership proof...");
      const { proof, publicInputs } = await generateZylithLPOwnershipProof(
        note.secret,
        note.nullifier,
        note.amount,
        note.tickLower || -887272,
        note.tickUpper || 887272,
        { path: merkleData.path, indices: merkleData.indices },
        merkleData.root,
        { sqrtPrice: poolState.sqrtPrice, sqrtLower, sqrtUpper }
      );
      const formattedProof = await formatGroth16ProofForStarknet(proof, publicInputs, "/circuits/lp_vk.json");

      const newComm = poseidon2([BigInt(note.noteHash), note.amount]);

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
          entrypoint: 'collect_fees_public',
          calldata: [...formattedProof, ...toU256(merkleData.root), ...toU256(note.noteHash), toFelt(note.tickLower || -887272), toFelt(note.tickUpper || 887272), address, ...toU256(toHex64(newComm))]
        }
      ];

      setStatus("Submitting fee collection...");
      await writeTransaction(calls);
      setMessage("Fees collected! Check your wallet.");
    } catch (e: any) { setError(e.message); } finally { setLoading(false); setStatus(null); }
  }, [address, writeTransaction, poolState.sqrtPrice]);

  return (
    <div className="min-h-screen bg-[#020202] text-white selection:bg-purple-500/30 font-sans antialiased flex flex-col">
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

      <main className="max-w-6xl mx-auto px-8 py-8 flex-1">
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
                    <span>{swapDirection === '0to1' ? token0Label : token1Label} Balance</span>
                    <span>Total: {formatAmount(currentPublicBalance + totalBalance, swapDirection === '0to1' ? (token0Meta?.decimals ?? 18) : (token1Meta?.decimals ?? 6), 4)}</span>
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
                      {swapDirection === '0to1' ? (
                        token0Meta?.logo ? (
                          <img src={token0Meta.logo} alt={token0Meta.symbol} className="w-6 h-6 rounded-full shadow-lg" />
                        ) : (
                          <div className="w-6 h-6 rounded-full shadow-lg bg-[#F7931A]" />
                        )
                      ) : (
                        token1Meta?.logo ? (
                          <img src={token1Meta.logo} alt={token1Meta.symbol} className="w-6 h-6 rounded-full shadow-lg" />
                        ) : (
                          <div className="w-6 h-6 rounded-full shadow-lg bg-[#627EEA]" />
                        )
                      )}
                      <span className="font-black text-sm">{swapDirection === '0to1' ? token0Label : token1Label}</span>
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
                    <span>{mode === 'swap' ? 'You Receive (Shielded)' : `Required ${swapDirection === '0to1' ? token1Label : token0Label} Deposit`}</span>
                    <span className="flex items-center gap-1.5 text-purple-400/60"><Shield className="w-3.5 h-3.5" /> Private Note</span>
                  </div>
                  <div className="flex justify-between items-center gap-4">
                    <div className={`${estimatedOutput.match(/[a-z]/i) ? 'text-sm' : 'text-3xl'} font-black tracking-tighter ${amount ? 'text-white' : 'text-white/5'}`}>
                      {estimatedOutput}
                    </div>
                    <button className="bg-white/5 px-4 py-2.5 rounded-2xl flex items-center gap-3 border border-white/10 opacity-60">
                      {swapDirection === '0to1' ? (
                        token1Meta?.logo ? (
                          <img src={token1Meta.logo} alt={token1Meta.symbol} className="w-6 h-6 rounded-full shadow-lg" />
                        ) : (
                          <div className="w-6 h-6 rounded-full shadow-lg bg-[#627EEA]" />
                        )
                      ) : (
                        token0Meta?.logo ? (
                          <img src={token0Meta.logo} alt={token0Meta.symbol} className="w-6 h-6 rounded-full shadow-lg" />
                        ) : (
                          <div className="w-6 h-6 rounded-full shadow-lg bg-[#F7931A]" />
                        )
                      )}
                      <span className="font-black text-sm">{swapDirection === '0to1' ? token1Label : token0Label}</span>
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

              {/* In-card Stats */}
              <div className="flex flex-row space-x-2 mb-6">
                <div className="bg-white/[0.03] p-3 rounded-2xl border border-white/5 flex-1">
                  <div className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1">Fees</div>
                  <div className="text-[9px] font-black leading-tight">
                    There is a 0.3% swap fee and 0.3% LP fee
                  </div>
                </div>
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
                Total Shielded: {formatAmount(totalBalance, swapDirection === '0to1' ? (token0Meta?.decimals ?? 18) : (token1Meta?.decimals ?? 6), 4)} Assets
              </div>
            </div>

            {/* Swaps/Ready Box */}
            <div className="glass rounded-[32px] p-8 border border-white/10 bg-gradient-to-br from-blue-500/[0.02] to-transparent">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Ready to Withdraw</div>
                  <div className="space-y-1">
                    <div className="text-2xl font-black tracking-tightest text-white">{readyToWithdraw0.toFixed(6)} <span className="text-[10px] text-white/20 font-medium uppercase">{token0Label}</span></div>
                    <div className="text-2xl font-black tracking-tightest text-white">{readyToWithdraw1.toFixed(6)} <span className="text-[10px] text-white/20 font-medium uppercase">{token1Label}</span></div>
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
                      {note.token === token0Meta?.address ? (
                        token0Meta?.logo ? (
                          <img src={token0Meta.logo} alt={token0Meta.symbol} className="w-8 h-8 rounded-lg shadow-lg" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg shadow-lg bg-[#F7931A]" />
                        )
                      ) : (
                        token1Meta?.logo ? (
                          <img src={token1Meta.logo} alt={token1Meta.symbol} className="w-8 h-8 rounded-lg shadow-lg" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg shadow-lg bg-[#627EEA]" />
                        )
                      )}
                      <div className="text-[10px] font-black uppercase tracking-wider">{formatAmount(note.amount, note.token === token0Meta?.address ? (token0Meta?.decimals ?? 18) : (token1Meta?.decimals ?? 6), 4)} {note.token === token0Meta?.address ? token0Label : token1Label}</div>
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
              </div>
            </div>

            {/* Fees Box */}
            <div className="glass rounded-[32px] p-8 border border-white/10 bg-gradient-to-br from-emerald-500/[0.02] to-transparent">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">LP Rewards</div>
                  <div className="space-y-1">
                    <div className="text-2xl font-black tracking-tightest text-white">Rewards and LP Positions</div>
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
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black ${note.token === token0Meta?.address ? 'bg-[#F7931A]/10 text-[#F7931A]' : 'bg-[#627EEA]/10 text-[#627EEA]'}`}>
                            LP
                          </div>
                          <div className="space-y-0.5">
                            <div className="text-[10px] font-black uppercase tracking-wider">{formatAmount(a0, token0Meta?.decimals ?? 18, 4)} {token0Label}</div>
                            <div className="text-[10px] font-black uppercase tracking-wider">{formatAmount(a1, token1Meta?.decimals ?? 6, 4)} {token1Label}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[8px] font-black text-white/20 uppercase tracking-widest">#{note.commitment.slice(2, 8)}</div>
                          <div />
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
                              setStatus("Fetching Merkle path...");
                              const response = await fetch(`${ASP_SERVER_URL}/get_path`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ commitment: note.commitment, note_hash: note.noteHash })
                              });
                              const merkleData = await response.json();
                              if (!merkleData || merkleData.root === "0x0") throw new Error("Merkle path not found yet.");

                              const sqrtLower = getSqrtPriceAtTick(note.tickLower || -887272);
                              const sqrtUpper = getSqrtPriceAtTick(note.tickUpper || 887272);

                              setStatus("Generating ownership proof...");
                              const { proof, publicInputs } = await generateZylithLPOwnershipProof(
                                note.secret,
                                note.nullifier,
                                note.amount,
                                note.tickLower || -887272,
                                note.tickUpper || 887272,
                                { path: merkleData.path, indices: merkleData.indices },
                                merkleData.root,
                                { sqrtPrice: poolState.sqrtPrice, sqrtLower, sqrtUpper }
                              );
                              const formattedProof = await formatGroth16ProofForStarknet(proof, publicInputs, "/circuits/lp_vk.json");

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
                                  calldata: [...formattedProof, ...toU256(merkleData.root), ...toU256(note.noteHash), toFelt(note.tickLower || -887272), toFelt(note.tickUpper || 887272), address]
                              }
                            ];
                              setStatus("Submitting LP removal...");
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
                
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-auto border-t border-white/5 py-4 px-12 flex flex-col md:flex-row justify-between items-center gap-8 bg-black/60 backdrop-blur-2xl">
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
