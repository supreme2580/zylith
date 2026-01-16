pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template MerkleTreeInclusion(height) {
    signal input leaf;
    signal input path_elements[height];
    signal input path_indices[height];
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

template ZylithLP() {
    // Private
    signal input secret;
    signal input nullifier;
    signal input balance;
    signal input out_secret;
    signal input out_nullifier;
    signal input path_elements[25];
    signal input path_indices[25];

    // Public
    signal input root;
    signal input nullifier_hash;
    signal input amount_in;
    signal input tick_lower;
    signal input tick_upper;
    signal input change_commitment;
    signal input sqrt_price;   // Q96
    signal input sqrt_lower;   // Q96
    signal input sqrt_upper;   // Q96

    // 1. Verify Note Commitment
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

    // 4. LP Balance Check
    component checkBalance = GreaterEqThan(252);
    checkBalance.in[0] <== balance;
    checkBalance.in[1] <== amount_in;
    checkBalance.out === 1;

    // Full spend for MVP: balance must equal amount_in
    balance === amount_in;

    // 5. Output Note Commitment (new LP note)
    component outNoteHasher = Poseidon(2);
    outNoteHasher.inputs[0] <== out_secret;
    outNoteHasher.inputs[1] <== out_nullifier;
    
    component outCommitmentHasher = Poseidon(2);
    outCommitmentHasher.inputs[0] <== outNoteHasher.out;
    outCommitmentHasher.inputs[1] <== amount_in;
    outCommitmentHasher.out === change_commitment;

    // 6. Range sanity checks
    component rangeCheck = LessThan(252);
    rangeCheck.in[0] <== sqrt_lower;
    rangeCheck.in[1] <== sqrt_upper;
    rangeCheck.out === 1;
}

component main {public [root, nullifier_hash, amount_in, tick_lower, tick_upper, change_commitment, sqrt_price, sqrt_lower, sqrt_upper]} = ZylithLP();
