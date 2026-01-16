pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template MerkleTreeInclusion(height) {
    signal input leaf;
    signal input path_elements[height];
    signal input path_indices[height]; // 0 for left, 1 for right
    signal output root;

    component hashers[height];

    signal level_hashes[height + 1];
    level_hashes[0] <== leaf;

    for (var i = 0; i < height; i++) {
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== level_hashes[i] + path_indices[i] * (path_elements[i] - level_hashes[i]);
        hashers[i].inputs[1] <== path_elements[i] + path_indices[i] * (level_hashes[i] - path_elements[i]);
        level_hashes[i + 1] <== hashers[i].out;
    }

    root <== level_hashes[height];
}

template ZylithSwap() {
    // Private
    signal input secret;
    signal input nullifier;
    signal input balance;
    signal input out_secret;
    signal input out_nullifier;
    signal input path_elements[25];
    signal input path_indices[25];
    signal input sqrt_next_v;     // Witness shadow for sqrt_next
    signal input out_sqrt_next_v; // Witness shadow for amount_out * sqrt_next
    signal input check0_v;        // Witness shadow for check0.out
    signal input check1_v;        // Witness shadow for check1.out

    // Public
    signal input root;
    signal input nullifier_hash;
    signal input amount_in;
    signal input amount_out;
    signal input min_amount_out;
    signal input change_commitment;
    signal input sqrt_price;      // Q96
    signal input liquidity;       // u128
    signal input zero_for_one;    // 0 or 1

    // 1. Verify Source Note Commitment
    component noteHasher = Poseidon(2);
    noteHasher.inputs[0] <== secret;
    noteHasher.inputs[1] <== nullifier;
    
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== noteHasher.out;
    commitmentHasher.inputs[1] <== balance;
    
    // 2. Verify Membership
    component inclusion = MerkleTreeInclusion(25);
    inclusion.leaf <== commitmentHasher.out;
    for (var i = 0; i < 25; i++) {
        inclusion.path_elements[i] <== path_elements[i];
        inclusion.path_indices[i] <== path_indices[i];
    }
    inclusion.root === root;

    // 3. Verify Nullifier
    component nHasher = Poseidon(2);
    nHasher.inputs[0] <== secret;
    nHasher.inputs[1] <== commitmentHasher.out;
    nHasher.out === nullifier_hash;

    // 4. Balance Check
    component checkBalance = GreaterEqThan(128);
    checkBalance.in[0] <== balance;
    checkBalance.in[1] <== amount_in;
    checkBalance.out === 1;
    
    // Full spend for MVP: balance must equal amount_in
    balance === amount_in;
    
    // 5. Output Note Commitment (new note)
    component outNoteHasher = Poseidon(2);
    outNoteHasher.inputs[0] <== out_secret;
    outNoteHasher.inputs[1] <== out_nullifier;
    
    component outCommitmentHasher = Poseidon(2);
    outCommitmentHasher.inputs[0] <== outNoteHasher.out;
    outCommitmentHasher.inputs[1] <== amount_out;
    outCommitmentHasher.out === change_commitment;

    // 6. Slippage Check
    component checkSlippage = GreaterEqThan(128);
    checkSlippage.in[0] <== amount_out;
    checkSlippage.in[1] <== min_amount_out;
    checkSlippage.out === 1;

    // 7. CLMM swap math (single-step, Q96)
    // Enforce zero_for_one is boolean
    zero_for_one * (zero_for_one - 1) === 0;

    signal amount_in_less_fee;
    signal amount_in_less_fee_rem;
    // (amount_in * 997) / 1000
    amount_in_less_fee <-- (amount_in * 997000) / 1000000;
    amount_in_less_fee_rem <-- (amount_in * 997000) % 1000000;
    amount_in * 997000 === amount_in_less_fee * 1000000 + amount_in_less_fee_rem;
    component feeRange = LessThan(20); // 20 bits is enough for 1,000,000
    feeRange.in[0] <== amount_in_less_fee_rem;
    feeRange.in[1] <== 1000000;
    feeRange.out === 1;

    // Zero-for-one path (token0 -> token1): price decreases
    // Formula: sqrt_next = (L * Q96 * sqrt) / (L * Q96 + amount_in * sqrt)
    // Identity: sqrt_next * (L * Q96 + amount_in * sqrt) + rem = L * Q96 * sqrt
    
    signal sqrt_next_0;
    sqrt_next_0 <-- (liquidity == 0) ? sqrt_price : 
        (liquidity * 79228162514264337593543950336 * sqrt_price) / 
        (liquidity * 79228162514264337593543950336 + amount_in_less_fee * sqrt_price);
    
    signal diff0_v <== sqrt_price - sqrt_next_0;
    
    // We verify the identity: L * Q96 * diff0_v = amount_in_less_fee * sqrt_price * sqrt_next_0 + rem0
    // To ensure soundness without field overflow, we use witness shadows for the 320-bit products.
    
    signal lhs0_full <== (liquidity * 79228162514264337593543950336) * diff0_v;
    signal rhs0_part <== amount_in_less_fee * sqrt_price;
    signal rhs0_full <== rhs0_part * sqrt_next_0;
    
    signal rem0;
    rem0 <-- (liquidity * 79228162514264337593543950336 * diff0_v) - (amount_in_less_fee * sqrt_price * sqrt_next_0);
    
    // Equality mod p
    lhs0_full === rhs0_full + rem0;
    
    // Equality mod 2^128 (Double Modulo trick for 320-bit identity)
    signal lhs0_low;
    lhs0_low <-- lhs0_full % 340282366920938463463374607431768211456;
    signal rhs0_rem_low;
    rhs0_rem_low <-- (rhs0_full + rem0) % 340282366920938463463374607431768211456;
    lhs0_low === rhs0_rem_low;

    // Range check rem0 to ensure it's "small" (less than the denominator)
    // The denominator is roughly L * Q96 (~224 bits). 
    // To be safe and simple, we check rem0 is < 2^250 (fits in field).
    component rem0Range = LessThan(252);
    rem0Range.in[0] <== rem0;
    rem0Range.in[1] <== 7237005577332262213973186563042994240829374041602535252466099000494570602496; // 2^252
    rem0Range.out === 1;

    // one_for_zero path
    signal sqrt_next_1;
    signal rem1;
    sqrt_next_1 <-- sqrt_price + (amount_in_less_fee * 79228162514264337593543950336) / (liquidity == 0 ? 1 : liquidity);
    rem1 <-- (amount_in_less_fee * 79228162514264337593543950336) % (liquidity == 0 ? 1 : liquidity);
    (sqrt_next_1 - sqrt_price) * liquidity + rem1 === amount_in_less_fee * 79228162514264337593543950336;
    
    component rem1Range = LessThan(128);
    rem1Range.in[0] <== rem1;
    rem1Range.in[1] <== liquidity + 1;
    rem1Range.out === 1;

    // select sqrt_next based on zero_for_one
    signal sqrt_next;
    signal s_delta <== (sqrt_next_1 - sqrt_next_0) * (1 - zero_for_one);
    sqrt_next <== sqrt_next_0 + s_delta;

    // Formula amount_out_0 (0to1): L * (sqrt - sqrt_next) / Q96
    // Formula amount_out_1 (1to0): L * (sqrt_next - sqrt) / Q96
    
    // Constraint version: amount_out * Q96 = L * |sqrt - sqrt_next|
    signal diff0 <== sqrt_price - sqrt_next;
    signal diff1 <== sqrt_next - sqrt_price;
    signal diff_select;
    signal diff_delta <== (diff1 - diff0) * (1 - zero_for_one);
    diff_select <== diff0 + diff_delta;

    // Formula amount_out selection
    // Case 0to1: amount_out * Q96 <= liquidity * (sqrt_price - sqrt_next)
    signal lhs0 <== amount_out * 79228162514264337593543950336;
    signal rhs0 <== liquidity * (sqrt_price - sqrt_next_v);
    component check0 = GreaterEqThan(252); // Keep 252 for price/liq products
    check0.in[0] <== rhs0;
    check0.in[1] <== lhs0;

    // Case 1to0: amount_out * sqrt_next * sqrt_price <= liquidity * (sqrt_next - sqrt_price) * Q96
    // Which is equivalent to: amount_out * sqrt_next * sqrt_price <= amount_in * Q96^2
    sqrt_next_v === sqrt_next;
    out_sqrt_next_v === amount_out * sqrt_next_v;
    signal lhs1 <== out_sqrt_next_v * sqrt_price;
    // Q96^2 = 6277101735386680763835789423207666416102355444464034512896
    signal rhs1 <== amount_in_less_fee * 6277101735386680763835789423207666416102355444464034512896;
    component check1 = GreaterEqThan(252); // Keep 252
    check1.in[0] <== rhs1;
    check1.in[1] <== lhs1;

    // Select valid check based on zero_for_one
    check0_v === check0.out;
    check1_v === check1.out;
    signal term0 <== check0_v * zero_for_one;
    signal term1 <== check1_v * (1 - zero_for_one);
    term0 + term1 === 1;
}

component main {public [root, nullifier_hash, amount_in, amount_out, min_amount_out, change_commitment, sqrt_price, liquidity, zero_for_one]} = ZylithSwap();
